---
description: "Keep source catalogs in a local SQLite file with the built-in node:sqlite module."
---

# SQLite store

Configure a local SQLite file; no extra package is needed (`node:sqlite` is built into Node.js):

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

SQLite keeps one row per profile.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `path` | `KIBANA_STORE_URL`, with or without a `sqlite:` prefix | Database file, or `:memory:`. Its directory is created if needed. |
| `table` | `kibana_mcp_catalogs` | Table name. Letters, digits and underscores only. |
| `database` | none | An open `DatabaseSync` you created yourself. The store never closes it. |

## When to use it

Use SQLite for one server or a few same-host processes sharing the file. WAL mode keeps readers from blocking.

For replicas on different hosts, use [PostgreSQL](./postgres), [MongoDB](./mongodb) or [Redis](./redis).

## Limits

- Calls are synchronous. Waiting for another process's write lock can pause the server for up to five seconds. Writes occur only during source configuration, so this is rare.
- Put the file on a persistent volume. In containers, mount that volume at its directory.
