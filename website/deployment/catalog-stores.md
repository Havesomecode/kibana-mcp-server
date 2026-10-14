---
description: "Where source catalogs can live: files, Redis, PostgreSQL, MongoDB, SQLite or a custom store."
---

# Catalog stores

Declare a store in the [configuration file](../guide/configuration-file):

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/postgres";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.DATABASE_URL },
});
```

Catalogs list the logical sources a profile can query. They default to files; a store keeps one entry per profile for shared processes and persistence across redeploys.

## Bundled stores

Import only the store you use; only its driver loads:

| Import | Driver to install | `storeOptions` |
| --- | --- | --- |
| `@havesomecode/kibana-mcp-server/stores/redis` | `redis` | `url`, `keyPrefix`, `client` |
| `@havesomecode/kibana-mcp-server/stores/ioredis` | `ioredis` | `url`, `keyPrefix`, `client` (standalone, Sentinel or Cluster) |
| `@havesomecode/kibana-mcp-server/stores/postgres` | `pg` | `url`, `table`, `createTable`, `client` |
| `@havesomecode/kibana-mcp-server/stores/mongodb` | `mongodb` | `url`, `database`, `collectionName`, `collection` |
| `@havesomecode/kibana-mcp-server/stores/sqlite` | none, uses `node:sqlite` | `path`, `table`, `database` |

- Install the required driver next to the server; drivers are optional peer dependencies.
- `url` defaults to `KIBANA_STORE_URL`, then to the usual variable of the backend (`REDIS_URL`, `DATABASE_URL`, `MONGODB_URI` or `MONGO_URL`). For SQLite, `path` defaults to `KIBANA_STORE_URL`.
- Defaults: key prefix `kibana-mcp:catalog:`, table and collection `kibana_mcp_catalogs`. The SQL stores create their table unless `createTable` is `false`.
- Pass `client`, `collection` or `database` to reuse your connection. The store never closes it.
- Stores replace catalogs only if the stored content still matches what was read; concurrent writers cannot overwrite each other.
- With Redis, use an instance with persistence and a `noeviction` policy: catalogs are data, not a cache.

Every tool call rereads the store-backed catalog; processes sharing a store serve the same sources.

## Choosing a store

| Situation | Store |
| --- | --- |
| One host, no extra service to run | [SQLite](./stores/sqlite) |
| Several replicas, a database already in place | [PostgreSQL](./stores/postgres) or [MongoDB](./stores/mongodb) |
| Several replicas, Redis already in place and persistent | [Redis](./stores/redis) |
| Anything else | [Write your own](./stores/custom) |
