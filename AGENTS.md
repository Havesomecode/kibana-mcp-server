# Agent Instructions

## First Step

Read [`INSTALL.md`](./INSTALL.md) first.

If the goal is to set up or use this repository in Codex, treat `INSTALL.md` as the primary operator and handoff guide.

## Setup Priority

When working from a fresh clone:

1. Read `INSTALL.md`
2. Follow the Codex/plugin installation flow there
3. Use the plugin-local skills when relevant:
   - `plugins/kibana-log-investigation/skills/ensure-node-runtime/SKILL.md`
   - `plugins/kibana-log-investigation/skills/install-and-configure/SKILL.md`

## Repository Context

This repo provides a read-only Kibana log investigation MCP server plus a repo-scoped Codex plugin for local installation from a cloned checkout.
Documented learnings live in `docs/solutions/`, organized by category with YAML frontmatter such as `module`, `tags`, and `problem_type`, and are relevant when working in already documented areas.

For product details and MCP behavior, read `README.md`.
