import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireStateLock } from "../src/state_lock.js";

const tempDirectories: string[] = [];

async function pathExists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("acquireStateLock", () => {
  it("serializes concurrent state mutations", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const releaseFirst = await acquireStateLock(root, { retryMs: 5, timeoutMs: 1000 });
    let secondAcquired = false;

    const second = acquireStateLock(root, { retryMs: 5, timeoutMs: 1000 }).then((release) => {
      secondAcquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondAcquired).toBe(false);

    await releaseFirst();
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);
    await releaseSecond();
  });

  it("lets only one contender reclaim a stale lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    await mkdir(lockPath);
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({ token: "stale", pid: process.pid, createdAt: 0 }),
      "utf8",
    );
    const old = new Date(Date.now() - 60000);
    await utimes(lockPath, old, old);
    let active = 0;
    let maxActive = 0;

    const contender = async () => {
      const release = await acquireStateLock(root, {
        retryMs: 1,
        staleMs: 100,
        timeoutMs: 1000,
      });
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      await release();
    };

    await Promise.all([contender(), contender()]);
    expect(maxActive).toBe(1);
  });

  it("does not reclaim a stale observation after the owner heartbeats", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const ownerPath = join(lockPath, "owner.json");
    await mkdir(lockPath);
    await writeFile(
      ownerPath,
      JSON.stringify({ token: "live", pid: process.pid, createdAt: new Date().toISOString() }),
      "utf8",
    );
    const old = new Date(Date.now() - 60000);
    await utimes(ownerPath, old, old);
    setTimeout(() => {
      const now = new Date();
      void utimes(ownerPath, now, now);
    }, 5);

    await expect(
      acquireStateLock(root, {
        retryMs: 2,
        reclaimGraceMs: 20,
        staleMs: 100,
        timeoutMs: 40,
      }),
    ).rejects.toThrow("Timed out waiting");
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("reclaims an ownerless stale lock left before owner metadata was written", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60000);
    await utimes(lockPath, old, old);

    const release = await acquireStateLock(root, {
      retryMs: 2,
      staleMs: 100,
      timeoutMs: 500,
    });
    await release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a stale reclaim marker left by a crashed contender", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const ownerPath = join(lockPath, "owner.json");
    const claimPath = join(lockPath, ".reclaim");
    await mkdir(lockPath);
    await writeFile(
      ownerPath,
      JSON.stringify({ token: "stale-owner", pid: process.pid, createdAt: 0 }),
      "utf8",
    );
    await writeFile(claimPath, "crashed-claimant", "utf8");
    const old = new Date(Date.now() - 60000);
    await utimes(ownerPath, old, old);
    await utimes(claimPath, old, old);

    const release = await acquireStateLock(root, {
      reclaimGraceMs: 10,
      retryMs: 2,
      staleMs: 100,
      timeoutMs: 500,
    });
    await release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers when a crashed reclaimer already quarantined owner metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const claimedOwnerPath = join(lockPath, ".owner.crashed-claimant");
    const claimPath = join(lockPath, ".reclaim");
    await mkdir(lockPath);
    await writeFile(
      claimedOwnerPath,
      JSON.stringify({ token: "stale-owner", pid: process.pid, createdAt: 0 }),
      "utf8",
    );
    await writeFile(claimPath, "crashed-claimant", "utf8");
    const old = new Date(Date.now() - 60000);
    await utimes(claimedOwnerPath, old, old);
    await utimes(claimPath, old, old);
    const now = new Date();
    await utimes(lockPath, now, now);

    const release = await acquireStateLock(root, {
      reclaimGraceMs: 10,
      retryMs: 2,
      staleMs: 1000,
      timeoutMs: 500,
    });
    await release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("honors release while stale reclamation temporarily claims owner metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const ownerPath = join(lockPath, "owner.json");
    const claimPath = join(lockPath, ".reclaim");
    const releaseFirst = await acquireStateLock(root, {
      staleMs: 300000,
      timeoutMs: 500,
    });
    const old = new Date(Date.now() - 60000);
    await utimes(ownerPath, old, old);

    const second = acquireStateLock(root, {
      reclaimGraceMs: 75,
      retryMs: 2,
      staleMs: 1000,
      timeoutMs: 500,
    });
    await waitFor(async () => await pathExists(claimPath));
    const now = new Date();
    await utimes(ownerPath, now, now);
    await waitFor(async () => !(await pathExists(ownerPath)) && (await pathExists(claimPath)));
    await releaseFirst();

    const releaseSecond = await second;
    await releaseSecond();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete a replacement lock generation during delayed release", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const releasePathPattern = ".release.";
    const releaseFirst = await acquireStateLock(root, {
      releaseGraceMs: 75,
      timeoutMs: 500,
    });
    const firstRelease = releaseFirst();
    await waitFor(async () =>
      (await readdir(lockPath)).some((name) => name.startsWith(releasePathPattern)),
    );

    await rm(lockPath, { recursive: true, force: true });
    const releaseSecond = await acquireStateLock(root, { retryMs: 2, timeoutMs: 500 });
    await firstRelease;

    await expect(acquireStateLock(root, { retryMs: 2, timeoutMs: 30 })).rejects.toThrow(
      "Timed out waiting",
    );
    await releaseSecond();
  });

  it("does not fail a completed critical section when release recovery is deferred", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const ownerPath = join(lockPath, "owner.json");
    const release = await acquireStateLock(root, {
      releaseTimeoutMs: 20,
      retryMs: 2,
      timeoutMs: 500,
    });
    await rename(ownerPath, join(lockPath, ".owner.crashed-claimant"));
    await writeFile(join(lockPath, ".reclaim"), "crashed-claimant", "utf8");

    await expect(release()).resolves.toBeUndefined();
    await expect(stat(lockPath)).resolves.toBeDefined();
  });

  it("keeps stale heartbeat and release callbacks bound to their generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-state-lock-"));
    tempDirectories.push(root);
    const lockPath = join(root, ".state.lock");
    const ownerPath = join(lockPath, "owner.json");
    const releaseA = await acquireStateLock(root, { heartbeatMs: 10, timeoutMs: 500 });
    await rm(lockPath, { recursive: true, force: true });
    const releaseB = await acquireStateLock(root, { heartbeatMs: 10000, timeoutMs: 500 });
    const before = (await stat(ownerPath)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect((await stat(ownerPath)).mtimeMs).toBe(before);
    await releaseA();
    await expect(stat(ownerPath)).resolves.toBeDefined();
    await releaseB();
  });
});
