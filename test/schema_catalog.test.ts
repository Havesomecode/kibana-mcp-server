import { describe, expect, it, vi } from "vitest";

import { KibanaClient } from "../src/kibana/client.js";
import { SchemaCatalog } from "../src/kibana/schema_catalog.js";
import { createApplication } from "../src/server.js";
import type { SourceDefinition, SourceFieldDescriptor } from "../src/types.js";

const source: SourceDefinition = {
  id: "reload-metrics",
  name: "Reload metrics",
  tags: ["metrics"],
  timeField: "@timestamp",
  backend: {
    kind: "kibana_internal_search_es",
    path: "/internal/search/es",
    index: "consumer-*",
  },
  fieldHints: [
    {
      name: "event",
      aliases: ["event_name"],
      description: "Logical event marker",
    },
  ],
  defaultTextFields: ["message"],
  evidenceFields: ["event"],
};

const fieldDescriptors: SourceFieldDescriptor[] = [
  {
    name: "event",
    type: "text",
    searchable: true,
    aggregatable: false,
    subfields: ["event.keyword"],
    preferred_exact_field: "event.keyword",
  },
  {
    name: "event.keyword",
    type: "keyword",
    searchable: true,
    aggregatable: true,
    multi_field_parent: "event",
    subfields: [],
  },
  {
    name: "slowest_layers.layer",
    type: "keyword",
    searchable: true,
    aggregatable: true,
    nested_path: "slowest_layers",
    subfields: [],
  },
];

