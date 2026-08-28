import { describe, expect, it } from "vitest";

import { SourceCatalog } from "../src/source_catalog.js";
import { executeDiscover, formatDiscoverResult } from "../src/tools/discover.js";

const catalog = new SourceCatalog([
  {
    id: "consumer",
    name: "Consumer cache logs",
    tags: ["consumer"],
    timeField: "@timestamp",
    backend: {
      kind: "kibana_internal_search_es",
      path: "/internal/search/es",
      index: "consumer-*",
    },
    fieldHints: [{ name: "requestId", aliases: ["request_id"] }],
    defaultTextFields: ["message"],
    evidenceFields: ["requestId"],
  },
]);

describe("executeDiscover", () => {
  it("returns matching sources with field hints", () => {
    const result = executeDiscover({ query: "consumer", limit: 10 }, catalog);
    expect(result.configured_total).toBe(1);
    expect(result.total).toBe(1);
    expect(result.sources[0]?.field_hints[0]?.name).toBe("requestId");
  });

  it("formats a concise text summary", () => {
    const result = executeDiscover({ limit: 10 }, catalog);
    expect(formatDiscoverResult(result)).toContain("consumer");
    expect(formatDiscoverResult(result)).toContain("requestId");
  });

  it("directs the agent to ask for an index when no source is configured", () => {
    const result = executeDiscover({ limit: 10 }, new SourceCatalog([]));

    expect(result).toEqual({ configured_total: 0, total: 0, sources: [] });
    expect(formatDiscoverResult(result)).toBe(
      "No log source is configured. Ask the user which Kibana index or index pattern they want to use, then call 'configure_index' with exactly that value.",
    );
  });

  it("reports a query miss without claiming the configured catalog is empty", () => {
    const result = executeDiscover({ query: "missing", limit: 10 }, catalog);

    expect(result).toEqual({ configured_total: 1, total: 0, sources: [] });
    expect(formatDiscoverResult(result)).toBe("No sources matched the requested discovery query.");
  });
});
