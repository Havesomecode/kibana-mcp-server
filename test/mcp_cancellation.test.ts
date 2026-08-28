import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { KibanaRequestError } from "../src/kibana_client.js";
import { createApplication } from "../src/server.js";
import type { AppConfig } from "../src/types.js";

const config: AppConfig = {
  kibana: {
    baseUrl: "https://kibana.example.com",
    username: "elastic",
    password: "secret",
    timeoutMs: 1000,
  },
  sources: [
    {
      id: "consumer",
      name: "Consumer",
      tags: ["consumer"],
      timeField: "@timestamp",
      backend: {
        kind: "elasticsearch_search",
        path: "/consumer/_search",
      },
      fieldHints: [],
      defaultTextFields: ["message"],
      evidenceFields: [],
    },
  ],
};

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for MCP lifecycle event");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("MCP cancellation", () => {
  it("aborts backend work when the client cancels a tool call", async () => {
    let backendSignal: AbortSignal | undefined;
    let backendStarted = false;
    const application = createApplication(config, {
      kibanaClient: {
        executeMany: async (_queries: unknown, signal?: AbortSignal) => {
          backendSignal = signal;
          backendStarted = true;
          await new Promise<never>((_resolve, reject) => {
            if (!signal) {
              reject(new Error("Missing cancellation signal"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("backend request cancelled")), {
              once: true,
            });
          });
        },
        describeFields: async () => [],
      } as never,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const responses: Array<Record<string, unknown>> = [];
    clientTransport.onmessage = (message) => {
      responses.push(message as Record<string, unknown>);
    };

    await application.server.connect(serverTransport);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cancellation-test", version: "1.0.0" },
      },
    });
    await waitFor(() => responses.some((message) => message.id === 1));
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "query",
        arguments: {
          source_ids: ["consumer"],
          start_time: "2026-04-02T12:00:00Z",
          end_time: "2026-04-02T12:05:00Z",
          mode: "count",
        },
      },
    });
    await waitFor(() => backendStarted);
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 2, reason: "test cancellation" },
    });
    await waitFor(() => backendSignal?.aborted === true);

    expect(backendSignal?.aborted).toBe(true);

    await clientTransport.close();
    await application.server.close();
  });

  it("aborts configure_index backend work when the client cancels the tool call", async () => {
    let backendSignal: AbortSignal | undefined;
    let backendStarted = false;
    const application = createApplication(config, {
      kibanaClient: {
        executeMany: async () => [],
        describeFields: async () => [],
      } as never,
      configureIndexFn: async (_input, options) => {
        backendSignal = options.callerSignal;
        backendStarted = true;
        return await new Promise<never>((_resolve, reject) => {
          if (!backendSignal) {
            reject(new Error("Missing cancellation signal"));
            return;
          }
          backendSignal.addEventListener(
            "abort",
            () => reject(new Error("configure_index request cancelled")),
            { once: true },
          );
        });
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const responses: Array<Record<string, unknown>> = [];
    clientTransport.onmessage = (message) => {
      responses.push(message as Record<string, unknown>);
    };

    await application.server.connect(serverTransport);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "configure-cancellation-test", version: "1.0.0" },
      },
    });
    await waitFor(() => responses.some((message) => message.id === 1));
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "configure_index",
        arguments: { index: "consumer-*" },
      },
    });
    await waitFor(() => backendStarted);
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 2, reason: "test cancellation" },
    });
    await waitFor(() => backendSignal?.aborted === true);

    expect(backendSignal?.aborted).toBe(true);

    await clientTransport.close();
    await application.server.close();
  });

  it("returns machine-readable backend diagnostics to the MCP client", async () => {
    const application = createApplication(config, {
      kibanaClient: {
        executeMany: async () => {
          throw new KibanaRequestError(
            "KIBANA_DNS",
            "request",
            "consumer",
            1000,
            "[KIBANA_DNS] Kibana request for source 'consumer' failed during request (ENOTFOUND)",
            new Error("lookup failed"),
            undefined,
            "ENOTFOUND",
          );
        },
        describeFields: async () => [],
      } as never,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const responses: Array<Record<string, unknown>> = [];
    clientTransport.onmessage = (message) => {
      responses.push(message as Record<string, unknown>);
    };

    await application.server.connect(serverTransport);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "diagnostics-test", version: "1.0.0" },
      },
    });
    await waitFor(() => responses.some((message) => message.id === 1));
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "query",
        arguments: {
          source_ids: ["consumer"],
          start_time: "2026-04-02T12:00:00Z",
          end_time: "2026-04-02T12:05:00Z",
          mode: "count",
        },
      },
    });
    await waitFor(() => responses.some((message) => message.id === 2));
    const response = responses.find((message) => message.id === 2);
    const result = response?.result as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({
      kibana_request_error: {
        code: "KIBANA_DNS",
        phase: "request",
        source_id: "consumer",
        timeout_ms: 1000,
        cause_code: "ENOTFOUND",
      },
    });

    await clientTransport.close();
    await application.server.close();
  });
});
