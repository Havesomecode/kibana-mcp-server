import { expect } from "vitest";

import { CatalogConflictError, type CatalogStore } from "../../src/stores/catalog_store.js";

/**
 * The behavior every catalog store must have, whatever keeps the catalogs.
 */
export async function expectCatalogStoreContract(store: CatalogStore): Promise<void> {
  expect(await store.read("alice")).toBeUndefined();

  await store.replace("alice", undefined, "v1");
  await store.replace("alice", "v1", "v2");
  await store.replace("bob", undefined, "other");
  expect(await store.read("alice")).toBe("v2");
  expect(await store.read("bob")).toBe("other");

  // A writer that read a stale catalog, or none, must not overwrite the current one.
  await expect(store.replace("alice", "v1", "v3")).rejects.toBeInstanceOf(CatalogConflictError);
  await expect(store.replace("alice", undefined, "v3")).rejects.toBeInstanceOf(
    CatalogConflictError,
  );
  await expect(store.replace("carol", "missing", "v1")).rejects.toBeInstanceOf(
    CatalogConflictError,
  );
  expect(await store.read("alice")).toBe("v2");
  expect(await store.read("carol")).toBeUndefined();
  expect(store.describe?.("alice")).toContain("alice");
}

/** Mirrors the Redis compare-and-set script against an in-memory map. */
export function compareAndSet(
  values: Map<string, string>,
  key: string,
  [hasExpected, expected, next]: string[],
): number {
  const current = values.get(key);
  if (hasExpected === "1" ? current !== expected : current !== undefined) return 0;
  values.set(key, next);
  return 1;
}
