---
description: "Implement the CatalogStore contract to keep source catalogs in any backend."
---

# Custom store

## 1. Implement the store

Implement `read` and `replace` for your backend: a database, object bucket or internal service.

```ts
import { CatalogConflictError, type CatalogStore } from "@havesomecode/kibana-mcp-server/config";

export default function myStore(options: { table: string }): CatalogStore {
  return {
    // serialized catalog of the profile, or undefined when it has none yet
    read: async (profileKey) => db.get(options.table, profileKey),
    // write only if the stored content is still `expected`, else throw CatalogConflictError
    replace: async (profileKey, expected, next, signal) => {
      signal?.throwIfAborted();
      if (!(await db.compareAndSet(options.table, profileKey, expected, next))) {
        throw new CatalogConflictError(profileKey);
      }
    },
    describe: (profileKey) => `db://${options.table}/${profileKey}`,
    close: () => db.close(),
  };
}
```

### Contract

| Method | Required | Role |
| --- | --- | --- |
| `read(profileKey)` | yes | Returns the serialized catalog of the profile, or `undefined` when it has none yet. |
| `replace(profileKey, expected, next, signal?)` | yes | Writes `next` only if the stored content is still `expected` (`undefined` when there was none). Throws `CatalogConflictError` otherwise. Checks the optional `AbortSignal` before issuing a write. |
| `describe(profileKey)` | no | Human-readable location reported by tools. Must not expose credentials. |
| `close()` | no | Releases connections when the server stops. |

The server derives `profileKey` from the profile name using only lowercase letters, digits and dashes: safe for file names, keys and primary keys.

Check the optional cancellation signal after any wait and before issuing a write. Cancellation never rolls back an already-dispatched write.

### Require compare-and-set

`configure_index` reads, validates against Kibana, then writes. Concurrent callers/processes must fail with a conflict if content changed, not erase another writer's source. Retry the operation after a conflict.

## 2. Configure the store

Pass the store and its required options to the configuration file:

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import myStore from "./my-store.js";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store: myStore({ table: "kibana_catalogs" }),
});
```
