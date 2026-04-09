import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("release contract", () => {
  it("keeps package release scripts and published files aligned", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
      files?: string[];
      name?: string;
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("@havesomecode/kibana-mcp-server");
    expect(pkg.scripts?.release).toBe("semantic-release");
    expect(pkg.scripts?.["verify:release-contract"]).toBe(
      "node scripts/verify-release-contract.mjs",
    );
    expect(pkg.scripts?.verify).toContain("npm run verify:release-contract");
    expect(pkg.scripts).not.toHaveProperty("changeset");
    expect(pkg.scripts).not.toHaveProperty("changeset:version");
    expect(pkg.scripts).not.toHaveProperty("changeset:release");
    expect(pkg.devDependencies).not.toHaveProperty("@changesets/cli");
    expect(pkg.files).not.toContain("CHANGELOG.md");
  });

  it("uses semantic-release on master without repo-mutating release plugins", () => {
    const config = JSON.parse(readFileSync(resolve(repoRoot, ".releaserc.json"), "utf8")) as {
      branches?: string[];
      plugins?: Array<string | [string, Record<string, unknown>]>;
      tagFormat?: string;
    };

    const pluginNames = (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );

    expect(config.branches).toEqual(["master"]);
    expect(config.tagFormat).toBe("v${version}");
    expect(pluginNames).toEqual([
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "@semantic-release/npm",
      "@semantic-release/github",
    ]);
    expect(pluginNames).not.toContain("@semantic-release/changelog");
    expect(pluginNames).not.toContain("@semantic-release/git");
  });

  it("keeps workflows aligned with semantic PR titles and trusted publishing", () => {
    const releaseWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    const semanticWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/semantic-commits.yml"),
      "utf8",
    );

    expect(releaseWorkflow).toContain("fetch-depth: 0");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("contents: write");
    expect(releaseWorkflow).toContain("npm run verify");
    expect(releaseWorkflow).toContain("npm run release");
    expect(releaseWorkflow).not.toContain("changesets/action");

    expect(semanticWorkflow).toContain("pull_request:");
    expect(semanticWorkflow).toContain("commitlint");
    expect(semanticWorkflow).toContain("github.event.pull_request.title");
  });

  it("passes the repo-local release contract verifier", () => {
    expect(() =>
      execFileSync("node", [resolve(repoRoot, "scripts/verify-release-contract.mjs")], {
        cwd: repoRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
