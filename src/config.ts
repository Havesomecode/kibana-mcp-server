import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import type { AppConfig } from "./types.js";

export const DEFAULT_RUNTIME_SOURCE_CATALOG_PATH = "config/sources.runtime.json";
export const DEFAULT_STATIC_SOURCE_CATALOG_PATH = "config/sources.json";

const envSchema = z.object({
  KIBANA_BASE_URL: z.url(),
  KIBANA_USERNAME: z.string().min(1),
  KIBANA_PASSWORD: z.string().min(1),
  KIBANA_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error("KIBANA_TIMEOUT_MS must be a positive number");
      }
      return numericValue;
    }),
  KIBANA_SOURCE_CATALOG_PATH: z.string().optional(),
});

const fieldHintSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  description: z.string().optional(),
  aliases: z.array(z.string().min(1)).default([]),
});

const sourceBackendSchema = z.object({
  kind: z.enum(["elasticsearch_search", "kibana_internal_search_es"]),
  path: z.string().min(1),
  index: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
});

const sourceSchemaBackendSchema = z.object({
  kind: z.enum([
    "elasticsearch_field_caps",
    "kibana_data_views_fields",
    "kibana_index_patterns_fields",
  ]),
  path: z.string().min(1).optional(),
  index: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
});

export const sourceDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  timeField: z.string().min(1),
  backend: sourceBackendSchema,
  schema: sourceSchemaBackendSchema.optional(),
  fieldHints: z.array(fieldHintSchema).default([]),
  defaultTextFields: z.array(z.string().min(1)).default([]),
  evidenceFields: z.array(z.string().min(1)).default([]),
});

export const sourceCatalogSchema = z.object({
  sources: z.array(sourceDefinitionSchema).min(1),
});

function buildKibanaConfig(env: z.output<typeof envSchema>): AppConfig["kibana"] {
  return {
    baseUrl: env.KIBANA_BASE_URL.replace(/\/+$/, ""),
    username: env.KIBANA_USERNAME,
    password: env.KIBANA_PASSWORD,
    timeoutMs: env.KIBANA_TIMEOUT_MS ?? 10000,
  };
}

export function resolveSourceCatalogPath(envInput: NodeJS.ProcessEnv = process.env): string {
  const explicitPath = envInput.KIBANA_SOURCE_CATALOG_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  return DEFAULT_RUNTIME_SOURCE_CATALOG_PATH;
}

export function parseAppConfig(envInput: unknown, sourceCatalogInput: unknown): AppConfig {
  const env = envSchema.parse(envInput);
  const sourceCatalog = sourceCatalogSchema.parse(sourceCatalogInput);

  return {
    kibana: buildKibanaConfig(env),
    sources: sourceCatalog.sources,
  };
}

export async function loadConfigFromEnvironment(
  envInput: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
  const env = envSchema.parse(envInput);
  const preferredPath = resolveSourceCatalogPath(envInput);
  const fallbackPaths =
    preferredPath === DEFAULT_RUNTIME_SOURCE_CATALOG_PATH
      ? [preferredPath, DEFAULT_STATIC_SOURCE_CATALOG_PATH]
      : [preferredPath];

  let sourceCatalogRaw: string | undefined;
  let lastError: unknown;

  for (const candidatePath of fallbackPaths) {
    try {
      sourceCatalogRaw = await readFile(candidatePath, "utf8");
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!sourceCatalogRaw) {
    throw lastError instanceof Error ? lastError : new Error("Source catalog could not be loaded");
  }

  const sourceCatalog = JSON.parse(sourceCatalogRaw) as unknown;
  return {
    kibana: buildKibanaConfig(env),
    sources: sourceCatalogSchema.parse(sourceCatalog).sources,
  };
}

export async function persistSourceCatalog(
  sources: AppConfig["sources"],
  envInput: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const sourceCatalogPath = resolveSourceCatalogPath(envInput);
  await mkdir(dirname(sourceCatalogPath), { recursive: true });
  await writeFile(sourceCatalogPath, `${JSON.stringify({ sources }, null, 2)}\n`, "utf8");
  return sourceCatalogPath;
}
