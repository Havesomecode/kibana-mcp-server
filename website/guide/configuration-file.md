---
description: "Configure the server with a kibana.mcp.config.ts file: connection, catalog store and HTTP options."
---

# Configuration file

1. Create `kibana.mcp.config.ts`:

**Use only trusted files:** configuration executes as code. `.ts` needs Node.js 22.18+; `.mjs` works on any supported Node.js version.

```ts
// kibana.mcp.config.ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/redis";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.REDIS_URL, keyPrefix: "kibana-mcp:production:" },
  http: { port: 3000, profileHeader: "x-kibana-profile", authToken: process.env.MCP_TOKEN },
});
```

2. Run with the explicit file (stdio or HTTP):

```bash
kibana-mcp-server serve --http --config ./kibana.mcp.config.ts
```

Matching `KIBANA_*` variables or `serve` flags override `url`, `user`, `password`, `timeoutMs`, `profile` and `http.*`.

`store` holds one catalog per profile; `storeOptions` goes to its factory. Without a store, direct startup requires `KIBANA_SOURCE_CATALOG_PATH`; saved profiles supply their own path. No implicit checkout catalog.

Select the file with `--config` or `KIBANA_MCP_CONFIG`; it is never discovered from the working directory.

## Next steps

- [Configuration file reference](../reference/config-file) lists every option.
- [Catalog stores](../deployment/catalog-stores) explains where source catalogs can live.
