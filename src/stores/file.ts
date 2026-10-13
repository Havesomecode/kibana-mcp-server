import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { resolveProfilePaths } from "../profiles/paths.js";
import { acquireStateLock } from "../profiles/state_lock.js";
import { isMissingFileError, readOptionalFile, writeTextAtomically } from "../utils/fs.js";
import { CatalogConflictError, type CatalogStore } from "./catalog_store.js";

/**
 * Catalog store keeping one file per profile, at the path `resolvePath` gives for its key.
 */
export function createFileCatalogStore(
  resolvePath: (profileKey: string) => string,
  stateRoot: string = resolveProfilePaths().stateRoot,
): CatalogStore {
  return {
    read: (profileKey) => readOptionalFile(resolvePath(profileKey)),
    describe: resolvePath,
    async replace(profileKey, expected, next, signal) {
      const path = resolvePath(profileKey);
      // Keep bootstrap's machine-state coordination, then lock the actual catalog independently
      // of that root. All file-store writers acquire these locks in the same order.
      const releaseLock = await acquireStateLock(stateRoot, { signal });
      try {
        await mkdir(dirname(path), { recursive: true });
        const canonicalPath = await realpath(path).catch(async (error: unknown) => {
          if (!isMissingFileError(error)) throw error;
          return join(await realpath(dirname(path)), basename(path));
        });
        const digest = createHash("sha256").update(canonicalPath).digest("hex");
        const releaseCatalogLock = await acquireStateLock(dirname(canonicalPath), {
          lockName: `.catalog-${digest}.lock`,
          signal,
        });
        try {
          if ((await readOptionalFile(canonicalPath)) !== expected) {
            throw new CatalogConflictError(path);
          }
          signal?.throwIfAborted();
          await writeTextAtomically(canonicalPath, next);
        } finally {
          await releaseCatalogLock();
        }
      } finally {
        await releaseLock();
      }
    },
  };
}
