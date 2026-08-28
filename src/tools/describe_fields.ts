import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SchemaCatalog } from "../schema_catalog.js";
import type { SourceCatalog } from "../source_catalog.js";

export const describeFieldsInputSchema = z.object({
  source_id: z.string().min(1),
  query: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export const describeFieldsOutputSchema = z.object({
  source_id: z.string(),
  total: z.number().int().nonnegative(),
  fields: z.array(
    z.object({
      name: z.string(),
      type: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      searchable: z.boolean().optional(),
      aggregatable: z.boolean().optional(),
      subfields: z.array(z.string()),
      nested_path: z.string().optional(),
      object_array_path: z.string().optional(),
      multi_field_parent: z.string().optional(),
      preferred_exact_field: z.string().optional(),
    }),
  ),
});

export async function executeDescribeFields(
  input: z.infer<typeof describeFieldsInputSchema>,
  sourceCatalog: Pick<SourceCatalog, "getRequiredSources">,
  schemaCatalog: SchemaCatalog,
  callerSignal?: AbortSignal,
): Promise<z.infer<typeof describeFieldsOutputSchema>> {
  const [source] = sourceCatalog.getRequiredSources([input.source_id]);
  const fields = await schemaCatalog.getFields(source, callerSignal);
  const filteredFields = schemaCatalog.filterFields(fields, input.query, input.limit);

  return {
    source_id: source.id,
    total: filteredFields.length,
    fields: filteredFields,
  };
}

export function formatDescribeFieldsResult(
  result: z.infer<typeof describeFieldsOutputSchema>,
): string {
  const preview = result.fields
    .slice(0, 10)
    .map((field) => {
      const traits = [
        field.type,
        field.searchable === true ? "searchable" : undefined,
        field.aggregatable === true ? "aggregatable" : undefined,
        field.object_array_path ? `object_array=${field.object_array_path}` : undefined,
        field.preferred_exact_field ? `exact=${field.preferred_exact_field}` : undefined,
      ].filter(Boolean);

      return `${field.name}${traits.length > 0 ? ` (${traits.join(", ")})` : ""}`;
    })
    .join("\n");

  return `Described ${result.total} fields for ${result.source_id}.\n${preview}`;
}

export function createDescribeFieldsCallToolResult(
  result: z.infer<typeof describeFieldsOutputSchema>,
): CallToolResult {
  return {
    content: [{ type: "text", text: formatDescribeFieldsResult(result) }],
    structuredContent: result,
  };
}
