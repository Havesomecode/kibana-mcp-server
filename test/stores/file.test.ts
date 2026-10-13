import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireStateLock } from "../../src/profiles/state_lock.js";
import { CatalogConflictError } from "../../src/stores/catalog_store.js";
import { createFileCatalogStore } from "../../src/stores/file.js";
import * as fileIo from "../../src/utils/fs.js";
import { expectCatalogStoreContract } from "./contract.js";

describe("file catalog store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-file-store-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const createStore = () =>
    createFileCatalogStore((profileKey) => join(directory, profileKey, "sources.json"), directory);

  it("fulfils the catalog store contract", async () => {
    await expectCatalogStoreContract(createStore());
  });

  it("writes each catalog at its resolved path, creating missing directories", async () => {
    const store = createStore();

    await store.replace("alice", undefined, "content");

    expect(store.describe?.("alice")).toBe(join(directory, "alice", "sources.json"));
    expect(await readFile(join(directory, "alice", "sources.json"), "utf8")).toBe("content");
  });

  it("allows only one CAS for a shared file despite different state roots and path aliases", async () => {
    const writeAtomically = fileIo.writeTextAtomically;
    vi.spyOn(fileIo, "writeTextAtomically").mockImplementation(async (path, content) => {
      // Keep the first CAS between its read and write long enough to expose an unlocked peer.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeAtomically(path, content);
    });
    const catalogDirectory = join(directory, "catalogs");
    await mkdir(catalogDirectory);
    const alias = join(directory, "alias");
    await symlink(catalogDirectory, alias, process.platform === "win32" ? "junction" : "dir");
    const first = createFileCatalogStore(
      () => join(catalogDirectory, "sources.json"),
      join(directory, "one"),
    );
    const second = createFileCatalogStore(
      () => join(alias, "sources.json"),
      join(directory, "two"),
    );
    for (const expected of [undefined, "seed"]) {
      if (expected !== undefined) {
        await first.replace("alice", await first.read("alice"), expected);
      }
      const results = await Promise.allSettled([
        first.replace("alice", expected, "first"),
        second.replace("alice", expected, "second"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        CatalogConflictError,
      );
      expect(await first.read("alice")).toBe(await second.read("alice"));
    }
  });

  it("still waits for bootstrap's state lock before replacing the catalog", async () => {
    const release = await acquireStateLock(directory);
    let completed = false;
    const replacement = createStore()
      .replace("alice", undefined, "content")
      .then(() => {
        completed = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(completed).toBe(false);
    } finally {
      await release();
      await replacement;
    }
    expect(await createStore().read("alice")).toBe("content");
    expect((await readdir(directory)).some((name) => name.startsWith(".state.lock"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("updates the symlink target", async () => {
    const path = join(directory, "sources.json");
    const alias = join(directory, "alias.json");
    const first = createFileCatalogStore(() => path, directory);
    await first.replace("alice", undefined, "seed");
    await symlink(path, alias, "file");
    const second = createFileCatalogStore(() => alias, join(directory, "other-root"));
    await second.replace("alice", "seed", "updated");
    expect(await first.read("alice")).toBe("updated");
    expect(await second.read("alice")).toBe("updated");
  });

  it("reports read failures other than a missing file", async () => {
    await mkdir(join(directory, "alice", "sources.json"), { recursive: true });

    await expect(createStore().read("alice")).rejects.toThrow();
  });
});
