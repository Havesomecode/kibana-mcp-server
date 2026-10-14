---
description: "Keep source catalogs in Redis with the redis or ioredis client: options and durability requirements."
---

# Redis store

## 1. Install a driver

Both entry points behave identically; choose your client:

| Entry point | Driver |
| --- | --- |
| `@havesomecode/kibana-mcp-server/stores/redis` | [`redis`](https://www.npmjs.com/package/redis) |
| `@havesomecode/kibana-mcp-server/stores/ioredis` | [`ioredis`](https://www.npmjs.com/package/ioredis) |

```bash
npm install redis
```

## 2. Configure the store

Redis keeps one key per profile, without expiry:

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/redis";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.REDIS_URL, keyPrefix: "kibana-mcp:production:" },
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `url` | `KIBANA_STORE_URL`, then `REDIS_URL` | `redis://` or `rediss://` URL |
| `keyPrefix` | `kibana-mcp:catalog:` | Prefix of the catalog keys |
| `client` | none | A client you configured yourself, used instead of `url`. The store never closes it. |

Use `client` with `ioredis` to reach Sentinel or Cluster deployments:

```ts
import { Redis } from "ioredis";
import store from "@havesomecode/kibana-mcp-server/stores/ioredis";

const client = new Redis({ sentinels: [{ host: "sentinel-1", port: 26379 }], name: "mymaster" });

export default defineKibanaMcpConfig({ /* … */ store, storeOptions: { client } });
```

## Redis must be durable

Use durable Redis; catalogs are data, not cache:

- Enable disk persistence (AOF or RDB).
- Set `noeviction`: full instances must refuse writes, not drop catalogs.

Cache instances usually have opposite settings. If unsure, use a dedicated instance or database.

## How writes are protected

A Lua script sets the key only if its content still matches what was read. Shared server processes cannot overwrite each other's changes.
