# Kibana Log Investigation MCP

Read-only MCP server for agent-driven log investigation against Kibana-backed search endpoints protected with basic auth.

It gives an agent what a Kibana UI cannot: a short list of logical sources it can trust, the fields it may filter on, and typed results.

**Documentation: https://havesomecode.github.io/kibana-mcp-server/**

## What it provides

- `discover` lists the logical sources configured for the caller
- `describe_fields` exposes the effective fields of a source, including which ones support exact matching
- `query` searches one or more sources over an absolute time window in `hits`, `count`, `histogram`, `terms`, `stats`, or `grouped_top_hits` mode
- `filter` runs an exact-field filter when the field name is already known
- `configure_index` validates and persists exactly one index or pattern after the user explicitly names it

The server never writes to Elasticsearch or Kibana, and never guesses an index.

## Requirements

- Node.js 22+
- A Kibana-compatible read endpoint reachable with basic auth
- One or more Elasticsearch index patterns

## Quick start

Pre-provision the connection values in the environment, then bootstrap:

```bash
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
```

Bootstrap verifies only the Kibana connection, creates an empty managed catalog, stores the credentials securely and registers the server. It does not list, scan, infer, or configure indexes: the agent asks which exact index or pattern to use, then calls `configure_index`.

Never pass passwords as command-line arguments. Use `KIBANA_PASSWORD`, `--password-env NAME`, or `--password-stdin`.

Install the agent skill that teaches the investigation workflow:

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex \
  --global \
  --yes
```

`INSTALL.md` is the deterministic install and handoff guide for agents.

For a version-matched handoff, resolve the selected branch, tag, or package metadata to the full commit SHA. That SHA is the **resolved installation commit** used in `https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md`. Read `INSTALL.md` and the skills from the same commit. Do not infer a Git tag from an npm version; use the exact package's `gitHead`. A maintained checkout can verify the handoff with `node scripts/readme-handoff.mjs <resolved-installation-ref>`.

## Run it as a shared service

By default the server speaks stdio and serves one configuration. Over HTTP, one process serves every caller of your gateway, each with their own source catalog:

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

Catalogs can live in files, Redis, PostgreSQL, MongoDB, SQLite, or a store you write. The HTTP transport trusts the profile header as sent: only a gateway that has authenticated the caller should reach it.

## Repository Codex plugin

`npm run build` creates a self-contained runtime in `plugins/kibana-log-investigation/dist/`. The repo-local Codex plugin launches that installed bundle through `mcp-launcher.mjs`, without depending on the original checkout or its `node_modules`. Use `npm run verify:entrypoint` for the isolated copied-plugin handshake, and inspect Codex's MCP startup status plus sanitized stderr before restarting a discussion.

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

The documentation sources live in `website/`.

## Project status

- Published package: `npx -y @havesomecode/kibana-mcp-server`
- Agent skill: `npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation`
- Repo-local Codex plugin install remains a first-class path for cloned checkouts
- GitHub Releases are the canonical release notes and version record; the `version` field in `package.json` inside git is not the release source of truth
- Support posture, compatibility matrix, distribution strategy and release checklist live in `docs/project/`
- Contributing and security reporting live in `CONTRIBUTING.md` and `SECURITY.md`

## Development

```bash
npm install
npm run verify
npm run docs:dev
```

This project is independent and not affiliated with or endorsed by Elastic. Kibana and Elasticsearch are trademarks of Elasticsearch B.V.
