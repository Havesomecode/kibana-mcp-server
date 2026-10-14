---
description: "A Docker image and compose file that run the server over HTTP with catalogs in PostgreSQL."
---

# Docker image

Create these files to run HTTP with PostgreSQL catalogs.

::: warning Version
Use a package version with HTTP transport, configuration files, and catalog stores. Releases predating this documentation do not include them.
:::

## Files

```
kibana-mcp/
  Dockerfile
  kibana.mcp.config.mjs
  compose.yaml
```

### `kibana.mcp.config.mjs`

```js
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/postgres";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.DATABASE_URL },
  http: {
    host: "0.0.0.0",
    port: 3000,
    profileHeader: "x-kibana-profile",
    authToken: process.env.KIBANA_MCP_TOKEN,
  },
});
```

Use `.mjs` on any supported Node.js version; `.ts` needs Node.js 22.18+.

### `Dockerfile`

Install the server and driver beside the config file so imports resolve:

```dockerfile
FROM node:22-alpine

WORKDIR /app
RUN npm init -y >/dev/null \
 && npm install --omit=dev @havesomecode/kibana-mcp-server pg

COPY kibana.mcp.config.mjs ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["npx", "kibana-mcp-server", "serve", "--http", "--config", "kibana.mcp.config.mjs"]
```

### `compose.yaml`

**Keep the port private:** only your [gateway](./gateway) should reach it. This file binds to host loopback.

**Keep catalogs persistent:** the `catalogs` volume below outlives the container. For file or SQLite stores, mount a volume at the catalog or database path.

```yaml
services:
  kibana-mcp:
    build: .
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      KIBANA_URL: https://kibana.example.com
      KIBANA_USER: service-account
      KIBANA_PASSWORD: ${KIBANA_PASSWORD}
      KIBANA_MCP_TOKEN: ${KIBANA_MCP_TOKEN}
      DATABASE_URL: postgres://kibana_mcp:${POSTGRES_PASSWORD}@postgres:5432/kibana_mcp
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: kibana_mcp
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: kibana_mcp
    volumes:
      - catalogs:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kibana_mcp"]
      interval: 5s
      retries: 10

volumes:
  catalogs:
```

## Run and check

Supply `KIBANA_PASSWORD`, `KIBANA_MCP_TOKEN`, and `POSTGRES_PASSWORD` through your secret provider. Listening on `0.0.0.0` requires `KIBANA_MCP_TOKEN`; the server refuses non-loopback startup without a shared secret.

```bash
docker compose up -d --build
```

Check health:

```bash
curl -s http://127.0.0.1:3000/healthz
```

Check tool discovery for profile `alice`:

```bash
curl -s http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $KIBANA_MCP_TOKEN" \
  -H "X-Kibana-Profile: alice" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: a health response and MCP tool list, not proof of index access.

## Notes

**SQLite instead of PostgreSQL:** import `stores/sqlite`, set `storeOptions: { path: "/data/catalogs.sqlite" }`, drop the `pg` install, and mount a volume at `/data`.
