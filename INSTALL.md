# Deterministic Installation

This is the canonical install and handoff guide for `@havesomecode/kibana-mcp-server`.

The supported newcomer path is a prompt-free bootstrap from an Elasticsearch index pattern. Agents must use the CLI contract below instead of editing Codex or MCP configuration files.

## Prerequisites

- Node.js 22 or newer
- `codex` on `PATH` when `--client codex` is used
- a Kibana base URL reachable with basic authentication
- an Elasticsearch index pattern
- credentials supplied through a trusted environment or stdin

An index pattern cannot reveal a Kibana URL or credentials. To make the index the only newcomer-specific input, provision these machine values before installation:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`

## Install The Agent Skill

The repository exposes a standard Agent Skill compatible with the open skills ecosystem:

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex \
  --global \
  --yes
```

The CLI discovers it at `skills/kibana-log-investigation/SKILL.md`. After the repository is indexed, its skills.sh route is:

- `https://skills.sh/havesomecode/kibana-mcp-server/kibana-log-investigation`

## Prompt-Free Bootstrap

With connection values provisioned, the complete install command is:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --client codex
```

Quote index patterns containing `*`.

Optional profile selection:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --profile prod \
  --index 'app-logs-*' \
  --client codex
```

The bootstrap is non-interactive and idempotent for profiles it generated. It:

1. validates all inputs;
2. checks for a missing or conflicting Codex registration;
3. connects to Kibana and discovers index fields;
4. runs a bounded search preflight;
5. selects a time field and useful text fields deterministically;
6. acquires an interprocess state lock and generates a machine-local source catalog;
7. saves credentials in the platform credential store;
8. saves profile and catalog files atomically;
9. calls `codex mcp add` with the exact running package version and a transport-hashed registration name rather than editing TOML;
10. reads the registered transport back exactly;
11. restores prior machine state if registration fails.

A non-zero exit means installation did not complete. Do not claim success or proceed with a partially configured client.

## Secret Input

Never put a password in a command-line argument.

The supported sources, in explicit-precedence order, are:

1. `--password-stdin`
2. `--password-env NAME`
3. `KIBANA_PASSWORD`

Examples:

```bash
printf '%s\n' "$SECRET_VALUE" | npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --password-stdin \
  --client codex
```

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --password-env KIBANA_PROD_PASSWORD \
  --client codex
```

Secrets are stored in:

- macOS Keychain
- Windows Credential Manager
- Linux Secret Service when available

They are not written to profiles, generated source catalogs, or MCP client configuration.

## Profiles

The first bootstrap creates the default profile. Use `--profile NAME` for additional environments and `--no-default` when the new profile must not replace the current default.

The registered, version-pinned stdio command selects the profile explicitly: `npx -y @havesomecode/kibana-mcp-server@<bootstrap-version> serve --profile prod`. The placeholder represents the exact version that performed bootstrap. Registration names use `kibana-log-investigation-<transport-hash>`, preventing different profiles or package versions from overwriting one another. Inspect them with `codex mcp list --json`.

This avoids OS-specific MCP environment-variable configuration.

## Client Registration Modes

Use `--client codex` for a full install. The bootstrap refuses to overwrite a conflicting MCP registration.

Use `--client none` when client registration is already managed, such as the repo-local plugin path or CI verification:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --client none
```

## Explicit Overrides

| Purpose | Option | Environment fallback |
|---|---|---|
| Profile | `--profile NAME` | `KIBANA_PROFILE`, then `default` |
| Kibana base URL | `--url URL` | `KIBANA_BASE_URL` |
| Username | `--username USER` | `KIBANA_USERNAME` |
| Password | `--password-stdin` / `--password-env NAME` | `KIBANA_PASSWORD` |
| Index patterns | repeatable `--index PATTERN` | none |
| Time field | `--time-field FIELD` | automatic discovery |
| Source id | `--source-id ID` | generated from the first index |
| Client | `--client codex|none` | `codex` |
| Replace catalog | `--replace` | refuse replacement by default |

If a profile points to a hand-authored, multi-source, or operator-modified catalog, bootstrap fails without changing it. Generated catalogs carry a tool marker plus a content hash, so manual edits invalidate automatic overwrite permission. Use `--replace` only when intentionally converting that profile to the generated single-source format. Untouched generated catalogs can be bootstrapped repeatedly without the flag.

## Example Catalog Policy

`config/sources.example.json` is packaged as documentation data. It never participates in prompt-free bootstrap precedence.

Guided `setup` remains available for operators with hand-authored catalogs:

```bash
npx -y @havesomecode/kibana-mcp-server setup
```

Guided setup requires an explicit catalog path. Type `example` to opt into the bundled example deliberately; pressing Enter cannot install it silently.

## Repository Contributor Path

For development from a clone:

```bash
npm install
npm run build
node dist/src/index.js bootstrap --index 'app-logs-*' --client none
```

The repo-scoped Codex plugin remains under `plugins/kibana-log-investigation`. Because that plugin already supplies the MCP entry, use `--client none` to avoid a duplicate global registration.

## Verification

Bootstrap success already means all automated checks passed:

- Kibana credentials accepted
- schema fields discovered
- bounded search accepted
- profile and catalog saved
- credential stored
- requested client registration read back

After a new Codex session starts, confirm the MCP can run source discovery and one bounded query. Never bypass a failed bootstrap by manually pasting a guessed config entry.
