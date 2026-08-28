import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { KibanaClient } from "../kibana_client.js";
import { compileQueryPlan } from "../query/compiler.js";
import { normalizeQueryResponse } from "../query/normalize.js";
import type { SchemaCatalog } from "../schema_catalog.js";
import type { SourceCatalog } from "../source_catalog.js";

const queryFilterSchema = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const nestedQueryFilterSchema = z.object({
  path: z.string().min(1),
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const queryInputSchema = z
  .object({
    source_ids: z.array(z.string().min(1)).min(1),
    start_time: z.string().datetime({ offset: true }),
    end_time: z.string().datetime({ offset: true }),
    text: z.string().trim().min(1).optional(),
    filters: z.array(queryFilterSchema).default([]),
    nested_filters: z.array(nestedQueryFilterSchema).default([]),
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

export const queryOutputSchema = z.object({
  query_echo: z.object({
    source_ids: z.array(z.string()),
    start_time: z.string(),
    end_time: z.string(),
    text: z.string().optional(),
    filters: z.array(
      z.object({
        field: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        resolved_field: z.string(),
      }),
    ),
    nested_filters: z
      .array(
        z.object({
          path: z.string(),
          field: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]),
          resolved_field: z.string(),
          query_strategy: z.enum(["nested", "flat_object_path"]).optional(),
        }),
      )
      .optional(),
    cursor: z.string().optional(),
    mode: z.enum(["hits", "count", "histogram", "terms", "stats", "grouped_top_hits"]),
    sort: z.enum(["asc", "desc"]),
    sort_by: z.string().optional(),
    resolved_sort_by_by_source: z
      .array(
        z.object({
          source_id: z.string(),
          resolved_sort_by: z.string(),
        }),
      )
      .optional(),
    advisories: z
      .array(
        z.object({
          kind: z.enum(["preferred_exact_field", "schema_unavailable", "non_nested_object_array"]),
          source_id: z.string(),
          purpose: z.enum(["filter", "sort", "group_by"]),
          requested_field: z.string(),
          resolved_field: z.string(),
          reason: z.string(),
        }),
      )
      .optional(),
    limit: z.number(),
    stats_field: z.string().optional(),
    top_hits_size: z.number().optional(),
    histogram_interval: z.string().optional(),
    group_by: z.string().optional(),
    truncated: z.boolean(),
  }),
  total: z.number(),
  next_cursor: z.string().optional(),
  hits: z
    .array(
      z.object({
        source_id: z.string(),
        timestamp: z.string().nullable(),
        summary: z.string(),
        document_id: z.string().nullable(),
        index: z.string().nullable(),
        selected_fields: z.record(z.string(), z.unknown()),
        nested_matches: z
          .array(
            z.object({
              path: z.string(),
              documents: z.array(z.record(z.string(), z.unknown())),
            }),
          )
          .optional(),
        raw_document: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  counts_by_source: z
    .array(
      z.object({
        source_id: z.string(),
        count: z.number(),
      }),
    )
    .optional(),
  histograms: z
    .array(
      z.object({
        source_id: z.string(),
        buckets: z.array(
          z.object({
            key: z.union([z.number(), z.string()]),
            key_as_string: z.string().optional(),
            count: z.number(),
          }),
        ),
      }),
    )
    .optional(),
  groups: z
    .array(
      z.object({
        source_id: z.string(),
        field: z.string(),
        buckets: z.array(
          z.object({
            key: z.string(),
            count: z.number(),
          }),
        ),
      }),
    )
    .optional(),
  stats: z
    .array(
      z.object({
        source_id: z.string(),
        field: z.string(),
        summary: z.object({
          count: z.number(),
          min: z.number().nullable(),
          max: z.number().nullable(),
          avg: z.number().nullable(),
          sum: z.number(),
          p50: z.number().nullable(),
          p95: z.number().nullable(),
          p99: z.number().nullable(),
        }),
      }),
    )
    .optional(),
  grouped_hits: z
    .array(
      z.object({
        source_id: z.string(),
        group_by: z.string(),
        buckets: z.array(
          z.object({
            key: z.string(),
            count: z.number(),
            hits: z.array(
              z.object({
                source_id: z.string(),
                timestamp: z.string().nullable(),
                summary: z.string(),
                document_id: z.string().nullable(),
                index: z.string().nullable(),
                selected_fields: z.record(z.string(), z.unknown()),
                nested_matches: z
                  .array(
                    z.object({
                      path: z.string(),
                      documents: z.array(z.record(z.string(), z.unknown())),
                    }),
                  )
                  .optional(),
                raw_document: z.record(z.string(), z.unknown()),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});

export async function executeQuery(
  input: z.infer<typeof queryInputSchema>,
  sourceCatalog: SourceCatalog,
  kibanaClient: Pick<KibanaClient, "executeMany">,
  options?: {
    resolveFieldAliases?: boolean;
    resolvePreferredExactFields?: boolean;
    schemaCatalog?: SchemaCatalog;
    callerSignal?: AbortSignal;
  },
): Promise<z.infer<typeof queryOutputSchema>> {
  const sources = sourceCatalog.getRequiredSources(input.source_ids);
  const schemaCatalog = options?.schemaCatalog;
  const usesSchemaAwareFieldResolution =
    (options?.resolveFieldAliases !== false || options?.resolvePreferredExactFields !== false) &&
    (input.filters.length > 0 || Boolean(input.sort_by) || Boolean(input.group_by));
  const needsSchemaResolution = usesSchemaAwareFieldResolution || input.nested_filters.length > 0;
  const sourceSchemas = new Map<string, Awaited<ReturnType<SchemaCatalog["getFields"]>>>();
  const sourceSchemaErrors = new Map<string, string>();

  if (schemaCatalog && needsSchemaResolution) {
    for (const source of sources) {
      try {
        sourceSchemas.set(source.id, await schemaCatalog.getFields(source, options?.callerSignal));
      } catch (error) {
        if (options?.callerSignal?.aborted) {
          throw error;
        }
        sourceSchemaErrors.set(source.id, error instanceof Error ? error.message : String(error));
      }
    }
  }

  const plan = compileQueryPlan(input, sources, {
    ...options,
    ...(sourceSchemas.size > 0 ? { sourceSchemas } : {}),
    ...(sourceSchemaErrors.size > 0 ? { sourceSchemaErrors } : {}),
  });
  const executions = await kibanaClient.executeMany(plan.sourceQueries, options?.callerSignal);
  return queryOutputSchema.parse(normalizeQueryResponse(plan, executions));
}

export function formatQueryResult(result: z.infer<typeof queryOutputSchema>): string {
  if (result.hits) {
    const preview = result.hits
      .slice(0, 5)
      .map((hit) => `[${hit.timestamp ?? "no-timestamp"}] ${hit.source_id}: ${hit.summary}`)
      .join("\n");
    return `Returned ${result.hits.length} hits (total=${result.total}).\n${preview}`;
  }

  if (result.counts_by_source) {
    return result.counts_by_source.map((count) => `${count.source_id}: ${count.count}`).join("\n");
  }

  if (result.histograms) {
    return result.histograms
      .map((histogram) => `${histogram.source_id}: ${histogram.buckets.length} histogram buckets`)
      .join("\n");
  }

  if (result.stats) {
    return result.stats
      .map((entry) => `${entry.source_id} ${entry.field}: p95=${entry.summary.p95 ?? "n/a"}`)
      .join("\n");
  }

  if (result.grouped_hits) {
    return result.grouped_hits
      .map((entry) => `${entry.source_id} grouped top hits: ${entry.buckets.length} buckets`)
      .join("\n");
  }

  return (result.groups ?? [])
    .map((group) => `${group.source_id} grouped by ${group.field}: ${group.buckets.length} buckets`)
    .join("\n");
}

export function createQueryCallToolResult(
  result: z.infer<typeof queryOutputSchema>,
): CallToolResult {
  return {
    content: [{ type: "text", text: formatQueryResult(result) }],
    structuredContent: result,
  };
}
