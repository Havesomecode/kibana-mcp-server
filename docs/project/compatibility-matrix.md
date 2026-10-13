---
title: Compatibility Matrix
status: active
updated: 2026-04-06
---

# Compatibility Matrix

This matrix distinguishes guaranteed support from best-effort behavior. Each claim includes an evidence basis so readers know what is tested vs inferred.

| Area | Status | Evidence basis | Notes |
| --- | --- | --- | --- |
| Node.js 22+ runtime | Guaranteed | Verified in CI via `.node-version` | Required for build and runtime. |
| Repo-local Codex plugin install | Guaranteed | Verified via `npm run verify` and entrypoint checks | Requires `npm install` + `npm run build`. |
| Fully autonomous plugin install by prompting alone across Codex model variants | Best-effort | Field reports show model-dependent behavior | Manual install from the local marketplace is the supported fallback when the agent cannot complete the UI step itself. |
| `kibana_internal_search_es` backend | Guaranteed | Verified in tests | Primary search transport. |
| `elasticsearch_search` backend | Guaranteed | Verified in tests | Direct Elasticsearch-compatible search path. |
| Schema metadata endpoints | Best-effort | Known 404s in some deployments | The server can sample fields through the configured search backend on `404`; this fallback is heuristic and `describe_fields` can still fail. |
| Nested query features | Best-effort | Depends on schema availability | Requires schema metadata for validation. |
| Connection-only package bootstrap | Guaranteed | Verified through CLI, rollback, packlist, and release-contract tests | Use `npx -y @havesomecode/kibana-mcp-server bootstrap --client codex`; configure an index only after the user names it. |
| Agent Skill installation | Guaranteed after publication | Repository discovery is verified with the `skills` CLI; skills.sh indexing follows the public branch | Install `kibana-log-investigation` from `Havesomecode/kibana-mcp-server`. |

Saved profiles carry an explicit catalog path. Direct connection startup requires `KIBANA_SOURCE_CATALOG_PATH` or a configuration-file catalog store; no checkout catalog is loaded implicitly. Without a saved connection, startup fails with `No saved Kibana connection is available. Run connection bootstrap first.` Guided `setup` remains supported for hand-authored catalogs.

Upgrade a row from best-effort to guaranteed only after verifying it in CI or in a reproducible environment test and documenting the evidence here.
