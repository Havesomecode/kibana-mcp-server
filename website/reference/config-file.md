---
description: "Every option of the configuration file, its precedence and its constraints."
---

# Configuration file reference

The file is loaded only when named with `serve --config <path>` or `KIBANA_MCP_CONFIG`. It is executed as code, so it is never discovered from the working directory.

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";

export default defineKibanaMcpConfig({
  // …
});
```

The default export may be the configuration object, or a function, possibly asynchronous, returning it. `defineKibanaMcpConfig` only provides types.

## Options

| Option | Type | Overridden by | Description |
| --- | --- | --- | --- |
| `url` | `string` | `KIBANA_BASE_URL` | Kibana base URL |
| `user` | `string` | `KIBANA_USERNAME` | Kibana user |
| `password` | `string` | `KIBANA_PASSWORD` | Kibana password |
| `timeoutMs` | `number` | `KIBANA_TIMEOUT_MS` | Backend deadline in milliseconds |
| `profile` | `string` | `--profile`, `KIBANA_PROFILE` | Profile served when the transport names none |
| `store` | store or factory | | Where source catalogs are kept. Without it, catalogs are files. |
| `storeOptions` | any | | Handed to the `store` factory |
| `http.host` | `string` | `--host`, `KIBANA_HTTP_HOST` | Listen host |
| `http.port` | `number` | `--port`, `KIBANA_HTTP_PORT` | Listen port |
| `http.path` | `string` | `--path`, `KIBANA_HTTP_PATH` | Endpoint path |
| `http.profileHeader` | `string` | `--profile-header`, `KIBANA_HTTP_PROFILE_HEADER` | Header carrying the profile of the caller |
| `http.authToken` | `string` | `KIBANA_HTTP_AUTH_TOKEN` | Shared secret expected as a bearer token |

## Precedence

Command-line flag, then environment variable, then configuration file, then built-in default.

## Constraints

- `store` requires `url`, `user` and `password`, from the file or from the environment.
- `store` cannot be combined with `KIBANA_SOURCE_CATALOG_PATH`.
- Without `store`, a direct connection requires an explicit `KIBANA_SOURCE_CATALOG_PATH`. Saved-profile startup uses the path stored with the profile. There is no implicit catalog path.
- A `.ts` file needs Node.js 22.18 or later. A `.mjs` file works on every supported version.
- The package must be resolvable from the directory of the file, since the file imports it.

## Types

```ts
import type { CatalogStore } from "@havesomecode/kibana-mcp-server/config";
import { CatalogConflictError } from "@havesomecode/kibana-mcp-server/config";
```

See [Custom store](../deployment/stores/custom) for the `CatalogStore` contract.
