---
description: "Protect the HTTP transport with your OpenID Connect provider: each user signs in, and gets the catalog named by their token."
---

# OpenID Connect authentication

Over HTTP, the server can authenticate each user with your OpenID Connect provider (Keycloak, Entra ID, Okta, Auth0…) instead of trusting a gateway. It then acts as an OAuth 2.1 resource server: MCP clients discover the provider, sign the user in, and send an access token on every request.

The server never sees passwords and never issues tokens. Client registration, sign-in and consent stay with the provider.

## How it works

1. An MCP client calls the endpoint without a token. The server answers `401` with a `WWW-Authenticate` challenge pointing to its [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) metadata, `/.well-known/oauth-protected-resource<path>`.
2. The metadata names your provider as the authorization server. The client signs the user in there and asks for a token bound to the endpoint ([RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) `resource`).
3. The client retries with `Authorization: Bearer <access token>`. The server verifies the token and reads the caller's profile from one of its claims.

Each user gets their own source catalog, and nobody can choose another one: the profile comes from the token, never from a header.

## Configure

In the [configuration file](../reference/config-file):

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
    oidc: {
      issuer: "https://sso.example.com/realms/acme",
      resource: "https://kibana-mcp.example.com/mcp",
      requiredScopes: ["kibana-mcp"],
    },
  },
});
```

Or with environment variables only:

```bash
KIBANA_HTTP_HOST=0.0.0.0 \
KIBANA_HTTP_OIDC_ISSUER=https://sso.example.com/realms/acme \
KIBANA_HTTP_OIDC_RESOURCE=https://kibana-mcp.example.com/mcp \
KIBANA_HTTP_OIDC_REQUIRED_SCOPES=kibana-mcp \
kibana-mcp-server serve --http --config ./kibana.mcp.config.mjs
```

| Option | Environment variable | Description |
| --- | --- | --- |
| `issuer` | `KIBANA_HTTP_OIDC_ISSUER` | Issuer identifier, exactly as published in its discovery document. Enables OpenID Connect. |
| `resource` | `KIBANA_HTTP_OIDC_RESOURCE` | Public URL of the MCP endpoint, as clients reach it. Required. |
| `audience` | `KIBANA_HTTP_OIDC_AUDIENCE` | Expected token audience. Defaults to `resource`. |
| `mode` | `KIBANA_HTTP_OIDC_MODE` | `offline` or `introspection`. Defaults to `introspection` when `clientId` is set, `offline` otherwise. |
| `clientId`, `clientSecret` | `KIBANA_HTTP_OIDC_CLIENT_ID`, `KIBANA_HTTP_OIDC_CLIENT_SECRET` | Confidential client of this server at the provider, used for introspection. |
| `requiredScopes` | `KIBANA_HTTP_OIDC_REQUIRED_SCOPES` | Scopes every token must carry. Separate them with spaces in the variable: a comma belongs to the scope name. |
| `scopesSupported` | `KIBANA_HTTP_OIDC_SCOPES_SUPPORTED` | Scopes advertised to clients in the metadata. |
| `profileClaim` | `KIBANA_HTTP_OIDC_PROFILE_CLAIM` | Claim naming the caller at the issuer. Defaults to `sub`. |
| `allowInsecureRequests` | `KIBANA_HTTP_OIDC_ALLOW_INSECURE_REQUESTS` | Allow a non-HTTPS issuer or resource. Development only. |

::: warning `resource` is the public URL
`resource` is never derived from the incoming request, whose `Host` header the caller controls. Behind a reverse proxy, use the external HTTPS URL. Its path must be the HTTP path of the server (`/mcp` by default): clients call that URL and look up its metadata at `/.well-known/oauth-protected-resource` followed by that path, so a proxy must forward both without rewriting the path.
:::

At startup, the server refuses:

- OpenID Connect combined with `KIBANA_HTTP_AUTH_TOKEN` or a profile header;
- a configuration without named profiles (a `store`, saved profiles, or the `{profile}` placeholder in `KIBANA_SOURCE_CATALOG_PATH`), since every user needs their own catalog;
- a non-HTTPS issuer or resource outside the loopback interface;
- a `resource` whose path differs from the HTTP path of the server;
- an issuer whose discovery document cannot be read, or names another issuer;
- in the offline mode, an issuer whose JWKS cannot be read or is malformed.

## Verify tokens

| Mode | How | Use it when |
| --- | --- | --- |
| `offline` | The JWT access token is checked locally with the provider's JWKS: signature, issuer, audience, expiration. No call to the provider per request. | The provider issues RFC 9068 JWT access tokens. |
| `introspection` | The provider is asked about each token ([RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662)). Answers are cached up to 60 seconds, never past the token expiration. | Tokens are opaque, or revocation must apply quickly. |

In the offline mode the JWKS is loaded at startup, then refreshed by `oauth4webapi` every 5 minutes, or sooner when a token names an unknown key. The JWKS and introspection endpoints are discovered from `<issuer>/.well-known/openid-configuration`, then `/.well-known/oauth-authorization-server`. Verification relies on [`oauth4webapi`](https://github.com/panva/oauth4webapi).

::: warning Access token format in offline mode
The offline mode accepts only [RFC 9068](https://datatracker.ietf.org/doc/html/rfc9068) JWT access tokens: the JWT header must carry `typ: at+jwt`, and the payload the `iss`, `sub`, `aud`, `exp`, `iat`, `jti` and `client_id` claims. Many providers issue plain JWTs by default (`typ: JWT`, `azp` instead of `client_id`), which are refused with `401`. If yours does, enable RFC 9068 access tokens on the provider, or use the introspection mode.
:::

::: warning Token audience
Every token must name the endpoint in its audience: the `aud` claim, or the `aud` field of the introspection answer, must contain `resource` (or `audience` when set). A token without it is refused with `401`, including when the provider returns no audience at all.

- **Keycloak**: add an audience mapper (*Audience*, *Included Custom Audience* set to the `resource` URL) to a client scope granted to MCP clients.
- **Entra ID**: tokens carry the application ID URI of the API (`api://…`) as audience; set `audience` to that URI.
:::

