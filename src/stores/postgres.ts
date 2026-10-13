import { CatalogConflictError, type CatalogStore } from "./catalog_store.js";
import {
  DEFAULT_TABLE_NAME,
  describeStoreUrl,
  importDriver,
  quoteSqlIdentifier,
  resolveStoreUrl,
} from "./shared.js";

export interface PostgresCatalogStoreOptions {
  /** `postgres://` or `postgresql://` URL. Defaults to `KIBANA_STORE_URL`, then `DATABASE_URL`. */
  url?: string;
  /** Catalog table, optionally schema-qualified. Defaults to `kibana_mcp_catalogs`. */
  table?: string;
  /** Set to `false` when the table is created by your own migrations. */
  createTable?: boolean;
  /** A `pg` Pool or Client to use instead of `url`. The store never closes it. */
  client?: PostgresCatalogClient;
}

/** The subset of a `pg` Pool or Client this store relies on. */
export interface PostgresCatalogClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

interface PgModule {
  Pool?: PgPoolConstructor;
  default?: { Pool?: PgPoolConstructor };
}

type PgPoolConstructor = new (config: {
  connectionString: string;
}) => PostgresCatalogClient & {
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

/**
 * Catalog store backed by PostgreSQL through the `pg` package: one row per profile.
 *
 * Usable directly as `store` in the configuration file; its options come from `storeOptions`.
 */
export default async function postgresCatalogStore(
  options: PostgresCatalogStoreOptions = {},
): Promise<CatalogStore> {
  const tableName = options.table ?? DEFAULT_TABLE_NAME;
  const table = quoteSqlIdentifier(tableName);
  let client = options.client;
  let label = "postgres:";
  let close: (() => Promise<void>) | undefined;

  if (!client) {
    const url = resolveStoreUrl(
      "PostgreSQL",
      options.url,
      ["DATABASE_URL"],
      ["postgres:", "postgresql:"],
    );
    const pg = await importDriver<PgModule>("PostgreSQL", "pg");
    const Pool = pg.Pool ?? pg.default?.Pool;
    if (!Pool) {
      throw new Error("The installed 'pg' package does not expose Pool.");
    }
    const pool = new Pool({ connectionString: url.href });
    // Without a listener, an error on an idle connection would crash the process.
    pool.on("error", () => {});
    client = pool;
    label = describeStoreUrl(url);
    close = () => pool.end();
  }

  const database = client;
  try {
    if (options.createTable ?? true) {
      await database.query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          profile_key TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
      );
    }
  } catch (error) {
    await close?.().catch(() => {});
    throw error;
  }

  const describe = (profileKey: string) => `${label}/${tableName}/${profileKey}`;
  return {
    describe,
    async read(profileKey) {
      const { rows } = await database.query(`SELECT content FROM ${table} WHERE profile_key = $1`, [
        profileKey,
      ]);
      const content = rows[0]?.content;
      return typeof content === "string" ? content : undefined;
    },
    async replace(profileKey, expected, next, signal) {
      signal?.throwIfAborted();
      const { rowCount } =
        expected === undefined
          ? await database.query(
              `INSERT INTO ${table} (profile_key, content) VALUES ($1, $2)
               ON CONFLICT (profile_key) DO NOTHING`,
              [profileKey, next],
            )
          : await database.query(
              `UPDATE ${table} SET content = $3, updated_at = now()
               WHERE profile_key = $1 AND content = $2`,
              [profileKey, expected, next],
            );
      if (rowCount !== 1) {
        throw new CatalogConflictError(describe(profileKey));
      }
    },
    close,
  };
}
