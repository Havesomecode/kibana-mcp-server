import type { DiscoverSourceResult, SourceDefinition } from "./types.js";

export class SourceCatalog {
  private readonly sourceMap: Map<string, SourceDefinition>;

  constructor(private readonly sources: SourceDefinition[]) {
    this.sourceMap = new Map(sources.map((source) => [source.id, source]));
  }

  count(): number {
    return this.sources.length;
  }

  list(query?: string, limit = 20): DiscoverSourceResult[] {
    const normalizedQuery = query?.trim().toLowerCase();
    const filtered = normalizedQuery
      ? this.sources.filter((source) => this.matchesQuery(source, normalizedQuery))
      : this.sources;

    return filtered.slice(0, limit).map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description,
      tags: source.tags,
      time_field: source.timeField,
      field_hints: source.fieldHints.map((fieldHint) => ({
        ...fieldHint,
        aliases: fieldHint.aliases ?? [],
      })),
    }));
  }

  getRequiredSources(sourceIds: string[]): SourceDefinition[] {
    const resolved = sourceIds.map((sourceId) => this.sourceMap.get(sourceId));
    const missing = sourceIds.filter((sourceId, index) => !resolved[index]);

    if (missing.length > 0) {
      throw new Error(`Unknown source ids: ${missing.join(", ")}`);
    }

    return resolved as SourceDefinition[];
  }

  private matchesQuery(source: SourceDefinition, query: string): boolean {
    const haystacks = [
      source.id,
      source.name,
      source.description ?? "",
      ...source.tags,
      ...source.fieldHints.flatMap((fieldHint) => [
        fieldHint.name,
        fieldHint.description ?? "",
        ...(fieldHint.aliases ?? []),
      ]),
    ];

    return haystacks.some((value) => value.toLowerCase().includes(query));
  }
}
