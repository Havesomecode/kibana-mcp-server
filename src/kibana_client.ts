import type {
  AppConfig,
  CompiledSourceQuery,
  KibanaSearchExecutionResult,
  SourceDefinition,
  SourceFieldDescriptor,
  SourceSchemaBackendConfig,
} from "./types.js";

const DEFAULT_META_FIELDS = ["_source", "_id", "_index", "_score"] as const;

class KibanaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`Kibana request failed with status ${status}: ${responseBody}`);
    this.name = "KibanaHttpError";
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString("base64");
}

function unwrapSearchResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Unexpected Kibana search response shape");
  }

  const record = raw as Record<string, unknown>;

  if (record.rawResponse && typeof record.rawResponse === "object") {
    return record.rawResponse as Record<string, unknown>;
  }

  if (record.response && typeof record.response === "object") {
    const responseRecord = record.response as Record<string, unknown>;
    if (responseRecord.rawResponse && typeof responseRecord.rawResponse === "object") {
      return responseRecord.rawResponse as Record<string, unknown>;
    }
    if (responseRecord.hits || responseRecord.aggregations || responseRecord.aggs) {
      return responseRecord;
    }
  }

  if (record.hits || record.aggregations || record.aggs) {
    return record;
  }

  throw new Error("Unexpected Kibana search response shape");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeFieldCapsResponse(raw: unknown): SourceFieldDescriptor[] {
  const fields = asRecord(asRecord(raw).fields);

  return Object.entries(fields)
    .map(([name, typeEntries]) => {
      const typeRecord = asRecord(typeEntries);
      const firstEntry = Object.values(typeRecord)[0];
      const fieldCaps = asRecord(firstEntry);

      return {
        name,
        type: typeof fieldCaps.type === "string" ? fieldCaps.type : Object.keys(typeRecord)[0],
        searchable: typeof fieldCaps.searchable === "boolean" ? fieldCaps.searchable : undefined,
        aggregatable:
          typeof fieldCaps.aggregatable === "boolean" ? fieldCaps.aggregatable : undefined,
        subfields: [],
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeKibanaFieldsResponse(raw: unknown): SourceFieldDescriptor[] {
  const rawFields = Array.isArray(raw) ? raw : asArray(asRecord(raw).fields);

  return rawFields
    .map((field): SourceFieldDescriptor | null => {
      const fieldRecord = asRecord(field);
      const name = fieldRecord.name;

      if (typeof name !== "string") {
        return null;
      }

      const subType = asRecord(fieldRecord.subType);
      const nested = asRecord(subType.nested);
      const multi = asRecord(subType.multi);

      return {
        name,
        type: typeof fieldRecord.type === "string" ? fieldRecord.type : undefined,
        searchable:
          typeof fieldRecord.searchable === "boolean" ? fieldRecord.searchable : undefined,
        aggregatable:
          typeof fieldRecord.aggregatable === "boolean" ? fieldRecord.aggregatable : undefined,
        nested_path: typeof nested.path === "string" ? nested.path : undefined,
        multi_field_parent: typeof multi.parent === "string" ? multi.parent : undefined,
        subfields: [],
      };
    })
    .filter((field): field is SourceFieldDescriptor => field !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveSchemaIndexPatterns(
  source: SourceDefinition,
  schemaBackend: SourceSchemaBackendConfig,
): string {
  const schemaIndex = schemaBackend.index ?? source.backend.index;

  if (!schemaIndex) {
    throw new Error(
      `Source '${source.id}' does not declare schema index patterns. Configure source.schema.index or backend.index.`,
    );
  }

  return Array.isArray(schemaIndex) ? schemaIndex.join(",") : schemaIndex;
}

function dedupePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path?.trim())))];
}

function resolveSchemaPaths(
  source: SourceDefinition,
  schemaBackend: SourceSchemaBackendConfig,
  patterns: string,
): string[] {
  if (schemaBackend.kind === "elasticsearch_field_caps") {
    return [schemaBackend.path ?? `/${patterns}/_field_caps`];
  }

  if (schemaBackend.kind === "kibana_data_views_fields") {
    return dedupePaths([
      schemaBackend.path,
      "/internal/data_views/_fields_for_wildcard",
      "/api/data_views/fields_for_wildcard",
      "/api/index_patterns/_fields_for_wildcard",
    ]);
  }

  return dedupePaths([
    schemaBackend.path,
    "/api/index_patterns/_fields_for_wildcard",
    "/internal/data_views/_fields_for_wildcard",
    "/api/data_views/fields_for_wildcard",
  ]);
}

function buildKibanaSchemaUrl(baseUrl: string, schemaPath: string, patterns: string): string {
  const url = new URL(joinUrl(baseUrl, schemaPath));
  url.searchParams.set("pattern", patterns);
  url.searchParams.set("allow_no_index", "true");

  for (const metaField of DEFAULT_META_FIELDS) {
    url.searchParams.append("meta_fields", metaField);
  }

  return url.toString();
}

function inferPrimitiveFieldType(value: unknown, fieldName?: string): string | undefined {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? "long" : "double";
  }

  if (typeof value === "string") {
    if (fieldName?.endsWith(".keyword")) {
      return "keyword";
    }

    if (
      fieldName &&
      /(^@timestamp$)|((^|[._-])(timestamp|time|date|created|ingested|updated)([._-]|$))/i.test(
        fieldName,
      ) &&
      !Number.isNaN(Date.parse(value))
    ) {
      return "date";
    }

    return "text";
  }

  return undefined;
}

