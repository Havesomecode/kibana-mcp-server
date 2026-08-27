import { readFile } from "node:fs/promises";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  buildGeneratedSource,
  chooseGeneratedSourceFields,
  createGeneratedCatalog,
  parseGeneratedCatalog,
} from "../bootstrap.js";
import { persistSourceCatalog } from "../config.js";
import type { KibanaClient } from "../kibana_client.js";
import { resolveProfilePaths } from "../profile_paths.js";
import { acquireStateLock } from "../state_lock.js";
import type { ResolvedAppConfig, SourceDefinition } from "../types.js";

export const configureIndexInputSchema = z
  .object({
    index: z.string().trim().min(1),
    source_name: z.string().trim().min(1).optional(),
    source_id: z.string().trim().min(1).optional(),
    time_field: z.string().trim().min(1).optional(),
    replace: z.boolean().default(false),
  })
  .strict();

export const configureIndexOutputSchema = z.object({
  configured: z.literal(true),
  persisted: z.literal(true),
  source_catalog_path: z.string(),
  source_count: z.number().int().positive(),
  source_id: z.string(),
  index: z.string(),
  time_field: z.string(),
});

type ConfigureIndexInput = z.input<typeof configureIndexInputSchema>;
type ConfigureIndexClient = Pick<KibanaClient, "describeFields" | "execute">;

export async function executeConfigureIndex(
  inputValue: ConfigureIndexInput,
  options: {
    config: ResolvedAppConfig;
    kibanaClient: ConfigureIndexClient;
    stateRoot?: string;
  },
): Promise<{
  sources: SourceDefinition[];
  result: z.infer<typeof configureIndexOutputSchema>;
}> {
  const input = configureIndexInputSchema.parse(inputValue);
  const sourceCatalogPath = options.config.sourceCatalogPath;
  if (!sourceCatalogPath) {
    throw new Error(
      "configure_index requires a persisted source catalog. Run connection bootstrap first.",
    );
  }

  const stateRoot = options.stateRoot ?? resolveProfilePaths().stateRoot;
  const releaseLock = await acquireStateLock(stateRoot);
  try {
    const existingContent = await readFile(sourceCatalogPath, "utf8");
    const existingCatalog = parseGeneratedCatalog(existingContent);
    if (!existingCatalog) {
      throw new Error(
        "configure_index can update only a managed generated catalog. Refusing to overwrite a hand-authored or modified catalog.",
      );
    }

    const proposedSource = buildGeneratedSource([input.index], input.source_name, input.source_id);
    const existingSource = existingCatalog.sources.find(
      (source) => source.id === proposedSource.id,
    );
    if (
      existingSource &&
      !input.replace &&
      JSON.stringify(existingSource.backend.index) !== JSON.stringify(proposedSource.backend.index)
    ) {
      throw new Error(
        `Source id '${proposedSource.id}' already refers to a different index. Re-run with replace=true only after the user explicitly approves replacement.`,
      );
    }

    const discoveredFields = await options.kibanaClient.describeFields(proposedSource);
    if (discoveredFields.length === 0) {
      throw new Error(
        `Explicit index pattern '${input.index}' resolved to no fields. Check the index and Kibana permissions.`,
      );
    }
    const generatedFields = chooseGeneratedSourceFields(discoveredFields, input.time_field);
    const verifiedSource: SourceDefinition = {
      ...proposedSource,
      ...generatedFields,
    };

    await options.kibanaClient.execute({
      source: verifiedSource,
      request: {
        body: {
          size: 1,
          track_total_hits: false,
          query: { match_all: {} },
        },
      },
      resolvedFilters: [],
      resolvedNestedFilters: [],
      resolvedSortBy: verifiedSource.timeField,
      advisories: [],
    });

    const sources = existingSource
      ? existingCatalog.sources.map((source) =>
          source.id === verifiedSource.id ? verifiedSource : source,
        )
      : [...existingCatalog.sources, verifiedSource];
    const generatedCatalog = createGeneratedCatalog(sources);
    await persistSourceCatalog(sources, {
      sourceCatalogPath,
      catalog: generatedCatalog,
    });

    return {
      sources,
      result: {
        configured: true,
        persisted: true,
        source_catalog_path: sourceCatalogPath,
        source_count: sources.length,
        source_id: verifiedSource.id,
        index: input.index,
        time_field: verifiedSource.timeField,
      },
    };
  } finally {
    await releaseLock();
  }
}

export function createConfigureIndexCallToolResult(
  result: z.infer<typeof configureIndexOutputSchema>,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Configured source '${result.source_id}' for the explicitly requested index '${result.index}' with time field '${result.time_field}'.`,
      },
    ],
    structuredContent: result,
  };
}
