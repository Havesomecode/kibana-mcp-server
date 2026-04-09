---
title: npm Publishing Setup
status: active
updated: 2026-04-09
---

# npm Publishing Setup

This repo is prepared for npm trusted publishing from GitHub Actions, but npm-side setup is still required before the first successful publish.

## Package Identity

The intended published package is `@havesomecode/kibana-mcp-server`.

Before enabling trusted publishing, confirm both of these are true:

- the npm scope `@havesomecode` is owned by the maintainer account that will publish this package
- the package `@havesomecode/kibana-mcp-server` is either unclaimed or already owned by that scope

Do not configure trusted publishing against a package or scope you do not control.

## Repo-Side Publish Workflow

The authoritative workflow file is `.github/workflows/release.yml`.

It is responsible for:

- running `npm run verify` on `master` pushes before any publish attempt
- running `semantic-release` on normal `master` pushes
- publishing to npm automatically when merged history contains a releasable semantic change
- creating Git tags and GitHub Releases from the same release event
- using GitHub OIDC instead of npm automation tokens

## npm-Side Setup

After package ownership is resolved:

1. Open the package settings on npmjs.com.
2. Add a trusted publisher.
3. Choose GitHub Actions.
4. Set:
   - Organization or user: `Zacaria`
   - Repository: `kibana-mcp-server`
   - Workflow filename: `release.yml`
   - Environment name: leave blank unless GitHub environments are added later
5. Save the trusted publisher.
6. Merge a PR into `master` with a semantic title such as `feat: ...` or `fix: ...`.
7. After the first successful publish, disable token-based publishing in npm package settings.

## Publish Expectations

- The workflow requires GitHub-hosted runners.
- The workflow requires `id-token: write`.
- The package must remain public for provenance to be generated automatically.
- The package `repository` field must match this public GitHub repository exactly.
- The npm package name in `package.json` must stay aligned with the package configured in npm trusted publishers.
- Squash merge should be enabled so the semantic PR title becomes the final commit title on `master`.
