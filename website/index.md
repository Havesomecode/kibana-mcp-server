---
layout: home

hero:
  name: Kibana MCP Server
  text: Structured Kibana investigations for agents and teams
  tagline: A read-only MCP server that turns Kibana logs into sources an agent can discover, fields it can inspect and results it can read.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Run it as a service
      link: /deployment/http
    - theme: alt
      text: GitHub
      link: https://github.com/Havesomecode/kibana-mcp-server

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/><circle cx="19" cy="12" r="1.6"/></svg>'
    title: discover
    details: Start from logical sources an operator chose to expose, not from a list of every index in the cluster.
    link: /reference/tools/discover
    linkText: Tool reference
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/></svg>'
    title: describe_fields
    details: Check which fields exist and which ones support exact matching before tightening a filter.
    link: /reference/tools/describe-fields
    linkText: Tool reference
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>'
    title: query
    details: Move from a broad search to counts, histograms, term buckets, statistics or grouped hits, all as typed results.
    link: /reference/tools/query
    linkText: Tool reference
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>'
    title: Read-only by design
    details: The server searches and describes. It never writes to Elasticsearch or Kibana, and never guesses an index.
    link: /deployment/security
    linkText: Security model
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="12" cy="20.5" r="1.8"/><path d="m6 7 3.6 3"/><path d="m18 7-3.6 3"/><path d="M12 15v3.7"/></svg>'
    title: One server, many callers
    details: Over HTTP, a single process serves every user of your gateway, each with their own source catalog.
    link: /deployment/http
    linkText: HTTP transport
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>'
    title: Catalogs where you want them
    details: Keep source catalogs in files, Redis, PostgreSQL, MongoDB or SQLite, or plug in your own store.
    link: /deployment/catalog-stores
    linkText: Catalog stores
---

<div class="home-section home-start home-reveal">

<div class="home-start-copy">

<p class="home-eyebrow">Get started</p>

## Connect it, name an index, investigate

<p class="home-lead">Bootstrap verifies the connection and registers the server. It does not pick an index. The agent follows one rule: "Ask the user which exact Kibana index or index pattern to use." Only then does it call <code>configure_index</code> with that value.</p>

</div>

<div class="home-start-code">

::: code-group

```bash [Codex]
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
```

```bash [Agent skill]
npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation
```

```bash [Shared service]
# One process for every caller of your gateway, each with their own catalog
kibana-mcp-server serve --http --config ./kibana.mcp.config.ts
```

:::

</div>

</div>

<div class="home-section home-reveal">

<p class="home-eyebrow">Why this server</p>

## Kibana works for people. Agents need structure.

<div class="home-grid">
  <div class="home-tile" style="--stagger: 0">
    <h3>Sources, not raw indexes</h3>
    <p>An operator exposes a short catalog of named sources. The agent starts there instead of wandering through every index of the cluster.</p>
  </div>
  <div class="home-tile" style="--stagger: 1">
    <h3>Fields before filters</h3>
    <p>The agent sees which fields exist and which ones match exactly, so a filter on <code>service.name</code> means what it says.</p>
  </div>
  <div class="home-tile" style="--stagger: 2">
    <h3>Results it can reason about</h3>
    <p>Hits, counts, histograms and statistics come back typed. Query and filter responses include a <code>query_echo</code> of what was actually searched.</p>
  </div>
  <div class="home-tile" style="--stagger: 3">
    <h3>Nothing happens by accident</h3>
    <p>No source is configured until a person names the index, and nothing is ever written to Elasticsearch or Kibana.</p>
  </div>
</div>

</div>

<div class="home-section home-reveal">

<p class="home-eyebrow">Choose your path</p>

## Local tool or shared service

<div class="home-paths">
  <PathCard
    style="--stagger: 0"
    kicker="stdio · one caller"
    title="A local tool"
    :route="['agent', 'server', 'Kibana']"
    link="/guide/getting-started"
    link-text="Getting started"
    secondary-link="/contributing/development"
    secondary-text="Work from a clone"
  >
    <ul>
      <li>Bootstrap it from Codex or any MCP client, in one command.</li>
      <li>Credentials stay in the secret store of your operating system.</li>
      <li>Also runs from a cloned repository (Repo + Codex).</li>
    </ul>
  </PathCard>
  <PathCard
    style="--stagger: 1"
    kicker="HTTP · many callers"
    title="A shared service"
    :route="['agents', 'gateway', 'server', 'Kibana']"
    link="/deployment/http"
    link-text="HTTP transport"
    secondary-link="/integrations/"
    secondary-text="Integration examples"
    highlight
  >
    <ul>
      <li>One process behind your gateway serves the whole team.</li>
      <li>Each caller gets a source catalog of their own.</li>
      <li>Catalogs live in Redis, PostgreSQL, MongoDB, SQLite or files.</li>
    </ul>
  </PathCard>
</div>

Looking for a tool input or an option? Go to the [reference](/reference/cli). Schema-aware features depend on the deployment: when Kibana does not expose field metadata, fields are sampled through search instead. {.home-note}

</div>

<div class="home-section home-reveal">

<p class="home-eyebrow">Thank you</p>

## Built by these people

<p class="home-lead">Every commit to the repository earns a place on this wall.</p>

<ContributorWall />

</div>
