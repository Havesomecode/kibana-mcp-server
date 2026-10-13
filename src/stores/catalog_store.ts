import { toProfileKey } from "../profiles/names.js";

export class CatalogConflictError extends Error {
  constructor(location: string) {
    super(`Source catalog '${location}' changed concurrently. Retry the operation.`);
    this.name = "CatalogConflictError";
  }
}

/**
 * Storage of the serialized source catalogs, one per profile. Implement it to keep catalogs
 * anywhere (a database, a key-value store, an object bucket) and register it in the configuration
 * file.
 *
 * `profileKey` is a filesystem-safe identifier derived from the profile name: lowercase letters,
 * digits and dashes only.
 */
export interface CatalogStore {
  /** Returns the serialized catalog of the profile, or `undefined` when it has none yet. */
  read(profileKey: string): Promise<string | undefined>;
  /**
   * Replaces the catalog of the profile. `expected` is the content the caller read before
   * computing `next` (`undefined` when there was none): a store shared by several processes should
   * write only if it still holds `expected`, and throw {@link CatalogConflictError} otherwise.
   * When supplied, `signal` must be checked after any wait and before issuing the write.
   * Cancellation after the write starts does not roll back a committed catalog.
   */
  replace(
    profileKey: string,
    expected: string | undefined,
    next: string,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Human-readable location of a catalog, reported by tools. Must not expose credentials. */
  describe?(profileKey: string): string;
  /** Releases the resources held by the store when the server stops. */
  close?(): Promise<void>;
}

/** A {@link CatalogStore} bound to one profile. */
export interface CatalogHandle {
  location: string;
  read(): Promise<string | undefined>;
  replace(expected: string | undefined, next: string, signal?: AbortSignal): Promise<void>;
}

/**
 * Binds a store to one profile. The key handed to the store is derived here, so that no caller
 * can reach a store with a name that is unsafe as a path or key.
 */
export function bindCatalogStore(store: CatalogStore, profileName: string): CatalogHandle {
  const profileKey = toProfileKey(profileName);
  return {
    location: store.describe?.(profileKey) ?? profileKey,
    read: () => store.read(profileKey),
    replace: async (expected, next, signal) => {
      signal?.throwIfAborted();
      await store.replace(profileKey, expected, next, signal);
    },
  };
}
