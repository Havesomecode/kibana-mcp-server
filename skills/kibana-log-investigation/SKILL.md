---
name: kibana-log-investigation
description: Bootstrap and use the Kibana log investigation MCP safely.
---

# Kibana Log Investigation

Use this skill when an operator wants to install, configure, or use the read-only Kibana MCP server from `@havesomecode/kibana-mcp-server`.

## Deterministic installation

Do not edit Codex or MCP configuration files by hand. Do not run guided `setup` when the operator supplied an Elasticsearch index pattern.

1. Verify Node.js 22 or newer is available.
2. Obtain the Elasticsearch index pattern from the task.
3. Resolve connection values from `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` unless the operator supplied safe alternatives.
4. Run the prompt-free bootstrap, quoting the index pattern so the shell cannot expand wildcards:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --client codex
```

The bootstrap must complete all of these steps itself:

- validate the Kibana base URL and index pattern
- connect to Kibana and discover fields
- choose a usable time field and text fields deterministically
- run a bounded search preflight
- generate and atomically save a machine-local source catalog
- save credentials in the operating-system credential store
- register the exact, version-pinned stdio command under a transport-hashed Codex name
- read the Codex registration back and reject conflicting entries
- restore prior profile state if registration fails

A successful command is the verification result. Do not claim installation succeeded if it exits non-zero.

## Supplying secrets safely

Never put a password directly in a command argument. Prefer a pre-provisioned `KIBANA_PASSWORD` environment variable. When a secret is available on stdin, use:

```bash
printf '%s\n' "$SECRET_VALUE" | npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --password-stdin \
  --client codex
```

If the password is stored under another environment variable, reference its name without exposing its value:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --index 'app-logs-*' \
  --password-env KIBANA_PROD_PASSWORD \
  --client codex
```

## Profiles and overrides

Connection values may be supplied through flags or environment variables:

| Value | Flag | Environment fallback |
|---|---|---|
| Profile | `--profile prod` | `KIBANA_PROFILE`, then `default` |
| Base URL | `--url https://kibana.example.com` | `KIBANA_BASE_URL` |
| Username | `--username elastic` | `KIBANA_USERNAME` |
| Password | `--password-stdin` or `--password-env NAME` | `KIBANA_PASSWORD` |
| Index | repeatable `--index 'pattern-*'` | none; always explicit |

Use `--time-field FIELD` only when automatic discovery reports that no date field can be selected. Use `--client none` for CI or for a machine where Codex registration is intentionally managed elsewhere.

To select an existing non-default profile without environment-variable editing, register or run:

```bash
npx -y @havesomecode/kibana-mcp-server serve --profile prod
```

## Failure rules

- Never silently import the bundled example catalog. It is documentation data, not a production default.
- Never add `--replace` merely to make a failed install pass. Use it only when the operator explicitly authorizes replacement of an existing hand-authored or multi-source catalog.
- Never overwrite a conflicting MCP client registration. Report the conflict and let the operator remove or rename it explicitly.
- Never bypass failed Kibana verification.
- Never expose a password in logs, summaries, shell history, generated catalogs, or MCP client configuration.
- If URL, username, password, or index is unavailable, report the exact missing prerequisite rather than inventing it.

## Using the MCP

After bootstrap succeeds:

1. Call source discovery.
2. Use field description before constructing unfamiliar filters or aggregations.
3. Start with a bounded time range and a small result limit.
4. Keep investigations read-only and cite returned evidence rather than inferring unseen log content.
