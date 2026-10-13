# Docker image

This example builds an image that runs the server over HTTP, with catalogs in PostgreSQL. Swap the store for any other one by changing two lines.

::: warning Version
The HTTP transport, the configuration file and the catalog stores are not part of the releases published before this documentation. Use a version of the package that includes them.
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

A `.mjs` file loads on every supported Node.js version. A `.ts` file works too from Node.js 22.18.

### `Dockerfile`

The server and the driver are installed in the same directory as the configuration file, so that its imports resolve.

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

```bash
docker compose up -d --build
```

```bash
curl -s http://127.0.0.1:3000/healthz
```

```bash
curl -s http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $KIBANA_MCP_TOKEN" \
  -H "X-Kibana-Profile: alice" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Notes

- **Listening on `0.0.0.0` requires `KIBANA_MCP_TOKEN`.** The server refuses to start on a non-loopback host without a shared secret.
- **Catalogs must outlive the container.** They live in the `catalogs` volume here. With the file store, mount a volume at the catalog path; with SQLite, at the database path.
- **Do not publish the port publicly.** Only your [gateway](./gateway) should reach it. The compose file binds it to the loopback interface of the host.
- **SQLite instead of PostgreSQL.** Import `stores/sqlite`, set `storeOptions: { path: "/data/catalogs.sqlite" }`, drop the `pg` install and mount a volume at `/data`.
