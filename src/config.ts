import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import { ProfileStore } from "./profile_store.js";
import { type SecretStore, SecretStoreError, createSecretStore } from "./secret_store.js";
import type { AppConfig, ResolvedAppConfig } from "./types.js";

export const DEFAULT_RUNTIME_SOURCE_CATALOG_PATH = "config/sources.runtime.json";
export const DEFAULT_STATIC_SOURCE_CATALOG_PATH = "config/sources.json";
export const PROFILE_NAME_ENV = "KIBANA_PROFILE";

export class NoSavedProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoSavedProfileError";
  }
}

const bootstrapEnvSchema = z.object({
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

const startupOverrideSchema = z.object({
  KIBANA_BASE_URL: z.string().optional(),
  KIBANA_USERNAME: z.string().optional(),
  KIBANA_PASSWORD: z.string().optional(),
  KIBANA_TIMEOUT_MS: z.string().optional(),
  KIBANA_SOURCE_CATALOG_PATH: z.string().optional(),
  [PROFILE_NAME_ENV]: z.string().optional(),
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

function buildKibanaConfig(env: z.output<typeof bootstrapEnvSchema>): AppConfig["kibana"] {
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
  const env = bootstrapEnvSchema.parse(envInput);
  const sourceCatalog = sourceCatalogSchema.parse(sourceCatalogInput);

  return {
    kibana: buildKibanaConfig(env),
    sources: sourceCatalog.sources,
  };
}

export async function loadConfigFromEnvironment(
  envInput: NodeJS.ProcessEnv = process.env,
  dependencies: {
    profileStore?: Pick<ProfileStore, "findProfile" | "getDefaultProfile">;
    secretStore?: Pick<SecretStore, "load">;
    readFile?: typeof readFile;
  } = {},
): Promise<ResolvedAppConfig> {
  const overrides = startupOverrideSchema.parse(envInput);
  const readFileImpl = dependencies.readFile ?? readFile;

  if (hasPartialBootstrapConfig(overrides)) {
    throw new Error(
      "Incomplete Kibana bootstrap environment. Provide KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD together.",
    );
  }

  if (hasBootstrapConfig(overrides)) {
    const preferredPath = resolveSourceCatalogPath(envInput);
    const sourceCatalog = await loadSourceCatalog(
      preferredPath === DEFAULT_RUNTIME_SOURCE_CATALOG_PATH
        ? [preferredPath, DEFAULT_STATIC_SOURCE_CATALOG_PATH]
        : [preferredPath],
      readFileImpl,
    );
    const config = parseAppConfig(overrides, sourceCatalog.value);

    return {
      ...config,
      sourceCatalogPath: preferredPath,
      sourceCatalogOrigin:
        sourceCatalog.loadedFrom === DEFAULT_STATIC_SOURCE_CATALOG_PATH
          ? "static_default"
          : preferredPath === DEFAULT_RUNTIME_SOURCE_CATALOG_PATH
            ? "runtime_default"
            : "environment",
    };
  }

  const profileStore = dependencies.profileStore ?? new ProfileStore();
  const secretStore = dependencies.secretStore ?? createSecretStore();
  const requestedProfileName = overrides[PROFILE_NAME_ENV]?.trim();
  const profile = requestedProfileName
    ? await profileStore.findProfile(requestedProfileName)
    : await profileStore.getDefaultProfile();

  if (!profile) {
    if (!requestedProfileName) {
      throw new NoSavedProfileError("No saved Kibana profile is available.");
    }
    throw new Error(
      requestedProfileName
        ? `Saved Kibana profile '${requestedProfileName}' was not found.`
        : "No saved Kibana profile is available.",
    );
  }

  const savedSecret = await secretStore.load(profile.id).catch((error: unknown) => {
    if (error instanceof SecretStoreError && error.code === "NOT_FOUND") {
      throw new Error(
        `Saved Kibana credentials for profile '${profile.name}' are missing. Run setup again on this machine.`,
      );
    }
    throw error;
  });
  const sourceCatalogPath =
    overrides.KIBANA_SOURCE_CATALOG_PATH?.trim() || profile.sourceCatalogPath;
  const sourceCatalog = await loadSourceCatalog([sourceCatalogPath], readFileImpl);

  return {
    kibana: {
      baseUrl: profile.baseUrl.replace(/\/+$/, ""),
      username: savedSecret.username,
      password: savedSecret.password,
      timeoutMs: parseTimeoutOverride(overrides.KIBANA_TIMEOUT_MS) ?? profile.timeoutMs,
    },
    sources: sourceCatalogSchema.parse(sourceCatalog.value).sources,
    profileName: profile.name,
    sourceCatalogPath,
    sourceCatalogOrigin: overrides.KIBANA_SOURCE_CATALOG_PATH?.trim() ? "environment" : "profile",
  };
}

export async function persistSourceCatalog(
  sources: AppConfig["sources"],
  options: {
    envInput?: NodeJS.ProcessEnv;
    sourceCatalogPath?: string;
  } = {},
): Promise<string> {
  const sourceCatalogPath = options.sourceCatalogPath ?? resolveSourceCatalogPath(options.envInput);
  await mkdir(dirname(sourceCatalogPath), { recursive: true });
  await writeFile(sourceCatalogPath, `${JSON.stringify({ sources }, null, 2)}\n`, "utf8");
  return sourceCatalogPath;
}

function hasBootstrapConfig(envInput: z.infer<typeof startupOverrideSchema>): boolean {
  return Boolean(
    envInput.KIBANA_BASE_URL?.trim() &&
      envInput.KIBANA_USERNAME?.trim() &&
      envInput.KIBANA_PASSWORD?.trim(),
  );
}

function hasPartialBootstrapConfig(envInput: z.infer<typeof startupOverrideSchema>): boolean {
  const bootstrapValues = [
    envInput.KIBANA_BASE_URL?.trim(),
    envInput.KIBANA_USERNAME?.trim(),
    envInput.KIBANA_PASSWORD?.trim(),
  ].filter(Boolean);

  return bootstrapValues.length > 0 && bootstrapValues.length < 3;
}

function parseTimeoutOverride(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("KIBANA_TIMEOUT_MS must be a positive number");
  }
  return numericValue;
}

async function loadSourceCatalog(
  candidatePaths: string[],
  readFileImpl: typeof readFile,
): Promise<{
  loadedFrom: string;
  value: unknown;
}> {
  let sourceCatalogRaw: string | undefined;
  let loadedFrom = candidatePaths[0];
  let lastError: unknown;

  for (const candidatePath of candidatePaths) {
    try {
      sourceCatalogRaw = await readFileImpl(candidatePath, "utf8");
      loadedFrom = candidatePath;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!sourceCatalogRaw) {
    throw lastError instanceof Error ? lastError : new Error("Source catalog could not be loaded");
  }

  return {
    loadedFrom,
    value: JSON.parse(sourceCatalogRaw) as unknown,
  };
}
