---
description: "What an MCP gateway or reverse proxy must do in front of the HTTP transport, with an nginx example."
---

# Behind an MCP gateway

The HTTP transport does not authenticate end users. It expects to sit behind something that does: an MCP gateway, an API gateway or a reverse proxy. This page describes what that component has to do, whatever it is built with.

## The contract

For every request it forwards, the gateway must:

1. **Authenticate the caller** with whatever your organization uses: OIDC, an API key, mutual TLS.
2. **Set the profile header** to a stable identifier of that caller, typically the `sub` claim of its token. The server uses it to select the caller's source catalog.
3. **Overwrite, never forward, that header.** A value sent by the client must not reach the server, or a caller could read another caller's catalog.
4. **Send the shared secret** as `Authorization: Bearer <token>`, so the server knows the request comes from the gateway.

```
caller ──(OIDC token)──▶ gateway ──(Authorization: Bearer <shared secret>
                                    X-Kibana-Profile: <caller id>)──▶ kibana-mcp-server ──▶ Kibana
```

## Server side

```bash
KIBANA_HTTP_AUTH_TOKEN=change-me \
kibana-mcp-server serve --http \
  --config ./kibana.mcp.config.ts \
  --profile-header x-kibana-profile
```

The server refuses to start over HTTP without a profile header unless you name a single default profile, and refuses to listen on a non-loopback host without `KIBANA_HTTP_AUTH_TOKEN`.

## Example: nginx with an auth subrequest

Any proxy that can run an authentication step and copy its result into a header works. With nginx and an OAuth2 proxy:

```nginx
location /mcp/kibana {
  auth_request /oauth2/auth;
  auth_request_set $caller $upstream_http_x_auth_request_user;

  proxy_set_header X-Kibana-Profile $caller;          # always overwritten
  proxy_set_header Authorization "Bearer change-me";  # shared secret
  proxy_pass http://127.0.0.1:3000/mcp;
  proxy_buffering off;                                # responses may be streamed
}
```

## One server per Kibana

A server process holds a single Kibana connection. To expose several Kibana instances, for example production and staging, run one server per instance, each on its own port and with its own store prefix or table, and route to them from the gateway.

## Callers without an identity

A caller whose identity has no stable identifier, such as a machine token without `sub`, produces an empty header, and the server answers `401`. Either reject such callers at the gateway or map them to a named profile there.
