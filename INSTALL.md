# Install the Kibana MCP

Use Node.js 22+, a reachable Kibana base URL, and basic-auth credentials. Codex registration also needs `codex` on `PATH`.

For a selected release or agent handoff, [resolve its commit first](#version-matched-readme-handoff). Agents must use bootstrap, not edit MCP client configuration files.

## Install in Codex

1. Run connection bootstrap. It prompts for missing values; never put a password in an argument.

   ```bash
   npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
   ```

   For automation, provision `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` first. With all three supplied, no prompts appear.

2. Clear those variables from the MCP server environment so it uses the saved profile.

   Bash:

   ```bash
   unset KIBANA_BASE_URL KIBANA_USERNAME KIBANA_PASSWORD
   ```

   PowerShell:

   ```powershell
   Remove-Item Env:KIBANA_BASE_URL, Env:KIBANA_USERNAME, Env:KIBANA_PASSWORD -ErrorAction SilentlyContinue
   ```

3. Install the investigation skill.

   ```bash
   npx skills add Havesomecode/kibana-mcp-server \
     --skill kibana-log-investigation \
     --agent codex --global --yes
   ```

4. Open a fresh agent session and call `discover`. A first install has no sources.
5. Ask the user for the exact index or pattern. Wait for their answer, call `configure_index` with that exact `index`, then call `discover` again.

Never guess, enumerate, scan, or auto-select an index. `configure_index` accepts no credentials; it inspects fields and runs one bounded validation search for the selected index only. Failed validation leaves the catalog unchanged.

**Success:** bootstrap verifies `/api/status`, saves the connection, and reads back the requested registration. It never inspects indexes. A non-zero exit means installation is incomplete; index access is verified only by `configure_index`.

## Choose a profile or registration mode

| Need | Option |
| --- | --- |
| Additional environment | `--profile prod` |
| Keep the current default | `--no-default` |
| Plugin or externally managed registration | `--client none` |
| Import a hand-authored catalog | bare `setup` |

The first bootstrap creates the default profile. With connection options, `setup` uses the same connection-only bootstrap flow. `config/sources.example.json` is documentation data, never an automatic bootstrap input.

Codex registers `npx -y @havesomecode/kibana-mcp-server@<bootstrap-version> serve --profile prod` under `kibana-log-investigation-<transport-hash>`. Inspect it with `codex mcp list --json`.

## Supply secrets or overrides

Password precedence: `--password-stdin`, then `--password-env NAME`, then `KIBANA_PASSWORD`.

```bash
printf '%s\n' "$SECRET_VALUE" | npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-stdin --client codex
```

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-env KIBANA_PROD_PASSWORD --client codex
```

| Value | Flag | Fallback |
| --- | --- | --- |
| Profile | `--profile NAME` | `KIBANA_PROFILE`, then `default` |
| Base URL | `--url URL` | `KIBANA_BASE_URL` |
| Username | `--username USER` | `KIBANA_USERNAME` |
| Client | `--client codex` or `--client none` | `codex` |

Credentials go to macOS Keychain, Windows Credential Manager, or Linux Secret Service when available, never profile, catalog, or client configuration files.

Bootstrap uses a state lock and atomic writes. It preserves previously configured managed sources, rejects conflicting registrations, and restores prior state if registration fails.

**Before using `--replace`:** get explicit operator authorization. It replaces the target with an empty managed catalog. Without it, bootstrap refuses hand-authored or modified catalogs; managed catalogs carry a marker and content hash.

## Start without a saved profile

Supply the connection and an explicit `KIBANA_SOURCE_CATALOG_PATH`, or a configuration-file catalog store. Direct environment values override profiles. Startup requires a connection; it never searches the checkout for a catalog or accepts credentials through MCP tools.

## Install the repo-local Codex plugin

1. Build from the repository root.

   ```bash
   npm install
   npm run build
   ```

2. Install the built plugin from the repo-local Codex marketplace. The bundle lives in `plugins/kibana-log-investigation/dist/`; `cwd: "."` means the installed plugin directory. It needs Node.js 22+ on `PATH`, not the original checkout or its `node_modules`.
3. Save the connection without duplicate registration.

   ```bash
   node dist/src/bin/kibana-mcp-server.js bootstrap --client none
   ```

4. Clear connection variables, reconnect, and follow the `discover` → user-selected `configure_index` flow above.

## Fix startup failures

1. Inspect Codex MCP startup status and sanitized stderr. Saved configuration does not prove startup.
2. For a missing runtime, rebuild and reinstall the plugin. For Node or module-loading errors, follow stderr repair instructions; stdout is reserved for MCP.
3. After startup succeeds, open one fresh discussion and call `discover`. If absent, check plugin enablement and startup logs instead of repeatedly restarting.

`npm run verify:entrypoint` packs and installs the npm artifact, then tests a copied plugin with `initialize`, `tools/list`, and `discover`. Its connection and empty catalog are synthetic: this proves packaged startup, not native Codex or real backend access.

Before sharing logs, remove credentials, authorization headers, credential-bearing URLs, and operational data. Never share complete environment dumps.

## Version-matched README handoff

1. Resolve the full **commit SHA** before installing or handing off. This is the **resolved installation commit**.

   | Source | Resolve with |
   | --- | --- |
   | Checkout branch/tag | `git rev-parse <ref>^{commit}` |
   | Detached checkout | `git rev-parse HEAD` |
   | Exact npm version | `npm view @havesomecode/kibana-mcp-server@<exact-version> gitHead` |

   Do not infer a Git tag from an npm version. Pin installation to the same exact package version. Missing metadata or refs are errors, not permission to substitute master.

2. Read `README.md`, `INSTALL.md`, and skills from that same commit.

   ```text
   https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
   ```

3. In a maintained checkout, verify the URL with the repository-only helper.

   ```bash
   node scripts/readme-handoff.mjs refs/heads/master
   ```

   Pass the actual `refs/heads/<branch>`, `refs/tags/<tag>`, or full SHA selected for installation. Fetch missing refs explicitly; resolve moved branches again.

4. Pass the verified `url` and `commit` to the receiving agent.

The helper makes a bounded fetch and compares README bytes against Git. It returns JSON `{ ref, commit, url }` only on success; no configuration changes or Git fetches.

Unknown or ambiguous refs, missing READMEs, HTTP errors, and mismatches fail without a handoff. Historical installs without the helper need explicit resolution and retrieval verification. It is not an npm command.
