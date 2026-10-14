---
description: "The default stdio transport: what it serves and when to move to HTTP."
---

# stdio transport

```bash
npx -y @havesomecode/kibana-mcp-server serve
```

stdio is the default: the MCP client starts a child process over standard input/output, serving **one global configuration** to one caller.

Supply a connection before startup. Otherwise it fails with `No saved Kibana connection is available. Run connection bootstrap first.`

## What it serves

- After [guided setup or bootstrap](../guide/getting-started), the default saved profile.
- With `--profile <name>` or `KIBANA_PROFILE`, that saved profile.
- With an [environment connection](../reference/environment), the explicit `KIBANA_SOURCE_CATALOG_PATH` catalog. No checkout file is selected implicitly.
- With a [configuration file](../guide/configuration-file) that declares a store, the profile named by `profile`, `--profile` or `KIBANA_PROFILE`, falling back to `default`.

## Running from a checkout

```bash
KIBANA_BASE_URL=https://kibana.example.com \
KIBANA_USERNAME=elastic \
KIBANA_PASSWORD=secret \
KIBANA_SOURCE_CATALOG_PATH=config/sources.json \
npm run dev
```

After guided setup, omit the environment values:

```bash
npm run dev
```

## When to move to HTTP

Use one [HTTP server](./http) behind a multi-user gateway with per-user catalogs. stdio needs one process per caller.
