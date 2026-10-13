import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import { startMcpServer } from "../../src/transports/stdio.js";
import { source, sourceIds } from "./helpers.js";

type JsonRpcMessage = { id?: number; result?: Record<string, unknown>; error?: unknown };

const transports = vi.hoisted(() => ({
  instances: [] as Array<{
    onmessage?: (message: unknown) => void;
    sent: unknown[];
  }>,
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  StdioServerTransport: class {
    onmessage?: (message: unknown) => void;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    sent: unknown[] = [];

    constructor() {
      transports.instances.push(this);
    }

    async start() {}

    async send(message: unknown) {
      this.sent.push(message);
    }

    async close() {}
  },
}));

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const callDiscover = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "discover", arguments: {} },
};
const listTools = { jsonrpc: "2.0", id: 3, method: "tools/list" };

const sourceIdsOf = (message: JsonRpcMessage | undefined) => sourceIds(message?.result);

function toolNamesOf(message: JsonRpcMessage | undefined): string[] {
  return ((message?.result?.tools as Array<{ name: string }>) ?? [])
    .map((tool) => tool.name)
    .sort();
}

async function exchange(messages: unknown[]): Promise<Map<number, JsonRpcMessage>> {
  const transport = transports.instances.at(-1);
  if (!transport) throw new Error("The stdio transport was not created.");
  for (const message of messages) {
    transport.onmessage?.(message);
  }
  const expected = messages.filter((message) => (message as { id?: number }).id !== undefined);
  await vi.waitFor(() => expect(transport.sent.length).toBeGreaterThanOrEqual(expected.length));
  return new Map((transport.sent as JsonRpcMessage[]).map((message) => [message.id ?? 0, message]));
}

describe("startMcpServer", () => {
  let directory: string;

  beforeEach(async () => {
    transports.instances.length = 0;
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-stdio-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("serves the single catalog of an environment connection", async () => {
    const catalogPath = join(directory, "sources.json");
    await writeFile(catalogPath, JSON.stringify(createGeneratedCatalog([source("orders")])));

    await startMcpServer({
      KIBANA_BASE_URL: "https://kibana.example.com",
      KIBANA_USERNAME: "elastic",
      KIBANA_PASSWORD: "secret",
      KIBANA_SOURCE_CATALOG_PATH: catalogPath,
    });
    const responses = await exchange([initialize, initialized, callDiscover, listTools]);

    expect(sourceIdsOf(responses.get(2))).toEqual(["orders"]);
    expect(toolNamesOf(responses.get(3))).toEqual([
      "configure_index",
      "describe_fields",
      "discover",
      "filter",
      "query",
    ]);
  });

  it("serves the default profile of the store declared in a configuration file", async () => {
    const configPath = join(directory, "kibana.mcp.config.mjs");
    await writeFile(
      configPath,
      `
      const catalogs = new Map(${JSON.stringify([
        ["default", JSON.stringify(createGeneratedCatalog([source("payments")]))],
        ["staging", JSON.stringify(createGeneratedCatalog([source("staging-logs")]))],
      ])});
      export default () => ({
        url: "https://kibana.example.com",
        user: "elastic",
        password: "secret",
        store: { read: async (key) => catalogs.get(key), replace: async () => {} },
      });
      `,
    );

    await startMcpServer({ KIBANA_MCP_CONFIG: configPath });
    expect(sourceIdsOf((await exchange([initialize, initialized, callDiscover])).get(2))).toEqual([
      "payments",
    ]);

    await startMcpServer({ KIBANA_MCP_CONFIG: configPath, KIBANA_PROFILE: "staging" });
    expect(sourceIdsOf((await exchange([initialize, initialized, callDiscover])).get(2))).toEqual([
      "staging-logs",
    ]);
  });
});

describe("serve over stdio, as a real process", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-stdio-process-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("answers MCP requests on stdout using a configuration file and its store", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../..");
    const configPath = join(directory, "kibana.mcp.config.mjs");
    const sqliteStore = pathToFileURL(join(repositoryRoot, "src/stores/sqlite.ts")).href;
    const databasePath = join(directory, "catalogs.sqlite");
    await writeFile(
      configPath,
      `
      import store from ${JSON.stringify(sqliteStore)};
      export default {
        url: "https://kibana.example.com",
        user: "elastic",
        password: "secret",
        store,
        storeOptions: { path: ${JSON.stringify(databasePath)} },
      };
      `,
    );
    // Seed the catalog the way another process sharing the database would.
    const { default: sqliteCatalogStore } = await import("../../src/stores/sqlite.js");
    const seed = await sqliteCatalogStore({ path: databasePath });
    await seed.replace(
      "default",
      undefined,
      JSON.stringify(createGeneratedCatalog([source("orders")])),
    );
    await seed.close?.();

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        join(repositoryRoot, "src/bin/kibana-mcp-server.ts"),
        "serve",
        "--config",
        configPath,
      ],
      { cwd: repositoryRoot, env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
    );
    const stderr: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));

    try {
      const responses = new Map<number, JsonRpcMessage>();
      const lines = createInterface({ input: child.stdout });
      const done = new Promise<void>((resolveDone, rejectDone) => {
        lines.on("line", (line) => {
          const message = JSON.parse(line) as JsonRpcMessage;
          if (message.id !== undefined) responses.set(message.id, message);
          if (responses.has(2)) resolveDone();
        });
        child.once("exit", (code) =>
          rejectDone(new Error(`Server exited with code ${code}: ${stderr.join("")}`)),
        );
      });
      for (const message of [initialize, initialized, callDiscover]) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
      await done;

      expect(sourceIdsOf(responses.get(2))).toEqual(["orders"]);
    } finally {
      child.removeAllListeners("exit");
      child.kill();
    }
  }, 20_000);
});