describe("SchemaCatalog", () => {
  it("merges field hints with backend field metadata", async () => {
    const catalog = new SchemaCatalog({
      describeFields: async () => fieldDescriptors,
    });

    const result = await catalog.getFields(source);

    expect(result[0]?.aliases).toEqual(["event_name"]);
    expect(result[0]?.description).toBe("Logical event marker");
    expect(result[0]?.preferred_exact_field).toBe("event.keyword");
  });

  it("caches field metadata by source", async () => {
    let callCount = 0;
    const catalog = new SchemaCatalog({
      describeFields: async () => {
        callCount += 1;
        return fieldDescriptors;
      },
    });

    await catalog.getFields(source);
    await catalog.getFields(source);

    expect(callCount).toBe(1);
  });

  it("coalesces concurrent schema discovery for the same source", async () => {
    let callCount = 0;
    let resolveDiscovery: ((fields: SourceFieldDescriptor[]) => void) | undefined;
    const catalog = new SchemaCatalog({
      describeFields: async () => {
        callCount += 1;
        return await new Promise<SourceFieldDescriptor[]>((resolve) => {
          resolveDiscovery = resolve;
        });
      },
    });

    const first = catalog.getFields(source);
    const second = catalog.getFields(source);
    expect(callCount).toBe(1);
    resolveDiscovery?.(fieldDescriptors);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.arrayContaining(fieldDescriptors),
      expect.arrayContaining(fieldDescriptors),
    ]);
    expect(callCount).toBe(1);
  });

  it("retries schema discovery after a transient failure", async () => {
    let callCount = 0;
    const catalog = new SchemaCatalog({
      describeFields: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("temporary backend failure");
        }
        return fieldDescriptors;
      },
    });

    await expect(catalog.getFields(source)).rejects.toThrow("temporary backend failure");
    await expect(catalog.getFields(source)).resolves.toHaveLength(fieldDescriptors.length);

    expect(callCount).toBe(2);
  });

  it("cancelling the first caller leaves shared discovery running for the second", async () => {
    const controller = new AbortController();
    let backendSignal: AbortSignal | undefined;
    let finish: ((fields: SourceFieldDescriptor[]) => void) | undefined;
    const catalog = new SchemaCatalog({
      describeFields: (_source, signal) =>
        new Promise((resolve, reject) => {
          backendSignal = signal;
          finish = resolve;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    const first = catalog.getFields(source, controller.signal);
    const firstCancelled = first.catch((error: unknown) => error);
    const second = catalog.getFields(source).catch((error: unknown) => error);
    controller.abort();
    expect(backendSignal?.aborted).toBe(false);
    expect(await firstCancelled).toMatchObject({ code: "KIBANA_CANCELLED" });
    finish?.(fieldDescriptors);
    expect(await second).toHaveLength(fieldDescriptors.length);
  });

  it("cancelling a joined caller finishes it promptly without cancelling the owner", async () => {
    const controller = new AbortController();
    let finish: ((fields: SourceFieldDescriptor[]) => void) | undefined;
    const catalog = new SchemaCatalog({
      describeFields: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const first = catalog.getFields(source);
    const second = catalog.getFields(source, controller.signal);
    const cancelled = expect(second).rejects.toMatchObject({ code: "KIBANA_CANCELLED" });
    controller.abort();
    await cancelled;
    finish?.(fieldDescriptors);
    await expect(first).resolves.toHaveLength(fieldDescriptors.length);
  });

  it("abandons sole cancelled work and permits immediate retry without stale cache writes", async () => {
    const controller = new AbortController();
    const work: { signal?: AbortSignal; finish: (fields: SourceFieldDescriptor[]) => void }[] = [];
    const catalog = new SchemaCatalog({
      describeFields: (_source, signal) => new Promise((finish) => work.push({ signal, finish })),
    });
    const first = catalog.getFields(source, controller.signal);
    const cancelled = expect(first).rejects.toMatchObject({ code: "KIBANA_CANCELLED" });
    controller.abort();
    await cancelled;
    expect(work[0].signal?.aborted).toBe(true);
    const second = catalog.getFields(source);
    expect(work).toHaveLength(2);
    work[1].finish(fieldDescriptors);
    const fields = await second;
    work[0].finish([{ name: "stale", subfields: [] }]);
    await first.catch(() => {});
    await Promise.resolve();
    expect(await catalog.getFields(source)).toBe(fields);
  });

  it("does not start discovery for an already cancelled caller or return cached fields to it", async () => {
    let calls = 0;
    const catalog = new SchemaCatalog({
      describeFields: async () => {
        calls += 1;
        return fieldDescriptors;
      },
    });
    const signal = AbortSignal.abort();
    await expect(catalog.getFields(source, signal)).rejects.toMatchObject({
      code: "KIBANA_CANCELLED",
    });
    expect(calls).toBe(0);
    await catalog.getFields(source);
    await expect(catalog.getFields(source, signal)).rejects.toMatchObject({
      code: "KIBANA_CANCELLED",
    });
    expect(calls).toBe(1);
  });

  it("isolates cancellation between concurrent describe_fields tool calls", async () => {
    const kibana = {
      baseUrl: "https://kibana.example.com",
      username: "elastic",
      password: "secret",
      timeoutMs: 2000,
    };
    const client = new KibanaClient(kibana);
    let backendSignal: AbortSignal | undefined;
    let finish: ((fields: SourceFieldDescriptor[]) => void) | undefined;
    const describeFields = vi.spyOn(client, "describeFields").mockImplementation(
      (_source, signal) =>
        new Promise((resolve, reject) => {
          backendSignal = signal;
          finish = resolve;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const app = createApplication({ kibana, sources: [source] }, { kibanaClient: client });
    const controller = new AbortController();
    const first = app.handlers
      .describe_fields({ source_id: source.id }, controller.signal)
      .catch((error: unknown) => error);
    const second = app.handlers
      .describe_fields({ source_id: source.id })
      .catch((error: unknown) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(describeFields).toHaveBeenCalledOnce();
    controller.abort();
    expect(await first).toMatchObject({ code: "KIBANA_CANCELLED" });
    expect(backendSignal?.aborted).toBe(false);
    finish?.(fieldDescriptors);
    expect(await second).toMatchObject({ source_id: source.id, total: fieldDescriptors.length });
  });

  it("uses an independently cancellable signal for schema discovery", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const catalog = new SchemaCatalog({
      describeFields: async (_source, signal) => {
        receivedSignal = signal;
        return fieldDescriptors;
      },
    });

    await catalog.getFields(source, controller.signal);

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal).not.toBe(controller.signal);
  });
});
