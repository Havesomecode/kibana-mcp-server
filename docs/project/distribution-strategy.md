---
title: Distribution Strategy
status: active
updated: 2026-04-09
---

# Distribution Strategy

Keep agent installation self-contained. Make prompt-free package bootstrap and skills.sh discovery the guaranteed newcomer path; preserve repo-local installation for contributors under the same contract.

## Supported Distribution Paths

### 1. Public package plus Agent Skill (guaranteed)

1. Install `kibana-log-investigation` from `Havesomecode/kibana-mcp-server` with the `skills` CLI.
2. Run the package's prompt-free `bootstrap --client codex` command.
3. Confirm bootstrap verified only the connection, saved an empty managed catalog, registered through `codex mcp add`, and read registration back.
4. Start a fresh agent session. Ask for the exact index or pattern before calling `configure_index`.

Bootstrap never lists, scans, infers, or configures indexes. Index validation begins only after the user explicitly supplies one.

### 2. Repo-local Codex plugin

1. Clone the repo.
2. `npm install`
3. `npm run build`
4. Install the `Kibana Log Investigation` plugin from the repo marketplace in Codex.

This always-supported path is required for development and is the support baseline.

### 3. Public package without the skill

Run `npx -y @havesomecode/kibana-mcp-server bootstrap --client codex`, or have the MCP client invoke the published binary instead of a repo-local build.

Keep this live path aligned with repo-local installation and the hosted homepage. Before publishing:

1. Confirm maintainers control the npm package identity.
2. Verify `npm pack` contents: runtime entrypoint, plugin metadata, README, LICENSE.
3. Pass CI and release workflows on the supported Node line.
4. Publish the support policy and compatibility matrix.
5. Use OIDC trusted publishing; never keep long-lived publish tokens.

## Artifact Boundary

| Include | Exclude |
| --- | --- |
| `dist/` runtime output | Tests and fixtures |
| Plugin metadata and MCP config | Local operator catalogs and saved machine profiles |
| `skills/kibana-log-investigation/SKILL.md` | Development-only scripts and tooling unrelated to runtime |
| `README.md`, `LICENSE` | |

## Versioning

Use `semantic-release` for semantic versioning. Read shipped versions from Git tags, npm, or GitHub Releases—not `package.json` on `master`. Generated version bumps and release notes are not committed back to Git.

## Ongoing Obligations

1. Keep npm identity under maintainer control and release automation green on the supported Node line.
2. Keep `npm run verify` enforcing the artifact boundary.
3. Keep the homepage, repo-local instructions, and support policy on the same install contract.
