---
description: "Run one shared server over Streamable HTTP with a source catalog per caller."
---

# HTTP transport

Start a shared Streamable HTTP server behind an authenticated MCP gateway:

```bash
KIBANA_BASE_URL=https://kibana.example.com \
KIBANA_USERNAME=service-account \
KIBANA_PASSWORD=... \
KIBANA_SOURCE_CATALOG_PATH='/var/lib/kibana-mcp/catalogs/{profile}.json' \
KIBANA_HTTP_AUTH_TOKEN=... \
kibana-mcp-server serve --http --port 3000 --profile-header x-kibana-profile
```

Only the gateway should reach the server. The profile header is trusted as sent: the server authenticates the gateway, not end users. Non-loopback listening requires `KIBANA_HTTP_AUTH_TOKEN`.

Without `--http`, the default is stdio with one global configuration.

## Select each caller's catalog

One process serves all callers; each tool call uses the configured profile header:

- `{profile}` in `KIBANA_SOURCE_CATALOG_PATH`: separate catalog files, shared environment connection.
- Configuration-file [`store`](./catalog-stores): separate store entries per profile.
- Without bootstrap environment variables: selects a saved machine profile by **exact name**, not generated id. CLI selection still accepts case-insensitive names and ids.
- Without `--profile-header`: startup requires an explicit default (`--profile`, `KIBANA_PROFILE` or configuration-file `profile`); all callers use it. Over stdio, per-profile catalogs fall back to `default`.
- HTTP profile names are exact: `Alice` and `alice` are distinct.

Missing catalogs start empty; fill them with `configure_index`.

Profile names become filesystem-safe path/store keys: plain lowercase slugs stay unchanged; other names get a digest suffix. Literal names ending in reserved `-<12 hex digits>` are hashed too, preventing impersonation of generated keys. The server never adopts another identity's catalog.

## HTTP options

- `--host` / `KIBANA_HTTP_HOST`, default `127.0.0.1`
- `--port` / `KIBANA_HTTP_PORT`, default `3000`
- `--path` / `KIBANA_HTTP_PATH`, default `/mcp`
- `--profile-header` / `KIBANA_HTTP_PROFILE_HEADER`, no default
- `KIBANA_HTTP_AUTH_TOKEN`, shared secret expected as `Authorization: Bearer <token>`

`GET /healthz` answers `200` without authentication.

Without a token, MCP requests require a loopback `Host` and, if present, loopback `Origin`. Authenticated gateways may forward their own host/origin headers.

## Legacy sessions

1. Send `initialize` to receive an `Mcp-Session-Id`.
2. Echo it on subsequent requests, including cancellation notifications.
3. Send `DELETE` with it when finished.

Sessions stay bound to the original profile:

- Maximum: 128 per process; a full registry returns `503`.
- Idle expiry: 30 minutes, reclaimed on the next legacy request.
- Retirement: after 1,024 requests, bounding SDK cancellation metadata and closing remaining session exchanges.
- Expired, exhausted, unknown or mismatched session: `404`; reinitialize.

The `2025-06-18` initialization flow supports session-based GET/SSE streams and authenticated DELETE. Disconnecting GET releases only the stream, not its session. Handshake-free legacy calls remain supported; cross-request cancellation requires a session.

## Modern requests

For stateless `2026-07-28` tool calls, send the per-request `_meta` envelope and SDK-required `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers. Disconnecting an in-flight modern request cancels backend work; backend deadlines still bound tool calls.

Authentication and profile selection are checked on **every request**, legacy or modern.
