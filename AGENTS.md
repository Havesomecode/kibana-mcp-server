# Agent Instructions

Read [`INSTALL.md`](./INSTALL.md) first.

It is the Codex setup and handoff guide.

## Set up a cloned checkout

1. Follow the Codex/plugin flow in `INSTALL.md`.
2. Use the relevant local skill:
   - `plugins/kibana-log-investigation/skills/ensure-node-runtime/SKILL.md`
   - `plugins/kibana-log-investigation/skills/install-and-configure/SKILL.md`

## Before editing

This repo provides a read-only Kibana MCP server and a repo-local Codex plugin.

Read `README.md` for product behavior. Check relevant learnings in `docs/solutions/`, organized by category and frontmatter (`module`, `tags`, `problem_type`).

## CLI conventions

- `src/bin/`: executables.
- `src/commands/`: Commander registration, command-specific validation and orchestration only.
- Keep terminal I/O and Clack prompt adapters outside command modules.

Do not add command logic back to `src/cli.ts`.

## Lessons

- When writing skills or instructions, lead with the action, use short numbered steps, keep warnings beside the affected action, and remove repeated rationale without removing contracts.
- When a project format was used only by the owner, remove its obsolete code, callers, tests and documentation instead of adding compatibility or migration paths.
