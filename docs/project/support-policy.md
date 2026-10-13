---
title: Support Policy
status: active
updated: 2026-04-09
---

# Support Policy

## Audience

This MCP is designed for operators and AI agents that need read-only access to Kibana-backed logs for investigation workflows.

## Guaranteed Support

- Node.js 22+ runtime
- Repo-local Codex plugin install
- `kibana_internal_search_es` and `elasticsearch_search` backends
- Connection-only bootstrap with saved profiles and platform credentials
- Guided machine setup for explicitly selected hand-authored source catalogs
- Startup with a saved profile, or a complete explicit connection plus `KIBANA_SOURCE_CATALOG_PATH` or a configuration-file catalog store
- Explicit user-approved source configuration through `configure_index`; no MCP tool accepts connection credentials

## Best-Effort Support

- Fully autonomous repo-local plugin installation by prompting alone across all Codex model variants
- Schema metadata endpoints (`kibana_data_views_fields`, `kibana_index_patterns_fields`, `elasticsearch_field_caps`)
- Nested query features that depend on schema availability
- Linux secure storage when a Secret Service-compatible keyring is missing or locked

Best-effort means we will investigate issues but cannot guarantee behavior across all deployments.

Startup without a saved connection fails with `No saved Kibana connection is available. Run connection bootstrap first.` Run connection-only bootstrap before reconnecting the MCP client. For saved-profile use, leave direct connection variables unset in the server environment.

## Known Environment Constraints

- Some Codex model variants are less reliable at completing repo-local plugin installation without a manual Codex UI step. The supported fallback is to install the plugin manually from the local marketplace, then continue with MCP configuration.
- Some Kibana deployments proxy or block schema metadata endpoints. On `404`, the server can sample fields through the configured search backend. This fallback is heuristic, not authoritative; schema-dependent features can still be unavailable.
- `KIBANA_BASE_URL` must be the Kibana base prefix, not a full search endpoint such as `/internal/search/es`.
- Linux secure storage depends on a Secret Service-compatible keyring being available and unlocked.
- If you run staging and production side by side, prefer saved machine profiles plus `KIBANA_PROFILE` selection. For direct environment startup, name `KIBANA_SOURCE_CATALOG_PATH` explicitly and keep it distinct per entry so managed sources from different environments do not mix.
- Credentials are not persisted to repo-local files or tracked config. Bootstrap and guided setup store them in the platform credential store.

## Security Reporting

If you find a security issue, report it through the process documented in `SECURITY.md`.

## Response Expectations

- Critical security reports: acknowledge within 3 business days.
- Non-security issues: response cadence depends on maintainer availability.
- Release notes and shipped version history are published through GitHub Releases and npm, not through committed changelog updates in the repository.
- Questions about the current shipped version should be answered from npm or GitHub Releases, not from the `package.json` version committed in git.

## Out of Scope

- Writes to Kibana, Elasticsearch, or data views
- Workflow-specific automation beyond log investigation
