---
title: Distribution Strategy
status: active
updated: 2026-04-09
---

# Distribution Strategy

## Goals

- Make the MCP installable by AI agents without manual explanation.
- Preserve the repo-local Codex plugin workflow as the guaranteed path.
- Offer a public distribution path once the artifact boundary is verified.

## Supported Distribution Paths

### 1. Repo-local Codex plugin (guaranteed)

This is the primary, always-supported path:

1. Clone the repo.
2. `npm install`
3. `npm run build`
4. Install the `Kibana Log Investigation` plugin from the repo marketplace in Codex.

This path is required for development and is the baseline for support.

### 2. Public package (planned, gated)

The package surface is prepared for agent-friendly execution via:

- `npx -y @havesomecode/kibana-mcp-server`
- MCP clients that invoke the published package binary instead of a repo-local build

Public publishing remains gated until the following are complete:

- npm package ownership is under maintainer control for the chosen package name
- Verified `npm pack` contents (runtime entrypoint, plugin metadata, README, LICENSE).
- CI and release workflows green on the supported Node line.
- Clear support policy and compatibility matrix published.
- Trusted publishing enabled (OIDC), no long-lived publish tokens.

This path is optional until explicitly enabled.

## Artifact Boundary

The release artifact must include:

- `dist/` runtime build output
- plugin metadata and MCP config
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

## Decision Triggers

Move from repo-local only to public publishing when:

- the repo has an npm package identity maintainers can actually control
- at least one external adopter confirms successful installation without maintainer intervention
- artifact verification passes on two consecutive release candidates
- maintainer agrees to own the support posture defined in `docs/project/support-policy.md`
