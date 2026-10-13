import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const launcher = resolve("plugins/kibana-log-investigation/mcp-launcher.mjs");

describe("installed plugin launcher", () => {
  it("reports a missing runtime without asking for another discussion", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-plugin-missing-"));
    try {
      await cp(launcher, join(root, "mcp-launcher.mjs"));
      const error = await execFileAsync(process.execPath, [join(root, "mcp-launcher.mjs")], {
        cwd: root,
        timeout: 5000,
      }).catch((failure) => failure);
      expect(error.code).toBe(1);
      expect(error.stdout).toBe("");
      expect(error.stderr).toContain("runtime is missing");
      expect(error.stderr).toContain("reinstall the built plugin");
      expect(error.stderr).toContain("Opening another discussion cannot repair");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves its bundle relative to itself, not the caller's working directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-plugin-moved-"));
    try {
      await cp(launcher, join(root, "mcp-launcher.mjs"));
      await mkdir(join(root, "dist"));
      await writeFile(join(root, "dist/mcp_entry.mjs"), 'process.stdout.write("loaded\\n");\n');
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [join(root, "mcp-launcher.mjs")],
        { cwd: process.cwd(), timeout: 5000 },
      );
      expect(stdout).toBe("loaded\n");
      expect(stderr).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not expose a thrown module's potentially secret error message", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-plugin-error-"));
    try {
      await cp(launcher, join(root, "mcp-launcher.mjs"));
      await mkdir(join(root, "dist"));
      await writeFile(
        join(root, "dist/mcp_entry.mjs"),
        'throw Object.assign(new Error("synthetic-private-value"), {code: "ERR_MODULE_NOT_FOUND"});\n',
      );
      const error = await execFileAsync(process.execPath, [join(root, "mcp-launcher.mjs")], {
        cwd: root,
        timeout: 5000,
      }).catch((failure) => failure);
      expect(error.code).toBe(1);
      expect(error.stdout).toBe("");
      expect(error.stderr).toContain("ERR_MODULE_NOT_FOUND");
      expect(error.stderr).toContain("Rebuild and reinstall");
      expect(error.stderr).not.toContain("synthetic-private-value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
