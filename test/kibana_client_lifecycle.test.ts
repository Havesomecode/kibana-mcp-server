import { type Server, createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it } from "vitest";

import { KibanaClient } from "../src/kibana_client.js";
import type { CompiledSourceQuery, SourceDefinition } from "../src/types.js";

const source: SourceDefinition = {
  id: "app-logs",
  name: "Application logs",
  tags: ["application"],
  timeField: "@timestamp",
  backend: {
    kind: "kibana_internal_search_es",
    path: "/internal/search/es",
    index: "app-logs-*",
  },
  schema: {
    kind: "kibana_data_views_fields",
    path: "/api/data_views/fields_for_wildcard",
    index: "app-logs-*",
  },
  fieldHints: [],
  defaultTextFields: ["message"],
  evidenceFields: [],
};

const compiledQuery: CompiledSourceQuery = {
  source,
  resolvedFilters: [],
  resolvedNestedFilters: [],
  resolvedSortBy: "@timestamp",
  advisories: [],
  request: { body: { size: 0 } },
};

interface StalledBackend {
  baseUrl: string;
  requestCount: number;
  abortedRequestCount: number;
  readonly activeRequestCount: number;
  readonly liveSocketCount: number;
  recover: () => void;
  close: () => Promise<void>;
}

const backends: Array<{ close: () => Promise<void> }> = [];

async function createStalledBackend(
  options: { sendHeaders?: boolean } = {},
): Promise<StalledBackend> {
  const sockets = new Set<Socket>();
  let recovered = false;
  let activeRequests = 0;
  const backend: StalledBackend = {
    baseUrl: "",
    requestCount: 0,
    abortedRequestCount: 0,
    get activeRequestCount() {
      return activeRequests;
    },
    get liveSocketCount() {
      return sockets.size;
    },
    recover: () => {
      recovered = true;
    },
    close: async () => {},
  };
  const server: Server = createServer((request, response) => {
    backend.requestCount += 1;
    activeRequests += 1;
    request.on("close", () => {
      activeRequests -= 1;
    });
    if (recovered) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          rawResponse: {
            hits: { total: { value: 0 }, hits: [] },
          },
        }),
      );
      return;
    }
    if (options.sendHeaders) {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    }
    request.on("aborted", () => {
      backend.abortedRequestCount += 1;
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  backend.baseUrl = `http://127.0.0.1:${address.port}`;
  backend.close = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
  backends.push(backend);
  return backend;
}

async function createRespondingBackend(
  status: number,
  body: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const backend = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  backends.push(backend);
  return backend;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()));
});

