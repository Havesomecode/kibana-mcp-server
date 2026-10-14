---
description: "Every option of the configuration file, its precedence and its constraints."
---

# Configuration file reference

Load a file explicitly with `serve --config <path>` or `KIBANA_MCP_CONFIG`. It executes as code; working-directory discovery is disabled.

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";

export default defineKibanaMcpConfig({
  // …
});
```

Default-export an object or a function (sync or async) returning it. `defineKibanaMcpConfig` provides types only.

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

Command-line flag → environment variable → configuration file → built-in default.

## Constraints

- `store` requires `url`, `user` and `password`, from the file or from the environment.
- `store` cannot be combined with `KIBANA_SOURCE_CATALOG_PATH`.
- Without `store`, direct connections require explicit `KIBANA_SOURCE_CATALOG_PATH`; saved profiles use their saved path. No implicit catalog path.
- A `.ts` file needs Node.js 22.18 or later. A `.mjs` file works on every supported version.
- The package must resolve from the file's directory for its import to work.

## Types

```ts
import type { CatalogStore } from "@havesomecode/kibana-mcp-server/config";
import { CatalogConflictError } from "@havesomecode/kibana-mcp-server/config";
```

See [Custom store](../deployment/stores/custom) for the `CatalogStore` contract.
