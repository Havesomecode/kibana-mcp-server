# Redis store

Keeps one key per profile, without expiry. Two entry points are provided, one per client library; they behave the same.

| Entry point | Driver |
| --- | --- |
| `@havesomecode/kibana-mcp-server/stores/redis` | [`redis`](https://www.npmjs.com/package/redis) |
| `@havesomecode/kibana-mcp-server/stores/ioredis` | [`ioredis`](https://www.npmjs.com/package/ioredis) |

```bash
npm install redis
```

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

Catalogs are data, not a cache. Point the store at a Redis that:

- persists to disk (AOF or RDB);
- uses the `noeviction` policy, so that a full instance refuses writes instead of dropping catalogs.

A Redis used as a cache elsewhere in your stack is usually configured the opposite way. Use a dedicated instance or database if in doubt.

## How writes are protected

A catalog is replaced by a short Lua script that sets the key only if it still holds the content that was read. Two server processes sharing one Redis cannot overwrite each other's changes.
