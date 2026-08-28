import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_STALE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_MS = 50;
const DEFAULT_RECLAIM_GRACE_MS = 25;
const LOCK_DIRECTORY_NAME = ".state.lock";

export interface StateLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  reclaimGraceMs?: number;
  releaseGraceMs?: number;
  releaseTimeoutMs?: number;
  heartbeatMs?: number;
}

interface LockOwner {
  token: string;
  pid: number;
  createdAt: string;
}

export async function acquireStateLock(
  stateRoot: string,
  options: StateLockOptions = {},
): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const reclaimGraceMs = options.reclaimGraceMs ?? DEFAULT_RECLAIM_GRACE_MS;
  const releaseGraceMs = options.releaseGraceMs ?? 0;
  const releaseTimeoutMs = options.releaseTimeoutMs ?? Math.max(1000, reclaimGraceMs * 4);
  const startedAt = Date.now();
  const lockPath = join(stateRoot, LOCK_DIRECTORY_NAME);
  const ownerPath = join(lockPath, "owner.json");
  const token = randomUUID();
  const pendingPath = join(stateRoot, `${LOCK_DIRECTORY_NAME}.${token}.pending`);
  const pendingOwnerPath = join(pendingPath, "owner.json");
  const owner: LockOwner = {
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };

  await mkdir(stateRoot, { recursive: true });
  await mkdir(pendingPath);
  try {
    await writeFile(pendingOwnerPath, `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    while (true) {
      try {
        await rename(pendingPath, lockPath);
      } catch (error) {
        if (!isLockOccupiedError(error)) throw error;
        if (!(await lockExists(lockPath))) {
          if (Date.now() - startedAt >= timeoutMs) throw error;
          await sleep(retryMs);
          continue;
        }

        if (await tryReclaimStaleLock(lockPath, ownerPath, staleMs, token, reclaimGraceMs)) {
          continue;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(
            `Timed out waiting for another Kibana MCP setup process to release '${lockPath}'.`,
          );
        }
        await sleep(retryMs);
        continue;
      }

      const heartbeatMs =
        options.heartbeatMs ?? Math.min(30000, Math.max(1000, Math.floor(staleMs / 3)));
      const heartbeatClaimStaleMs = Math.max(1000, Math.min(staleMs, 30000));
      let heartbeatInFlight = Promise.resolve();
      const heartbeat = setInterval(() => {
        heartbeatInFlight = heartbeatInFlight
          .then(() => refreshOwnerHeartbeat(lockPath, ownerPath, token, heartbeatClaimStaleMs))
          .catch(() => {});
      }, heartbeatMs);
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        await heartbeatInFlight;
        // The critical section has already committed or rolled back. Release is best effort;
        // lease recovery handles any remaining lock without changing that outcome.
        await releaseOwnedLock(
          lockPath,
          ownerPath,
          token,
          staleMs,
          retryMs,
          reclaimGraceMs,
          releaseGraceMs,
          releaseTimeoutMs,
        ).catch(() => {});
      };
    }
  } catch (error) {
    await rm(pendingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function refreshOwnerHeartbeat(
  lockPath: string,
  ownerPath: string,
  ownerToken: string,
  claimStaleMs: number,
): Promise<void> {
  const claimPath = join(lockPath, ".reclaim");
  const claimToken = `${ownerToken}.heartbeat.${randomUUID()}`;
  const releaseClaim = await acquireTransitionLease(claimPath, claimToken, claimStaleMs);
  if (!releaseClaim) return;
  try {
    if ((await readOwner(ownerPath))?.token !== ownerToken) return;
    const now = new Date();
    await utimes(ownerPath, now, now);
  } finally {
    await releaseClaim();
  }
}

async function acquireTransitionLease(
  claimPath: string,
  token: string,
  staleMs: number,
): Promise<((removeMarker?: boolean) => Promise<void>) | undefined> {
  if (!(await acquireReclaimClaim(claimPath, token, staleMs))) return undefined;
  const claimHandle = await open(claimPath, "r+");
  const heartbeatMs = Math.max(100, Math.floor(staleMs / 3));
  const heartbeat = setInterval(() => {
    const now = new Date();
    void claimHandle.utimes(now, now).catch(() => {});
  }, heartbeatMs);
  heartbeat.unref();
  return async (removeMarker = true) => {
    clearInterval(heartbeat);
    await claimHandle.close().catch(() => {});
    if (removeMarker && (await claimIsOwned(claimPath, token))) {
      await rm(claimPath, { force: true }).catch(() => {});
    }
  };
}

async function releaseOwnedLock(
  lockPath: string,
  ownerPath: string,
  token: string,
  staleMs: number,
  retryMs: number,
  reclaimGraceMs: number,
  releaseGraceMs: number,
  releaseTimeoutMs: number,
): Promise<void> {
  const releasePath = join(lockPath, `.release.${token}`);
  const releaseDeadline = Date.now() + releaseTimeoutMs;
  const claimPath = join(lockPath, ".reclaim");
  const claimStaleMs = Math.max(1000, Math.min(staleMs, 30000), reclaimGraceMs * 4);
  let releaseClaim: ((removeMarker?: boolean) => Promise<void>) | undefined;

  while (!releaseClaim) {
    releaseClaim = await acquireTransitionLease(claimPath, token, claimStaleMs);
    if (releaseClaim) break;
    if (Date.now() >= releaseDeadline) return;
    await sleep(Math.max(1, Math.min(10, retryMs)));
  }

  try {
    const ownerBeforeRelease = await readOwner(ownerPath);
    const partialRelease = await readOwner(releasePath);
    if (ownerBeforeRelease?.token !== token && partialRelease?.token !== token) return;

    while (true) {
      try {
        await rename(ownerPath, releasePath);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        const existingReleaseOwner = await readOwner(releasePath);
        if (existingReleaseOwner?.token === token) break;
        if (!(await hasLockTransitionMarker(lockPath))) return;
        if (Date.now() >= releaseDeadline) return;
        await sleep(Math.max(1, Math.min(10, retryMs)));
        continue;
      }
      break;
    }

    const claimedOwner = await readOwner(releasePath);
    if (claimedOwner?.token !== token) {
      await rename(releasePath, ownerPath).catch(() => {});
      return;
    }
    if (releaseGraceMs > 0) await sleep(releaseGraceMs);
    if ((await readOwner(releasePath))?.token !== token) return;
    if (!(await claimIsOwned(claimPath, token))) return;
    await releaseClaim(false);
    await removeLockGeneration(lockPath, token, "released");
  } finally {
    await releaseClaim();
  }
}

async function tryReclaimStaleLock(
  lockPath: string,
  ownerPath: string,
  staleMs: number,
  claimantToken: string,
  reclaimGraceMs: number,
): Promise<boolean> {
  const claimPath = join(lockPath, ".reclaim");
  const claimStaleMs = Math.max(1000, Math.min(staleMs, 30000), reclaimGraceMs * 4);
  const observedOwner = await readOwner(ownerPath);
  const ownerStat = await stat(ownerPath).catch(() => undefined);
  if (ownerStat) {
    if (Date.now() - ownerStat.mtimeMs <= staleMs) return false;
  } else {
    const claimStat = await stat(claimPath).catch(() => undefined);
    if (claimStat && Date.now() - claimStat.mtimeMs <= claimStaleMs) return false;
    const claimedOwnerStat = await newestTransitionOwnerStat(lockPath);
    if (claimedOwnerStat && Date.now() - claimedOwnerStat.mtimeMs <= staleMs) return false;
    if (!claimStat && !claimedOwnerStat) {
      const lockStat = await stat(lockPath).catch(() => undefined);
      if (!lockStat || Date.now() - lockStat.mtimeMs <= staleMs) return false;
    }
  }

  if (!(await acquireReclaimClaim(claimPath, claimantToken, claimStaleMs))) return false;
  const claimHandle = await open(claimPath, "r+");
  const claimHeartbeatMs = Math.max(100, Math.floor(claimStaleMs / 3));
  const claimHeartbeat = setInterval(() => {
    const now = new Date();
    void claimHandle.utimes(now, now).catch(() => {});
  }, claimHeartbeatMs);
  claimHeartbeat.unref();

  try {
    if (reclaimGraceMs > 0) await sleep(reclaimGraceMs);
    if (!(await claimIsOwned(claimPath, claimantToken))) return false;
    const claimedOwnerPath = join(lockPath, `.owner.${claimantToken}`);
    try {
      await rename(ownerPath, claimedOwnerPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        if (
          !(await claimIsOwned(claimPath, claimantToken)) ||
          observedOwner ||
          (await readOwner(ownerPath))
        ) {
          return false;
        }
        clearInterval(claimHeartbeat);
        await claimHandle.close().catch(() => {});
        await removeLockGeneration(lockPath, claimantToken, "reclaimed");
        return true;
      }
      throw error;
    }

    if (reclaimGraceMs > 0) await sleep(reclaimGraceMs);
    if (!(await claimIsOwned(claimPath, claimantToken))) {
      await rename(claimedOwnerPath, ownerPath).catch(() => {});
      return false;
    }
    const claimedOwner = await readOwner(claimedOwnerPath);
    const claimedStat = await stat(claimedOwnerPath).catch(() => undefined);
    const ownerUnchanged = claimedOwner?.token === observedOwner?.token;
    const stillStale = Boolean(claimedStat && Date.now() - claimedStat.mtimeMs > staleMs);
    if (ownerUnchanged && stillStale) {
      clearInterval(claimHeartbeat);
      await claimHandle.close().catch(() => {});
      await removeLockGeneration(lockPath, claimantToken, "reclaimed");
      return true;
    }
    await rename(claimedOwnerPath, ownerPath).catch(() => {});
    return false;
  } finally {
    clearInterval(claimHeartbeat);
    await claimHandle.close().catch(() => {});
    if (await claimIsOwned(claimPath, claimantToken)) {
      await rm(claimPath, { force: true }).catch(() => {});
    }
  }
}

async function removeLockGeneration(
  lockPath: string,
  token: string,
  reason: "reclaimed" | "released",
): Promise<void> {
  const disposalPath = `${lockPath}.${token}.${reason}`;
  try {
    await rename(lockPath, disposalPath);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  await rm(disposalPath, { recursive: true, force: true });
}

async function newestTransitionOwnerStat(lockPath: string): Promise<Stats | undefined> {
  let names: string[];
  try {
    names = (await readdir(lockPath)).filter(
      (name) => name.startsWith(".owner.") || name.startsWith(".release."),
    );
  } catch {
    return undefined;
  }
  const stats = await Promise.all(
    names.map(async (name) => await stat(join(lockPath, name)).catch(() => undefined)),
  );
  return stats.reduce<Stats | undefined>((newest, candidate) => {
    if (!candidate) return newest;
    return !newest || candidate.mtimeMs > newest.mtimeMs ? candidate : newest;
  }, undefined);
}

async function acquireReclaimClaim(
  claimPath: string,
  claimantToken: string,
  staleMs: number,
): Promise<boolean> {
  try {
    await writeFile(claimPath, claimantToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    if (!isAlreadyExistsError(error)) throw error;
  }

  const observedStat = await stat(claimPath).catch(() => undefined);
  if (!observedStat || Date.now() - observedStat.mtimeMs <= staleMs) return false;

  const quarantinePath = `${claimPath}.${claimantToken}.stale`;
  try {
    await rename(claimPath, quarantinePath);
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }

  const claimedStat = await stat(quarantinePath).catch(() => undefined);
  if (claimedStat && Date.now() - claimedStat.mtimeMs <= staleMs) {
    await rename(quarantinePath, claimPath).catch(async () => {
      await rm(quarantinePath, { force: true }).catch(() => {});
    });
    return false;
  }
  await rm(quarantinePath, { force: true });

  try {
    await writeFile(claimPath, claimantToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error) || isMissingFileError(error)) return false;
    throw error;
  }
}

async function claimIsOwned(claimPath: string, claimantToken: string): Promise<boolean> {
  try {
    return (await readFile(claimPath, "utf8")) === claimantToken;
  } catch {
    return false;
  }
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LockOwner>;
    return typeof parsed.token === "string" ? (parsed as LockOwner) : undefined;
  } catch {
    return undefined;
  }
}

async function hasLockTransitionMarker(lockPath: string): Promise<boolean> {
  try {
    return (await readdir(lockPath)).some(
      (name) =>
        name === ".reclaim" ||
        name.startsWith(".reclaim.") ||
        name.startsWith(".owner.") ||
        name.startsWith(".release."),
    );
  } catch {
    return false;
  }
}

async function lockExists(lockPath: string): Promise<boolean> {
  try {
    await stat(lockPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isLockOccupiedError(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(String(error.code));
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
