import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sqliteCatalogStore from "../../src/stores/sqlite.js";
import { expectCatalogStoreContract } from "./contract.js";

describe("sqlite catalog store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-sqlite-store-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("fulfils the catalog store contract in memory", async () => {
    const store = await sqliteCatalogStore({ path: ":memory:" });

    await expectCatalogStoreContract(store);
    await store.close?.();
  });

  it("persists catalogs in a file shared by several stores, creating its directory", async () => {
    const path = join(directory, "nested", "catalogs.sqlite");
    const first = await sqliteCatalogStore({ path, table: "team_catalogs" });
    const second = await sqliteCatalogStore({ path, table: "team_catalogs" });

    await first.replace("alice", undefined, "v1");
    await second.replace("alice", "v1", "v2");
    await expect(first.replace("alice", "v1", "stale")).rejects.toThrow("changed concurrently");

    expect(await first.read("alice")).toBe("v2");
    expect(first.describe?.("alice")).toBe(`sqlite:${path}/team_catalogs/alice`);
    await first.close?.();
    await second.close?.();

    const reopened = await sqliteCatalogStore({ path, table: "team_catalogs" });
    expect(await reopened.read("alice")).toBe("v2");
    await reopened.close?.();
    expect((await stat(path)).isFile()).toBe(true);
  });

  it("reads its path from KIBANA_STORE_URL, with or without the sqlite: prefix", async () => {
    const path = join(directory, "from-env.sqlite");
    vi.stubEnv("KIBANA_STORE_URL", `sqlite://${path}`);

    const store = await sqliteCatalogStore();
    await store.replace("alice", undefined, "v1");
    await store.close?.();

    expect(store.describe?.("alice")).toBe(`sqlite:${path}/kibana_mcp_catalogs/alice`);
    expect((await stat(path)).isFile()).toBe(true);
  });

  it("uses a supplied database without closing it", async () => {
    const database = new DatabaseSync(":memory:");
    const store = await sqliteCatalogStore({ database });

    await expectCatalogStoreContract(store);

    expect(store.close).toBeUndefined();
    expect(
      database.prepare("SELECT count(*) AS total FROM kibana_mcp_catalogs").get(),
    ).toMatchObject({ total: 2 });
    database.close();
  });

  it("asks for a database file and refuses unsafe table names", async () => {
    vi.stubEnv("KIBANA_STORE_URL", "");

    await expect(sqliteCatalogStore()).rejects.toThrow("needs a database file");
    await expect(sqliteCatalogStore({ path: ":memory:", table: "a b" })).rejects.toThrow(
      "Invalid table name",
    );
  });
});