## Choose the profile claim

The caller's profile is the issuer followed by `#` and the value of `profileClaim`, for example `https://sso.example.com/realms/acme#alice`. A token without that claim is refused with `401`.

The issuer prefix keeps identities apart: the same `sub` or username at another provider is another person, and a catalog created through a gateway's profile header (`alice`) is never handed to an OIDC user. Changing `issuer` therefore starts every user with a new catalog.

- `sub` (default) is stable and unique, but opaque: catalogs are named after identifiers like `f81d4fae-7dec-…`.
- `preferred_username` or `email` give readable catalog names. Use them only if users cannot change them on the provider, or a user could take over another one's catalog.

Profile names are turned into safe keys before they reach a store, as with the [profile header](./http).

## Set up the provider

The provider must:

- publish its metadata over HTTPS, with an `issuer` identical to the configured one;
- let MCP clients register, through Dynamic Client Registration or Client ID Metadata Documents depending on what your clients support, or offer them a pre-registered public client;
- issue tokens for the endpoint audience (see the warning above);
- for the offline mode, issue RFC 9068 access tokens and publish a `jwks_uri`;
- for the introspection mode, publish an `introspection_endpoint` and give the server a confidential client.

Grant the scope listed in `requiredScopes` only to the users allowed to query Kibana: every authenticated caller reads what the Kibana service account can read. See the [security model](./security).

## Check the setup

```bash
# 1. an unauthenticated call is challenged
curl -i https://kibana-mcp.example.com/mcp -X POST \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer error="invalid_token", ..., resource_metadata="https://kibana-mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

```bash
# 2. the metadata names the provider
curl -s https://kibana-mcp.example.com/.well-known/oauth-protected-resource/mcp
# {"resource":"https://kibana-mcp.example.com/mcp","authorization_servers":["https://sso.example.com/realms/acme"],...}
```

```bash
# 3. a token issued for the endpoint is accepted
curl -s https://kibana-mcp.example.com/mcp -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

| Status | Meaning |
| --- | --- |
| `401` | Missing, expired or invalid token, wrong audience, wrong format in offline mode, or no profile claim. The client must sign in again. |
| `403` | Valid token without one of `requiredScopes`. |
| `500` | The provider (JWKS or introspection) could not be reached. Not a token issue. |
