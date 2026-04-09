import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

const required = [
  "dist/src/index.js",
  "plugins/kibana-log-investigation/.mcp.json",
  "plugins/kibana-log-investigation/.codex-plugin/plugin.json",
  "README.md",
  "LICENSE",
];

const forbiddenPrefixes = ["test/", "test\\", "config/sources.json", "config/sources.runtime.json"];

const { stdout } = await execFileAsync("npm", ["pack", "--json", "--dry-run"], {
  encoding: "utf8",
  env: {
    ...process.env,
    NPM_CONFIG_CACHE: resolve(repoRoot, ".npm-cache"),
  },
});

const result = JSON.parse(stdout);
const files = new Set(result?.[0]?.files?.map((entry) => entry.path) ?? []);

for (const file of required) {
  if (!files.has(file)) {
    throw new Error(`Packlist missing required file: ${file}`);
  }
}

for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    throw new Error(`Packlist includes forbidden file: ${file}`);
  }
}

console.log("Packlist verified.");
