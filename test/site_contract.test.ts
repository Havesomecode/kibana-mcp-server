import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readSiteFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("site contract", () => {
  it("ships the required Pages site files", () => {
    expect(existsSync(resolve(repoRoot, "site/index.html"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "site/styles.css"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "site/app.js"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "site/404.html"))).toBe(true);
  });

  it("keeps the homepage structure and install paths intact", () => {
    const html = readSiteFile("site/index.html");

    const requiredSections = [
      'id="hero"',
      'id="workflow"',
      'id="why"',
      'id="features"',
      'id="install"',
      'id="boundaries"',
    ];

    for (const section of requiredSections) {
      expect(html).toContain(section);
    }

    expect(html).toContain("@havesomecode/kibana-mcp-server");
    expect(html).toContain("bootstrap --index 'app-logs-*' --client codex");
    expect(html).toContain("npx skills add Havesomecode/kibana-mcp-server");
    expect(html).toContain("kibana-log-investigation");
    expect(html).not.toContain("@havesomecode/kibana-mcp-server setup");
    expect(html).toContain("Repo + Codex");
    expect(html).toContain("Read-only by design");
    expect(html).toContain("Schema-aware features depend on the deployment");
  });

  it("labels the public investigation example without making unmeasured speed claims", () => {
    const html = readSiteFile("site/index.html");

    expect(html).toContain("Synthetic investigation example");
    expect(html).not.toMatch(/\b(?:fast|faster|efficien(?:t|cy))\b/i);
  });

  it("describes query echoes only for query and filter responses", () => {
    const html = readSiteFile("site/index.html");
    const portfolio = readSiteFile("docs/portfolio/kibana-log-investigation-mcp.md");

    expect(html).toContain("Query and filter responses include a <code>query_echo</code>");
    expect(html).not.toContain("Every response includes a <code>query_echo</code>");
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

  it("avoids root-relative links and assets that would break on a project Pages path", () => {
    const html = readSiteFile("site/index.html");

    expect(html).not.toMatch(/\b(?:href|src)=["']\/(?!\/)/);
  });

  it("keeps the 404 page connected to the install and repository surfaces", () => {
    const html = readSiteFile("site/404.html");

    expect(html).toContain("@havesomecode/kibana-mcp-server");
    expect(html).toContain("Back to homepage");
    expect(html).toContain("Open the repository");
    expect(html).toContain('href="/kibana-mcp-server/styles.css"');
    expect(html).toContain('href="/kibana-mcp-server/"');
  });
});
