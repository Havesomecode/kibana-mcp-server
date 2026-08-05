import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  throw new Error("npm_execpath is unavailable; run this verifier through npm.");
}
const npmCommandOptions = {
  encoding: "utf8",
  timeout: 120_000,
  maxBuffer: 10 * 1024 * 1024,
};

const repoRoot = process.cwd();
const mcpConfigPath = resolve(repoRoot, "plugins/kibana-log-investigation/.mcp.json");
const packageJsonPath = resolve(repoRoot, "package.json");
const expectedServerPath = "dist/src/mcp_entry.js";
const expectedCliPath = "dist/src/index.js";

const raw = await readFile(mcpConfigPath, "utf8");
const config = JSON.parse(raw);
const server = config?.mcpServers?.["kibana-log-investigation"];

if (!server?.args?.length) {
  throw new Error("MCP config missing args for kibana-log-investigation.");
}

const entrypoint = resolve(repoRoot, server.args[0]);

if (!existsSync(entrypoint)) {
  throw new Error(`Expected MCP entrypoint missing: ${entrypoint}`);
}

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const packageBin = packageJson?.bin?.["kibana-mcp-server"];

if (packageJson?.main !== expectedServerPath) {
  throw new Error(
    `package.json main must be ${expectedServerPath}. Received: ${packageJson?.main}`,
  );
}

if (packageBin !== expectedCliPath) {
  throw new Error(
    `package.json bin.kibana-mcp-server must be ${expectedCliPath}. Received: ${packageBin}`,
  );
}

if (packageJson?.scripts?.start !== `node ${expectedServerPath}`) {
  throw new Error(
    `package.json start must be "node ${expectedServerPath}". Received: ${packageJson?.scripts?.start}`,
  );
}

const normalizedEntrypoint = server.args[0].replace(/^[.][\\/]/, "");
if (normalizedEntrypoint !== expectedServerPath) {
  throw new Error(`MCP config must point to ${expectedServerPath}. Received: ${server.args[0]}`);
}

const builtEntrypoint = await readFile(entrypoint, "utf8");
if (!builtEntrypoint.startsWith("#!/usr/bin/env node")) {
  throw new Error("Built package entrypoint must start with a Node shebang for npm bin execution.");
}

const cliEntrypoint = resolve(repoRoot, packageBin);
const builtCliEntrypoint = await readFile(cliEntrypoint, "utf8");
if (!builtCliEntrypoint.startsWith("#!/usr/bin/env node")) {
  throw new Error("Built CLI entrypoint must start with a Node shebang for npm bin execution.");
}

const installRoot = await mkdtemp(join(tmpdir(), "kibana-mcp-package-install-"));
try {
  const packRoot = join(installRoot, "pack");
  const consumerRoot = join(installRoot, "consumer");
  await mkdir(packRoot);
  await mkdir(consumerRoot);
  await writeFile(join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n');

  const { stdout: packOutput } = await execFileAsync(
    process.execPath,
    [npmExecPath, "pack", "--json", "--pack-destination", packRoot],
    { ...npmCommandOptions, cwd: repoRoot },
  );
  const packed = JSON.parse(packOutput)?.[0]?.filename;
  if (!packed) {
    throw new Error("npm pack did not report a package filename.");
  }

  const tarballPath = join(packRoot, packed);
  await execFileAsync(
    process.execPath,
    [npmExecPath, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
    { ...npmCommandOptions, cwd: consumerRoot },
  );
  const installedCli = join(
    consumerRoot,
    "node_modules",
    "@havesomecode",
    "kibana-mcp-server",
    expectedCliPath,
  );
  const { stdout: helpOutput } = await execFileAsync(process.execPath, [installedCli, "--help"], {
    cwd: consumerRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (!helpOutput.includes("Kibana Log Investigation")) {
    throw new Error("Installed package CLI did not render the expected help output.");
  }
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

console.log(`MCP entrypoint verified: ${entrypoint}`);
