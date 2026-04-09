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
- Guided machine setup with saved profiles and imported source catalogs
- Runtime configuration via `configure` plus persisted non-secret source catalogs

## Best-Effort Support

- Fully autonomous repo-local plugin installation by prompting alone across all Codex model variants
- Schema metadata endpoints (`kibana_data_views_fields`, `kibana_index_patterns_fields`, `elasticsearch_field_caps`)
- Nested query features that depend on schema availability
- Public package installs (once enabled)

Best-effort means we will investigate issues but cannot guarantee behavior across all deployments.

## Known Environment Constraints

- Some Codex model variants are less reliable at completing repo-local plugin installation without a manual Codex UI step. The supported fallback is to install the plugin manually from the local marketplace, then continue with MCP configuration.
- Some Kibana deployments proxy or block schema metadata endpoints. In those cases, schema-aware features may be unavailable.
- `KIBANA_BASE_URL` must be the Kibana base prefix, not a full search endpoint such as `/internal/search/es`.
- Linux secure storage depends on a Secret Service-compatible keyring being available and unlocked.
- If you run staging and production side by side, prefer saved machine profiles plus `KIBANA_PROFILE` selection. If you stay on env bootstrap, keep `KIBANA_SOURCE_CATALOG_PATH` distinct per entry so runtime-persisted sources do not overwrite each other.
- Credentials are not persisted to repo-local files or tracked config. Guided setup stores them in the platform credential store.

## Security Reporting

If you find a security issue, report it through the process documented in `SECURITY.md`.

## Response Expectations

- Critical security reports: acknowledge within 3 business days.
- Non-security issues: response cadence depends on maintainer availability.

## Out of Scope

- Writes to Kibana, Elasticsearch, or data views
- Workflow-specific automation beyond log investigation
