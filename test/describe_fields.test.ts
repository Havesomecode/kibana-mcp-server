import { describe, expect, it } from "vitest";

import { SchemaCatalog } from "../src/kibana/schema_catalog.js";
import { executeDescribeFields, formatDescribeFieldsResult } from "../src/tools/describe_fields.js";
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
    aliases: ["event_name"],
  },
  {
    name: "event.keyword",
    type: "keyword",
    searchable: true,
    aggregatable: true,
    multi_field_parent: "event",
    subfields: [],
  },
];

describe("executeDescribeFields", () => {
  it("returns field capabilities for a configured source", async () => {
    const result = await executeDescribeFields(
      {
        source_id: "reload-metrics",
        limit: 20,
      },
      {
        getRequiredSources: () => [source],
      } as never,
      new SchemaCatalog({
        describeFields: async () => fieldDescriptors,
      }),
    );

    expect(result.source_id).toBe("reload-metrics");
    expect(result.total).toBe(2);
    expect(result.fields[0]?.preferred_exact_field).toBe("event.keyword");
  });

  it("supports searching within described fields", async () => {
    const result = await executeDescribeFields(
      {
        source_id: "reload-metrics",
        query: "keyword",
        limit: 20,
      },
      {
        getRequiredSources: () => [source],
      } as never,
      new SchemaCatalog({
        describeFields: async () => fieldDescriptors,
      }),
    );

    expect(result.total).toBe(2);
    expect(result.fields.map((field) => field.name)).toContain("event.keyword");
    expect(formatDescribeFieldsResult(result)).toContain("event.keyword");
  });
});
