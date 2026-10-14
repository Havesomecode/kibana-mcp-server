---
description: "Every KIBANA_* environment variable read by the server."
---

# Environment variables

Set environment variables to override [configuration-file](./config-file) defaults.

## Connection

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_PROFILE` optional, selects a saved non-default machine profile
- `KIBANA_TIMEOUT_MS` optional, default `10000`
- `KIBANA_SOURCE_CATALOG_PATH` required for direct environment-based startup unless a configuration-file store supplies the catalog; saved profiles carry their own path. No implicit default.

### Deadlines and cancellation

`KIBANA_TIMEOUT_MS` covers each Kibana HTTP request end to end: queue wait, connection and response-body read.

- Per configured client: eight concurrent requests, 32 queued. Excess work fails immediately with `KIBANA_OVERLOADED`.
- Cancelled MCP calls abort queued/in-flight backend work.
- Shared schema discovery: cancellation stops only that caller's wait while others remain; the last caller's cancellation aborts the shared backend request.

Backend failures use stable codes: `KIBANA_TIMEOUT`, `KIBANA_CANCELLED`, `KIBANA_OVERLOADED`, `KIBANA_AUTHENTICATION`, `KIBANA_DNS`, `KIBANA_TLS`, `KIBANA_CONNECTION`, `KIBANA_RESPONSE` and [others](./errors). Failed backend tool results expose diagnostics in `_meta.kibana_request_error`.

### Choose the base URL

Set `KIBANA_BASE_URL` to the base prefix; the server joins it with configured backend/schema paths.

Use:

- `https://kibana.example.com`
- `https://gateway.example.com/logs` when Kibana is reverse-proxied under `/logs`

Do not use:

- `https://kibana.example.com/internal/search/es`
- `https://gateway.example.com/logs/internal/search/es`

Sources already carry paths such as `/internal/search/es`; a full API path here usually produces a bad combined URL and `404`.

### Select startup mode

- **Direct environment:** supply all three connection values plus explicit `KIBANA_SOURCE_CATALOG_PATH` or a [configuration-file store](../deployment/catalog-stores). Only the named catalog is read; the checkout is never searched. Use `config/sources.example.json` only as a deliberate hand-authored template, never automatic setup input.
- **Saved profile:** unset connection variables; optionally select `KIBANA_PROFILE`. Credentials and catalog path come from saved state. Without a saved connection, startup fails with `No saved Kibana connection is available. Run connection bootstrap first.`

## Configuration file

- `KIBANA_MCP_CONFIG` path of a [configuration file](../guide/configuration-file), same as `serve --config`

## HTTP transport

- `KIBANA_HTTP_HOST` listen host, default `127.0.0.1`
- `KIBANA_HTTP_PORT` listen port, default `3000`
- `KIBANA_HTTP_PATH` endpoint path, default `/mcp`
- `KIBANA_HTTP_PROFILE_HEADER` header carrying the profile of the caller, no default
- `KIBANA_HTTP_AUTH_TOKEN` shared secret expected as `Authorization: Bearer <token>`

See [HTTP transport](../deployment/http).

## Catalog stores

- `KIBANA_STORE_URL` connection URL of the bundled stores when `storeOptions.url` is not set
- `REDIS_URL`, `DATABASE_URL`, `MONGODB_URI`, `MONGO_URL` are read next, by the matching store

See [Catalog stores](../deployment/catalog-stores).

## Machine state

- `KIBANA_STATE_DIR` directory holding saved profiles and their generated catalogs. Defaults to the configuration directory of the operating system.