function upsertFieldDescriptor(
  fieldMap: Map<string, SourceFieldDescriptor>,
  field: SourceFieldDescriptor,
): void {
  const existing = fieldMap.get(field.name);

  if (!existing) {
    fieldMap.set(field.name, {
      ...field,
      subfields: [...new Set(field.subfields)],
    });
    return;
  }

  fieldMap.set(field.name, {
    ...existing,
    type: existing.type ?? field.type,
    description: existing.description ?? field.description,
    searchable: existing.searchable ?? field.searchable,
    aggregatable: existing.aggregatable ?? field.aggregatable,
    nested_path: existing.nested_path ?? field.nested_path,
    object_array_path: existing.object_array_path ?? field.object_array_path,
    multi_field_parent: existing.multi_field_parent ?? field.multi_field_parent,
    preferred_exact_field: existing.preferred_exact_field ?? field.preferred_exact_field,
    subfields: [...new Set([...(existing.subfields ?? []), ...(field.subfields ?? [])])],
  });
}

function normalizeInferredNestedPath(
  nestedPath: string | undefined,
  objectArrayPath: string | undefined,
): string | undefined {
  // Sampled hits cannot prove Elasticsearch nested mappings. Once a field is inferred under an
  // array-of-objects path, keep that shape explicit and never mark it as nested.
  return objectArrayPath ? undefined : nestedPath;
}

function collectFieldsFromSourceDocument(
  value: unknown,
  fieldMap: Map<string, SourceFieldDescriptor>,
  path?: string,
  nestedPath?: string,
  objectArrayPath?: string,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    const objectValues = value.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );

    if (path && objectValues.length > 0) {
      for (const entry of objectValues) {
        for (const [key, childValue] of Object.entries(entry)) {
          collectFieldsFromSourceDocument(childValue, fieldMap, `${path}.${key}`, undefined, path);
        }
      }
      return;
    }

    const primitiveSample = value.find(
      (entry) => entry !== null && entry !== undefined && typeof entry !== "object",
    );
    if (path && primitiveSample !== undefined) {
      upsertFieldDescriptor(fieldMap, {
        name: path,
        type: inferPrimitiveFieldType(primitiveSample, path),
        searchable: true,
        aggregatable: typeof primitiveSample !== "string",
        nested_path: normalizeInferredNestedPath(nestedPath, objectArrayPath),
        object_array_path: objectArrayPath,
        subfields: [],
      });
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      collectFieldsFromSourceDocument(childValue, fieldMap, childPath, nestedPath, objectArrayPath);
    }
    return;
  }

  if (!path) {
    return;
  }

  upsertFieldDescriptor(fieldMap, {
    name: path,
    type: inferPrimitiveFieldType(value, path),
    searchable: true,
    aggregatable: typeof value !== "string",
    nested_path: normalizeInferredNestedPath(nestedPath, objectArrayPath),
    object_array_path: objectArrayPath,
    subfields: [],
  });
}

