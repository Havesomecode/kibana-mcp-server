import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repoRoot, "plugins/kibana-log-investigation");

const result = await build({
  absWorkingDir: repoRoot,
  entryPoints: ["src/mcp_entry.ts"],
  outfile: join(pluginRoot, "dist/mcp_entry.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});

// The installed plugin has no node_modules. Carry dependency licenses with its bundle.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const marker = input.lastIndexOf("node_modules/");
  if (marker < 0) continue;
  const parts = input.slice(marker + "node_modules/".length).split("/");
  const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  packages.add(resolve(repoRoot, input.slice(0, marker), "node_modules", name));
}

const notices = [];
for (const root of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  let licenseText;
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "COPYING"]) {
    try {
      licenseText = await readFile(join(root, name), "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!licenseText) throw new Error(`Missing bundled dependency license: ${pkg.name}`);
  notices.push(`## ${pkg.name}@${pkg.version} (${pkg.license})\n\n${licenseText.trim()}\n`);
}
await writeFile(join(pluginRoot, "dist/THIRD_PARTY_NOTICES.md"), notices.join("\n"));
console.log("Self-contained Kibana MCP plugin runtime built.");
