---
title: Release Checklist
status: active
updated: 2026-04-09
---

# Release Checklist

## Preconditions

- CI is green on `master`.
- `npm run verify` passes locally.
- The compatibility matrix is up to date (`docs/project/compatibility-matrix.md`).
- Any new env or config requirements are documented in `README.md` and `INSTALL.md`.
- The npm scope and package name (`@havesomecode/kibana-mcp-server`) are owned by the maintainers.
- Maintainers understand that released versions are tracked in npm, tags, and GitHub Releases, not by the `package.json` version committed in git.

## Release Authorization

- Releases are created via the `Release` GitHub Actions workflow.
- Trusted publishing for npm must point at workflow file `release.yml`.
- Tags and GitHub Releases are created by `semantic-release` after a verified push to `master`.
- PRs that should affect semver must use a Conventional Commit title because squash merge will carry that title onto `master`.
- Only maintainers listed in `CODEOWNERS` should have permission to trigger releases.

## Security Posture for CI/Release

- Workflow permissions must be minimal (`contents: read` for CI, `contents: write` + `id-token: write` for publish).
- Publishing to npm must use OIDC trusted publishing.
- Do not store long-lived npm tokens in repo secrets.
- After trusted publishing is verified, disallow token-based publishing in npm package settings.

## Threat Model (Top 3)

1. **Compromised GitHub Actions workflow**: mitigate with minimal permissions, required reviews, and avoiding untrusted actions.
2. **Malicious dependency update**: mitigate with dependency review workflow and human review of automated PRs.
3. **Accidental secrets leakage in artifacts**: mitigate with `verify-packlist` and explicit exclusion of local config files.

## Steps

1. Open a PR with a semantic title such as `feat: ...`, `fix: ...`, or `feat!: ...`.
2. Run `npm run verify`.
3. Confirm the npm package identity is publishable by this maintainer account.
4. Configure npm trusted publishing for `release.yml`.
5. Merge with squash merge into `master`.
6. Confirm the `Release` workflow either exits with no release or publishes a new version.
7. Validate the Git tag, GitHub Release notes, published package contents, and provenance.

## Post-Release

- Confirm install instructions still match the shipped artifact.
- Update any compatibility claims that changed in the release.
- If docs mention a specific current version, verify it against npm or GitHub Releases rather than reading `package.json` in git.
