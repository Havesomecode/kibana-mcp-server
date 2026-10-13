import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildGeneratedSource } from "../src/setup/bootstrap.js";

const repoRoot = process.cwd();

function readSiteFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("site contract", () => {
  it.each(["\n", "\r\n"])(
    "uses the configured walkthrough source ID with %j line endings",
    (newline) => {
      const markdown = readSiteFile("website/guide/investigating.md").replace(/\r?\n/g, newline);
      const examples = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(([, json]) =>
        JSON.parse(json),
      );
      const configured = examples[0];
      const source = buildGeneratedSource(
        [configured.index],
        configured.source_name,
        configured.source_id,
      );
      for (const example of examples.slice(1)) {
        if (example.source_id) expect(example.source_id).toBe(source.id);
        if (example.source_ids) expect(example.source_ids).toEqual([source.id]);
      }
    },
  );

  it("ships the documentation site sources", () => {
    for (const file of [
      "website/index.md",
      "website/.vitepress/config.ts",
      "website/.vitepress/theme/index.ts",
      "website/.vitepress/theme/custom.css",
      "website/.vitepress/theme/Layout.vue",
      "website/.vitepress/theme/components/FeatureCard.vue",
      "website/.vitepress/theme/components/PathCard.vue",
      "website/.vitepress/theme/components/InvestigationPanel.vue",
      "website/.vitepress/theme/components/ContributorWall.vue",
      "website/.vitepress/theme/components/HomeFooter.vue",
      "website/.vitepress/contributors.json",
      "website/public/logo.svg",
    ]) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(true);
    }
  });

  it("publishes the documentation for language models", () => {
    const config = readSiteFile("website/.vitepress/config.ts");

    expect(config).toContain('from "vitepress-plugin-llms"');
    expect(config).toContain("plugins: [llmstxt(");
    expect(readSiteFile("website/ai/llms.md")).toContain("llms-full.txt");
  });

  it("keeps the Claude Code marketplace aligned with the documented install commands", () => {
    const marketplace = JSON.parse(readSiteFile(".claude-plugin/marketplace.json")) as {
      name: string;
      plugins: Array<{ name: string; source: string }>;
    };
    const plugin = JSON.parse(readSiteFile(".claude-plugin/plugin.json")) as {
      name: string;
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const guide = readSiteFile("website/ai/agent-plugins.md");

    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: plugin.name, source: "./" });
    // The plugin root is the repository root, where the published skill lives.
    expect(existsSync(resolve(repoRoot, "skills", plugin.name, "SKILL.md"))).toBe(true);
    expect(Object.values(plugin.mcpServers)[0]).toEqual({
      command: "npx",
      args: ["-y", "@havesomecode/kibana-mcp-server", "serve"],
    });
    const skill = readSiteFile(`skills/${plugin.name}/SKILL.md`);

    // The plugin registers the server, so in Claude Code the skill must not ask bootstrap to.
    expect(skill).toMatch(/\| Claude Code \|[^\n]*\| `--client none` \|/);
    expect(skill).toContain(`/plugin install ${plugin.name}@${marketplace.name}`);
    expect(guide).toContain("claude plugin marketplace add Havesomecode/kibana-mcp-server");
    expect(guide).toContain(`claude plugin install ${plugin.name}@${marketplace.name}`);
  });

  it("serves the site from the project Pages path", () => {
    const config = readSiteFile("website/.vitepress/config.ts");

    expect(config).toContain('const siteBase = "/kibana-mcp-server/"');
    expect(config).toContain("base: siteBase");
    // The AI icon of the navigation bar is a social link, which needs the base spelled out.
    expect(config).toContain("link: `${siteBase}ai/`");
  });

  it("links every navigation and sidebar entry to an existing page", () => {
    const config = readSiteFile("website/.vitepress/config.ts");
    const links = [...config.matchAll(/link: "(\/[^"]*)"/g)].map(([, link]) => link);

    expect(links.length).toBeGreaterThan(20);
    for (const link of links) {
      const page = link.endsWith("/") ? `${link}index.md` : `${link}.md`;
      expect(existsSync(resolve(repoRoot, "website", `.${page}`)), link).toBe(true);
    }
  });

  it("keeps the homepage install paths and boundaries intact", () => {
    const home = readSiteFile("website/index.md");

    expect(home).toContain("@havesomecode/kibana-mcp-server");
    expect(home).toContain("bootstrap --client codex");
    expect(home).not.toContain("--index");
    expect(home).toContain("Ask the user which exact Kibana index or index pattern to use.");
    expect(home).toContain("configure_index");
    expect(home).toContain("npx skills add Havesomecode/kibana-mcp-server");
    expect(home).toContain("kibana-log-investigation");
    expect(home).not.toContain("@havesomecode/kibana-mcp-server setup");
    expect(home).toContain("Repo + Codex");
    expect(home).toContain("Read-only by design");
    expect(home).toContain("Schema-aware features depend on the deployment");
  });

  it("labels the public investigation example without making unmeasured speed claims", () => {
    const home = readSiteFile("website/index.md");
    const panel = readSiteFile("website/.vitepress/theme/components/InvestigationPanel.vue");

    expect(panel).toContain("Synthetic investigation example");
    expect(`${home}\n${panel}`).not.toMatch(/\b(?:fast|faster|efficien(?:t|cy))\b/i);
  });

  it("states that the project is independent from Elastic", () => {
    const config = readSiteFile("website/.vitepress/config.ts");
    const homeFooter = readSiteFile("website/.vitepress/theme/components/HomeFooter.vue");

    expect(config).toContain("not affiliated with or endorsed by Elastic");
    expect(homeFooter.replace(/\s+/g, " ")).toContain("not affiliated with or endorsed by Elastic");
  });

  it("describes query echoes only for query and filter responses", () => {
    const home = readSiteFile("website/index.md");
    const portfolio = readSiteFile("docs/portfolio/kibana-log-investigation-mcp.md");

    expect(home).toContain("Query and filter responses include a <code>query_echo</code>");
    expect(home).not.toContain("Every response includes a <code>query_echo</code>");
    expect(portfolio).toContain("Query and filter responses include a `query_echo`");
    expect(portfolio).not.toContain("query scope echoed in every response");
    expect(portfolio).not.toContain("Responses include a `query_echo`");
  });

  it("keeps the public install handoff portable and current", () => {
    const handoff = readSiteFile(
      "docs/solutions/documentation-gaps/self-contained-codex-install-handoff-2026-04-08.md",
    );

    expect(handoff).toContain(
      "https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/master/INSTALL.md",
    );
    expect(handoff).not.toContain("raw.githubusercontent.com/Zacaria/");
    expect(handoff).not.toContain("/Users/");
  });

  it("keeps the timeout bug handoff synthetic and portable", () => {
    const handoff = readSiteFile("HANDOFF_timeout-config-bug.md");
    const baseUrls = [...handoff.matchAll(/KIBANA_BASE_URL='([^']+)'/g)].map(
      ([, baseUrl]) => baseUrl,
    );

    expect(baseUrls.length).toBeGreaterThan(0);
    for (const baseUrl of baseUrls) {
      expect(new URL(baseUrl).hostname).toBe("kibana.example.com");
    }
    expect(handoff).toContain("KIBANA_SOURCE_CATALOG_PATH='config/sources.example.json'");
    expect(handoff).not.toMatch(/\/(?:Users|Volumes)\//);
  });
});
