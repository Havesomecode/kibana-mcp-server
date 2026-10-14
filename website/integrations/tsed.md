---
description: "Expose Kibana MCP Server through a Ts.ED gateway protected by OIDC, with one catalog per user."
---

# Ts.ED gateway

Use [Ts.ED](https://tsed.dev/docs/mcp.html) to expose OAuth-protected MCP endpoints: one Kibana server per environment, one catalog per user.

## Run the Kibana MCP server

1. Create one config per Kibana instance:

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

2. Start production:

```bash
kibana-mcp-server serve --http --config ./kibana.production.config.ts
```

3. For staging, use its own URL, port `3102`, and prefix `kibana-mcp:staging:`.

## Declare the gateway

Set the profile from the verified token subject. Ts.ED interpolates `${OAUTH_SUB}`; keep placeholders as plain strings, not template literals. Overwrite client-supplied profile headers; never trust them.

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

Expected: a catalog per token subject; queries use the shared Kibana service account. New catalogs are empty. Call `discover`, ask for the exact index or pattern, and wait before `configure_index`. Never guess, list, or scan indexes.

## Things to check

- Reject tokens without a string `sub`, or assign a subject in Ts.ED. `${OAUTH_SUB}` is otherwise empty and the server returns `401`; check `client_credentials` and custom pre-authentication results.
- Use `http` for one MCP process shared across users. A `stdio` upstream starts one process per token.
