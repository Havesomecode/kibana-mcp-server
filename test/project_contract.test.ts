import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("project contract", () => {
  it("launches the bundled MCP from the installed plugin root", () => {
    const mcpRaw = readFileSync(
      resolve(repoRoot, "plugins/kibana-log-investigation/.mcp.json"),
      "utf8",
    );
    const mcp = JSON.parse(mcpRaw) as {
      mcpServers?: Record<string, { command?: string; cwd?: string; args?: string[] }>;
    };
    const server = mcp.mcpServers?.["kibana-log-investigation"];
    expect(server?.command).toBe("node");
    expect(server?.cwd).toBe(".");
    expect(server?.args).toEqual(["./mcp-launcher.mjs"]);
  });

  it("keeps GitHub Pages deployment aligned with the checked-in site artifact", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/pages.yml"), "utf8");

    expect(workflow).toContain("actions/configure-pages@v5");
    expect(workflow).toContain("actions/upload-pages-artifact@v3");
    expect(workflow).toContain("actions/deploy-pages@v4");
    expect(workflow).toContain("path: site");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("name: github-pages");
  });

  it("keeps the Codex plugin handoff connection-only", () => {
    const plugin = readFileSync(
      resolve(repoRoot, "plugins/kibana-log-investigation/.codex-plugin/plugin.json"),
      "utf8",
    );

    expect(plugin).toContain("connection-only bootstrap");
    expect(plugin).toContain("ask me which exact index or pattern to configure");
    expect(plugin).not.toContain("bootstrap from my Elasticsearch index");
    expect(plugin).not.toContain("profile from an Elasticsearch index");
  });
});
