---
description: "Set up a checkout, run the checks and build the documentation site."
---

# Development

```bash
git clone https://github.com/Havesomecode/kibana-mcp-server
cd kibana-mcp-server
npm install
```

## Checks

```bash
npm run lint
npm run format:check
npm run check:types
npm test
npm run verify
```

`npm run verify` runs everything CI runs: type check, lint, format check, tests, build, and the release and package contracts.

## Documentation site

```bash
npm run docs:dev
npm run docs:build
```

The site lives in `website/` and is published to GitHub Pages from `master`.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); releases are cut by semantic-release.
- New dependencies must be at least 20 days old, the same cooldown Dependabot applies.
- See `CONTRIBUTING.md` and `SECURITY.md` in the repository for contribution and disclosure rules.