describe("KibanaClient request lifecycle", () => {
  it("aborts a stalled backend request when the caller cancels", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 2000,
    });
    const controller = new AbortController();
    const execution = client.execute(compiledQuery, controller.signal);

    await waitFor(() => backend.requestCount === 1);
    controller.abort("client cancelled");

    await expect(execution).rejects.toMatchObject({
      code: "KIBANA_CANCELLED",
      phase: "request",
    });
    await waitFor(() => backend.abortedRequestCount === 1);
    await waitFor(() => backend.activeRequestCount === 0);
  });

  it("aborts stalled schema discovery when the caller cancels", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 2000,
    });
    const controller = new AbortController();
    const discovery = client.describeFields(source, controller.signal);

    await waitFor(() => backend.requestCount === 1);
    controller.abort("client cancelled");

    await expect(discovery).rejects.toMatchObject({
      code: "KIBANA_CANCELLED",
      phase: "request",
      sourceId: "app-logs",
    });
    await waitFor(() => backend.abortedRequestCount === 1);
    await waitFor(() => backend.activeRequestCount === 0);
  });

  it("classifies a stalled backend request as a bounded timeout", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 100,
    });
    const execution = client.execute(compiledQuery);

    await expect(execution).rejects.toMatchObject({
      name: "KibanaRequestError",
      code: "KIBANA_TIMEOUT",
      phase: "request",
      sourceId: "app-logs",
      timeoutMs: 100,
    });
    await waitFor(() => backend.activeRequestCount === 0);
  });

  it("times out while reading a stalled response body", async () => {
    const backend = await createStalledBackend({ sendHeaders: true });
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 1000,
    });

    await expect(client.execute(compiledQuery)).rejects.toMatchObject({
      code: "KIBANA_TIMEOUT",
      phase: "response",
      sourceId: "app-logs",
      timeoutMs: 1000,
    });
    await waitFor(() => backend.activeRequestCount === 0);
  });

  it("releases sockets across repeated timeouts before backend recovery", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 100,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(client.execute(compiledQuery)).rejects.toMatchObject({
        code: "KIBANA_TIMEOUT",
      });
      await waitFor(() => backend.activeRequestCount === 0);
      expect(backend.liveSocketCount).toBeLessThanOrEqual(1);
    }

    backend.recover();
    await expect(client.execute(compiledQuery)).resolves.toMatchObject({
      source: { id: "app-logs" },
    });
    expect(backend.requestCount).toBe(4);
  });

  it("succeeds after a stalled backend recovers", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 300,
    });

    await expect(client.execute(compiledQuery)).rejects.toMatchObject({
      code: "KIBANA_TIMEOUT",
    });
    backend.recover();

    await expect(client.execute(compiledQuery)).resolves.toMatchObject({
      source: { id: "app-logs" },
      rawResponse: { hits: { total: { value: 0 }, hits: [] } },
    });
    expect(backend.requestCount).toBe(2);
  });

  it("classifies authentication failures with an HTTP status", async () => {
    const backend = await createRespondingBackend(401, JSON.stringify({ error: "unauthorized" }));
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 500,
    });

    await expect(client.execute(compiledQuery)).rejects.toMatchObject({
      code: "KIBANA_AUTHENTICATION",
      phase: "response",
      sourceId: "app-logs",
      status: 401,
    });
  });

  it("classifies malformed backend payloads as response failures", async () => {
    const backend = await createRespondingBackend(200, "not-json");
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 500,
    });

    await expect(client.execute(compiledQuery)).rejects.toMatchObject({
      code: "KIBANA_RESPONSE",
      phase: "response",
      sourceId: "app-logs",
    });
  });

  it("classifies malformed successful schema responses as response failures", async () => {
    const backend = await createRespondingBackend(200, JSON.stringify({ unexpected: true }));
    const client = new KibanaClient({
      baseUrl: backend.baseUrl,
      username: "elastic",
      password: "secret",
      timeoutMs: 500,
    });

    await expect(client.describeFields(source)).rejects.toMatchObject({
      code: "KIBANA_RESPONSE",
      phase: "response",
      sourceId: "app-logs",
    });
  });

  it("bounds concurrency and times out while waiting for a request slot", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient(
      {
        baseUrl: backend.baseUrl,
        username: "elastic",
        password: "secret",
        timeoutMs: 500,
      },
      { maxConcurrency: 1, queueTimeoutMs: 50 },
    );
    const firstExecution = client.execute(compiledQuery).catch((error: unknown) => error);

    await waitFor(() => backend.requestCount === 1);
    const queuedExecution = client.execute(compiledQuery);

    await expect(queuedExecution).rejects.toMatchObject({
      code: "KIBANA_TIMEOUT",
      phase: "queue",
    });
    expect(backend.requestCount).toBe(1);
    await expect(firstExecution).resolves.toMatchObject({
      code: "KIBANA_TIMEOUT",
      phase: "request",
    });
  });

  it("rejects excess queued requests with a structured overload error", async () => {
    const backend = await createStalledBackend();
    const client = new KibanaClient(
      {
        baseUrl: backend.baseUrl,
        username: "elastic",
        password: "secret",
        timeoutMs: 500,
      },
      { maxConcurrency: 1, maxQueueDepth: 1, queueTimeoutMs: 250 },
    );
    const active = client.execute(compiledQuery).catch((error: unknown) => error);

    await waitFor(() => backend.requestCount === 1);
    const queued = client.execute(compiledQuery).catch((error: unknown) => error);
    const overloaded = client.execute(compiledQuery);

    await expect(overloaded).rejects.toMatchObject({
      code: "KIBANA_OVERLOADED",
      phase: "queue",
      sourceId: "app-logs",
    });
    expect(backend.requestCount).toBe(1);
    await expect(Promise.all([active, queued])).resolves.toEqual([
      expect.objectContaining({ code: "KIBANA_TIMEOUT" }),
      expect.objectContaining({ code: "KIBANA_TIMEOUT" }),
    ]);
  });
});
