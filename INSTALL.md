# Deterministic Installation

This is the canonical install and handoff guide for `@havesomecode/kibana-mcp-server`.

The supported newcomer path is a prompt-free, connection-only bootstrap. Bootstrap never lists, scans, infers, or configures Kibana indexes. Agents must use the CLI contract below instead of editing Codex or MCP configuration files.

## Prerequisites

- Node.js 22 or newer
- `codex` on `PATH` when `--client codex` is used
- a Kibana base URL reachable with basic authentication
- credentials supplied through a trusted environment or stdin

Provision these machine values before installation:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`

No index is required or accepted during bootstrap.

## Install The Agent Skill

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex \
  --global \
  --yes
```

The skill is stored at `skills/kibana-log-investigation/SKILL.md`. After the repository is indexed, its skills.sh route is:

- `https://skills.sh/havesomecode/kibana-mcp-server/kibana-log-investigation`

## Prompt-Free Connection Bootstrap

With connection values provisioned:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --client codex
```

Optional profile selection:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --profile prod \
  --client codex
```

Bootstrap is non-interactive and idempotent for profiles it generated. It:

1. validates the connection inputs;
2. checks for a missing or conflicting Codex registration;
3. verifies only the Kibana connection through `/api/status`;
4. acquires an interprocess state lock;
5. writes an empty managed source catalog on first install;
6. preserves sources that were explicitly configured after a prior bootstrap;
7. saves credentials in the platform credential store;
8. saves profile and catalog files atomically;
9. calls `codex mcp add` with the exact running package version and a transport-hashed registration name;
10. reads the registered transport back exactly;
11. restores prior machine state if registration fails.

A non-zero exit means installation did not complete. A successful exit verifies the connection, not any index.

## Explicit Index Selection

Start a fresh agent session after bootstrap and call `discover`. An empty catalog responds with instructions to ask the user which exact Kibana index or index pattern they want to use.

The safe sequence is:

1. call `discover`;
2. ask the user for the exact index or pattern;
3. wait for their answer—never guess, enumerate, scan, or auto-select;
4. call `configure_index` with exactly the user-provided `index` value;
5. let that tool inspect fields and run one bounded validation search only for that index;
6. call `discover` again and use the returned source id.

`configure_index` accepts no Kibana credentials. A validation failure leaves the existing catalog unchanged.

## Secret Input

Never put a password in a command-line argument. Supported sources, in precedence order:

1. `--password-stdin`
2. `--password-env NAME`
3. `KIBANA_PASSWORD`

```bash
printf '%s\n' "$SECRET_VALUE" | npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-stdin \
  --client codex
```

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-env KIBANA_PROD_PASSWORD \
  --client codex
```

Secrets are stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service when available. They are not written to profiles, generated catalogs, or MCP client configuration.

## Profiles

The first bootstrap creates the default profile. Use `--profile NAME` for additional environments and `--no-default` when the new profile must not replace the current default.

The registered stdio command selects the profile explicitly: `npx -y @havesomecode/kibana-mcp-server@<bootstrap-version> serve --profile prod`. Registration names use `kibana-log-investigation-<transport-hash>`. Inspect them with `codex mcp list --json`.

## Client Registration Modes

Use `--client codex` for a full install. Use `--client none` when registration is already managed, such as the repo-local plugin path or CI:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap --client none
```

## Explicit Overrides

| Purpose | Option | Environment fallback |
|---|---|---|
| Profile | `--profile NAME` | `KIBANA_PROFILE`, then `default` |
| Kibana base URL | `--url URL` | `KIBANA_BASE_URL` |
| Username | `--username USER` | `KIBANA_USERNAME` |
| Password | `--password-stdin` / `--password-env NAME` | `KIBANA_PASSWORD` |
| Client | `--client codex|none` | `codex` |
| Replace catalog | `--replace` | preserve managed sources; refuse protected catalogs |

If a profile points to a hand-authored or operator-modified catalog, bootstrap fails without changing it. Generated catalogs carry a tool marker and content hash. `--replace` intentionally converts the target to an empty managed catalog; use it only with explicit operator authorization.

## Example Catalog Policy

`config/sources.example.json` is documentation data. It never participates in bootstrap precedence. Guided `setup` remains available for operators who explicitly want a hand-authored catalog:

```bash
npx -y @havesomecode/kibana-mcp-server setup
```

## Repository Contributor Path

```bash
npm install
npm run build
node dist/src/index.js bootstrap --client none
```

The repo-scoped Codex plugin already supplies the MCP entry, so `--client none` avoids a duplicate global registration.

## Verification

Bootstrap success verifies:

- Kibana returned a valid status envelope through `/api/status`
- no index endpoint called
- empty managed catalog created on first install
- profile and credential saved
- requested client registration read back

After a new agent session starts, confirm `discover` reports the empty state. Configure and validate an index only after the user explicitly names it.
