import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toProfileKey } from "../../src/profiles/names.js";
import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import { type HttpServerHandle, startHttpMcpServer } from "../../src/transports/http.js";
import { callTool, source, sourceIds } from "./helpers.js";

// Answers the two Kibana calls configure_index makes: field discovery, then a probe search.
async function startFakeKibana(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          request.url?.includes("fields_for_wildcard")
            ? {
                fields: [
                  { name: "@timestamp", type: "date", searchable: true, aggregatable: true },
                  { name: "message", type: "string", esTypes: ["text"], searchable: true },
                ],
              }
            : { rawResponse: { hits: { hits: [] } } },
        ),
      );
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}

describe("startHttpMcpServer", () => {
  let directory: string;
  let handle: HttpServerHandle | undefined;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-http-"));
    env = {
      KIBANA_BASE_URL: "https://kibana.example.com",
      KIBANA_USERNAME: "elastic",
      KIBANA_PASSWORD: "secret",
      KIBANA_SOURCE_CATALOG_PATH: join(directory, "{profile}", "sources.json"),
      KIBANA_HTTP_AUTH_TOKEN: "gateway-secret",
    };
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  async function writeCatalog(profile: string, ids: string[]): Promise<void> {
    await mkdir(join(directory, toProfileKey(profile)), { recursive: true });
    await writeFile(
      join(directory, toProfileKey(profile), "sources.json"),
      JSON.stringify(createGeneratedCatalog(ids.map(source))),
    );
  }

  it("serves each caller the catalog of the profile carried by the trusted header", async () => {
    await writeCatalog("alice", ["orders"]);
    await writeCatalog("bob@example.com", ["payments"]);
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "X-Profile" });
    const authorization = { Authorization: "Bearer gateway-secret" };

    const alice = await callTool(handle.url, "discover", {
      ...authorization,
      "X-Profile": "alice",
    });
    const bob = await callTool(handle.url, "discover", {
      ...authorization,
      "X-Profile": "bob@example.com",
    });
    const newcomer = await callTool(handle.url, "discover", {
      ...authorization,
      "X-Profile": "carol",
    });

    expect(sourceIds(alice.result)).toEqual(["orders"]);
    expect(sourceIds(bob.result)).toEqual(["payments"]);
    expect(sourceIds(newcomer.result)).toEqual([]);
  });

  it("keeps the catalogs of identities that differ only by case apart", async () => {
    await writeCatalog("alice", ["lowercase"]);
    await writeCatalog("Alice", ["uppercase"]);
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "x-profile" });
    const discover = async (profile: string) =>
      sourceIds(
        (
          await callTool(handle?.url ?? "", "discover", {
            Authorization: "Bearer gateway-secret",
            "X-Profile": profile,
          })
        ).result,
      );

    // Whichever identity calls first, each one keeps reading its own catalog.
    expect(await discover("Alice")).toEqual(["uppercase"]);
    expect(await discover("alice")).toEqual(["lowercase"]);
    expect(await discover("Alice")).toEqual(["uppercase"]);
  });

  it("rejects calls without the shared token or without the profile header", async () => {
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "x-profile" });

    expect((await callTool(handle.url, "discover", { "X-Profile": "alice" })).status).toBe(401);
    expect(
      (
        await callTool(handle.url, "discover", {
          Authorization: "Bearer wrong",
          "X-Profile": "alice",
        })
      ).status,
    ).toBe(401);
    expect(
      (await callTool(handle.url, "discover", { Authorization: "Bearer gateway-secret" })).status,
    ).toBe(401);
  });

  it("refuses unsafe or incoherent listen configurations", async () => {
    await expect(
      startHttpMcpServer({ ...env, KIBANA_HTTP_AUTH_TOKEN: "" }, { port: 0, host: "0.0.0.0" }),
    ).rejects.toThrow("Refusing to listen on non-loopback host");
    await expect(
      startHttpMcpServer({}, { port: 0 }, { startupConfiguration: { close: async () => {} } }),
    ).rejects.toThrow("needs a profile header, or a default profile");
    // Per-profile catalogs without a header would hand every caller the same catalog.
    await expect(startHttpMcpServer(env, { port: 0 })).rejects.toThrow(
      "needs a profile header, or a default profile",
    );
    await writeFile(
      join(directory, "sources.json"),
      JSON.stringify(createGeneratedCatalog([source("orders")])),
    );
    await expect(
      startHttpMcpServer(
        { ...env, KIBANA_SOURCE_CATALOG_PATH: join(directory, "sources.json") },
        { port: 0, profileHeader: "x-profile" },
      ),
    ).rejects.toThrow("A profile header requires named profiles");
  });

  it("validates the port, the path and the profile header name", async () => {
    const start = (overrides: NodeJS.ProcessEnv, options = {}) =>
      startHttpMcpServer({ ...env, ...overrides }, options);

    await expect(start({ KIBANA_HTTP_PORT: "http" })).rejects.toThrow(
      "HTTP port must be an integer",
    );
    await expect(start({}, { port: 70000 })).rejects.toThrow("HTTP port must be an integer");
    await expect(start({ KIBANA_HTTP_PATH: "mcp" }, { port: 0 })).rejects.toThrow(
      "HTTP path must start with '/'",
    );
    await expect(start({}, { port: 0, path: "/healthz" })).rejects.toThrow("differ from /healthz");
    await expect(start({}, { port: 0, profileHeader: "x profile" })).rejects.toThrow(
      "must be a valid HTTP header name",
    );
    await expect(
      start({ KIBANA_HTTP_PROFILE_HEADER: "Authorization" }, { port: 0 }),
    ).rejects.toThrow("must not be 'authorization'");
  });

  it("fails to start when the port is already taken", async () => {
    const options = { profileHeader: "x-profile" };
    handle = await startHttpMcpServer(env, { ...options, port: 0 });
    const port = Number(new URL(handle.url).port);

    await expect(startHttpMcpServer(env, { ...options, port })).rejects.toThrow("EADDRINUSE");
  });

  it("reads its listen options from the environment and serves the default profile without header", async () => {
    await writeCatalog("team", ["orders"]);
    handle = await startHttpMcpServer({
      ...env,
      KIBANA_PROFILE: "team",
      KIBANA_HTTP_HOST: "::1",
      KIBANA_HTTP_PORT: "0",
      KIBANA_HTTP_PATH: "/kibana",
    });

    expect(handle.url).toMatch(/^http:\/\/\[::1\]:\d+\/kibana$/);
    const result = await callTool(handle.url, "discover", {
      Authorization: "bearer gateway-secret",
    });
    expect(sourceIds(result.result)).toEqual(["orders"]);
  });

  it("answers health checks without credentials and hides every other path", async () => {
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "x-profile" });
    const origin = new URL(handle.url).origin;

    const health = await fetch(`${origin}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await fetch(`${origin}/healthz`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${origin}/other`)).status).toBe(404);
    expect((await fetch(`${origin}/mcp/extra`)).status).toBe(404);

    const unauthenticated = await fetch(handle.url, { method: "POST", body: "{}" });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects oversized bodies, oversized profiles and unsupported methods", async () => {
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "x-profile" });
    const headers = { Authorization: "Bearer gateway-secret", "X-Profile": "alice" };

    const oversized = await fetch(handle.url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "x".repeat(4 * 1024 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);

    const longProfile = await callTool(handle.url, "discover", {
      ...headers,
      "X-Profile": "a".repeat(300),
    });
    expect(longProfile.status).toBe(400);

    const get = await fetch(handle.url, { headers });
    expect(get.status).toBeGreaterThanOrEqual(400);
    expect(get.status).toBeLessThan(500);
  });

  it("creates the catalog of a new profile through configure_index and keeps it isolated", async () => {
    const kibana = await startFakeKibana();
    try {
      handle = await startHttpMcpServer(
        { ...env, KIBANA_BASE_URL: kibana.url },
        { port: 0, profileHeader: "x-profile" },
      );
      const headers = { Authorization: "Bearer gateway-secret", "X-Profile": "alice" };

      const configured = await callTool(handle.url, "configure_index", headers, {
        index: "orders-*",
      });
      expect(configured.result?.isError).toBeFalsy();
      expect(configured.result?.structuredContent).toMatchObject({
        source_id: "orders",
        source_catalog_path: join(directory, "alice", "sources.json"),
      });

      expect(sourceIds((await callTool(handle.url, "discover", headers)).result)).toEqual([
        "orders",
      ]);
      expect(
        sourceIds(
          (await callTool(handle.url, "discover", { ...headers, "X-Profile": "bob" })).result,
        ),
      ).toEqual([]);
    } finally {
      await kibana.close();
    }
  });
});

