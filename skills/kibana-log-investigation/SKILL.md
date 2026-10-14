---
name: kibana-log-investigation
description: Bootstrap and use the Kibana log investigation MCP safely.
---

# Kibana Log Investigation

Call `discover` before investigating. For installation, follow the steps below.

## Install the connection

1. Verify Node.js 22+ and [resolve the installation version](#pin-the-installation-version).
2. Obtain `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` from trusted inputs. If unavailable, report what is missing. Never put passwords in arguments, logs, summaries, or client files. Alternatives: `--url URL`, `--username USER`, `--password-env NAME`, or `--password-stdin`.
3. Choose the registration mode. Never edit client configuration yourself.

   | Agent | Registration owner | Mode |
   | --- | --- | --- |
   | Codex | bootstrap | `--client codex` |
   | Claude Code | plugin | `--client none` |
   | Other agent | operator | `--client none` |

4. Run bootstrap with the chosen mode; supplied connection values make it prompt-free.

   ```bash
   npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
   ```

   **Expected:** verified Kibana status, OS-stored credentials, and an empty catalog on first install. No index inspection; reruns preserve managed sources.

   Codex registration is version-pinned, transport-hashed, and read back exactly. Failed registration restores prior profile state. `--client none` leaves client files untouched.

   **Do not bypass failures:** never overwrite a conflict, add `--replace` to empty a catalog, or import the bundled example automatically.

5. Remove connection variables from the server environment and reconnect. Saved profiles provide their catalog; direct environment startup overrides profiles and needs `KIBANA_SOURCE_CATALOG_PATH` or a configuration-file store. No implicit checkout catalog or credential-taking MCP tool exists.

If non-Codex tools are absent, ask the operator to register the server:

- Claude Code: `/plugin marketplace add Havesomecode/kibana-mcp-server`, then `/plugin install kibana-log-investigation@kibana-mcp-server`.
- Other agents: stdio command `npx -y @havesomecode/kibana-mcp-server serve`.

For `No saved Kibana connection is available. Run connection bootstrap first.`, bootstrap and reconnect; do not send credentials through MCP.

## Configure the selected index

1. Call `discover`. If empty, ask for the exact index or pattern.
2. Wait for the answer. Never guess, enumerate, scan, or auto-select.
3. Call `configure_index` once with that exact `index`. It accepts no credentials and runs field inspection plus one bounded validation search for that index only.
4. Report `source_id` and time field. On failure, preserve the catalog and report the error; bootstrap success alone does not prove index access.
5. Call `discover` again before investigating.

## Investigate

1. Use the source id returned by `discover`.
2. Call `describe_fields` before unfamiliar filters or aggregations.
3. Use a bounded time range and small result limit.
4. Keep queries read-only and cite returned evidence, not unseen logs.

## Choose a profile

Use `--profile NAME`; fallback is `KIBANA_PROFILE`, then `default`. Start an existing profile with:

```bash
npx -y @havesomecode/kibana-mcp-server serve --profile prod
```

Bare `setup` is for operator-requested hand-authored catalog import, not automatic installation.

## Pin the installation version

1. Resolve the full **commit SHA**: checkout branch/tag or detached `HEAD`; for npm, the exact package's `gitHead`. This is the **resolved installation commit**. Do not infer a Git tag from an npm version. Pin the package to that exact version.
2. Read README, INSTALL, and skills from that commit.

   ```text
   https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
   ```

3. In a maintained clone, run `node scripts/readme-handoff.mjs <resolved-installation-ref>`. Hand off its verified `url` and `commit`.

The helper checks retrieved README bytes against Git. It is repository-only, not an npm command. If absent in a historical install, resolve and verify retrieval explicitly. Missing refs, metadata, README, or failed retrieval are errors: never invent success or substitute master.
