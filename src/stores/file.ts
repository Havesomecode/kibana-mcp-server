import { resolveProfilePaths } from "../profiles/paths.js";
import { acquireStateLock } from "../profiles/state_lock.js";
import { readOptionalFile, writeTextAtomically } from "../utils/fs.js";
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
    async replace(profileKey, expected, next) {
      const path = resolvePath(profileKey);
      const releaseLock = await acquireStateLock(stateRoot);
      try {
        if ((await readOptionalFile(path)) !== expected) {
          throw new CatalogConflictError(path);
        }
        await writeTextAtomically(path, next);
      } finally {
        await releaseLock();
      }
    },
  };
}
