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

The repo-local install path for this Kibana MCP worked in practice, but the handoff was still fragile. A colleague could not reliably give only the raw `INSTALL.md` link to another agent and expect the full setup flow to succeed without extra human explanation about the repo name, plugin location, build requirements, fallback behavior, or environment-specific configuration rules.

The friction showed up most clearly when older Codex model variants failed to complete the repo-local plugin install autonomously, and when one workspace needed both staging and production MCP entries. The setup guidance also left room for a common configuration mistake: setting `KIBANA_BASE_URL` to a full Kibana API endpoint instead of the base prefix that the server should join with source backend paths.

## Guidance

Treat `INSTALL.md` as the canonical operator handoff for this repo. An agent that receives only the raw file link should still be able to infer all of the following without extra prompting:

- the GitHub repository to clone
- the repo-scoped plugin name and location
- the required Node.js major and build steps
- the manual plugin-install fallback path if the model cannot complete the Codex UI step itself
- the MCP configuration and verification flow

For multi-environment setup, always ask the user for a short environment name such as `staging`, `prod`, `preprod`, or `qa`. Derive the source catalog path as `config/sources.<ENV_NAME>.json` and use a distinct value per MCP entry. Do not invent the environment name, and do not reuse one shared runtime catalog path across staging and production.

If the operator already keeps target-specific host variables such as `KIBANA_BASE_URL_STAGING` and `KIBANA_BASE_URL_PROD`, preserve that host-side convention if it is useful to them. For each MCP entry, map those values into the standard runtime variables expected by the server:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`

Treat manual plugin installation as a supported continuation path, not as a setup failure. If a model cannot complete the repo-local plugin install from prompting alone, the agent should tell the user exactly which Codex UI steps to click, wait for confirmation, then continue with configuration and verification.

Keep `KIBANA_BASE_URL` limited to the Kibana base prefix. Endpoint paths such as `/internal/search/es` belong in the source backend configuration, not in `KIBANA_BASE_URL`.

## Why This Matters

The main benefit is durable handoff quality. A colleague should be able to send only the raw `INSTALL.md` link to another agent and get the same setup flow every time, instead of relying on undocumented tribal knowledge about the repo structure or Codex behavior.

The environment-name rule matters because this repo persists runtime source catalogs. If two MCP entries share one runtime catalog path, one environment can silently overwrite the other. Deriving `config/sources.<env>.json` from the user-provided environment name prevents that collision.

The env-var mapping rule matters because operators often already have separate secrets or shell variables for each target environment. Allowing those host-side names while standardizing each MCP entry onto the server's `KIBANA_*` contract keeps the server simple without forcing users to reorganize their environment management.

The `KIBANA_BASE_URL` clarification matters because the wrong value looks plausible but produces a bad combined URL at runtime. Calling out correct and incorrect shapes removes a common source of confusing 404 debugging.

## When to Apply

- When this repo is being handed to another operator or agent for first-time setup from a cloned checkout
- When the handoff must work from the raw `INSTALL.md` link alone
- When one Codex workspace needs both staging and production MCP entries
- When the operator already uses target-specific host variables and needs them mapped into the server's runtime variables
- When a user reports 404s after setup and the configured `KIBANA_BASE_URL` may include a full endpoint path

## Examples

Raw handoff that should now be sufficient by itself:

```text
Use this INSTALL.md as the canonical setup guide:
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/master/INSTALL.md

Clone and set up the repo end to end, install the local plugin, ask me for the environment name, configure Kibana access, and verify the MCP works.
```

Manual plugin-install fallback:

```text
If you cannot complete the repo-local plugin install yourself, open this repo in Codex, open plugins/kibana-log-investigation, install "Kibana Log Investigation" from the local marketplace, restart Codex if needed, then continue with MCP configuration.
```

Derived source catalog paths:

```text
User says: staging
Agent derives: config/sources.staging.json

User says: prod
Agent derives: config/sources.prod.json
```

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

- [Persist runtime source catalog for client-configured Kibana MCP sessions](../integration-issues/kibana-mcp-config-reset-after-restart-2026-04-03.md)
- [Kibana schema metadata endpoints may be unavailable behind a proxy](../integration-issues/kibana-mcp-schema-endpoints-may-be-unavailable-2026-04-03.md)
- GitHub issue search was skipped because network access was unavailable in this session.
