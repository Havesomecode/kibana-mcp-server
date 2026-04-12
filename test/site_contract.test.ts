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
    expect(html).toContain("Repo + Codex");
    expect(html).toContain("Read-only by design");
    expect(html).toContain("Schema-aware features depend on the deployment");
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
  });
});
