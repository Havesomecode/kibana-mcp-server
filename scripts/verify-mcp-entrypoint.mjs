import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

console.log(`MCP entrypoint verified: ${entrypoint}`);
