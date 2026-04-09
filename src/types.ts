export type BackendKind = "elasticsearch_search" | "kibana_internal_search_es";
export type SchemaBackendKind =
  | "elasticsearch_field_caps"
  | "kibana_data_views_fields"
  | "kibana_index_patterns_fields";

export interface FieldHint {
  name: string;
  type?: string;
  description?: string;
  aliases?: string[];
}

export interface NormalizedFieldHint extends FieldHint {
  aliases: string[];
}

export interface SourceFieldDescriptor {
  name: string;
  type?: string;
  description?: string;
  aliases?: string[];
  searchable?: boolean;
  aggregatable?: boolean;
  subfields: string[];
  nested_path?: string;
  object_array_path?: string;
  multi_field_parent?: string;
  preferred_exact_field?: string;
}

export interface SourceBackendConfig {
  kind: BackendKind;
  path: string;
  index?: string | string[];
}

export interface SourceSchemaBackendConfig {
  kind: SchemaBackendKind;
  path?: string;
  index?: string | string[];
}

export interface SourceDefinition {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  timeField: string;
  backend: SourceBackendConfig;
  schema?: SourceSchemaBackendConfig;
  fieldHints: FieldHint[];
  defaultTextFields: string[];
  evidenceFields: string[];
}

export interface KibanaConnectionConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface AppConfig {
  kibana: KibanaConnectionConfig;
  sources: SourceDefinition[];
}

export interface ResolvedAppConfig extends AppConfig {
  profileName?: string;
  sourceCatalogPath?: string;
  sourceCatalogOrigin?: "environment" | "profile" | "runtime_default" | "static_default";
}

export interface SavedProfile {
  id: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  sourceCatalogPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedProfileStoreState {
  version: 1;
  defaultProfileId: string | null;
  profiles: SavedProfile[];
}

export interface SavedSecret {
  username: string;
  password: string;
}

export interface DiscoverSourceResult {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  time_field: string;
  field_hints: NormalizedFieldHint[];
}

export interface QueryFilter {
  field: string;
  value: string | number | boolean;
}

export interface NestedQueryFilter extends QueryFilter {
  path: string;
}

export type QueryMode = "hits" | "count" | "histogram" | "terms" | "stats" | "grouped_top_hits";
export type QuerySort = "asc" | "desc";

export interface QueryRequest {
  source_ids: string[];
  start_time: string;
  end_time: string;
  text?: string;
  filters?: QueryFilter[];
  nested_filters?: NestedQueryFilter[];
  cursor?: string;
  mode?: QueryMode;
  sort?: QuerySort;
  sort_by?: string;
  limit?: number;
  extract_nested?: boolean;
  stats_field?: string;
  top_hits_size?: number;
  histogram_interval?: string;
  group_by?: string;
}

export interface ResolvedQueryFilter extends QueryFilter {
  resolved_field: string;
}

export interface ResolvedNestedQueryFilter extends NestedQueryFilter {
  resolved_field: string;
  query_strategy?: "nested" | "flat_object_path";
}

export interface FieldResolutionAdvisory {
  kind: "preferred_exact_field" | "schema_unavailable" | "non_nested_object_array";
  source_id: string;
  purpose: "filter" | "sort" | "group_by";
  requested_field: string;
  resolved_field: string;
  reason: string;
}

export interface CompiledSourceQuery {
  source: SourceDefinition;
  request: {
    body: Record<string, unknown>;
  };
  resolvedFilters: ResolvedQueryFilter[];
  resolvedNestedFilters: ResolvedNestedQueryFilter[];
  resolvedSortBy: string;
  advisories: FieldResolutionAdvisory[];
}

export interface QueryPlan {
  mode: QueryMode;
  startTime: string;
  endTime: string;
  sort: QuerySort;
  sortBy?: string;
  cursor?: string;
  limit: number;
  text?: string;
  nestedFilters?: ResolvedNestedQueryFilter[];
  statsField?: string;
  topHitsSize?: number;
  histogramInterval?: string;
  groupBy?: string;
  sourceIds: string[];
  sourceQueries: CompiledSourceQuery[];
}

export interface KibanaSearchExecutionResult {
  source: SourceDefinition;
  rawResponse: Record<string, unknown>;
}

export interface NormalizedHit {
  source_id: string;
  timestamp: string | null;
  summary: string;
  document_id: string | null;
  index: string | null;
  selected_fields: Record<string, unknown>;
  nested_matches?: Array<{
    path: string;
    documents: Record<string, unknown>[];
  }>;
  raw_document: Record<string, unknown>;
}

export interface HistogramBucket {
  key: number | string;
  key_as_string?: string;
  count: number;
}

export interface TermsBucket {
  key: string;
  count: number;
}

export interface QueryStructuredResponse {
  query_echo: {
    source_ids: string[];
    start_time: string;
    end_time: string;
    text?: string;
    filters: ResolvedQueryFilter[];
    nested_filters?: ResolvedNestedQueryFilter[];
    cursor?: string;
    mode: QueryMode;
    sort: QuerySort;
    sort_by?: string;
    resolved_sort_by_by_source?: Array<{
      source_id: string;
      resolved_sort_by: string;
    }>;
    advisories?: FieldResolutionAdvisory[];
    limit: number;
    stats_field?: string;
    top_hits_size?: number;
    histogram_interval?: string;
    group_by?: string;
    truncated: boolean;
  };
  total: number;
  next_cursor?: string;
  hits?: NormalizedHit[];
  counts_by_source?: Array<{ source_id: string; count: number }>;
  histograms?: Array<{ source_id: string; buckets: HistogramBucket[] }>;
  groups?: Array<{ source_id: string; field: string; buckets: TermsBucket[] }>;
  stats?: Array<{
    source_id: string;
    field: string;
    summary: {
      count: number;
      min: number | null;
      max: number | null;
      avg: number | null;
      sum: number;
      p50: number | null;
      p95: number | null;
      p99: number | null;
    };
  }>;
  grouped_hits?: Array<{
    source_id: string;
    group_by: string;
    buckets: Array<{
      key: string;
      count: number;
      hits: NormalizedHit[];
    }>;
  }>;
}

export interface DescribeFieldsResult {
  source_id: string;
  total: number;
  fields: SourceFieldDescriptor[];
}
