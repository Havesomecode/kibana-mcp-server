---
title: npm Publishing Setup
status: active
updated: 2026-04-09
---

# npm Publishing Setup

This repo publishes to npm from GitHub Actions using trusted publishing.

## Package Identity

The published package is `@havesomecode/kibana-mcp-server`.

The release workflow assumes both of these remain true:

- the maintainer account controls the npm scope `@havesomecode` and the published package
- npm trusted publishing points to this repository's `release.yml` workflow

If the owner or workflow changes, update the trusted publisher before the next release.

## Repo-Side Publish Workflow

The authoritative workflow file is `.github/workflows/release.yml`.

It is responsible for:

- running `npm run verify` on `master` pushes before any publish attempt
- running `semantic-release` on normal `master` pushes
- publishing to npm automatically when merged history contains a releasable semantic change
- creating Git tags and GitHub Releases from the same release event
- using GitHub OIDC instead of npm automation tokens

## npm-Side Setup

For future maintenance:

1. Open the package settings on npmjs.com.
2. Add a trusted publisher.
3. Choose GitHub Actions.
4. Set:
   - Organization or user: `Havesomecode`
   - Repository: `kibana-mcp-server`
   - Workflow filename: `release.yml`
   - Environment name: leave blank unless GitHub environments are added later
5. Save the trusted publisher.
6. Merge a PR into `master` with a semantic title such as `feat: ...` or `fix: ...`.
7. Keep token-based publishing disabled in npm package settings after trusted publishing is verified.

## Publish Expectations

- The workflow requires GitHub-hosted runners.
- The workflow requires `id-token: write`.
- The package must remain public for provenance to be generated automatically.
- The package `repository` field must match this public GitHub repository exactly.
- The npm package name in `package.json` must stay aligned with the package configured in npm trusted publishers.
- Squash merge should be enabled so the semantic PR title becomes the final commit title on `master`.
- The published version is determined by `semantic-release` and recorded in npm, tags, and GitHub Releases; the `package.json` version committed in git is not the canonical released version.
