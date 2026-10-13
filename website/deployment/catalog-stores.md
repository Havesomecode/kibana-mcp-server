# Catalog stores

A source catalog is the list of logical sources a profile can query. By default catalogs are files. A **catalog store** keeps them somewhere else, one entry per profile, so that several server processes can share them and a redeploy does not lose them.

A store is declared in the [configuration file](../guide/configuration-file):

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

## Bundled stores

Each store is imported from its own entry point, so that only the driver you use is loaded:

| Import | Driver to install | `storeOptions` |
| --- | --- | --- |
| `@havesomecode/kibana-mcp-server/stores/redis` | `redis` | `url`, `keyPrefix`, `client` |
| `@havesomecode/kibana-mcp-server/stores/ioredis` | `ioredis` | `url`, `keyPrefix`, `client` (standalone, Sentinel or Cluster) |
| `@havesomecode/kibana-mcp-server/stores/postgres` | `pg` | `url`, `table`, `createTable`, `client` |
| `@havesomecode/kibana-mcp-server/stores/mongodb` | `mongodb` | `url`, `database`, `collectionName`, `collection` |
| `@havesomecode/kibana-mcp-server/stores/sqlite` | none, uses `node:sqlite` | `path`, `table`, `database` |

- Drivers are optional peer dependencies: install the one you need next to the server.
- `url` defaults to `KIBANA_STORE_URL`, then to the usual variable of the backend (`REDIS_URL`, `DATABASE_URL`, `MONGODB_URI` or `MONGO_URL`). For SQLite, `path` defaults to `KIBANA_STORE_URL`.
- Defaults: key prefix `kibana-mcp:catalog:`, table and collection `kibana_mcp_catalogs`. The SQL stores create their table unless `createTable` is `false`.
- Pass `client`, `collection` or `database` to reuse a connection you configured yourself. The store then never closes it.
- Every store replaces a catalog only if it still holds the content that was read, so concurrent writers cannot overwrite each other.
- With Redis, use an instance with persistence and a `noeviction` policy: catalogs are data, not a cache.

A store-backed catalog is read on every tool call, so several server processes sharing one store always serve the same sources.

## Choosing a store

| Situation | Store |
| --- | --- |
| One host, no extra service to run | [SQLite](./stores/sqlite) |
| Several replicas, a database already in place | [PostgreSQL](./stores/postgres) or [MongoDB](./stores/mongodb) |
| Several replicas, Redis already in place and persistent | [Redis](./stores/redis) |
| Anything else | [Write your own](./stores/custom) |
