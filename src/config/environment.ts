import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { type SecretStore, SecretStoreError, createSecretStore } from "../profiles/secret_store.js";
import { ProfileStore } from "../profiles/store.js";
import type { AppConfig, ResolvedAppConfig } from "../types.js";

export const PROFILE_NAME_ENV = "KIBANA_PROFILE";
export const PROFILE_PLACEHOLDER = "{profile}";

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

export const sourceCatalogSchema = z
  .object({
    generatedBy: z
      .object({
        tool: z.literal("@havesomecode/kibana-mcp-server"),
        formatVersion: z.literal(1),
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    sources: z.array(sourceDefinitionSchema),
  })
  .superRefine((catalog, context) => {
    if (catalog.sources.length !== 0) return;
    if (!catalog.generatedBy) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Empty source catalogs must be managed by @havesomecode/kibana-mcp-server.",
      });
      return;
    }
    const expectedHash = createHash("sha256").update(JSON.stringify(catalog.sources)).digest("hex");
    if (catalog.generatedBy.sourceHash !== expectedHash) {
      context.addIssue({
        code: "custom",
        path: ["generatedBy", "sourceHash"],
        message: "Empty source catalogs require valid managed provenance.",
      });
    }
  });

function buildKibanaConfig(env: z.output<typeof bootstrapEnvSchema>): AppConfig["kibana"] {
  return {
    baseUrl: env.KIBANA_BASE_URL.replace(/\/+$/, ""),
    username: env.KIBANA_USERNAME,
    password: env.KIBANA_PASSWORD,
    timeoutMs: env.KIBANA_TIMEOUT_MS ?? 10000,
  };
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
    exactProfileName?: boolean;
    secretStore?: Pick<SecretStore, "load">;
    readFile?: typeof readFile;
  } = {},
): Promise<ResolvedAppConfig> {
  const overrides = startupOverrideSchema.parse(envInput);
  const readFileImpl = dependencies.readFile ?? readFile;

  const kibana = readBootstrapConnection(envInput);

  if (kibana) {
    const sourceCatalogPath = overrides.KIBANA_SOURCE_CATALOG_PATH?.trim();
    if (!sourceCatalogPath) {
      throw new Error("KIBANA_SOURCE_CATALOG_PATH is required for an environment connection.");
    }
    return {
      kibana,
      sources: await loadSourceCatalog(sourceCatalogPath, readFileImpl),
      sourceCatalogPath,
    };
  }

  const profileStore = dependencies.profileStore ?? new ProfileStore();
  const secretStore = dependencies.secretStore ?? createSecretStore();
  const requestedProfileName = overrides[PROFILE_NAME_ENV]?.trim();
  const profile = requestedProfileName
    ? await profileStore.findProfile(requestedProfileName, {
        exactName: dependencies.exactProfileName,
      })
    : await profileStore.getDefaultProfile();

  if (!profile) {
    throw new Error(
      requestedProfileName
        ? `Saved Kibana profile '${requestedProfileName}' was not found.`
        : "No saved Kibana connection is available. Run connection bootstrap first.",
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

  return {
    kibana: {
      baseUrl: profile.baseUrl.replace(/\/+$/, ""),
      username: savedSecret.username,
      password: savedSecret.password,
      timeoutMs: parseTimeoutOverride(overrides.KIBANA_TIMEOUT_MS) ?? profile.timeoutMs,
    },
    sources: await loadSourceCatalog(sourceCatalogPath, readFileImpl),
    profileName: profile.name,
    sourceCatalogPath,
  };
}

/**
 * Reads the connection supplied through the bootstrap environment variables, if any.
 */
export function readBootstrapConnection(
  envInput: NodeJS.ProcessEnv = process.env,
): AppConfig["kibana"] | undefined {
  const overrides = startupOverrideSchema.parse(envInput);
  if (hasPartialBootstrapConfig(overrides)) {
    throw new Error(
      "Incomplete Kibana bootstrap environment. Provide KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD together.",
    );
  }
  return hasBootstrapConfig(overrides)
    ? buildKibanaConfig(bootstrapEnvSchema.parse(overrides))
    : undefined;
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
  path: string,
  readFileImpl: typeof readFile,
): Promise<AppConfig["sources"]> {
  return sourceCatalogSchema.parse(JSON.parse(await readFileImpl(path, "utf8"))).sources;
}