function collectFieldsFromSearchHit(
  hit: Record<string, unknown>,
  fieldMap: Map<string, SourceFieldDescriptor>,
): void {
  collectFieldsFromSourceDocument(asRecord(hit._source), fieldMap);

  const fieldValues = asRecord(hit.fields);
  for (const [fieldName, values] of Object.entries(fieldValues)) {
    const firstValue = Array.isArray(values) ? values.find((value) => value !== undefined) : values;
    const multiFieldParent = fieldName.includes(".")
      ? fieldName.slice(0, fieldName.lastIndexOf("."))
      : undefined;
    const inferredType = inferPrimitiveFieldType(firstValue, fieldName);

    upsertFieldDescriptor(fieldMap, {
      name: fieldName,
      type: inferredType,
      searchable: true,
      aggregatable: true,
      multi_field_parent: multiFieldParent,
      preferred_exact_field: inferredType === "keyword" && multiFieldParent ? fieldName : undefined,
      subfields: [],
    });

    if (inferredType === "keyword" && multiFieldParent) {
      upsertFieldDescriptor(fieldMap, {
        name: multiFieldParent,
        type: fieldMap.get(multiFieldParent)?.type ?? "text",
        searchable: true,
        aggregatable: false,
        preferred_exact_field: fieldName,
        subfields: [fieldName],
      });
    }
  }
}

