import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ClientRegistrar, CodexClientRegistrar } from "./client_registration.js";
import { sourceCatalogSchema, sourceDefinitionSchema } from "./config.js";
import { KibanaClient } from "./kibana_client.js";
import { type ProfilePaths, resolveProfilePaths } from "./profile_paths.js";
import { ProfileStore, deriveProfileId } from "./profile_store.js";
import { type SecretStore, SecretStoreError, createSecretStore } from "./secret_store.js";
import { acquireStateLock } from "./state_lock.js";
import type {
  KibanaConnectionConfig,
  SavedSecret,
  SourceDefinition,
  SourceFieldDescriptor,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MCP_NAME = "kibana-log-investigation";
const KNOWN_ENDPOINT_PATHS = [
  "/internal/search/es",
  "/api/data_views/fields_for_wildcard",
  "/api/index_patterns/_fields_for_wildcard",
];

export type BootstrapClient = "codex" | "none";

export interface BootstrapOptions {
  profileName: string;
  baseUrl: string;
  username: string;
  password: string;
  client: BootstrapClient;
  makeDefault: boolean;
  timeoutMs?: number;
  mcpName?: string;
  packageSpecifier?: string;
  replaceExisting?: boolean;
}

export interface BootstrapResult {
  profileName: string;
  profileId: string;
  sourceCount: number;
  sourceCatalogPath: string;
  client: BootstrapClient;
  registered: boolean;
  verified: boolean;
}

export interface BootstrapVerifier {
  verify(connection: KibanaConnectionConfig): Promise<void>;
}

interface BootstrapDependencies {
  paths?: ProfilePaths;
  profileStore?: ProfileStore;
  secretStore?: SecretStore;
  verifier?: BootstrapVerifier;
  clientRegistrar?: ClientRegistrar;
}

interface GeneratedSourceFields {
  timeField: string;
  defaultTextFields: string[];
  evidenceFields: string[];
}

export function buildGeneratedSource(
  rawIndexes: string[],
  sourceName?: string,
  sourceId?: string,
): SourceDefinition {
  const indexes = normalizeIndexes(rawIndexes);
  const resolvedSourceId = normalizeSourceId(sourceId ?? sourceName ?? indexes[0] ?? "logs");
  const resolvedSourceName = sourceName?.trim() || resolvedSourceId;
  const indexConfig = indexes.length === 1 ? indexes[0] : indexes;

  return {
    id: resolvedSourceId,
    name: resolvedSourceName,
    description: `Generated from Elasticsearch index patterns: ${indexes.join(", ")}.`,
    tags: ["generated"],
    timeField: "@timestamp",
    backend: {
      kind: "kibana_internal_search_es",
      path: "/internal/search/es",
      index: indexConfig,
    },
    schema: {
      kind: "kibana_data_views_fields",
      index: indexConfig,
    },
    fieldHints: [],
    defaultTextFields: ["message"],
    evidenceFields: [],
  };
}

export function chooseGeneratedSourceFields(
  fields: SourceFieldDescriptor[],
  explicitTimeField?: string,
): GeneratedSourceFields {
  if (fields.length === 0) {
    throw new Error(
      "The index pattern resolved to no fields. Check the index and Kibana permissions.",
    );
  }

  const byName = new Map(fields.map((field) => [field.name, field]));
  const requestedTimeField = explicitTimeField?.trim();
  if (requestedTimeField && !byName.has(requestedTimeField)) {
    throw new Error(
      `Requested time field '${requestedTimeField}' was not found in the index pattern.`,
    );
  }

  const timeField =
    requestedTimeField ||
    ["@timestamp", "timestamp", "event.created", "event.ingested", "date"].find((name) => {
      const field = byName.get(name);
      return field?.type === "date" || field?.type === "date_nanos";
    }) ||
    fields
      .filter((field) => field.type === "date" || field.type === "date_nanos")
      .map((field) => field.name)
      .sort((left, right) => left.localeCompare(right))[0];

  if (!timeField) {
    throw new Error(
      "Could not determine a time field from the discovered schema. Retry configure_index with time_field set explicitly.",
    );
  }

  const preferredTextFields = ["message", "event.original", "log.original"];
  const defaultTextFields = preferredTextFields.filter((name) => byName.has(name));
  if (defaultTextFields.length === 0) {
    const fallbackTextField = fields
      .filter(
        (field) =>
          field.searchable !== false && (field.type === "text" || field.type === "match_only_text"),
      )
      .map((field) => field.name)
      .sort((left, right) => left.localeCompare(right))[0];
    if (fallbackTextField) {
      defaultTextFields.push(fallbackTextField);
    }
  }

  const evidenceFields = [
    "trace.id",
    "traceId",
    "trace_id",
    "correlation_id",
    "request.id",
    "transaction.id",
    "service.name",
    "host.name",
  ].filter((name) => byName.has(name));

  return { timeField, defaultTextFields, evidenceFields };
}

export async function runBootstrap(
  rawOptions: BootstrapOptions,
  dependencies: BootstrapDependencies = {},
): Promise<BootstrapResult> {
  const paths = dependencies.paths ?? resolveProfilePaths();
  const releaseLock = await acquireStateLock(paths.stateRoot);
  try {
    return await runBootstrapLocked(rawOptions, { ...dependencies, paths });
  } finally {
    await releaseLock();
  }
}

async function runBootstrapLocked(
  rawOptions: BootstrapOptions,
  dependencies: BootstrapDependencies,
): Promise<BootstrapResult> {
  const normalizedOptions = normalizeOptions(rawOptions);
  const options = {
    ...normalizedOptions,
    packageSpecifier:
      normalizedOptions.packageSpecifier ||
      (normalizedOptions.client === "codex" ? await resolveCurrentPackageSpecifier() : ""),
  };
  const paths = dependencies.paths ?? resolveProfilePaths();
  const profileStore = dependencies.profileStore ?? new ProfileStore(paths);
  const secretStore = dependencies.secretStore ?? createSecretStore();
  const verifier = dependencies.verifier ?? new NetworkBootstrapVerifier();
  const stateBefore = await profileStore.load();
  const existingProfile = stateBefore.profiles.find(
    (profile) => profile.name.toLowerCase() === options.profileName.toLowerCase(),
  );
  const profileId =
    existingProfile?.id ??
    deriveProfileId(
      options.profileName,
      stateBefore.profiles.map((profile) => profile.id),
    );
  const sourceCatalogPath = join(paths.sourceCatalogsDir, `${profileId}.json`);
  const profileCatalog = existingProfile
    ? await readOptionalFile(existingProfile.sourceCatalogPath)
    : undefined;
  const targetCatalog = await readOptionalFile(sourceCatalogPath);
  const protectedCatalog = [profileCatalog, targetCatalog].find(
    (content) => content !== undefined && !isGeneratedCatalog(content),
  );
  if (!options.replaceExisting && protectedCatalog !== undefined) {
    throw new Error(
      `Profile '${options.profileName}' would replace an existing hand-authored, modified, or orphaned source catalog. Re-run with --replace to replace it explicitly.`,
    );
  }
  const connection: KibanaConnectionConfig = {
    baseUrl: options.baseUrl,
    username: options.username,
    password: options.password,
    timeoutMs: options.timeoutMs,
  };
  const registrar = resolveRegistrar(options, dependencies.clientRegistrar);

  if (registrar) {
    await registrar.preflight();
  }

  await verifier.verify(connection);
  const existingGeneratedCatalog = [targetCatalog, profileCatalog]
    .filter((content): content is string => content !== undefined)
    .find((content) => isGeneratedCatalog(content));
  const catalog =
    !options.replaceExisting && existingGeneratedCatalog
      ? sourceCatalogSchema.parse(JSON.parse(existingGeneratedCatalog) as unknown)
      : createGeneratedCatalog([]);

  const previousCatalog = targetCatalog;
  const previousSecret = await loadPreviousSecret(secretStore, profileId);
  let localStateChanged = false;
  let secretPossiblyChanged = false;

  try {
    await writeJsonAtomically(sourceCatalogPath, catalog);
    localStateChanged = true;
    secretPossiblyChanged = true;
    await secretStore.save(profileId, {
      username: options.username,
      password: options.password,
    });
    await profileStore.upsertProfile(
      {
        id: profileId,
        name: options.profileName,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
        sourceCatalogPath,
      },
      { makeDefault: options.makeDefault },
    );

    if (registrar) {
      await registrar.register();
    }

    return {
      profileName: options.profileName,
      profileId,
      sourceCount: catalog.sources.length,
      sourceCatalogPath,
      client: options.client,
      registered: options.client === "codex",
      verified: true,
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (registrar) {
      await rollbackClientRegistration(registrar).catch((rollbackError: unknown) => {
        rollbackErrors.push(asErrorMessage(rollbackError));
      });
    }
    if (localStateChanged) {
      await profileStore.replaceState(stateBefore).catch((rollbackError: unknown) => {
        rollbackErrors.push(asErrorMessage(rollbackError));
      });
      await restoreFile(sourceCatalogPath, previousCatalog).catch((rollbackError: unknown) => {
        rollbackErrors.push(asErrorMessage(rollbackError));
      });
      if (secretPossiblyChanged) {
        await restoreSecret(secretStore, profileId, previousSecret).catch(
          (rollbackError: unknown) => {
            rollbackErrors.push(asErrorMessage(rollbackError));
          },
        );
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `${asErrorMessage(error)} Rollback also failed: ${rollbackErrors.join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}

class NetworkBootstrapVerifier implements BootstrapVerifier {
  async verify(connection: KibanaConnectionConfig): Promise<void> {
    await new KibanaClient(connection).verifyConnection();
  }
}

function resolveRegistrar(
  options: RequiredBootstrapOptions,
  injectedRegistrar?: ClientRegistrar,
): ClientRegistrar | undefined {
  if (options.client === "none") {
    return undefined;
  }
  return (
    injectedRegistrar ??
    new CodexClientRegistrar({
      mcpName: options.mcpName,
      profileName: options.profileName,
      packageSpecifier: options.packageSpecifier,
    })
  );
}

interface RequiredBootstrapOptions
  extends Omit<BootstrapOptions, "timeoutMs" | "mcpName" | "packageSpecifier"> {
  timeoutMs: number;
  mcpName: string;
  packageSpecifier: string;
}

function normalizeOptions(options: BootstrapOptions): RequiredBootstrapOptions {
  const profileName = options.profileName.trim();
  if (!profileName || !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(profileName)) {
    throw new Error(
      "Profile name must start with a letter or number and contain only letters, numbers, spaces, dashes, or underscores.",
    );
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const username = options.username.trim();
  const password = options.password;
  if (!username) throw new Error("Kibana username is required.");
  if (!password) throw new Error("Kibana password is required.");
  if (options.client !== "codex" && options.client !== "none") {
    throw new Error("Client must be either 'codex' or 'none'.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    throw new Error("Timeout must be a positive number no greater than 120000 milliseconds.");
  }

  return {
    ...options,
    profileName,
    baseUrl,
    username,
    password,
    timeoutMs,
    mcpName: options.mcpName?.trim() || DEFAULT_MCP_NAME,
    packageSpecifier: options.packageSpecifier?.trim() || "",
    replaceExisting: options.replaceExisting ?? false,
  };
}

export async function resolveCurrentPackageSpecifier(): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, "..", "package.json"),
    join(moduleDirectory, "..", "..", "package.json"),
  ];

  for (const candidate of candidates) {
    const content = await readOptionalFile(candidate);
    if (!content) continue;
    try {
      const parsed = JSON.parse(content) as { name?: unknown; version?: unknown };
      if (typeof parsed.name === "string" && typeof parsed.version === "string") {
        return `${parsed.name}@${parsed.version}`;
      }
    } catch {
      // Try the next package.json candidate.
    }
  }
  throw new Error("Could not resolve the running package version for deterministic registration.");
}

export function createGeneratedCatalog(
  sourceOrSources: SourceDefinition | SourceDefinition[],
): ReturnType<typeof sourceCatalogSchema.parse> {
  const sources = Array.isArray(sourceOrSources) ? sourceOrSources : [sourceOrSources];
  const parsedSources = sources.map((source) => sourceDefinitionSchema.parse(source));
  return sourceCatalogSchema.parse({
    generatedBy: {
      tool: "@havesomecode/kibana-mcp-server",
      formatVersion: 1,
      sourceHash: hashSources(parsedSources),
    },
    sources: parsedSources,
  });
}

export function parseGeneratedCatalog(
  content: string,
): ReturnType<typeof sourceCatalogSchema.parse> | undefined {
  try {
    const raw = JSON.parse(content) as unknown;
    const parsed = sourceCatalogSchema.parse(raw);
    if (!isPlainRecord(raw) || !hasExactKeys(raw, ["generatedBy", "sources"])) return undefined;
    if (!isPlainRecord(raw.generatedBy)) return undefined;
    if (!hasExactKeys(raw.generatedBy, ["formatVersion", "sourceHash", "tool"])) {
      return undefined;
    }
    if (!Array.isArray(raw.sources)) return undefined;
    if (!parsed.generatedBy || parsed.generatedBy.sourceHash !== hashSources(raw.sources)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isGeneratedCatalog(content: string): boolean {
  return parseGeneratedCatalog(content) !== undefined;
}

function hashSources(sources: unknown): string {
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expectedKeys: string[]): boolean {
  const keys = Object.keys(record).sort();
  return JSON.stringify(keys) === JSON.stringify([...expectedKeys].sort());
}

async function loadPreviousSecret(
  secretStore: SecretStore,
  profileId: string,
): Promise<SavedSecret | undefined> {
  try {
    return await secretStore.load(profileId);
  } catch (error) {
    if (error instanceof SecretStoreError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

function normalizeIndexes(rawIndexes: string[]): string[] {
  const indexes = [...new Set(rawIndexes.map((index) => index.trim()).filter(Boolean))];
  if (indexes.length === 0) {
    throw new Error("At least one Elasticsearch index pattern is required.");
  }
  return indexes;
}

function normalizeSourceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\*+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "logs";
}

function normalizeBaseUrl(rawValue: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    throw new Error("Kibana base URL must be a valid http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Kibana base URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Kibana base URL must not embed credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Kibana base URL must not include a query string or fragment.");
  }
  if (KNOWN_ENDPOINT_PATHS.some((path) => parsed.pathname.includes(path))) {
    throw new Error("Kibana base URL must not include endpoint paths such as /internal/search/es.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function restoreFile(path: string, previousContent: string | undefined): Promise<void> {
  if (previousContent === undefined) {
    await rm(path, { force: true });
    return;
  }
  await writeTextAtomically(path, previousContent);
}

async function restoreSecret(
  secretStore: SecretStore,
  profileId: string,
  previousSecret: SavedSecret | undefined,
): Promise<void> {
  if (previousSecret) {
    await secretStore.save(profileId, previousSecret);
    return;
  }
  await secretStore.delete(profileId);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function formatIndex(index: string | string[] | undefined): string {
  if (!index) return "unknown";
  return Array.isArray(index) ? index.join(",") : index;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rollbackClientRegistration(registrar: ClientRegistrar): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await registrar.rollback();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
