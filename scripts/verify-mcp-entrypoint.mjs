import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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

  const { stdout: bootstrapHelp } = await execFileAsync(
    process.execPath,
    [installedCli, "bootstrap", "--help"],
    {
      cwd: consumerRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (!bootstrapHelp.includes("--index <pattern>")) {
    throw new Error("Installed package CLI did not expose deterministic bootstrap help.");
  }

  const installedSkill = join(
    consumerRoot,
    "node_modules",
    "@havesomecode",
    "kibana-mcp-server",
    "skills",
    "kibana-log-investigation",
    "SKILL.md",
  );
  if (!existsSync(installedSkill)) {
    throw new Error("Installed package is missing the kibana-log-investigation Agent Skill.");
  }

  if (process.platform !== "win32") {
    const fakeBin = join(installRoot, "fake-bin");
    const stateRoot = join(installRoot, "state");
    await mkdir(fakeBin);
    const credentialStubs = new Map([
      [
        "security",
        '#!/bin/sh\ncase "$1" in\n  find-generic-password) exit 44 ;;\n  add-generic-password) IFS= read -r _secret || true; exit 0 ;;\n  delete-generic-password) exit 0 ;;\n  *) exit 2 ;;\nesac\n',
      ],
      [
        "secret-tool",
        '#!/bin/sh\ncase "$1" in\n  lookup) exit 1 ;;\n  store) IFS= read -r _secret || true; exit 0 ;;\n  clear) exit 0 ;;\n  *) exit 2 ;;\nesac\n',
      ],
    ]);
    for (const [executable, stub] of credentialStubs) {
      const executablePath = join(fakeBin, executable);
      await writeFile(executablePath, stub, "utf8");
      await chmod(executablePath, 0o755);
    }

    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET") {
        response.end(
          JSON.stringify({
            fields: [
              { name: "@timestamp", type: "date", searchable: true, aggregatable: true },
              { name: "message", type: "text", searchable: true, aggregatable: false },
            ],
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          rawResponse: { hits: { total: { value: 0 }, hits: [] } },
        }),
      );
    });
    await new Promise((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Mock Kibana server did not expose a TCP port.");
      }
      const { stdout: bootstrapOutput } = await execFileAsync(
        process.execPath,
        [
          installedCli,
          "bootstrap",
          "--url",
          `http://127.0.0.1:${address.port}`,
          "--username",
          "verification-user",
          "--password-env",
          "VERIFY_KIBANA_PASSWORD",
          "--index",
          "verification-logs-*",
          "--client",
          "none",
        ],
        {
          cwd: consumerRoot,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            KIBANA_STATE_DIR: stateRoot,
            VERIFY_KIBANA_PASSWORD: "verification-secret",
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          },
        },
      );
      if (!bootstrapOutput.includes("Bootstrap verified for profile 'default'.")) {
        throw new Error("Installed package did not complete prompt-free bootstrap.");
      }
      const savedProfiles = JSON.parse(await readFile(join(stateRoot, "profiles.json"), "utf8"));
      const sourcePath = savedProfiles.profiles?.[0]?.sourceCatalogPath;
      if (!sourcePath || !existsSync(sourcePath)) {
        throw new Error(
          "Installed package bootstrap did not persist its generated source catalog.",
        );
      }
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

console.log(`MCP entrypoint verified: ${entrypoint}`);
