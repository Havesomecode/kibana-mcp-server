import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositories: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function fixture(): string {
  const repo = mkdtempSync(join(tmpdir(), "readme-handoff-"));
  repositories.push(repo);
  git(repo, "init", "--quiet", "--initial-branch=master");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test Fixture");
  writeFileSync(join(repo, "README.md"), "# README at master\n");
  git(repo, "add", "README.md");
  git(repo, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
  return repo;
}

async function helper() {
  const path = join(process.cwd(), "scripts/readme-handoff.mjs");
  return import(/* @vite-ignore */ path);
}

afterEach(() => {
  for (const repo of repositories.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe("version-matched README handoff", () => {
  it("resolves master to the exact raw branch URL and actual commit", async () => {
    const repo = fixture();
    const { resolveReadmeHandoff } = await helper();
    expect(resolveReadmeHandoff(repo, "master")).toEqual({
      ref: "refs/heads/master",
      commit: git(repo, "rev-parse", "HEAD"),
      url: "https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/refs/heads/master/README.md",
    });
  });

  it("resolves a nested branch without losing its path", async () => {
    const repo = fixture();
    git(repo, "branch", "release/next");
    const { resolveReadmeHandoff } = await helper();
    expect(resolveReadmeHandoff(repo, "refs/heads/release/next").url).toBe(
      "https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/refs/heads/release/next/README.md",
    );
  });

  it("uses the actual annotated tag or pinned commit, not master's different README", async () => {
    const repo = fixture();
    const taggedCommit = git(repo, "rev-parse", "HEAD");
    git(repo, "-c", "tag.gpgsign=false", "tag", "-a", "release-actual", "-m", "actual tag");
    writeFileSync(join(repo, "README.md"), "# New master README\n");
    git(repo, "add", "README.md");
    git(repo, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "new master");
    const { verifyReadmeHandoff } = await helper();
    for (const ref of ["release-actual", "refs/tags/release-actual", taggedCommit]) {
      const result = await verifyReadmeHandoff(repo, ref, async (url: string) => {
        expect(url).not.toContain("refs/heads/master");
        return new Response("# README at master\n");
      });
      expect(result.commit).toBe(taggedCommit);
      expect(result.url).toBe(
        `https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/${ref === taggedCommit ? taggedCommit : "refs/tags/release-actual"}/README.md`,
      );
    }
  });

  it("rejects ambiguous names until branch or tag is specified", async () => {
    const repo = fixture();
    git(repo, "-c", "tag.gpgsign=false", "tag", "master");
    const { resolveReadmeHandoff } = await helper();
    expect(() => resolveReadmeHandoff(repo, "master")).toThrow(/ambiguous/i);
    expect(resolveReadmeHandoff(repo, "refs/tags/master").ref).toBe("refs/tags/master");
    expect(resolveReadmeHandoff(repo, "refs/heads/master").ref).toBe("refs/heads/master");
  });

  it("rejects an annotated tag object's SHA when a commit SHA was requested", async () => {
    const repo = fixture();
    git(repo, "-c", "tag.gpgsign=false", "tag", "-a", "actual-tag", "-m", "tag object");
    const tagObject = git(repo, "rev-parse", "refs/tags/actual-tag");
    const { resolveReadmeHandoff } = await helper();
    expect(() => resolveReadmeHandoff(repo, tagObject)).toThrow(/not a commit SHA/i);
  });

  it.each(["unknown-release", "v0.1.0", "refs/tags/missing", "a".repeat(40)])(
    "reports an unknown ref without a master fallback: %s",
    async (ref) => {
      const { resolveReadmeHandoff } = await helper();
      expect(() => resolveReadmeHandoff(fixture(), ref)).toThrow(/cannot resolve/i);
    },
  );

  it.each(["", " master", "master ", "--help", "HEAD", "master~1", "refs/remotes/origin/master"])(
    "rejects unsupported refs without normalizing them: %s",
    async (ref) => {
      const { resolveReadmeHandoff } = await helper();
      expect(() => resolveReadmeHandoff(fixture(), ref)).toThrow(/installation ref/i);
    },
  );

  it("reports a README missing from the selected commit even when master has one", async () => {
    const repo = fixture();
    git(repo, "checkout", "--quiet", "-b", "no-readme");
    git(repo, "rm", "--quiet", "README.md");
    git(repo, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "remove readme");
    git(repo, "checkout", "--quiet", "master");
    const { resolveReadmeHandoff } = await helper();
    expect(() => resolveReadmeHandoff(repo, "no-readme")).toThrow(/README.md.*missing/i);
  });

  it("encodes URL-significant characters in valid Git refs", async () => {
    const repo = fixture();
    git(repo, "branch", "topic/#next");
    const { resolveReadmeHandoff } = await helper();
    expect(resolveReadmeHandoff(repo, "topic/#next").url).toContain(
      "refs/heads/topic/%23next/README.md",
    );
  });

  it("verifies the fetched README byte-for-byte against the resolved Git object", async () => {
    const repo = fixture();
    const { verifyReadmeHandoff } = await helper();
    const handoff = await verifyReadmeHandoff(repo, "master", async (url: string) => {
      expect(url).toBe(
        "https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/refs/heads/master/README.md",
      );
      return new Response("# README at master\n");
    });
    expect(handoff.ref).toBe("refs/heads/master");
    await expect(
      verifyReadmeHandoff(repo, "master", async () => new Response("# Another version\n")),
    ).rejects.toThrow(/does not match.*resolved commit/i);
  });

  it.each([404, 500, 302])("rejects HTTP %s instead of emitting a handoff", async (status) => {
    const { verifyReadmeHandoff } = await helper();
    await expect(
      verifyReadmeHandoff(fixture(), "master", async () => new Response(null, { status })),
    ).rejects.toThrow(new RegExp(`README.*HTTP ${status}`));
  });

  it("reports transport failures and uses a bounded, non-redirecting request", async () => {
    const { verifyReadmeHandoff } = await helper();
    await expect(
      verifyReadmeHandoff(fixture(), "master", async (_url: string, init: RequestInit) => {
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        throw new Error("network unavailable");
      }),
    ).rejects.toThrow(/cannot retrieve README.*network unavailable/i);
  });

  it("CLI errors go to stderr with a nonzero exit and no handoff on stdout", () => {
    for (const args of [[], ["unknown-ref"], ["master", "extra"]]) {
      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts/readme-handoff.mjs"), ...args],
        {
          cwd: fixture(),
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/readme-handoff:/);
    }
  });
});
