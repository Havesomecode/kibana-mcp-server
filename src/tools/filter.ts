import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { KibanaClient } from "../kibana_client.js";
import type { SchemaCatalog } from "../schema_catalog.js";
import type { SourceCatalog } from "../source_catalog.js";
import { executeQuery, queryOutputSchema } from "./query.js";

const exactFilterSchema = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const nestedExactFilterSchema = z.object({
  path: z.string().min(1),
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const filterInputSchema = z
  .object({
    source_ids: z.array(z.string().min(1)).min(1),
    start_time: z.string().datetime({ offset: true }),
    end_time: z.string().datetime({ offset: true }),
    field: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
    filters: z.array(exactFilterSchema).default([]),
    nested_filters: z.array(nestedExactFilterSchema).default([]),
    cursor: z.string().min(1).optional(),
    mode: z
      .enum(["hits", "count", "histogram", "terms", "stats", "grouped_top_hits"])
      .default("hits"),
    sort: z.enum(["asc", "desc"]).default("desc"),
    sort_by: z.string().min(1).optional(),
    limit: z.number().int().positive().max(1000).default(100),
    extract_nested: z.boolean().default(false),
    stats_field: z.string().min(1).optional(),
    top_hits_size: z.number().int().positive().max(100).default(1),
    histogram_interval: z.string().min(1).optional(),
    group_by: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.start_time) >= Date.parse(value.end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_time"],
        message: "end_time must be later than start_time",
      });
    }

    if (value.mode === "histogram" && !value.histogram_interval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["histogram_interval"],
        message: "histogram_interval is required when mode is 'histogram'",
      });
    }

    if ((value.mode === "terms" || value.mode === "grouped_top_hits") && !value.group_by) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["group_by"],
        message: `group_by is required when mode is '${value.mode}'`,
      });
    }

    if (!["hits", "grouped_top_hits"].includes(value.mode) && value.sort_by) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sort_by"],
        message: "sort_by is only supported when mode is 'hits' or 'grouped_top_hits'",
      });
    }

    if (value.cursor && value.mode !== "hits") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cursor"],
        message: "cursor is only supported when mode is 'hits'",
      });
    }

    if (value.cursor && value.source_ids.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cursor"],
        message: "cursor pagination is only supported for single-source hits queries",
      });
    }

    if (value.mode === "stats" && !value.stats_field) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stats_field"],
        message: "stats_field is required when mode is 'stats'",
      });
    }

    if (value.mode === "grouped_top_hits" && !value.sort_by) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sort_by"],
        message: "sort_by is required when mode is 'grouped_top_hits'",
      });
    }
  });

export const filterOutputSchema = queryOutputSchema;

export async function executeFilter(
  input: z.infer<typeof filterInputSchema>,
  sourceCatalog: SourceCatalog,
  kibanaClient: Pick<KibanaClient, "executeMany">,
  options?: {
    schemaCatalog?: SchemaCatalog;
    callerSignal?: AbortSignal;
  },
): Promise<z.infer<typeof filterOutputSchema>> {
  return executeQuery(
    {
      source_ids: input.source_ids,
      start_time: input.start_time,
      end_time: input.end_time,
      filters: [{ field: input.field, value: input.value }, ...input.filters],
      nested_filters: input.nested_filters,
      cursor: input.cursor,
      mode: input.mode,
      sort: input.sort,
      sort_by: input.sort_by,
      limit: input.limit,
      extract_nested: input.extract_nested,
      stats_field: input.stats_field,
      top_hits_size: input.top_hits_size,
      histogram_interval: input.histogram_interval,
      group_by: input.group_by,
    },
    sourceCatalog,
    kibanaClient,
    {
      resolveFieldAliases: false,
      resolvePreferredExactFields: true,
      schemaCatalog: options?.schemaCatalog,
      callerSignal: options?.callerSignal,
    },
  );
}

export function formatFilterResult(result: z.infer<typeof filterOutputSchema>): string {
  if (result.hits) {
    const preview = result.hits
      .slice(0, 5)
      .map((hit) => `[${hit.timestamp ?? "no-timestamp"}] ${hit.source_id}: ${hit.summary}`)
      .join("\n");
    return `Returned ${result.hits.length} exact-field matches (total=${result.total}).\n${preview}`;
  }

  if (result.counts_by_source) {
    return result.counts_by_source.map((count) => `${count.source_id}: ${count.count}`).join("\n");
  }

  if (result.histograms) {
    return result.histograms
      .map((histogram) => `${histogram.source_id}: ${histogram.buckets.length} histogram buckets`)
      .join("\n");
  }

  return (result.groups ?? [])
    .map((group) => `${group.source_id} grouped by ${group.field}: ${group.buckets.length} buckets`)
    .join("\n");
}

export function createFilterCallToolResult(
  result: z.infer<typeof filterOutputSchema>,
): CallToolResult {
  return {
    content: [{ type: "text", text: formatFilterResult(result) }],
    structuredContent: result,
  };
}
