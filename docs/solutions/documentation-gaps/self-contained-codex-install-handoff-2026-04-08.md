---
title: Make INSTALL.md self-contained for repo-local Codex handoff
date: 2026-04-08
category: documentation-gaps
module: kibana-mcp-server
problem_type: documentation_gap
component: documentation
severity: high
applies_when:
  - handing only the raw INSTALL.md link to another Codex user or agent
  - setting up separate staging and production MCP entries from one repo checkout
  - using target-specific host environment variables for different Kibana environments
  - troubleshooting 404s caused by a misconfigured KIBANA_BASE_URL
symptoms:
  - agents need extra oral context beyond INSTALL.md to complete setup reliably
  - repo-local plugin installation can stall on some Codex model variants
  - multiple environments can overwrite each other's source catalog if they share one runtime path
  - users can configure KIBANA_BASE_URL as a full endpoint and hit avoidable 404s
root_cause: inadequate_documentation
resolution_type: documentation_update
tags: [codex, install, plugin, multi-environment, kibana]
---

# Make INSTALL.md self-contained for repo-local Codex handoff

## Context

The 2026-04-08 handoff needed extra explanation about repository, build, plugin fallback, and environment isolation. Older Codex model variants stalled on plugin installation; endpoint-shaped `KIBANA_BASE_URL` values caused avoidable `404`s.

## Repo-local handoff steps

Use `INSTALL.md` as the canonical operator handoff, including for raw-link setup, multiple environments, host-variable mapping, and base-URL troubleshooting.

1. With Node.js 22+, run `git clone https://github.com/Havesomecode/kibana-mcp-server` and `cd kibana-mcp-server`. Read `INSTALL.md` first.
2. Resolve the full installation commit SHA using the commands below, then `git checkout <resolved-commit>`. Verify README, INSTALL, and skills from that commit. Stop on missing refs or files; never substitute master.
3. Run `npm install` and `npm run build`.

### Install and connect

1. In Codex, install **Kibana Log Investigation** from `.agents/plugins/marketplace.json`; plugin root: `plugins/kibana-log-investigation`. If the model stalls, use the manual fallback below and wait for confirmation.
2. Ask for a short profile name, such as `staging` or `prod`. Supply credentials through operator-side environment input or secure prompts. On Linux, unlock the Secret Service keyring.
3. Run `node dist/src/bin/kibana-mcp-server.js bootstrap --profile <name> --client none`. Do not register a duplicate standalone MCP or invent catalog contents. Bootstrap verifies the connection, stores platform credentials, and creates an empty machine-local catalog without listing, scanning, inferring, or configuring indexes.
4. Restart Codex, load `skills/kibana-log-investigation/SKILL.md` from the same commit, and check MCP tools. Ask for the exact index or pattern before `configure_index`.

### Resolve the installation commit

| Input | Resolve the SHA |
| --- | --- |
| Checkout branch/tag | `git rev-parse <ref>^{commit}` |
| Detached checkout | `git rev-parse HEAD` |
| Exact npm version | `npm view @havesomecode/kibana-mcp-server@<exact-version> gitHead` |

Do not infer a Git tag from an npm version. Pin the same exact package version. Fetch missing selected refs explicitly; absent metadata is an error.

Verify the commit-pinned README with `node scripts/readme-handoff.mjs <resolved-commit>`. The repository-only helper compares fetched bytes against Git and returns `url` and `commit` without installing or configuring anything. Historical checkouts without it need explicit resolution and retrieval verification.

## Keep environments separate

1. Give each saved profile its own catalog. `configure_index` writes to the selected managed catalog; guided `setup` instead imports an explicitly selected hand-authored catalog.
2. For direct environment startup, provide `KIBANA_SOURCE_CATALOG_PATH` or a configuration-file store. Keep catalogs distinct; no checkout catalog loads implicitly.
3. Preserve useful host-specific variables such as `KIBANA_BASE_URL_STAGING` and `KIBANA_BASE_URL_PROD`; map each entry to standard `KIBANA_BASE_URL`, `KIBANA_USERNAME`, `KIBANA_PASSWORD`, and `KIBANA_SOURCE_CATALOG_PATH` as shown below.
4. Set `KIBANA_BASE_URL` to the Kibana base prefix. Put paths such as `/internal/search/es` in the source backend configuration, not the base URL.

## Examples

Copy the resolved commit into this handoff; branch/tag names are resolution inputs, not durable README URLs:

```text
For the resolved installation commit, read this README:
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md

Verify that this README matches the resolved installation commit before handing off. Follow INSTALL.md from the same commit, bootstrap only the connection, and ask me for the exact index or pattern before configuring it. If the ref or README cannot be resolved, report that error instead of using another version's instructions.
```

Manual plugin-install fallback:

```text
If you cannot complete the repo-local plugin install yourself, open this repo in Codex, open plugins/kibana-log-investigation, install "Kibana Log Investigation" from the local marketplace, restart Codex if needed, then continue with MCP configuration.
```

Standalone package registration with named profiles (not alongside the repo-local plugin):

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap --profile staging --client codex
npx -y @havesomecode/kibana-mcp-server bootstrap --profile prod --no-default --client codex
```

Leave direct connection variables unset for saved-profile server processes; they select environment startup and require an explicit catalog/store. Without a saved connection, startup fails with `No saved Kibana connection is available. Run connection bootstrap first.`

Mapping target-specific host variables into the standard runtime variables for one MCP entry:

```text
Host-side variables:
KIBANA_BASE_URL_STAGING=https://kibana-staging.example.com
KIBANA_USERNAME_STAGING=staging_user
KIBANA_PASSWORD_STAGING=staging_secret

MCP entry runtime variables:
KIBANA_BASE_URL=$KIBANA_BASE_URL_STAGING
KIBANA_USERNAME=$KIBANA_USERNAME_STAGING
KIBANA_PASSWORD=$KIBANA_PASSWORD_STAGING
KIBANA_SOURCE_CATALOG_PATH=config/sources.staging.json
```

Correct vs incorrect `KIBANA_BASE_URL` values:

```text
Correct:
KIBANA_BASE_URL=https://kibana.example.com
KIBANA_BASE_URL=https://gateway.example.com/logs
```

```text
Incorrect:
KIBANA_BASE_URL=https://kibana.example.com/internal/search/es
KIBANA_BASE_URL=https://gateway.example.com/logs/internal/search/es
```

## Related

- [Kibana schema metadata endpoints may be unavailable behind a proxy](../integration-issues/kibana-mcp-schema-endpoints-may-be-unavailable-2026-04-03.md)
- GitHub issue search was skipped because network access was unavailable in this session.
