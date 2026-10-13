import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { type ServerResponse, createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerRequestHTTPServerTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toProfileKey } from "../../src/profiles/names.js";
import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import { type HttpServerHandle, startHttpMcpServer } from "../../src/transports/http.js";
import { PROTOCOL_VERSION, callTool, requestMeta, sendRpc, source, sourceIds } from "./helpers.js";

const queryMessage = {
  id: 1,
  method: "tools/call",
  params: {
    name: "query",
    arguments: {
      source_ids: ["orders"],
      start_time: "2026-04-02T12:00:00Z",
      end_time: "2026-04-02T12:05:00Z",
      mode: "count",
    },
  },
};

// Answers the two Kibana calls configure_index makes: field discovery, then a probe search.
async function startFakeKibana(
  onSearch?: (response: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (onSearch && !request.url?.includes("fields_for_wildcard")) {
        onSearch(response);
        return;
      }
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

  function postRpc(
    message: Record<string, unknown>,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    return sendRpc(
      handle?.url ?? "",
      message,
      { Authorization: "Bearer gateway-secret", "X-Profile": "alice", ...headers },
      signal,
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

  it.each([
    { Host: "attacker.example" },
    { Origin: "http://attacker.example" },
    { Origin: "null" },
  ])("rejects tokenless loopback requests with untrusted headers %j", async (headers) => {
    await writeCatalog("alice", ["orders"]);
    handle = await startHttpMcpServer(
      { ...env, KIBANA_HTTP_AUTH_TOKEN: "" },
      { port: 0, profileHeader: "x-profile" },
    );
    const status = await new Promise<number>((resolveStatus, rejectStatus) => {
      const request = httpRequest(
        handle?.url ?? "",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-Profile": "alice",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "Mcp-Method": "tools/call",
            "Mcp-Name": "discover",
            ...headers,
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolveStatus(response.statusCode ?? 0));
        },
      );
      request.on("error", rejectStatus);
      request.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "discover", arguments: {}, _meta: requestMeta },
        }),
      );
    });
    expect(status).toBe(403);
  });

  it("refuses unsafe or incoherent listen configurations", async () => {
    await expect(
      startHttpMcpServer({ ...env, KIBANA_HTTP_AUTH_TOKEN: "" }, { port: 0, host: "0.0.0.0" }),
    ).rejects.toThrow("Refusing to listen on non-loopback host");
    await expect(
      startHttpMcpServer({}, { port: 0 }, { startupConfiguration: { close: async () => {} } }),
    ).rejects.toThrow("No saved Kibana connection is available");
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

  it("rejects the old session flow without allocating sessions and serves modern requests", async () => {
    await writeCatalog("alice", ["orders"]);
    handle = await startHttpMcpServer(env, { port: 0, profileHeader: "x-profile" });
    const headers = {
      Authorization: "Bearer gateway-secret",
      "X-Profile": "alice",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    for (const message of [
      {
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "http-test", version: "1.0.0" },
        },
      },
      { id: 1, method: "tools/call", params: { name: "discover", arguments: {} } },
    ]) {
      const response = await fetch(handle.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      expect((await response.json()).error.code).toBe(-32022);
    }
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(handle.url, {
        method,
        headers: { ...headers, "Mcp-Session-Id": "unknown" },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      await response.text();
    }
    const listed = await postRpc({ id: 2, method: "tools/list" });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("mcp-session-id")).toBeNull();
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "discover",
    );
    expect(sourceIds((await callTool(handle.url, "discover", headers)).result)).toEqual(["orders"]);
  });

  it("cancels backend work when a modern request disconnects before a response", async () => {
    let backend: ServerResponse | undefined;
    const kibana = await startFakeKibana((response) => {
      backend = response;
    });
    const controller = new AbortController();
    let pending: Promise<Response | undefined> | undefined;
    try {
      await writeCatalog("alice", ["orders"]);
      handle = await startHttpMcpServer(
        { ...env, KIBANA_BASE_URL: kibana.url },
        { port: 0, profileHeader: "x-profile" },
      );
      pending = postRpc(queryMessage, {}, controller.signal).catch(() => undefined);
      await vi.waitFor(() => expect(backend).toBeDefined());
      controller.abort();
      await pending;
      await vi.waitFor(() => expect(backend?.destroyed).toBe(true));
      expect((await postRpc({ id: 2, method: "tools/list" })).status).toBe(200);
    } finally {
      controller.abort();
      await pending;
      backend?.destroy();
      await kibana.close();
    }
  });

  it("cleans up a modern SSE response disconnected before stream attachment", async () => {
    const original = PerRequestHTTPServerTransport.prototype.handleMessage;
    const requests = vi.spyOn(PerRequestHTTPServerTransport.prototype, "handleMessage");
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const controller = new AbortController();
    let resume: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let arrived = false;
    let backend: ServerResponse | undefined;
    const kibana = await startFakeKibana((response) => {
      backend = response;
    });
    let pending: Promise<Response | undefined> | undefined;
    try {
      await writeCatalog("alice", ["orders"]);
      handle = await startHttpMcpServer(
        { ...env, KIBANA_BASE_URL: kibana.url },
        { port: 0, profileHeader: "x-profile" },
      );
      requests.mockImplementationOnce(async function (
        this: PerRequestHTTPServerTransport,
        message,
        extra,
      ) {
        const response = await original.call(this, message, extra);
        arrived = true;
        await paused;
        return response;
      });
      pending = postRpc(queryMessage, {}, controller.signal).catch(() => undefined);
      await vi.waitFor(() => expect(backend).toBeDefined());
      const transport = requests.mock.contexts[0] as PerRequestHTTPServerTransport;
      await transport.send(
        {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: 1, progress: 0 },
        },
        { relatedRequestId: 1 },
      );
      await vi.waitFor(() => expect(arrived).toBe(true));
      const timer = interval.mock.results.at(-1)?.value;
      expect(timer).toBeDefined();
      const request = requests.mock.lastCall?.[1]?.request;
      controller.abort();
      await pending;
      await vi.waitFor(() => expect(request?.signal.aborted).toBe(true));
      await vi.waitFor(() => expect(backend?.destroyed).toBe(true));
      resume();
      await vi.waitFor(() => expect(clear).toHaveBeenCalledWith(timer));
    } finally {
      controller.abort();
      resume();
      await pending;
      backend?.destroy();
      await kibana.close();
      requests.mockRestore();
      interval.mockRestore();
      clear.mockRestore();
    }
  });

  it.each(["cancelled", "completed"])(
    "releases %s modern streams without disturbing identical request IDs in another profile",
    async (outcome) => {
      const requests = vi.spyOn(PerRequestHTTPServerTransport.prototype, "handleMessage");
      const interval = vi.spyOn(globalThis, "setInterval");
      const clear = vi.spyOn(globalThis, "clearInterval");
      const backends: ServerResponse[] = [];
      const controllers: AbortController[] = [];
      const kibana = await startFakeKibana((response) => backends.push(response));
      try {
        await writeCatalog("alice", ["orders"]);
        await writeCatalog("bob", ["payments"]);
        handle = await startHttpMcpServer(
          { ...env, KIBANA_BASE_URL: kibana.url },
          { port: 0, profileHeader: "x-profile" },
        );
        const query = async (profile: string, sourceId: string) => {
          const controller = new AbortController();
          controllers.push(controller);
          const pending = postRpc(
            {
              ...queryMessage,
              params: {
                ...queryMessage.params,
                arguments: { ...queryMessage.params.arguments, source_ids: [sourceId] },
              },
            },
            { "X-Profile": profile },
            controller.signal,
          );
          await vi.waitFor(() => expect(backends).toHaveLength(controllers.length));
          const transport = requests.mock.contexts.at(-1) as PerRequestHTTPServerTransport;
          const request = requests.mock.lastCall?.[1]?.request;
          await transport.send(
            {
              jsonrpc: "2.0",
              method: "notifications/progress",
              params: { progressToken: 1, progress: 0 },
            },
            { relatedRequestId: 1 },
          );
          const timer = interval.mock.results.at(-1)?.value;
          expect(timer).toBeDefined();
          const response = await pending;
          expect(response.status).toBe(200);
          return { controller, request, timer, response };
        };
        const sibling = await query("bob", "payments");
        const siblingBody = sibling.response.text().catch(() => "");
        for (let count = 0; count < 3; count += 1) {
          const current = await query("alice", "orders");
          const body = current.response.text().catch(() => "");
          if (outcome === "completed") {
            backends
              .at(-1)
              ?.end(JSON.stringify({ rawResponse: { hits: { total: { value: 0 } } } }));
            expect(await body).toContain('"id":1');
          } else {
            // A separate notification cannot cancel another stateless exchange.
            const cancellation = await postRpc({
              method: "notifications/cancelled",
              params: { requestId: 1 },
            });
            await cancellation.text();
            expect(backends.at(-1)?.destroyed).toBe(false);
            current.controller.abort();
            await body;
            await vi.waitFor(() => expect(backends.at(-1)?.destroyed).toBe(true));
          }
          await vi.waitFor(() => expect(current.request?.signal.aborted).toBe(true));
          expect(clear).toHaveBeenCalledWith(current.timer);
          expect(clear).not.toHaveBeenCalledWith(sibling.timer);
          expect(backends[0].destroyed).toBe(false);
        }
        backends[0].end(JSON.stringify({ rawResponse: { hits: { total: { value: 0 } } } }));
        expect(await siblingBody).toContain('"id":1');
        await vi.waitFor(() => expect(clear).toHaveBeenCalledWith(sibling.timer));
        expect(
          sourceIds(
            (
              await callTool(handle.url, "discover", {
                Authorization: "Bearer gateway-secret",
                "X-Profile": "alice",
              })
            ).result,
          ),
        ).toEqual(["orders"]);
      } finally {
        for (const controller of controllers) controller.abort();
        for (const backend of backends) backend.destroy();
        await kibana.close();
        requests.mockRestore();
        interval.mockRestore();
        clear.mockRestore();
      }
    },
  );

  it("keeps backend deadlines on modern tool calls", async () => {
    let backend: ServerResponse | undefined;
    const kibana = await startFakeKibana((response) => {
      backend = response;
    });
    try {
      await writeCatalog("alice", ["orders"]);
      handle = await startHttpMcpServer(
        { ...env, KIBANA_BASE_URL: kibana.url, KIBANA_TIMEOUT_MS: "100" },
        { port: 0, profileHeader: "x-profile" },
      );
      const response = await postRpc(queryMessage);
      expect(response.status).toBe(200);
      expect((await response.json()).result).toMatchObject({
        isError: true,
        _meta: { kibana_request_error: { code: "KIBANA_TIMEOUT", timeout_ms: 100 } },
      });
      await vi.waitFor(() => expect(backend?.destroyed).toBe(true));
    } finally {
      backend?.destroy();
      await kibana.close();
    }
  });

  it("cancels active modern backend work on server close", async () => {
    let backend: ServerResponse | undefined;
    const kibana = await startFakeKibana((response) => {
      backend = response;
    });
    const controller = new AbortController();
    let pending: Promise<Response | undefined> | undefined;
    try {
      await writeCatalog("alice", ["orders"]);
      handle = await startHttpMcpServer(
        { ...env, KIBANA_BASE_URL: kibana.url },
        { port: 0, profileHeader: "x-profile" },
      );
      pending = postRpc(queryMessage, {}, controller.signal).catch(() => undefined);
      await vi.waitFor(() => expect(backend).toBeDefined());
      await handle.close();
      handle = undefined;
      await pending;
      await vi.waitFor(() => expect(backend?.destroyed).toBe(true));
    } finally {
      controller.abort();
      await pending;
      backend?.destroy();
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
