# Kibana Log Investigation MCP — portfolio copy

## Short card

A read-only MCP that gives agents a bounded way to investigate Kibana-backed logs. Operators choose the source catalog; agents can inspect fields, apply exact filters, and run time-bounded queries. Query and filter responses include a `query_echo` so their scope remains inspectable.

## Personal context

Kibana already had the data. The part I wanted to change was how an agent reaches it.

Driving the UI would have tied each investigation to page state and local habits. I built a smaller interface instead: named sources, field capabilities, exact filters, explicit time windows, and structured results. The operator decides which sources exist in the catalog, and the MCP does not expose write operations.

The interesting part for me is not adding AI to observability. It is making a difficult system legible enough that another person or tool can investigate it without hiding the boundaries.

## Expanded project copy

Kibana Log Investigation MCP exposes a small, read-only investigation surface over Kibana-backed search endpoints. It supports source discovery, schema inspection where the deployment allows it, exact-field filters, and bounded queries for hits, counts, histograms, terms, statistics, and grouped top hits.

Query and filter responses include a `query_echo` with the selected sources, time bounds, filters, and mode. That keeps the scope visible when an agent explains what it found. Schema-dependent features fail clearly or return advisories rather than pretending that exact-field resolution happened.

The project includes a repo-local Codex plugin, guided machine setup, secure credential storage, a public npm package, release automation, and a static documentation site. The public capture uses invented service names and counts; it contains no real host, source catalog, credential, or log payload.

## Evidence to link

- Public docs: <https://havesomecode.github.io/kibana-mcp-server/>
- Source: <https://github.com/Havesomecode/kibana-mcp-server>
- npm: <https://www.npmjs.com/package/@havesomecode/kibana-mcp-server>
- Current public release: [latest release](https://github.com/Havesomecode/kibana-mcp-server/releases/latest)
- Sanitized capture: `docs/portfolio/kibana-log-investigation-mcp-homepage.png`

## Claim boundaries

Do not add adoption, time-saved, incident-reduction, investigation-speed, or efficiency claims. None has been validated for public use. Describe the implemented boundary and inspectable behavior instead: read-only operations, operator-controlled sources, absolute time windows, schema advisories, pagination, and query echoes.

## Capture record

The capture uses the synthetic example committed in `site/index.html`: `kibana.example.com`, `app-logs-*`, invented service names, and invented counts. npm reported `1.1.0` as the latest package version when the capture was prepared. The screenshot reflects the local portfolio copy update and should be regenerated after any visible homepage change.
