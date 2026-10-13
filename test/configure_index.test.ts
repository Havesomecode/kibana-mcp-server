import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireStateLock } from "../src/profiles/state_lock.js";
import { createGeneratedCatalog } from "../src/setup/bootstrap.js";
import { CatalogConflictError } from "../src/stores/catalog_store.js";
import { configureIndexInputSchema, executeConfigureIndex } from "../src/tools/configure_index.js";
import type {
  KibanaSearchExecutionResult,
  ResolvedAppConfig,
  SourceDefinition,
  SourceFieldDescriptor,
} from "../src/types.js";

const temporaryDirectories: string[] = [];

const fields: SourceFieldDescriptor[] = [
  {
    name: "@timestamp",
    type: "date",
    searchable: true,
    aggregatable: true,
    subfields: [],
  },
  {
    name: "message",
    type: "text",
    searchable: true,
    aggregatable: false,
    subfields: [],
  },
  {
    name: "trace.id",
    type: "keyword",
    searchable: true,
    aggregatable: true,
    subfields: [],
  },
];

function config(sourceCatalogPath: string): ResolvedAppConfig {
  return {
    kibana: {
      baseUrl: "https://kibana.example.com",
      username: "elastic",
      password: "secret",
      timeoutMs: 1000,
    },
    sources: [],
    sourceCatalogPath,
    sourceCatalogOrigin: "profile",
    profileName: "default",
  };
}

