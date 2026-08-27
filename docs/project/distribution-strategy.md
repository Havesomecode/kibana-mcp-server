---
title: Distribution Strategy
status: active
updated: 2026-04-09
---

# Distribution Strategy

## Goals

- Make the MCP installable by AI agents without manual explanation.
- Make prompt-free package bootstrap and skills.sh discovery the guaranteed newcomer path.
- Preserve the repo-local Codex plugin workflow for contributors.
- Keep the public package path healthy and aligned with the repo-local workflow.

## Supported Distribution Paths

### 1. Public package plus Agent Skill (guaranteed)

The newcomer path is:

1. Install `kibana-log-investigation` from `Havesomecode/kibana-mcp-server` with the `skills` CLI.
2. Run the package's prompt-free `bootstrap --client codex` command.
3. Let bootstrap verify only the Kibana connection, save an empty managed catalog, register through `codex mcp add`, and read the registration back.
4. In a fresh agent session, ask the user which exact index or pattern to configure before calling `configure_index`.

Bootstrap never lists, scans, infers, or configures indexes. Index validation begins only after the user explicitly supplies one.

### 2. Repo-local Codex plugin

This is the primary, always-supported path:

1. Clone the repo.
2. `npm install`
3. `npm run build`
4. Install the `Kibana Log Investigation` plugin from the repo marketplace in Codex.

This path is required for development and is the baseline for support.

### 3. Public package without the skill

The package is published for agent-friendly execution via:

- `npx -y @havesomecode/kibana-mcp-server bootstrap --client codex`
- MCP clients that invoke the published package binary instead of a repo-local build

This path depends on the following remaining true:

- npm package ownership is under maintainer control for the chosen package name
- Verified `npm pack` contents (runtime entrypoint, plugin metadata, README, LICENSE).
- CI and release workflows green on the supported Node line.
- Clear support policy and compatibility matrix published.
- Trusted publishing enabled (OIDC), no long-lived publish tokens.

This path is live and should stay aligned with the repo-local install story and the hosted homepage.

## Artifact Boundary

The release artifact must include:

- `dist/` runtime build output
- plugin metadata and MCP config
- `skills/kibana-log-investigation/SKILL.md`
- `README.md`, `LICENSE`

The release artifact must exclude:

- tests and fixtures
- local operator config (`config/sources.json`, `config/sources.runtime.json`)
- development-only scripts and tooling that do not affect runtime execution

## Versioning

Releases use semantic versioning driven by `semantic-release`.

The authoritative release record is:

- Git tags
- npm package versions
- GitHub Releases

The repository does not commit generated version bumps or release notes back into git.
The `version` field in `package.json` on `master` is therefore a source manifest value, not an authoritative shipped version.

## Ongoing Obligations

Keep public publishing healthy by ensuring all of the following remain true:

- the npm package identity stays under maintainer control
- `npm run verify` continues to enforce the published artifact boundary
- release automation remains green on the supported Node line
- the hosted homepage, repo-local install path, and support policy describe the same install contract
