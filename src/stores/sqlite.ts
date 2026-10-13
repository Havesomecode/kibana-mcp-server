import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CatalogConflictError, type CatalogStore } from "./catalog_store.js";
import { DEFAULT_TABLE_NAME, STORE_URL_ENV, importDriver, quoteSqlIdentifier } from "./shared.js";

export interface SqliteCatalogStoreOptions {
  /** Database file, or `:memory:`. Defaults to `KIBANA_STORE_URL`, with or without a `sqlite:` prefix. */
  path?: string;
  /** Catalog table. Defaults to `kibana_mcp_catalogs`. */
  table?: string;
  /** An open `node:sqlite` database to use instead of `path`. The store never closes it. */
  database?: SqliteCatalogDatabase;
}

/** The subset of a `node:sqlite` `DatabaseSync` this store relies on. */
export interface SqliteCatalogDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...parameters: string[]): unknown;
    run(...parameters: string[]): { changes: number | bigint };
  };
}

/**
 * Catalog store backed by a SQLite file through the built-in `node:sqlite` module: one row per
 * profile. Suited to a single host; several processes may share the file.
 *
 * Usable directly as `store` in the configuration file; its options come from `storeOptions`.
 */
export default async function sqliteCatalogStore(
  options: SqliteCatalogStoreOptions = {},
): Promise<CatalogStore> {
  const tableName = options.table ?? DEFAULT_TABLE_NAME;
  const table = quoteSqlIdentifier(tableName);
  let database = options.database;
  let label = "sqlite:";
  let close: (() => Promise<void>) | undefined;

  if (!database) {
    const configuredPath = (options.path?.trim() || process.env[STORE_URL_ENV]?.trim())?.replace(
      /^sqlite:(\/\/)?/,
      "",
    );
    if (!configuredPath) {
      throw new Error(
        `The SQLite catalog store needs a database file: pass 'path', or set ${STORE_URL_ENV}.`,
      );
    }
    const inMemory = configuredPath === ":memory:";
    const path = inMemory ? configuredPath : resolve(configuredPath);
    if (!inMemory) {
      await mkdir(dirname(path), { recursive: true });
    }

    const sqlite = await importDriver<typeof import("node:sqlite")>("SQLite", "node:sqlite");
    const opened = new sqlite.DatabaseSync(path);
    // Let several server processes share the file: readers do not block, writers wait their turn.
    opened.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database = opened;
    label = `sqlite:${path}`;
    close = async () => opened.close();
  }

  database.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (
      profile_key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  const select = database.prepare(`SELECT content FROM ${table} WHERE profile_key = ?`);
  const insert = database.prepare(
    `INSERT INTO ${table} (profile_key, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (profile_key) DO NOTHING`,
  );
  const update = database.prepare(
    `UPDATE ${table} SET content = ?, updated_at = ? WHERE profile_key = ? AND content = ?`,
  );

  const describe = (profileKey: string) => `${label}/${tableName}/${profileKey}`;
  return {
    describe,
    async read(profileKey) {
      const row = select.get(profileKey) as { content?: unknown } | undefined;
      return typeof row?.content === "string" ? row.content : undefined;
    },
    async replace(profileKey, expected, next) {
      const now = new Date().toISOString();
      const { changes } =
        expected === undefined
          ? insert.run(profileKey, next, now)
          : update.run(next, now, profileKey, expected);
      if (Number(changes) !== 1) {
        throw new CatalogConflictError(describe(profileKey));
      }
    },
    close,
  };
}
