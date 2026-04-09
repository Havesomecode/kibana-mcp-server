import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
const readText = (path) => readFileSync(resolve(repoRoot, path), "utf8");

const pkg = readJson("package.json");
const releaseConfig = readJson(".releaserc.json");
const releaseWorkflow = readText(".github/workflows/release.yml");
const semanticWorkflow = readText(".github/workflows/semantic-commits.yml");

if (pkg.name !== "@havesomecode/kibana-mcp-server") {
  throw new Error(`Unexpected package name: ${pkg.name}`);
}

if (pkg.scripts?.release !== "semantic-release") {
  throw new Error("package.json must expose `npm run release` via semantic-release.");
}

if (pkg.scripts?.["verify:release-contract"] !== "node scripts/verify-release-contract.mjs") {
  throw new Error("package.json must expose verify:release-contract.");
}

if (!pkg.scripts?.verify?.includes("npm run verify:release-contract")) {
  throw new Error("npm run verify must include verify:release-contract.");
}

if ("changeset" in (pkg.scripts ?? {})) {
  throw new Error("package.json must not keep Changesets scripts after the release migration.");
}

if ("@changesets/cli" in (pkg.devDependencies ?? {})) {
  throw new Error("package.json must not depend on @changesets/cli after the release migration.");
}

if (pkg.files?.includes("CHANGELOG.md")) {
  throw new Error("CHANGELOG.md must not be part of the published artifact surface.");
}

if (JSON.stringify(releaseConfig.branches) !== JSON.stringify(["master"])) {
  throw new Error("semantic-release must target master.");
}

if (releaseConfig.tagFormat !== "v${version}") {
  throw new Error("semantic-release must tag releases as v${version}.");
}

const pluginNames = releaseConfig.plugins.map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin,
);
const expectedPlugins = [
  "@semantic-release/commit-analyzer",
  "@semantic-release/release-notes-generator",
  "@semantic-release/npm",
  "@semantic-release/github",
];
if (JSON.stringify(pluginNames) !== JSON.stringify(expectedPlugins)) {
  throw new Error("semantic-release plugins do not match the expected publish contract.");
}

if (!releaseWorkflow.includes("id-token: write")) {
  throw new Error("release workflow must keep id-token: write for npm trusted publishing.");
}

if (!releaseWorkflow.includes("contents: write")) {
  throw new Error(
    "release workflow must keep contents: write for Git tag and GitHub Release creation.",
  );
}

if (!releaseWorkflow.includes("npm run verify")) {
  throw new Error("release workflow must verify before publishing.");
}

if (!releaseWorkflow.includes("npm run release")) {
  throw new Error("release workflow must run npm run release.");
}

if (releaseWorkflow.includes("changesets/action")) {
  throw new Error("release workflow must not invoke Changesets.");
}

if (!semanticWorkflow.includes("pull_request:")) {
  throw new Error("semantic input workflow must validate pull requests.");
}

if (!semanticWorkflow.includes("commitlint")) {
  throw new Error("semantic input workflow must validate PR titles with commitlint.");
}

const removedPaths = [
  ".changeset/config.json",
  ".changeset/README.md",
  ".changeset/eight-radios-admire.md",
  ".changeset/forty-deers-unite.md",
];
for (const path of removedPaths) {
  if (existsSync(resolve(repoRoot, path))) {
    throw new Error(`${path} must be removed after the semantic-release migration.`);
  }
}

console.log("Release contract verified.");
