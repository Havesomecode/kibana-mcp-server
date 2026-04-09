import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { persistSourceCatalog, sourceDefinitionSchema } from "../config.js";
import type { AppConfig } from "../types.js";

export const configureInputSchema = z.object({
  kibana: z.object({
    baseUrl: z.url(),
    username: z.string().min(1),
    password: z.string().min(1),
    timeoutMs: z.number().int().positive().max(120000).default(10000),
  }),
  sources: z.array(sourceDefinitionSchema).min(1),
});

export const configureOutputSchema = z.object({
  configured: z.literal(true),
  persisted: z.literal(true),
  source_catalog_path: z.string(),
  source_count: z.number().int().positive(),
  source_ids: z.array(z.string()),
  base_url: z.string(),
});

export async function executeConfigure(
  input: z.infer<typeof configureInputSchema>,
  options: {
    envInput?: NodeJS.ProcessEnv;
    sourceCatalogPath?: string;
  } = {},
): Promise<{ nextConfig: AppConfig; result: z.infer<typeof configureOutputSchema> }> {
  const nextConfig: AppConfig = {
    kibana: {
      baseUrl: input.kibana.baseUrl.replace(/\/+$/, ""),
      username: input.kibana.username,
      password: input.kibana.password,
      timeoutMs: input.kibana.timeoutMs,
    },
    sources: input.sources,
  };
  const sourceCatalogPath = await persistSourceCatalog(input.sources, options);

  return {
    nextConfig,
    result: {
      configured: true,
      persisted: true,
      source_catalog_path: sourceCatalogPath,
      source_count: input.sources.length,
      source_ids: input.sources.map((source) => source.id),
      base_url: nextConfig.kibana.baseUrl,
    },
  };
}

export function createConfigureCallToolResult(
  result: z.infer<typeof configureOutputSchema>,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Configured Kibana connection for ${result.base_url} with ${result.source_count} sources. Source catalog persisted to ${result.source_catalog_path}.`,
      },
    ],
    structuredContent: result,
  };
}
