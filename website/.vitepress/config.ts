import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";
import llmstxt, { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";

const repository = "https://github.com/Havesomecode/kibana-mcp-server";
const siteBase = "/kibana-mcp-server/";

export default defineConfig({
  lang: "en-US",
  title: "Kibana MCP Server",
  description:
    "Read-only MCP server that gives agents structured access to Kibana logs: logical sources, field inspection and typed query results.",
  base: siteBase,
  cleanUrls: true,
  srcExclude: ["THIRD_PARTY_NOTICES.md"],
  lastUpdated: true,
  appearance: "dark",
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },
  vite: {
    // Publishes llms.txt, llms-full.txt and a Markdown twin of every page.
    plugins: [llmstxt({ ignoreFiles: ["THIRD_PARTY_NOTICES.md"] })],
    resolve: {
      // Swap the default feature card for ours; VitePress documents this alias for internal components.
      alias: [
        {
          find: /^.*\/VPFeature\.vue$/,
          replacement: fileURLToPath(
            new URL("./theme/components/FeatureCard.vue", import.meta.url),
          ),
        },
      ],
    },
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/kibana-mcp-server/logo.svg" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
    ],
    ["meta", { name: "theme-color", content: "#07111e" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Kibana MCP Server",
    nav: [
      { text: "Guide", link: "/guide/what-is-it", activeMatch: "/guide/" },
      { text: "Deployment", link: "/deployment/stdio", activeMatch: "/deployment/" },
      { text: "Integrations", link: "/integrations/", activeMatch: "/integrations/" },
      { text: "Reference", link: "/reference/cli", activeMatch: "/reference/" },
      {
        text: "Project",
        items: [
          { text: "Contributing", link: "/contributing/development" },
          { text: "Architecture", link: "/contributing/architecture" },
          { text: "Releases", link: `${repository}/releases` },
          { text: "npm", link: "https://www.npmjs.com/package/@havesomecode/kibana-mcp-server" },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is it?", link: "/guide/what-is-it" },
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Investigating with an agent", link: "/guide/investigating" },
          ],
        },
        {
          text: "Configuration",
          items: [
            { text: "Profiles and environments", link: "/guide/profiles" },
            { text: "Configuration file", link: "/guide/configuration-file" },
          ],
        },
      ],
      "/deployment/": [
        {
          text: "Transports",
          items: [
            { text: "stdio", link: "/deployment/stdio" },
            { text: "HTTP", link: "/deployment/http" },
            { text: "OpenID Connect", link: "/deployment/oidc" },
            { text: "Security model", link: "/deployment/security" },
          ],
        },
        {
          text: "Catalog stores",
          items: [
            { text: "Overview", link: "/deployment/catalog-stores" },
            { text: "Redis", link: "/deployment/stores/redis" },
            { text: "PostgreSQL", link: "/deployment/stores/postgres" },
            { text: "MongoDB", link: "/deployment/stores/mongodb" },
            { text: "SQLite", link: "/deployment/stores/sqlite" },
            { text: "Custom store", link: "/deployment/stores/custom" },
          ],
        },
      ],
      "/integrations/": [
        {
          text: "Integration examples",
          items: [
            { text: "Overview", link: "/integrations/" },
            { text: "Behind an MCP gateway", link: "/integrations/gateway" },
            { text: "Ts.ED gateway", link: "/integrations/tsed" },
            { text: "Docker image", link: "/integrations/docker" },
          ],
        },
      ],
      "/ai/": [
        {
          text: "AI",
          items: [
            { text: "Built for agents", link: "/ai/" },
            { text: "LLM-friendly documentation", link: "/ai/llms" },
            { text: "Agent plugins and skills", link: "/ai/agent-plugins" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Configuration",
          items: [
            { text: "Command line", link: "/reference/cli" },
            { text: "Environment variables", link: "/reference/environment" },
            { text: "Configuration file", link: "/reference/config-file" },
            { text: "Source catalog", link: "/reference/source-catalog" },
          ],
        },
        {
          text: "Tools",
          items: [
            { text: "configure_index", link: "/reference/tools/configure-index" },
            { text: "discover", link: "/reference/tools/discover" },
            { text: "describe_fields", link: "/reference/tools/describe-fields" },
            { text: "query", link: "/reference/tools/query" },
            { text: "filter", link: "/reference/tools/filter" },
          ],
        },
        { text: "Errors", link: "/reference/errors" },
      ],
      "/contributing/": [
        {
          text: "Project",
          items: [
            { text: "Development", link: "/contributing/development" },
            { text: "Architecture", link: "/contributing/architecture" },
          ],
        },
      ],
    },
    socialLinks: [
      {
        // Social links are not prefixed with the site base, hence the explicit one.
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,9 20.25,6.25 23,5 20.25,3.75 19,1 17.75,3.75 15,5 17.75,6.25"></polygon><polygon points="19,15 17.75,17.75 15,19 17.75,20.25 19,23 20.25,20.25 23,19 20.25,17.75"></polygon><path d="M11.5,9.5L9,4L6.5,9.5L1,12l5.5,2.5L9,20l2.5-5.5L17,12L11.5,9.5z M9.99,12.99L9,15.17l-0.99-2.18L5.83,12l2.18-0.99 L9,8.83l0.99,2.18L12.17,12L9.99,12.99z"></path></svg>',
        },
        link: `${siteBase}ai/`,
        ariaLabel: "AI: documentation and plugins for agents",
      },
      { icon: "github", link: repository },
    ],
    search: { provider: "local" },
    editLink: {
      pattern: `${repository}/edit/master/website/:path`,
      text: "Edit this page on GitHub",
    },
    outline: { level: [2, 3] },
    footer: {
      message:
        "Released under the MIT License. Independent project, not affiliated with or endorsed by Elastic. Kibana and Elasticsearch are trademarks of Elasticsearch B.V.",
      copyright: "Copyright © Havesomecode",
    },
  },
});
