import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Build on the development host; the Mac needs only its existing Node and Python.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = process.argv[2];
if (!outfile) throw new Error("Supply an output bundle path.");
await build({
  absWorkingDir: root,
  entryPoints: ["scripts/verify-macos-keychain.mjs"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
console.log("Built current native check.");
