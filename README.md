# Kibana Log Investigation MCP

Read Kibana logs with an agent. No Elasticsearch or Kibana writes, no guessed indexes.

## Quick start

Use Node.js 22+, `codex` on `PATH`, and a reachable Kibana base URL with basic auth. Run:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
```

Missing values are prompted for. For automation, provision `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` first. Never pass a password in an argument; use environment, `--password-env NAME`, or `--password-stdin`.

1. Clear those variables from the server environment after bootstrap so it uses the saved profile. Bash: `unset KIBANA_BASE_URL KIBANA_USERNAME KIBANA_PASSWORD`; PowerShell instructions are in [INSTALL.md](INSTALL.md).
2. Open a fresh agent session and call `discover`.
3. Name the exact index or pattern when asked. The agent calls `configure_index`, then `discover` again. It must not guess, enumerate, scan, or auto-select indexes.

Bootstrap saves and verifies the connection, not index access. Startup requires a connection; direct environment startup overrides profiles and needs `KIBANA_SOURCE_CATALOG_PATH` or a configuration-file store. No implicit checkout catalog or MCP credential input is supported.

## Install the investigation skill

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex --global --yes
```

Use [INSTALL.md](INSTALL.md) for profiles, plugin installation, or hand-authored catalogs. Bare `setup` imports a hand-authored catalog; with connection options it runs bootstrap.

## MCP tools

| Tool | Use |
| --- | --- |
| `discover` | List configured sources for the caller. |
| `describe_fields` | Find fields and exact-match support. |
| `query` | Search sources over an absolute time window: `hits`, `count`, `histogram`, `terms`, `stats`, or `grouped_top_hits`. |
| `filter` | Filter a known exact field. |
| `configure_index` | Validate and save the user's exact index or pattern. |

## Run it as a shared service

Use HTTP behind an authenticated gateway to give each caller a separate catalog. Stdio serves one configuration.

```ts
// kibana.mcp.config.ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/postgres";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.DATABASE_URL },
  http: { port: 3000, profileHeader: "x-kibana-profile", authToken: process.env.MCP_TOKEN },
});
```

```bash
kibana-mcp-server serve --http --config ./kibana.mcp.config.ts
```

**Restrict access to the authenticated gateway:** the server trusts its profile header. Stores: files, Redis, PostgreSQL, MongoDB, SQLite, or a custom store.

## Repository Codex plugin

Run `npm run build` before installing the plugin. Its bundled runtime needs no original checkout or `node_modules`. Check startup status and sanitized stderr before restarting a discussion; `npm run verify:entrypoint` tests the copied plugin.

## Version-matched agent handoff

Resolve the full **commit SHA** before installation: this is the **resolved installation commit**. Read README, INSTALL, and skills from that commit:

```text
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
```

Do not infer a Git tag from an npm version. Use the exact package's `gitHead`; pin the same package version. From a maintained checkout, verify with `node scripts/readme-handoff.mjs <resolved-installation-ref>`. Missing metadata or failed retrieval must be reported, not replaced with master.

## Documentation

| Topic | Link |
| --- | --- |
| Getting started | https://havesomecode.github.io/kibana-mcp-server/guide/getting-started |
| Agent plugins and skills | https://havesomecode.github.io/kibana-mcp-server/ai/agent-plugins |
| Investigating with an agent | https://havesomecode.github.io/kibana-mcp-server/guide/investigating |
| HTTP transport and security model | https://havesomecode.github.io/kibana-mcp-server/deployment/http |
| Catalog stores | https://havesomecode.github.io/kibana-mcp-server/deployment/catalog-stores |
| Integration examples (gateway, Ts.ED, Docker) | https://havesomecode.github.io/kibana-mcp-server/integrations/ |
| Tool, CLI and configuration reference | https://havesomecode.github.io/kibana-mcp-server/reference/cli |

Documentation sources: `website/`. Support and release policy: `docs/project/`. Version record: GitHub Releases, not the checkout's `package.json`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for contributions and private vulnerability reports.

## Development

```bash
npm install
npm run verify
npm run docs:dev
```

This project is independent and not affiliated with or endorsed by Elastic. Kibana and Elasticsearch are trademarks of Elasticsearch B.V.
