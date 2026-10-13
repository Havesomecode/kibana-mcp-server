---
description: "Keep source catalogs in PostgreSQL: options, table definition and required privileges."
---

# PostgreSQL store

Keeps one row per profile.

```bash
npm install pg
```

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/postgres";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.DATABASE_URL, table: "ops.kibana_catalogs" },
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `url` | `KIBANA_STORE_URL`, then `DATABASE_URL` | `postgres://` or `postgresql://` URL |
| `table` | `kibana_mcp_catalogs` | Table name, optionally schema-qualified. Letters, digits and underscores only. |
| `createTable` | `true` | Set to `false` when your own migrations create the table |
| `client` | none | A `pg` Pool or Client you configured yourself. The store never closes it. |

## Table

Created on startup unless `createTable` is `false`:

```sql
CREATE TABLE IF NOT EXISTS kibana_mcp_catalogs (
  profile_key TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The database user needs `SELECT`, `INSERT` and `UPDATE` on that table, plus `CREATE` on the schema if the store creates it.

## How writes are protected

A new catalog is inserted with `ON CONFLICT DO NOTHING`; an existing one is updated only `WHERE content = <what was read>`. A write that changes no row is reported as a conflict.
