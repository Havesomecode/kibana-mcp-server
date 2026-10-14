---
title: Support Policy
status: active
updated: 2026-10-14
---

# Support Policy

This MCP supports read-only Kibana log investigation by operators and AI agents. Kibana, Elasticsearch, and data-view writes, and automation beyond log investigation, are out of scope.

## Guaranteed Support

| Area | Guaranteed contract |
| --- | --- |
| Runtime | Node.js 22+ |
| Installation | Repo-local Codex plugin |
| Search | `kibana_internal_search_es` and `elasticsearch_search` |
| Connection setup | Connection-only bootstrap, saved profiles, platform credentials |
| Guided setup | Explicitly selected hand-authored source catalogs |
| Startup | Saved profile, or complete explicit connection plus `KIBANA_SOURCE_CATALOG_PATH` or configuration-file catalog store |
| Source configuration | User-approved `configure_index`; no MCP tool accepts connection credentials |

## Connection Setup Boundary

1. Run operator-side `bootstrap` for the connection, then user-approved `configure_index` for sources. Credential-taking `configure` and unconfigured startup are intentionally retired.
2. Select a catalog path/store explicitly for direct environment startup. No working-directory catalog is searched. Catalog JSON and existing catalog/profile files are unchanged.
3. Bootstrap before reconnecting if startup reports `No saved Kibana connection is available. Run connection bootstrap first.` For saved profiles, leave direct connection variables unset in the server environment.

## Best-Effort Support

| Area | Limitation |
| --- | --- |
| Autonomous repo-local installation | Prompt-only completion varies by Codex model |
| Schema metadata | `kibana_data_views_fields`, `kibana_index_patterns_fields`, `elasticsearch_field_caps` may be unavailable |
| Nested queries | Depend on schema availability |
| Linux secure storage | Missing or locked Secret Service-compatible keyring |

We investigate best-effort issues without guaranteeing behavior across deployments.

## Known Environment Constraints

1. If autonomous plugin installation stalls, install manually from the local marketplace, then continue MCP configuration. This is a supported fallback.
2. Treat search-backend field sampling as heuristic, not authoritative. It applies only when all known Kibana data-view/index-pattern metadata endpoints return `404`, never to direct Elasticsearch field-capability errors. Schema-dependent features may remain unavailable.
3. Set `KIBANA_BASE_URL` to the Kibana base prefix, not a search endpoint such as `/internal/search/es`.
4. Keep Linux's Secret Service-compatible keyring available and unlocked. Bootstrap and guided setup store credentials in the platform credential store, never repo-local files or tracked config.
5. Separate staging and production with saved profiles and `KIBANA_PROFILE`. For direct environment startup, set a distinct `KIBANA_SOURCE_CATALOG_PATH` per entry to avoid mixing managed sources.

## Security Reporting

Report security issues through `SECURITY.md`.

## Response Expectations

| Request | Expectation |
| --- | --- |
| Critical security report | Acknowledge within 3 business days |
| Non-security issue | Depends on maintainer availability |
| Release notes or shipped versions | Read GitHub Releases or npm, not committed changelogs or the Git `package.json` version |
