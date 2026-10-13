---
description: "The documentation is published as plain Markdown for language models - llms.txt, llms-full.txt and a Markdown version of every page."
---

# LLM-friendly documentation

This site follows the [`llms.txt`](https://llmstxt.org/) standard: alongside the HTML pages, it publishes the same content as plain Markdown that a language model can read without parsing a web page.

## What is published

| File | Content | Use it when |
| --- | --- | --- |
| [`/llms.txt`](https://havesomecode.github.io/kibana-mcp-server/llms.txt) | An index: every page with its title, description and link to its Markdown version | The agent should pick the pages it needs |
| [`/llms-full.txt`](https://havesomecode.github.io/kibana-mcp-server/llms-full.txt) | The whole documentation in a single file | You want to load everything into the context at once |
| `<page>.md` | The Markdown version of one page | You need one precise page |

For example, the reference of the `query` tool is available at:

```text
https://havesomecode.github.io/kibana-mcp-server/reference/tools/query.md
```

## Copy a page as Markdown

Every documentation page has two buttons under its title, to copy the page as Markdown or to download it. Paste the result into a conversation when your agent cannot browse.

## In an agent or an IDE

Most coding agents can fetch a URL. Tell yours where the index is:

```text
Use https://havesomecode.github.io/kibana-mcp-server/llms.txt as the documentation of Kibana MCP Server.
```

In a project, add that line to your `AGENTS.md` or `CLAUDE.md` so every session starts with it.

## How it is generated

The files are produced at build time by [`vitepress-plugin-llms`](https://github.com/okineadev/vitepress-plugin-llms) from the same Markdown sources as the HTML pages, so the two never drift apart.
