import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileCatalogStore } from "../../src/stores/file.js";
import { expectCatalogStoreContract } from "./contract.js";

describe("file catalog store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-file-store-"));
  });

  afterEach(async () => {
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

  it("reports read failures other than a missing file", async () => {
    await mkdir(join(directory, "alice", "sources.json"), { recursive: true });

    await expect(createStore().read("alice")).rejects.toThrow();
  });
});
