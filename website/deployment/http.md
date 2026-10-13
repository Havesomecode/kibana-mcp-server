---
description: "Run one shared server over Streamable HTTP with a source catalog per caller."
---

# HTTP transport

By default the server speaks stdio and serves one global configuration. To run it as a shared service, for example behind an MCP gateway, start it over Streamable HTTP:

```bash
KIBANA_BASE_URL=https://kibana.example.com \
KIBANA_USERNAME=service-account \
KIBANA_PASSWORD=... \
KIBANA_SOURCE_CATALOG_PATH='/var/lib/kibana-mcp/catalogs/{profile}.json' \
KIBANA_HTTP_AUTH_TOKEN=... \
kibana-mcp-server serve --http --port 3000 --profile-header x-kibana-profile
```

One process then serves every caller. Each tool call is bound to the profile named by the configured header, so callers never share a source catalog:

- with the `{profile}` placeholder in `KIBANA_SOURCE_CATALOG_PATH`, every profile gets its own catalog file and shares the environment connection.
- with a `store` in the configuration file (see below), every profile gets its own entry in that store.
- without bootstrap environment variables, the header selects a saved machine profile by its exact name, not its generated id. CLI profile selection still accepts case-insensitive names and ids.
- without `--profile-header`, the server refuses to start unless a default profile is named (`--profile`, `KIBANA_PROFILE` or `profile` in the configuration file); every caller is then served that one profile. Over stdio, per-profile catalogs fall back to the `default` profile.
- profile names are compared exactly: `Alice` and `alice` are two profiles.

A profile without a catalog starts empty and fills it through `configure_index`. Profile names are turned into filesystem-safe keys before they reach a path or a store: a plain lowercase slug is kept as is, anything else gets a digest suffix. Literal names ending in the reserved `-<12 hex digits>` suffix are hashed too, so they cannot impersonate another profile's generated key. The server never adopts another identity's catalog.

HTTP options, as flags or environment variables:

- `--host` / `KIBANA_HTTP_HOST`, default `127.0.0.1`
- `--port` / `KIBANA_HTTP_PORT`, default `3000`
- `--path` / `KIBANA_HTTP_PATH`, default `/mcp`
- `--profile-header` / `KIBANA_HTTP_PROFILE_HEADER`, no default
- `KIBANA_HTTP_AUTH_TOKEN`, shared secret expected as `Authorization: Bearer <token>`

`GET /healthz` answers `200` without authentication.

The profile header is trusted as sent: the server does not authenticate end users itself. Only a gateway that has already authenticated the caller should be able to reach it. The server refuses to listen on a non-loopback host without `KIBANA_HTTP_AUTH_TOKEN`.

Without a token, MCP requests must also have a loopback `Host` and, when present, a loopback `Origin`. Authenticated gateways may forward their own host and origin headers.

HTTP tool calls use the stateless protocol revision `2026-07-28`: send the current protocol's per-request `_meta` envelope and its `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers as required by the SDK; no initialization handshake or `Mcp-Session-Id` is needed. The server does not allocate client sessions or provide session-based GET streams, DELETE, or cross-request cancellation. Disconnecting an in-flight request cancels its backend work; backend deadlines still bound every tool call. Authentication and profile selection are checked on every request.
