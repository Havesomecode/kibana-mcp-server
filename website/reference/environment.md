---
description: "Every KIBANA_* environment variable read by the server."
---

# Environment variables

The server reads its connection from environment variables when they are set. A [configuration file](./config-file) supplies the same values as defaults: a variable that is set always wins.

## Connection

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_PROFILE` optional, selects a saved non-default machine profile
- `KIBANA_TIMEOUT_MS` optional, default `10000`
- `KIBANA_SOURCE_CATALOG_PATH` required for direct environment-based startup unless a configuration-file store supplies the catalog; saved profiles carry their own path. No implicit default.

`KIBANA_TIMEOUT_MS` bounds each Kibana HTTP request end to end: it includes waiting for a request slot, connecting, and reading the response body. The server allows at most eight concurrent Kibana requests and 32 queued requests per configured client; excess work fails immediately with `KIBANA_OVERLOADED`. Cancelled MCP tool calls abort their queued or in-flight backend work, except shared schema discovery: cancelling one caller stops only its wait while other callers remain; cancelling the last caller aborts the shared backend request.

Backend failures use stable diagnostic codes such as `KIBANA_TIMEOUT`, `KIBANA_CANCELLED`, `KIBANA_OVERLOADED`, `KIBANA_AUTHENTICATION`, `KIBANA_DNS`, `KIBANA_TLS`, `KIBANA_CONNECTION`, and `KIBANA_RESPONSE`. Failed backend tool results also expose the diagnostic fields in `_meta.kibana_request_error`.

`KIBANA_BASE_URL` is the Kibana base prefix that the server joins with each configured backend or schema path.

Use:

- `https://kibana.example.com`
- `https://gateway.example.com/logs` when Kibana is reverse-proxied under `/logs`

Do not use:

- `https://kibana.example.com/internal/search/es`
- `https://gateway.example.com/logs/internal/search/es`

The source definition already carries endpoint paths such as `/internal/search/es`, so including a full API path in `KIBANA_BASE_URL` usually produces a bad combined URL and a `404`.

Direct environment-based startup requires all three connection values together and an explicit `KIBANA_SOURCE_CATALOG_PATH`, or a [configuration-file store](../deployment/catalog-stores). The server reads only the named catalog; it never searches the checkout for one. Hand-authored catalogs may use `config/sources.example.json` as a deliberate template, not as an automatic setup input.

For saved-profile startup, leave the connection variables unset and select the profile with `KIBANA_PROFILE` if needed. Its catalog path and credentials are loaded from saved state. Without a saved connection, startup fails with `No saved Kibana connection is available. Run connection bootstrap first.`

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
