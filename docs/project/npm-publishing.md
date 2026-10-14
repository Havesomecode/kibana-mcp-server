---
title: npm Publishing Setup
status: active
updated: 2026-04-09
---

# npm Publishing Setup

## Package Identity

The published package is `@havesomecode/kibana-mcp-server`.

Confirm maintainer control of `@havesomecode` and `@havesomecode/kibana-mcp-server`. Point npm trusted publishing to this repository's `release.yml`; update it before releasing if ownership or the workflow changes.

## Repo-Side Publish Workflow

Use `.github/workflows/release.yml`. On normal `master` pushes it runs `npm run verify` before `semantic-release`. Releasable history produces an npm version, Git tag, and GitHub Release from one event, using GitHub OIDC—not npm automation tokens.

## npm-Side Setup

1. Open package settings on npmjs.com; add a **GitHub Actions** trusted publisher.
2. Set:
   - Organization or user: `Havesomecode`
   - Repository: `kibana-mcp-server`
   - Workflow filename: `release.yml`
   - Environment name: leave blank unless GitHub environments are added later
3. Save the publisher.
4. Merge a PR into `master` with a semantic title such as `feat: ...` or `fix: ...`.
5. After verifying trusted publishing, keep token-based publishing disabled in npm settings.

## Publish Expectations

1. Use GitHub-hosted runners with `id-token: write`.
2. Keep the package public for automatic provenance. Match its `repository` field exactly to this public GitHub repository.
3. Match the `package.json` name to the npm trusted publisher's package.
4. Enable squash merge so semantic PR titles become commit titles on `master`.
5. Read `semantic-release` versions from npm, tags, or GitHub Releases; the committed `package.json` version is not canonical.
