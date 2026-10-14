---
description: "The documentation is published as plain Markdown for language models - llms.txt, llms-full.txt and a Markdown version of every page."
---

# LLM-friendly documentation

Use the plain Markdown docs below. They follow the [`llms.txt`](https://llmstxt.org/) standard and match the HTML pages.

## What is published

| File | Content | Use it when |
| --- | --- | --- |
| [`/llms.txt`](https://havesomecode.github.io/kibana-mcp-server/llms.txt) | An index: every page with its title, description and link to its Markdown version | The agent should pick the pages it needs |
| [`/llms-full.txt`](https://havesomecode.github.io/kibana-mcp-server/llms-full.txt) | The whole documentation in a single file | You want to load everything into the context at once |
| `<page>.md` | The Markdown version of one page | You need one precise page |

For the `query` reference, fetch:

```text
https://havesomecode.github.io/kibana-mcp-server/reference/tools/query.md
```

## Copy a page as Markdown

Click **Copy as Markdown** or **Download** under the page title. If your agent cannot browse, paste the result into its conversation.

## In an agent or an IDE

Send your agent this prompt:

```text
Use https://havesomecode.github.io/kibana-mcp-server/llms.txt as the documentation of Kibana MCP Server.
```

Add that line to `AGENTS.md` or `CLAUDE.md` to reuse it each session.

## How it is generated

[`vitepress-plugin-llms`](https://github.com/okineadev/vitepress-plugin-llms) builds these files from the same Markdown sources as the HTML pages.
