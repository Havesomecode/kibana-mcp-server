import type { SourceDefinition, SourceFieldDescriptor } from "./types.js";

function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase();
}

function buildFieldMap(fields: SourceFieldDescriptor[]): Map<string, SourceFieldDescriptor> {
  return new Map(fields.map((field) => [field.name, field]));
}

function linkFieldRelationships(fields: SourceFieldDescriptor[]): SourceFieldDescriptor[] {
  const fieldMap = buildFieldMap(fields);
  const subfieldsByParent = new Map<string, string[]>();

  for (const field of fields) {
    const parent =
      field.multi_field_parent ??
      (field.name.includes(".") ? field.name.slice(0, field.name.lastIndexOf(".")) : undefined);

    if (!parent) {
      continue;
    }

    const subfields = subfieldsByParent.get(parent) ?? [];
    subfields.push(field.name);
    subfieldsByParent.set(parent, subfields);
  }

  return fields.map((field) => {
    const subfields = [
      ...new Set([...(field.subfields ?? []), ...(subfieldsByParent.get(field.name) ?? [])]),
    ];
    const keywordSubfield = subfields
      .map((subfieldName) => fieldMap.get(subfieldName))
      .find((candidate) => candidate?.type === "keyword" && candidate.aggregatable);

    return {
      ...field,
      subfields,
      preferred_exact_field:
        field.preferred_exact_field ??
        (field.type === "text" ? keywordSubfield?.name : field.preferred_exact_field),
    };
  });
}

function mergeFieldHints(
  source: SourceDefinition,
  fields: SourceFieldDescriptor[],
): SourceFieldDescriptor[] {
  const byName = buildFieldMap(fields);

  for (const fieldHint of source.fieldHints) {
    const existing = byName.get(fieldHint.name);

    if (existing) {
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...(fieldHint.aliases ?? [])])];
      existing.description = existing.description ?? fieldHint.description;
      continue;
    }

    byName.set(fieldHint.name, {
      name: fieldHint.name,
      type: fieldHint.type,
      description: fieldHint.description,
      aliases: fieldHint.aliases ?? [],
      subfields: [],
    });
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export class SchemaCatalog {
  private readonly cache = new Map<string, SourceFieldDescriptor[]>();
  private readonly inFlight = new Map<string, Promise<SourceFieldDescriptor[]>>();

  constructor(
    private readonly client: {
      describeFields: (
        source: SourceDefinition,
        callerSignal?: AbortSignal,
      ) => Promise<SourceFieldDescriptor[]>;
    },
  ) {}

  async getFields(
    source: SourceDefinition,
    callerSignal?: AbortSignal,
  ): Promise<SourceFieldDescriptor[]> {
    const existing = this.cache.get(source.id);
    if (existing) {
      return existing;
    }

    const pending = this.inFlight.get(source.id);
    if (pending) {
      return pending;
    }

    const discovery = this.client.describeFields(source, callerSignal).then((fields) => {
      const resolved = linkFieldRelationships(mergeFieldHints(source, fields));
      this.cache.set(source.id, resolved);
      return resolved;
    });
    this.inFlight.set(source.id, discovery);

    try {
      return await discovery;
    } finally {
      if (this.inFlight.get(source.id) === discovery) {
        this.inFlight.delete(source.id);
      }
    }
  }

  filterFields(
    fields: SourceFieldDescriptor[],
    query?: string,
    limit = 100,
  ): SourceFieldDescriptor[] {
    const normalizedQuery = query ? normalizeFieldName(query) : undefined;
    const filtered = normalizedQuery
      ? fields.filter((field) => {
          const haystacks = [
            field.name,
            field.type ?? "",
            field.description ?? "",
            field.nested_path ?? "",
            field.object_array_path ?? "",
            field.multi_field_parent ?? "",
            field.preferred_exact_field ?? "",
            ...(field.aliases ?? []),
            ...field.subfields,
          ];

          return haystacks.some((value) => normalizeFieldName(value).includes(normalizedQuery));
        })
      : fields;

    return filtered.slice(0, limit);
  }
}
