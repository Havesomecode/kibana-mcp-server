# Ts.ED gateway

[Ts.ED](https://tsed.dev/docs/mcp.html) can expose a third-party MCP server on one of its own endpoints, protected by OAuth. This example mounts a Kibana MCP server for each environment and gives every user their own source catalog.

## Run the Kibana MCP server

One process per Kibana instance:

```ts
// kibana.production.config.ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/redis";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_PRODUCTION_BASE_URL,
  user: process.env.KIBANA_USERNAME,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.REDIS_URL, keyPrefix: "kibana-mcp:production:" },
  http: {
    port: 3101,
    profileHeader: "x-kibana-profile",
    authToken: process.env.KIBANA_MCP_TOKEN,
  },
});
```

```bash
kibana-mcp-server serve --http --config ./kibana.production.config.ts
```

Staging uses the same file with its own URL, port `3102` and prefix `kibana-mcp:staging:`.

## Declare the gateway

Ts.ED interpolates `${OAUTH_SUB}` with the subject of the verified token. Placeholders are plain strings, not template literals.

```ts
import type { PlatformMcpSettings } from "@tsed/platform-mcp";

export function kibanaGateway(name: string, path: string, upstreamUrl: string): PlatformMcpSettings {
  return {
    name,
    path,
    auth: {
      issuer: process.env.OIDC_ISSUER,
      resource: new URL(path, process.env.PORTAL_BASE_URL).toString(),
      mode: "introspection",
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      requiredScopes: ["api_admin"],
    },
    upstream: {
      type: "http",
      url: upstreamUrl,
      headers: {
        Authorization: `Bearer ${process.env.KIBANA_MCP_TOKEN}`,
        "X-Kibana-Profile": "${OAUTH_SUB}",
      },
    },
  };
}

export const mcpsConfig: PlatformMcpSettings[] = [
  kibanaGateway("kibana", "/mcp/kibana/production", "http://127.0.0.1:3101/mcp"),
  kibanaGateway("kibana_staging", "/mcp/kibana/staging", "http://127.0.0.1:3102/mcp"),
];
```

## What each user gets

- Their own catalog, keyed by the token subject. A new user starts with an empty catalog and fills it by asking the agent to configure an index.
- The shared Kibana service account for queries.

## Things to check

- `${OAUTH_SUB}` is empty for tokens without a string `sub`, which is common for `client_credentials` grants and for custom pre-authentication checks that return no subject. The server then answers `401`. Reject those identities in Ts.ED, or give them a subject there.
- Compared with a `stdio` upstream, an `http` upstream keeps one Kibana MCP process for all users instead of one process per token.
