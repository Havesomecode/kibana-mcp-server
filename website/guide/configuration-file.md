# Configuration file

Instead of environment variables, the server can read a configuration file, in stdio and in HTTP mode alike:

```bash
kibana-mcp-server serve --http --config ./kibana.mcp.config.ts
```

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

- `url`, `user`, `password`, `timeoutMs`, `profile` and `http.*` are defaults: the matching `KIBANA_*` environment variable or `serve` flag wins when set.
- `store` decides where source catalogs live, one per profile. `storeOptions` is handed to the store factory. Without `store`, catalogs are files.
- The file is executed as code, so it is loaded only when named with `--config` or `KIBANA_MCP_CONFIG`, never discovered from the working directory. A `.ts` file needs Node.js 22.18 or later; `.mjs` works everywhere.

## Next steps

- [Configuration file reference](../reference/config-file) lists every option.
- [Catalog stores](../deployment/catalog-stores) explains where source catalogs can live.
