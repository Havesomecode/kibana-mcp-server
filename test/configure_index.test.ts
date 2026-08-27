import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGeneratedCatalog } from "../src/bootstrap.js";
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

    const result = await executeConfigureIndex(
      {
        index: "consumer-*",
        source_name: "Consumer logs",
      },
      {
        config: config(catalogPath),
        stateRoot: root,
        kibanaClient: {
          async describeFields(source: SourceDefinition) {
            inspectedIndexes.push(source.schema?.index);
            return fields;
          },
          async execute(compiledQuery) {
            executedIndexes.push(compiledQuery.source.backend.index);
            return {
              source: compiledQuery.source,
              rawResponse: { hits: { total: { value: 0 }, hits: [] } },
            } as KibanaSearchExecutionResult;
          },
        },
      },
    );

    expect(inspectedIndexes).toEqual(["consumer-*"]);
    expect(executedIndexes).toEqual(["consumer-*"]);
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
});
