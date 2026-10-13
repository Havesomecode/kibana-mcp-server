# SQLite store

Keeps one row per profile in a local database file. It needs no extra package: it uses the `node:sqlite` module built into Node.js.

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/sqlite";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { path: "/var/lib/kibana-mcp/catalogs.sqlite" },
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `path` | `KIBANA_STORE_URL`, with or without a `sqlite:` prefix | Database file, or `:memory:`. Its directory is created if needed. |
| `table` | `kibana_mcp_catalogs` | Table name. Letters, digits and underscores only. |
| `database` | none | An open `DatabaseSync` you created yourself. The store never closes it. |

## When to use it

SQLite suits a single host: one server, or a few processes on the same machine sharing the file. The database is opened in WAL mode so readers do not block.

It is not the right store for several replicas on different machines: use [PostgreSQL](./postgres), [MongoDB](./mongodb) or [Redis](./redis) there.

## Limits

- Calls are synchronous. A write that waits for another process holding the lock can pause the server for up to five seconds. Writes only happen when a source is configured, so this is rare.
- The file must be on a persistent volume. In a container, mount one at its directory.
