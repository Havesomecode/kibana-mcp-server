---
description: "The default stdio transport: what it serves and when to move to HTTP."
---

# stdio transport

stdio is the default transport: the MCP client starts the server as a child process and talks to it over standard input and output. It serves **one global configuration** to its single caller.

```bash
npx -y @havesomecode/kibana-mcp-server serve
```

## What it serves

- After [guided setup or bootstrap](../guide/getting-started), the default saved profile.
- With `--profile <name>` or `KIBANA_PROFILE`, that saved profile.
- With the connection in [environment variables](../reference/environment), the catalog explicitly named by `KIBANA_SOURCE_CATALOG_PATH`. No checkout file is selected implicitly.
- With a [configuration file](../guide/configuration-file) that declares a store, the profile named by `profile`, `--profile` or `KIBANA_PROFILE`, falling back to `default`.

The server must have a connection before it starts. Without a saved or explicit connection, startup fails with `No saved Kibana connection is available. Run connection bootstrap first.`

## Running from a checkout

```bash
KIBANA_BASE_URL=https://kibana.example.com \
KIBANA_USERNAME=elastic \
KIBANA_PASSWORD=secret \
KIBANA_SOURCE_CATALOG_PATH=config/sources.json \
npm run dev
```

Or, after guided setup:

```bash
npm run dev
```

## When to move to HTTP

stdio needs one process per caller. Behind a gateway that serves many users, each with their own catalog, run a single [HTTP server](./http) instead.
