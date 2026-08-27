import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SourceCatalog } from "../source_catalog.js";

export const discoverInputSchema = z.object({
  query: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
});

export const discoverOutputSchema = z.object({
  configured_total: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()),
      time_field: z.string(),
      field_hints: z.array(
        z.object({
          name: z.string(),
          type: z.string().optional(),
          description: z.string().optional(),
          aliases: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export function executeDiscover(
  input: z.infer<typeof discoverInputSchema>,
  sourceCatalog: SourceCatalog,
): z.infer<typeof discoverOutputSchema> {
  const sources = sourceCatalog.list(input.query, input.limit);
  return {
    configured_total: sourceCatalog.count(),
    total: sources.length,
    sources,
  };
}

export function formatDiscoverResult(result: z.infer<typeof discoverOutputSchema>): string {
  if (result.configured_total === 0) {
    return "No log source is configured. Ask the user which Kibana index or index pattern they want to use, then call 'configure_index' with exactly that value.";
  }

  if (result.sources.length === 0) {
    return "No sources matched the requested discovery query.";
  }

  return result.sources
    .map((source) => {
      const fieldPreview =
        source.field_hints.length > 0
          ? source.field_hints.map((fieldHint) => fieldHint.name).join(", ")
          : "no field hints configured";
      return `${source.id}: ${source.name} [${source.tags.join(", ")}] time_field=${source.time_field} fields=${fieldPreview}`;
    })
    .join("\n");
}

export function createDiscoverCallToolResult(
  result: z.infer<typeof discoverOutputSchema>,
): CallToolResult {
  return {
    content: [{ type: "text", text: formatDiscoverResult(result) }],
    structuredContent: result,
  };
}
