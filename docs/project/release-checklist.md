---
title: Release Checklist
status: active
updated: 2026-04-09
---

# Release Checklist

## Before merging

1. Require green CI on `master` and local `npm run verify`.
2. Check build freshness: `npm run build` replaces root `dist/`. Every packed `dist/src/**/*.js` or `dist/src/**/*.d.ts` needs its corresponding `src/**/*.ts`; `npm run verify:packlist` rejects orphaned output.
3. Update `docs/project/compatibility-matrix.md`, and document new env/config requirements in `README.md` and `INSTALL.md`.
4. Check the install contract and hosted homepage: connection-only bootstrap is default; guided setup supports explicitly selected hand-authored catalogs. Startup needs a connection and explicit catalog path/store; saved profiles use their stored path. Never advertise credential-taking MCP setup or implicit checkout catalogs.
5. Confirm maintainers own the npm scope and `@havesomecode/kibana-mcp-server`, and the maintainer account can publish it.

## Authorize publishing

1. Restrict release triggers to maintainers in `CODEOWNERS`. Use the `Release` GitHub Actions workflow and point npm trusted publishing at `release.yml`.
2. Use minimal permissions: `contents: read` for CI; `contents: write` + `id-token: write` for publishing.
3. Use OIDC trusted publishing. Never store long-lived npm tokens in repo secrets; disallow token-based publishing in npm settings after verifying OIDC.

## Threat Model (Top 3)

| Threat | Required mitigation |
| --- | --- |
| Compromised GitHub Actions workflow | Minimal permissions, required reviews, no untrusted actions |
| Malicious dependency update | Dependency review workflow and human review of automated PRs |
| Secrets leaked in artifacts | `verify-packlist` and explicit exclusion of local config files |

## Steps

1. Open a PR with a Conventional Commit title such as `feat: ...`, `fix: ...`, or `feat!: ...`; squash merge carries it onto `master` for semver.
2. Complete the checks and authorization above, then squash merge into `master`.
3. Confirm `Release` either exits without a release or publishes. After a verified push to `master`, `semantic-release` creates the tags and GitHub Releases.
4. Validate the Git tag, GitHub Release notes, package contents, and provenance.
5. Confirm `Pages` deploys the homepage and its install copy remains truthful.

## Post-Release

1. Match install instructions and the homepage to the shipped artifact and support posture.
2. Update changed compatibility claims.
3. Read released versions from npm, tags, or GitHub Releases—not committed `package.json`. Verify any current-version claim against npm or GitHub Releases.
