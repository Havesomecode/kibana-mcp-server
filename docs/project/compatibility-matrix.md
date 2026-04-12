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
| Schema metadata endpoints | Best-effort | Known 404s in some deployments | `describe_fields` may fail if endpoints are blocked. |
| Nested query features | Best-effort | Depends on schema availability | Requires schema metadata for validation. |
| Public package install | Guaranteed | Published on npm and verified through packlist, release-contract, and release automation checks | Direct machine setup uses `npx -y @havesomecode/kibana-mcp-server`. |

Upgrade a row from best-effort to guaranteed only after verifying it in CI or in a reproducible environment test and documenting the evidence here.