function normalizeSearchSampleFields(raw: unknown): SourceFieldDescriptor[] {
  const hitsRecord = asRecord(asRecord(raw).hits);
  const hits = asArray(hitsRecord.hits);
  const fieldMap = new Map<string, SourceFieldDescriptor>();

  for (const hit of hits) {
    collectFieldsFromSearchHit(asRecord(hit), fieldMap);
  }

  return [...fieldMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export class KibanaClient {
  constructor(private readonly config: AppConfig["kibana"]) {}

  private async requestJson(
    url: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${encodeBasicAuth(this.config.username, this.config.password)}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new KibanaHttpError(response.status, errorBody);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async execute(compiledQuery: CompiledSourceQuery): Promise<KibanaSearchExecutionResult> {
    const source = compiledQuery.source;
    const endpoint = joinUrl(this.config.baseUrl, source.backend.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const body =
        source.backend.kind === "kibana_internal_search_es"
          ? {
              params: {
                ...(source.backend.index ? { index: source.backend.index } : {}),
                body: compiledQuery.request.body,
              },
            }
          : compiledQuery.request.body;

      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${encodeBasicAuth(this.config.username, this.config.password)}`,
          "Content-Type": "application/json",
          ...(source.backend.kind === "kibana_internal_search_es"
            ? { "kbn-xsrf": "kibana-mcp-server" }
            : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Kibana request failed for source '${source.id}' with status ${response.status}: ${errorBody}`,
        );
      }

      const responseJson = (await response.json()) as unknown;
      return {
        source,
        rawResponse: unwrapSearchResponse(responseJson),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async executeMany(sourceQueries: CompiledSourceQuery[]): Promise<KibanaSearchExecutionResult[]> {
    return Promise.all(sourceQueries.map((sourceQuery) => this.execute(sourceQuery)));
  }

  private async describeFieldsViaSearchBackend(
    source: SourceDefinition,
  ): Promise<SourceFieldDescriptor[]> {
    const endpoint = joinUrl(this.config.baseUrl, source.backend.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const body =
        source.backend.kind === "kibana_internal_search_es"
          ? {
              params: {
                ...(source.backend.index ? { index: source.backend.index } : {}),
                body: {
                  size: 20,
                  fields: ["*"],
                  _source: true,
                  track_total_hits: false,
                },
              },
            }
          : {
              size: 20,
              fields: ["*"],
              _source: true,
              track_total_hits: false,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${encodeBasicAuth(this.config.username, this.config.password)}`,
          "Content-Type": "application/json",
          ...(source.backend.kind === "kibana_internal_search_es"
            ? { "kbn-xsrf": "kibana-mcp-server" }
            : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Search transport fallback failed for source '${source.id}' with status ${response.status}: ${errorBody}`,
        );
      }

      const responseJson = (await response.json()) as unknown;
      const rawResponse = unwrapSearchResponse(responseJson);
      const fields = normalizeSearchSampleFields(rawResponse);

      if (fields.length === 0) {
        throw new Error(
          `Search transport fallback returned no fields for source '${source.id}'. Sample hits may be empty for the requested index pattern.`,
        );
      }

      return fields;
    } finally {
      clearTimeout(timeout);
    }
  }

  async describeFields(source: SourceDefinition): Promise<SourceFieldDescriptor[]> {
    const schemaBackend = source.schema;

    if (!schemaBackend) {
      throw new Error(
        `Source '${source.id}' does not configure a schema backend. Add source.schema before using describe_fields or schema-dependent query features.`,
      );
    }

    const patterns = resolveSchemaIndexPatterns(source, schemaBackend);
    const schemaPaths = resolveSchemaPaths(source, schemaBackend, patterns);

    if (schemaBackend.kind === "elasticsearch_field_caps") {
      const schemaPath = schemaPaths[0];

      if (!schemaPath) {
        throw new Error(
          `Schema backend '${schemaBackend.kind}' does not have a usable path for source '${source.id}'`,
        );
      }

      const separator = schemaPath.includes("?") ? "&" : "?";
      const url = joinUrl(this.config.baseUrl, `${schemaPath}${separator}fields=*`);
      let responseJson: unknown;
      try {
        responseJson = await this.requestJson(url, {
          method: "GET",
        });
      } catch (error) {
        throw new Error(
          `Schema backend '${schemaBackend.kind}' request failed for source '${source.id}' at '${schemaPath}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        return normalizeFieldCapsResponse(responseJson);
      } catch (error) {
        throw new Error(
          `Schema backend '${schemaBackend.kind}' returned an unexpected field capabilities payload for source '${source.id}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const attempts: string[] = [];

    for (const schemaPath of schemaPaths) {
      const url = buildKibanaSchemaUrl(this.config.baseUrl, schemaPath, patterns);

      try {
        const responseJson = await this.requestJson(url, {
          method: "GET",
          headers: {
            "kbn-xsrf": "kibana-mcp-server",
          },
        });

        try {
          return normalizeKibanaFieldsResponse(responseJson);
        } catch (error) {
          throw new Error(
            `Schema backend '${schemaBackend.kind}' returned an unexpected Kibana field payload for source '${source.id}' from '${schemaPath}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      } catch (error) {
        if (error instanceof KibanaHttpError && error.status === 404) {
          attempts.push(`${schemaPath} -> 404`);
          continue;
        }

        throw new Error(
          `Schema backend '${schemaBackend.kind}' request failed for source '${source.id}' at '${schemaPath}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.describeFieldsViaSearchBackend(source).catch((fallbackError) => {
      throw new Error(
        `Schema backend '${schemaBackend.kind}' returned 404 for source '${source.id}' on every known Kibana field-discovery path (${attempts.join(", ")}). Search transport fallback also failed: ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`,
      );
    });
  }
}
