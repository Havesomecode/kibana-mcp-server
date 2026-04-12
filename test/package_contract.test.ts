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
      homepage?: string;
      main?: string;
      name?: string;
      publishConfig?: { access?: string; provenance?: boolean };
      repository?: { url?: string };
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("@havesomecode/kibana-mcp-server");
    expect(pkg.homepage).toBe("https://havesomecode.github.io/kibana-mcp-server/");
    expect(pkg.main).toBe("dist/src/mcp_entry.js");
    expect(pkg.bin?.["kibana-mcp-server"]).toBe("dist/src/index.js");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.provenance).toBe(true);
    expect(pkg.repository?.url).toBe("git+https://github.com/Havesomecode/kibana-mcp-server.git");
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
    ];

    for (const entry of required) {
      expect(pkg.files).toContain(entry);
    }
  });

  it("keeps plugin metadata aligned with the public homepage and current owner", () => {
    const pluginRaw = readFileSync(
      resolve(repoRoot, "plugins/kibana-log-investigation/.codex-plugin/plugin.json"),
      "utf8",
    );
    const plugin = JSON.parse(pluginRaw) as {
      author?: { name?: string; url?: string };
      homepage?: string;
      interface?: { developerName?: string; websiteURL?: string };
      repository?: string;
    };

    expect(plugin.author?.name).toBe("Havesomecode");
    expect(plugin.author?.url).toBe("https://github.com/Havesomecode");
    expect(plugin.homepage).toBe("https://havesomecode.github.io/kibana-mcp-server/");
    expect(plugin.repository).toBe("https://github.com/Havesomecode/kibana-mcp-server");
    expect(plugin.interface?.developerName).toBe("Havesomecode");
    expect(plugin.interface?.websiteURL).toBe("https://havesomecode.github.io/kibana-mcp-server/");
  });
});
