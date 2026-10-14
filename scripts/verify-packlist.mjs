import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  throw new Error("npm_execpath is unavailable; run this verifier through npm.");
}
const repoRoot = process.cwd();

const required = [
  "dist/src/bin/kibana-mcp-server.js",
  "plugins/kibana-log-investigation/.mcp.json",
  "plugins/kibana-log-investigation/.codex-plugin/plugin.json",
  "plugins/kibana-log-investigation/mcp-launcher.mjs",
  "plugins/kibana-log-investigation/dist/mcp_entry.mjs",
  "plugins/kibana-log-investigation/dist/mcp_entry.mjs.LEGAL.txt",
  "plugins/kibana-log-investigation/dist/LICENSE",
  "plugins/kibana-log-investigation/dist/THIRD_PARTY_NOTICES.md",
  "plugins/kibana-log-investigation/skills/install-and-configure/SKILL.md",
  "skills/kibana-log-investigation/SKILL.md",
  "README.md",
  "LICENSE",
];

const forbiddenPrefixes = ["test/", "test\\", "config/sources.json", "config/sources.runtime.json"];

const { stdout } = await execFileAsync(
  process.execPath,
  [npmExecPath, "pack", "--json", "--dry-run"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: resolve(repoRoot, ".npm-cache"),
    },
  },
);

const result = JSON.parse(stdout);
const entries = result?.[0]?.files ?? [];
const files = new Set(entries.map((entry) => entry.path));

for (const file of required) {
  if (!files.has(file)) {
    throw new Error(`Packlist missing required file: ${file}`);
  }
}

for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    throw new Error(`Packlist includes forbidden file: ${file}`);
  }
  if (/^dist\/src\/.*(?:\.js|\.d\.ts)$/.test(file)) {
    const source = file.slice("dist/".length).replace(/(?:\.js|\.d\.ts)$/, ".ts");
    if (!statSync(resolve(repoRoot, source), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(
        `Packlist includes generated file without source: ${file} (expected ${source})`,
      );
    }
  }
}

const pluginBundle = entries.find(
  (entry) => entry.path === "plugins/kibana-log-investigation/dist/mcp_entry.mjs",
);
if (process.platform !== "win32" && pluginBundle?.mode !== 0o644) {
  throw new Error(`Plugin bundle must be packaged with mode 0644. Received: ${pluginBundle?.mode}`);
}

const notices = await readFile(
  resolve(repoRoot, "plugins/kibana-log-investigation/dist/THIRD_PARTY_NOTICES.md"),
  "utf8",
);
for (const dependency of [
  "ajv@8.18.0",
  "ajv-formats@3.0.1",
  "content-type@1.0.5",
  "fast-deep-equal@3.1.3",
  "fast-uri@3.1.0",
  "json-schema-traverse@1.0.0",
]) {
  if (!notices.includes(`## ${dependency} (`)) {
    throw new Error(`Third-party notices missing bundled dependency: ${dependency}`);
  }
}

console.log("Packlist verified.");
