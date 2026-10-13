import { describe, expect, it } from "vitest";

import { CatalogConflictError, bindCatalogStore } from "../../src/stores/catalog_store.js";

describe("bindCatalogStore", () => {
  it("binds a store to one profile and falls back to the key as location", async () => {
    const calls: unknown[][] = [];
    const store = {
      read: async (profileKey: string) => {
        calls.push(["read", profileKey]);
        return "content";
      },
      replace: async (profileKey: string, expected: string | undefined, next: string) => {
        calls.push(["replace", profileKey, expected, next]);
      },
    };

    const handle = bindCatalogStore(store, "alice");
    expect(await handle.read()).toBe("content");
    await handle.replace("content", "next");

    expect(handle.location).toBe("alice");
    expect(
      bindCatalogStore({ ...store, describe: (key) => `memory://${key}` }, "alice").location,
    ).toBe("memory://alice");
    expect(calls).toEqual([
      ["read", "alice"],
      ["replace", "alice", "content", "next"],
    ]);
  });

  it("names the catalog in conflict errors", () => {
    const error = new CatalogConflictError("memory://alice");

    expect(error.name).toBe("CatalogConflictError");
    expect(error.message).toContain("memory://alice");
  });
});
