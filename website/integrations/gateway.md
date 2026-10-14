---
description: "What an MCP gateway or reverse proxy must do in front of the HTTP transport, with an nginx example."
---

# Behind an MCP gateway

Put HTTP behind an MCP/API gateway or reverse proxy. The server does not authenticate end users; the gateway must.

## The contract

For every forwarded request:

1. **Authenticate the caller:** OIDC, API key, or mutual TLS.
2. **Set the profile header** from a stable verified identity, typically token `sub`. It selects the caller's catalog.
3. **Overwrite, never forward, that header.** Client-supplied values could expose another caller's catalog.
4. **Send the shared secret** as `Authorization: Bearer <token>` to authenticate the gateway to the server.

```
caller ──(OIDC token)──▶ gateway ──(Authorization: Bearer <shared secret>
                                    X-Kibana-Profile: <caller id>)──▶ kibana-mcp-server ──▶ Kibana
```

## Server side

Set a profile header, or name one default profile. Non-loopback HTTP requires `KIBANA_HTTP_AUTH_TOKEN`; otherwise startup is refused.

```bash
KIBANA_HTTP_AUTH_TOKEN=change-me \
kibana-mcp-server serve --http \
  --config ./kibana.mcp.config.ts \
  --profile-header x-kibana-profile
```

## Example: nginx with an auth subrequest

With nginx and an OAuth2 proxy, authenticate and overwrite headers:

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

Run one process per Kibana instance. Give each its own port and store prefix or table, then route from the gateway.

## Callers without an identity

Reject identities without a stable identifier, or map them to a named profile at the gateway. An empty profile header (for example, a token without `sub`) returns `401`.
