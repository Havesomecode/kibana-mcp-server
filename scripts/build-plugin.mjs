import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repoRoot, "plugins/kibana-log-investigation");
const bundlePath = join(pluginRoot, "dist/mcp_entry.mjs");

const result = await build({
  absWorkingDir: repoRoot,
  entryPoints: ["src/mcp_entry.ts"],
  outfile: bundlePath,
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

await chmod(bundlePath, 0o644);
await copyFile(join(repoRoot, "LICENSE"), join(pluginRoot, "dist/LICENSE"));

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

const embeddedNotices = await readFile(join(repoRoot, "legal/plugin-bundled-notices.md"), "utf8");
const bundle = await readFile(bundlePath, "utf8");
const embeddedPackages = new Set();
const embeddedPackagePattern =
  /node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//g;
for (const match of bundle.matchAll(embeddedPackagePattern)) {
  const [, locator, name] = match;
  const encodedName = name.replace("/", "+");
  if (locator.startsWith(`${encodedName}@`)) {
    embeddedPackages.add(`${name}@${locator.slice(encodedName.length + 1).split("_")[0]}`);
  }
}
for (const dependency of embeddedPackages) {
  if (!embeddedNotices.includes(`## ${dependency} (`)) {
    throw new Error(`Missing bundled dependency notice: ${dependency}`);
  }
}
notices.push(embeddedNotices.trim());
await writeFile(join(pluginRoot, "dist/THIRD_PARTY_NOTICES.md"), notices.join("\n"));
console.log("Self-contained Kibana MCP plugin runtime built.");