describe("configuration file", () => {
  let directory: string;
  let handle: HttpServerHandle | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-config-"));
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it("supplies the connection, the HTTP options and a custom store built from storeOptions", async () => {
    const configPath = join(directory, "kibana.mcp.config.mjs");
    await writeFile(
      configPath,
      `
      const catalogs = new Map();
      globalThis.__kibanaMcpTestStore = { catalogs, closed: false };
      export default {
        url: "https://kibana.example.com",
        user: "elastic",
        password: "secret",
        http: { port: 0, profileHeader: "x-profile" },
        storeOptions: { prefix: "team:" },
        store: ({ prefix }) => ({
          describe: (key) => "memory://" + prefix + key,
          read: async (key) => catalogs.get(prefix + key),
          replace: async (key, expected, next) => { catalogs.set(prefix + key, next); },
          close: async () => { globalThis.__kibanaMcpTestStore.closed = true; },
        }),
      };
      `,
    );
    const state = () =>
      (
        globalThis as unknown as {
          __kibanaMcpTestStore: { catalogs: Map<string, string>; closed: boolean };
        }
      ).__kibanaMcpTestStore;

    handle = await startHttpMcpServer({ KIBANA_MCP_CONFIG: configPath });
    expect(
      sourceIds((await callTool(handle.url, "discover", { "X-Profile": "alice" })).result),
    ).toEqual([]);

    // Another process sharing the store adds a source: the next call sees it.
    state().catalogs.set("team:alice", JSON.stringify(createGeneratedCatalog([source("orders")])));
    expect(
      sourceIds((await callTool(handle.url, "discover", { "X-Profile": "alice" })).result),
    ).toEqual(["orders"]);
    expect(
      sourceIds((await callTool(handle.url, "discover", { "X-Profile": "bob" })).result),
    ).toEqual([]);

    await handle.close();
    handle = undefined;
    expect(state().closed).toBe(true);
  });
});