async function createEmptyCatalog(): Promise<{ root: string; catalogPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "configure-index-"));
  temporaryDirectories.push(root);
  const catalogPath = join(root, "sources.json");
  await writeFile(catalogPath, `${JSON.stringify(createGeneratedCatalog([]), null, 2)}\n`, "utf8");
  return { root, catalogPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("configure_index", () => {
  it("rejects credentials and accepts only explicit index configuration fields", () => {
    expect(
      configureIndexInputSchema.safeParse({
        index: "consumer-*",
        kibana: { username: "elastic", password: "secret" },
      }).success,
    ).toBe(false);
  });

  it("validates only the user-supplied index and persists a generated source", async () => {
    const { root, catalogPath } = await createEmptyCatalog();
    const inspectedIndexes: unknown[] = [];
    const executedIndexes: unknown[] = [];
    const receivedSignals: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();

    const result = await executeConfigureIndex(
      {
        index: "consumer-*",
        source_name: "Consumer logs",
      },
      {
        config: config(catalogPath),
        stateRoot: root,
        kibanaClient: {
          async describeFields(source: SourceDefinition, signal?: AbortSignal) {
            inspectedIndexes.push(source.schema?.index);
            receivedSignals.push(signal);
            return fields;
          },
          async execute(compiledQuery, signal) {
            executedIndexes.push(compiledQuery.source.backend.index);
            receivedSignals.push(signal);
            return {
              source: compiledQuery.source,
              rawResponse: { hits: { total: { value: 0 }, hits: [] } },
            } as KibanaSearchExecutionResult;
          },
        },
        callerSignal: controller.signal,
      },
    );

    expect(inspectedIndexes).toEqual(["consumer-*"]);
    expect(executedIndexes).toEqual(["consumer-*"]);
    expect(receivedSignals).toEqual([controller.signal, controller.signal]);
    expect(result.result).toMatchObject({
      configured: true,
      source_id: "consumer-logs",
      index: "consumer-*",
      source_count: 1,
    });
    expect(result.sources).toHaveLength(1);
    const persisted = JSON.parse(await readFile(catalogPath, "utf8"));
    expect(persisted.sources[0]).toMatchObject({
      id: "consumer-logs",
      timeField: "@timestamp",
      defaultTextFields: ["message"],
      evidenceFields: ["trace.id"],
    });
    expect(persisted.generatedBy.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not commit if cancelled while waiting for the persistence lock", async () => {
    const { root, catalogPath } = await createEmptyCatalog();
    const original = await readFile(catalogPath, "utf8");
    const release = await acquireStateLock(root);
    const controller = new AbortController();
    const pending = executeConfigureIndex(
      { index: "consumer-*" },
      {
        config: config(catalogPath),
        stateRoot: root,
        callerSignal: controller.signal,
        kibanaClient: {
          describeFields: async () => fields,
          execute: async (query) => ({ source: query.source, rawResponse: {} }),
        },
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    try {
      const deadline = Date.now() + 1000;
      while (!(await readdir(root)).some((name) => name.endsWith(".pending"))) {
        if (Date.now() > deadline) throw new Error("configure_index did not wait for the lock");
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      controller.abort();
    } finally {
      await release();
    }
    await rejected;
    expect(await readFile(catalogPath, "utf8")).toBe(original);
  });

  it("does not inspect Kibana or overwrite a modified catalog", async () => {
    const { root, catalogPath } = await createEmptyCatalog();
    const modified = JSON.parse(await readFile(catalogPath, "utf8"));
    modified.operatorNote = "keep";
    const original = `${JSON.stringify(modified, null, 2)}\n`;
    await writeFile(catalogPath, original, "utf8");
    let inspected = false;

    await expect(
      executeConfigureIndex(
        { index: "consumer-*" },
        {
          config: config(catalogPath),
          stateRoot: root,
          kibanaClient: {
            async describeFields() {
              inspected = true;
              return fields;
            },
            async execute() {
              throw new Error("must not execute");
            },
          },
        },
      ),
    ).rejects.toThrow("managed generated catalog");

    expect(inspected).toBe(false);
    expect(await readFile(catalogPath, "utf8")).toBe(original);
  });

  it("leaves the empty catalog unchanged when the explicit index fails validation", async () => {
    const { root, catalogPath } = await createEmptyCatalog();
    const original = await readFile(catalogPath, "utf8");

    await expect(
      executeConfigureIndex(
        { index: "missing-*" },
        {
          config: config(catalogPath),
          stateRoot: root,
          kibanaClient: {
            async describeFields() {
              return [];
            },
            async execute() {
              throw new Error("must not execute");
            },
          },
        },
      ),
    ).rejects.toThrow("resolved to no fields");

    expect(await readFile(catalogPath, "utf8")).toBe(original);
  });

  it("creates the managed catalog of a profile that has none yet", async () => {
    const { root } = await createEmptyCatalog();
    const catalogPath = join(root, "new-profile", "sources.json");

    const result = await executeConfigureIndex(
      { index: "consumer-*" },
      {
        config: config(catalogPath),
        stateRoot: root,
        kibanaClient: {
          describeFields: async () => fields,
          execute: async (query) => ({ source: query.source, rawResponse: {} }),
        },
      },
    );

    expect(result.result.source_count).toBe(1);
    expect(result.result.source_catalog_path).toBe(catalogPath);
    const persisted = JSON.parse(await readFile(catalogPath, "utf8")) as {
      sources: SourceDefinition[];
    };
    expect(persisted.sources.map((source) => source.id)).toEqual(["consumer"]);
  });

  it("does not overwrite a catalog file changed while Kibana was being queried", async () => {
    const { root, catalogPath } = await createEmptyCatalog();
    const concurrent = `${JSON.stringify(createGeneratedCatalog([]))}\n`;

    await expect(
      executeConfigureIndex(
        { index: "consumer-*" },
        {
          config: config(catalogPath),
          stateRoot: root,
          kibanaClient: {
            describeFields: async () => {
              await writeFile(catalogPath, concurrent, "utf8");
              return fields;
            },
            execute: async (query) => ({ source: query.source, rawResponse: {} }),
          },
        },
      ),
    ).rejects.toThrow("changed concurrently");

    expect(await readFile(catalogPath, "utf8")).toBe(concurrent);
  });

  it("reports a concurrent catalog change instead of overwriting it", async () => {
    let stored: string | undefined;
    const client = {
      describeFields: async () => {
        // Another writer adds a source while this call is validating its index.
        stored = JSON.stringify(createGeneratedCatalog([]));
        return fields;
      },
      execute: async (query: { source: SourceDefinition }) => ({
        source: query.source,
        rawResponse: {},
      }),
    };

    await expect(
      executeConfigureIndex(
        { index: "consumer-*" },
        {
          config: {
            ...config("unused"),
            catalog: {
              location: "memory://alice",
              read: async () => stored,
              replace: async (expected) => {
                if (expected !== stored) throw new CatalogConflictError("memory://alice");
              },
            },
          },
          kibanaClient: client,
        },
      ),
    ).rejects.toThrow("changed concurrently");
  });

  it("refuses to start a new catalog when the configured sources were loaded from elsewhere", async () => {
    const { root } = await createEmptyCatalog();
    // Environment bootstrap can load the static fallback catalog while persisting to a runtime
    // path that does not exist yet.
    const runtimePath = join(root, "sources.runtime.json");
    let kibanaCalls = 0;

    await expect(
      executeConfigureIndex(
        { index: "consumer-*" },
        {
          config: {
            ...config(runtimePath),
            sources: [
              {
                id: "hand-authored",
                name: "Hand authored",
                tags: [],
                timeField: "@timestamp",
                backend: { kind: "elasticsearch_search", path: "/logs/_search" },
                fieldHints: [],
                defaultTextFields: [],
                evidenceFields: [],
              },
            ],
          },
          stateRoot: root,
          kibanaClient: {
            describeFields: async () => {
              kibanaCalls += 1;
              return fields;
            },
            execute: async (query) => ({ source: query.source, rawResponse: {} }),
          },
        },
      ),
    ).rejects.toThrow("does not exist although sources are configured");

    expect(kibanaCalls).toBe(0);
    await expect(readFile(runtimePath, "utf8")).rejects.toThrow("ENOENT");
  });

  it("requires a catalog to persist into", async () => {
    await expect(
      executeConfigureIndex(
        { index: "consumer-*" },
        {
          config: { ...config("unused"), sourceCatalogPath: undefined },
          kibanaClient: { describeFields: async () => fields, execute: async () => ({}) as never },
        },
      ),
    ).rejects.toThrow("requires a persisted source catalog");
  });
});
