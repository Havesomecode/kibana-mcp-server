import { describe, expect, it } from "vitest";

import { SourceCatalog } from "../src/kibana/source_catalog.js";
import type { SourceDefinition } from "../src/types.js";

const sources: SourceDefinition[] = [
  {
    id: "consumer",
    name: "Consumer",
    description: "Consumer logs",
    tags: ["consumer", "cache"],
    timeField: "@timestamp",
    backend: {
      kind: "elasticsearch_search",
      path: "/consumer/_search",
    },
    fieldHints: [
      {
        name: "productId",
        aliases: ["product_id"],
      },
    ],
    defaultTextFields: ["message"],
    evidenceFields: ["productId"],
  },
  {
    id: "api",
    name: "API",
    tags: ["api"],
    timeField: "@timestamp",
    backend: {
      kind: "elasticsearch_search",
      path: "/api/_search",
    },
    fieldHints: [],
    defaultTextFields: ["message"],
    evidenceFields: [],
  },
];

describe("SourceCatalog", () => {
  it("lists all sources when no query is provided", () => {
    const catalog = new SourceCatalog(sources);
    expect(catalog.list().map((source) => source.id)).toEqual(["consumer", "api"]);
  });

  it("matches names, tags, and field aliases", () => {
    const catalog = new SourceCatalog(sources);
    expect(catalog.list("cache").map((source) => source.id)).toEqual(["consumer"]);
    expect(catalog.list("product_id").map((source) => source.id)).toEqual(["consumer"]);
  });

  it("throws when required source ids are missing", () => {
    const catalog = new SourceCatalog(sources);
    expect(() => catalog.getRequiredSources(["missing"])).toThrow("Unknown source ids");
  });
});
