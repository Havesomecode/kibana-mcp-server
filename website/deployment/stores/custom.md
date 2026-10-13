---
description: "Implement the CatalogStore contract to keep source catalogs in any backend."
---

# Custom store

A store is an object with two required methods. Implement them to keep catalogs anywhere: another database, an object bucket, an internal service.

```ts
import { CatalogConflictError, type CatalogStore } from "@havesomecode/kibana-mcp-server/config";

export default function myStore(options: { table: string }): CatalogStore {
  return {
    // serialized catalog of the profile, or undefined when it has none yet
    read: async (profileKey) => db.get(options.table, profileKey),
    // write only if the stored content is still `expected`, else throw CatalogConflictError
    replace: async (profileKey, expected, next) => {
      if (!(await db.compareAndSet(options.table, profileKey, expected, next))) {
        throw new CatalogConflictError(profileKey);
      }
    },
    describe: (profileKey) => `db://${options.table}/${profileKey}`,
    close: () => db.close(),
  };
}
```

## The contract

| Method | Required | Role |
| --- | --- | --- |
| `read(profileKey)` | yes | Returns the serialized catalog of the profile, or `undefined` when it has none yet. |
| `replace(profileKey, expected, next)` | yes | Writes `next` only if the stored content is still `expected` (`undefined` when there was none). Throws `CatalogConflictError` otherwise. |
| `describe(profileKey)` | no | Human-readable location reported by tools. Must not expose credentials. |
| `close()` | no | Releases connections when the server stops. |

`profileKey` is derived by the server from the profile name. It only contains lowercase letters, digits and dashes, so it is safe as a file name, a key or a primary key.

## Why `replace` compares first

`configure_index` reads the catalog, validates the index against Kibana, then writes. Two callers, or two server processes, can do that at the same time. Writing only when the content is unchanged means the second writer fails with a conflict instead of silently erasing the first one's source. The caller simply retries.

## Using it

Export a factory and give it to the configuration file. `storeOptions` is passed to the factory as is.

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import myStore from "./my-store.js";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store: myStore,
  storeOptions: { table: "kibana_catalogs" },
});
```
