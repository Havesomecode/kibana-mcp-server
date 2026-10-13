import { afterEach, describe, expect, it, vi } from "vitest";

import postgresCatalogStore from "../../src/stores/postgres.js";
import { expectCatalogStoreContract } from "./contract.js";

class FakePool {
  static instances: FakePool[] = [];
  static failOnCreateTable = false;
  readonly rows = new Map<string, string>();
  readonly statements: string[] = [];
  readonly listeners: string[] = [];
  ended = false;
  emitError: (error: Error) => void = () => {};

  constructor(readonly config?: { connectionString: string }) {
    FakePool.instances.push(this);
  }

  on(event: string, listener: (error: Error) => void) {
    this.listeners.push(event);
    this.emitError = listener;
    return this;
  }

  async query(text: string, values: unknown[] = []) {
    this.statements.push(text.replace(/\s+/g, " ").trim());
    const [key, second, third] = values as string[];
    if (text.startsWith("CREATE")) {
      if (FakePool.failOnCreateTable) throw new Error("permission denied for schema public");
      return { rows: [], rowCount: null };
    }
    if (text.startsWith("SELECT")) {
      return { rows: this.rows.has(key) ? [{ content: this.rows.get(key) }] : [], rowCount: 1 };
    }
    if (text.startsWith("INSERT")) {
      if (this.rows.has(key)) return { rows: [], rowCount: 0 };
      this.rows.set(key, second);
      return { rows: [], rowCount: 1 };
    }
    if (this.rows.get(key) !== second) return { rows: [], rowCount: 0 };
    this.rows.set(key, third);
    return { rows: [], rowCount: 1 };
  }

  async end() {
    this.ended = true;
  }
}

afterEach(() => {
  FakePool.instances = [];
  FakePool.failOnCreateTable = false;
  vi.doUnmock("pg");
  vi.unstubAllEnvs();
});

describe("postgres catalog store", () => {
  it("fulfils the catalog store contract with a supplied client it does not own", async () => {
    const client = new FakePool();
    const store = await postgresCatalogStore({ client });

    await expectCatalogStoreContract(store);

    expect(client.statements[0]).toContain('CREATE TABLE IF NOT EXISTS "kibana_mcp_catalogs"');
    expect(store.describe?.("alice")).toBe("postgres:/kibana_mcp_catalogs/alice");
    expect(store.close).toBeUndefined();
  });

  it("opens, uses and closes its own pool from the configured URL", async () => {
    // The CommonJS build of pg is reached through its default export.
    vi.doMock("pg", () => ({ Pool: undefined, default: { Pool: FakePool } }));
    vi.stubEnv("KIBANA_STORE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.internal:5432/logs");

    const store = await postgresCatalogStore({ table: "ops.catalogs" });
    await expectCatalogStoreContract(store);
    await store.close?.();

    const [pool] = FakePool.instances;
    expect(pool.config).toEqual({
      connectionString: "postgresql://app:secret@db.internal:5432/logs",
    });
    expect(pool.listeners).toEqual(["error"]);
    // An error on an idle connection must not take the process down.
    expect(() => pool.emitError(new Error("terminating connection"))).not.toThrow();
    expect(pool.statements[0]).toContain('CREATE TABLE IF NOT EXISTS "ops"."catalogs"');
    expect(store.describe?.("alice")).toBe("postgresql://db.internal:5432/logs/ops.catalogs/alice");
    expect(pool.ended).toBe(true);
  });

  it("leaves the schema alone when createTable is disabled", async () => {
    const client = new FakePool();

    const store = await postgresCatalogStore({ client, createTable: false });
    await store.read("alice");

    expect(client.statements).toEqual([
      'SELECT content FROM "kibana_mcp_catalogs" WHERE profile_key = $1',
    ]);
  });

  it("closes its pool when the table cannot be created", async () => {
    vi.doMock("pg", () => ({ Pool: FakePool }));
    FakePool.failOnCreateTable = true;

    await expect(
      postgresCatalogStore({ url: "postgres://app:secret@db.internal/logs" }),
    ).rejects.toThrow("permission denied");

    expect(FakePool.instances[0].ended).toBe(true);
  });

  it("refuses unsafe table names, foreign URLs and a driver without Pool", async () => {
    await expect(
      postgresCatalogStore({ client: new FakePool(), table: 'x"; DROP TABLE y; --' }),
    ).rejects.toThrow("Invalid table name");
    await expect(postgresCatalogStore({ url: "mysql://localhost/db" })).rejects.toThrow(
      "must use postgres:// or postgresql://",
    );

    vi.doMock("pg", () => ({ Pool: undefined, default: {} }));
    await expect(postgresCatalogStore({ url: "postgres://localhost/db" })).rejects.toThrow(
      "does not expose Pool",
    );
  });
});
