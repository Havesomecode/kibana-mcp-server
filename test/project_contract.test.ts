import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("project contract", () => {
  it("keeps MCP entrypoint aligned with build output", () => {
    const tsconfigRaw = readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8");
    const tsconfig = JSON.parse(tsconfigRaw) as { compilerOptions?: { outDir?: string } };
    const outDir = tsconfig.compilerOptions?.outDir ?? "dist";

    const mcpRaw = readFileSync(
      resolve(repoRoot, "plugins/kibana-log-investigation/.mcp.json"),
      "utf8",
    );
    const mcp = JSON.parse(mcpRaw) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    const entryArg = mcp.mcpServers?.["kibana-log-investigation"]?.args?.[0];

    expect(entryArg).toBeDefined();
    if (!entryArg) {
      return;
    }

    const normalized = entryArg
      .replace(/^[.][\\/]/, "")
      .split(/[\\/]/)
      .join(sep);
    const expected = [outDir, "src", "mcp_entry.js"].join(sep);
    expect(normalized).toBe(expected);
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
});
