# Deterministic Installation

This is the canonical install and handoff guide for `@havesomecode/kibana-mcp-server`.

The supported newcomer path is connection-only bootstrap. It prompts for missing connection values and is prompt-free when all values are supplied. Bootstrap never lists, scans, infers, or configures Kibana indexes. Agents must use the CLI contract below instead of editing Codex or MCP configuration files.

## Version-Matched README Handoff

Before installation or agent handoff, resolve the selected branch, tag, or package metadata to the full commit SHA. This is the **resolved installation commit**. Read `README.md`, `INSTALL.md`, and installation skills from that immutable commit; older commits may have different installation contracts.

The version-matched README URL is always commit-pinned:

```text
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
```

A branch or tag is an input to commit resolution, never the final handoff URL. Do not infer a Git tag from an npm version. For npm installations, resolve the requested package to the exact version being installed, obtain its `gitHead` with `npm view @havesomecode/kibana-mcp-server@<exact-version> gitHead`, and pin the installation to that same package version. If that metadata is absent or the commit cannot be resolved, report the missing installation ref rather than claiming master matches the package. For a cloned checkout, resolve the selected branch/tag with `git rev-parse <ref>^{commit}`; for a detached checkout, use `git rev-parse HEAD`'s full commit SHA.

From a maintained checkout containing the repository-only helper, verify a handoff with:

```bash
node scripts/readme-handoff.mjs refs/heads/master
# Or pass the actual refs/tags/<tag> or full commit SHA selected for installation.
```

The helper does not install anything or change configuration. It resolves locally available Git refs, fetches the immutable commit URL with a timeout, compares it byte-for-byte to the resolved commit's README, and outputs JSON with `ref`, `commit`, and `url` only after verification. Fetch a missing ref explicitly before retrying; the helper does not fetch Git refs or assume a tag. Ambiguous branch/tag names require the qualified `refs/heads/` or `refs/tags/` form. Unknown refs, missing READMEs, HTTP failures, and content mismatches exit nonzero without a handoff. Resolve a moved branch again to create a new commit-pinned handoff; do not silently substitute master. This helper is not a published npm command or a requirement that historical tags contain it.

Pass the verified URL and resolved commit to the receiving agent. A master preview link is not evidence that master matches a tagged or npm installation.

## Prerequisites

- Node.js 22 or newer
- `codex` on `PATH` when `--client codex` is used
- a Kibana base URL reachable with basic authentication
- credentials supplied through a trusted environment, stdin, or a secret prompt

For prompt-free automation, provision these values before installation:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`

Without these values, bootstrap prompts for the missing connection inputs. No index is required or accepted during bootstrap.

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

With all connection values supplied, bootstrap is non-interactive. It is idempotent for profiles it generated and:

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

After bootstrap, remove `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` from the MCP server environment before reconnecting so startup uses the saved profile. In Bash, run `unset KIBANA_BASE_URL KIBANA_USERNAME KIBANA_PASSWORD`; in PowerShell, run `Remove-Item Env:KIBANA_BASE_URL, Env:KIBANA_USERNAME, Env:KIBANA_PASSWORD -ErrorAction SilentlyContinue`. Leaving direct connection values set overrides profile selection and requires an explicit catalog path or store.

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

The MCP server starts only with a configured connection. Bootstrap saves one for subsequent starts. Operators who supply the connection directly through environment variables must also set `KIBANA_SOURCE_CATALOG_PATH`, or declare a catalog store in a configuration file. No catalog is loaded implicitly from the checkout, and no MCP tool accepts connection credentials.

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

`config/sources.example.json` is documentation data. It never participates in bootstrap precedence. `bootstrap` is always connection-only, including without flags. Bare `setup` guides operators who explicitly want a hand-authored catalog; with connection options, `setup` uses the same connection-only bootstrap flow:

```bash
npx -y @havesomecode/kibana-mcp-server setup
```

## Repository Contributor Path

```bash
npm install
npm run build
node dist/src/bin/kibana-mcp-server.js bootstrap --client none
```

The repo-scoped Codex plugin already supplies the MCP entry, so `--client none` avoids a duplicate global registration.

`npm run build` also bundles the MCP server and its runtime dependencies into `plugins/kibana-log-investigation/dist/`. Install the plugin only after that build. The plugin declares `cwd: "."`, which Codex resolves against its installed plugin directory, and its launcher resolves the bundle relative to itself. The installed plugin does not depend on the original checkout, its root `dist/`, or its `node_modules`. Node.js 22+ must still be available on `PATH`.

Run `npm run verify:entrypoint` to pack and install the actual npm artifact, copy only its plugin into an isolated cache directory, and perform a bounded `initialize`, `tools/list`, and `discover` handshake. This uses an explicitly synthetic connection and empty managed catalog; it does not validate a real Kibana backend or a native Codex discussion.

### Diagnose plugin startup before restarting discussions

1. **Saved configuration:** a plugin entry or successful bootstrap is not proof the process started.
2. **Process startup:** inspect Codex's MCP startup status and sanitized stderr. A missing plugin runtime requires rebuilding the checkout and reinstalling the built plugin, not another discussion. Node/version and module-loading failures print repair instructions on stderr, never MCP stdout.
3. **Current discussion:** after startup succeeds, open one fresh Codex discussion and call the native `discover` tool. If it is absent, inspect plugin enablement and startup logs; do not repeat restarts indefinitely.
4. **Backend access:** an empty `discover` response proves local tools work, not backend reachability. Bootstrap verifies `/api/status`; only an explicitly selected `configure_index` validation establishes access to that index.

Before sharing startup logs, remove credentials, authorization headers, credential-bearing URLs, and any operational data. Never paste passwords or complete environment dumps into an issue.

## Verification

Bootstrap success verifies:

- Kibana returned a valid status envelope through `/api/status`
- no index endpoint called
- empty managed catalog created on first install
- profile and credential saved
- requested client registration read back

After a new agent session starts, confirm `discover` reports the empty state. Configure and validate an index only after the user explicitly names it.
