import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("package contract", () => {
  it("publishes the intended artifact surface", () => {
    const pkgRaw = readFileSync(resolve(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      bin?: Record<string, string>;
      files?: string[];
      main?: string;
      name?: string;
      publishConfig?: { access?: string; provenance?: boolean };
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("@zacaria/kibana-mcp-server");
    expect(pkg.main).toBe("dist/src/mcp_entry.js");
    expect(pkg.bin?.["kibana-mcp-server"]).toBe("dist/src/index.js");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.provenance).toBe(true);
    expect(pkg.scripts?.start).toBe("node dist/src/mcp_entry.js");
    expect(pkg.files).toBeDefined();
    if (!pkg.files) {
      return;
    }

    const required = [
      "dist/**",
      "plugins/kibana-log-investigation/.mcp.json",
      "plugins/kibana-log-investigation/.codex-plugin/plugin.json",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
    ];

    for (const entry of required) {
      expect(pkg.files).toContain(entry);
    }
  });
});
