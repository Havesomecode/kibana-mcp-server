import type { SourceDefinition } from "../../src/types.js";

export function source(id: string): SourceDefinition {
  return {
    id,
    name: id,
    tags: [],
    timeField: "@timestamp",
    backend: { kind: "kibana_internal_search_es", path: "/internal/search/es", index: `${id}-*` },
    fieldHints: [],
    defaultTextFields: ["message"],
    evidenceFields: [],
  };
}

export async function callTool(
  url: string,
  name: string,
  headers: Record<string, string> = {},
  toolArguments: Record<string, unknown> = {},
): Promise<{ status: number; result?: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: toolArguments },
    }),
  });
  const text = await response.text();
  if (response.status !== 200) {
    return { status: response.status };
  }
  const payload = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length) ?? "{}");
  return {
    status: response.status,
    result: (JSON.parse(payload) as { result?: Record<string, unknown> }).result,
  };
}

export function sourceIds(result: Record<string, unknown> | undefined): string[] {
  const structured = result?.structuredContent as { sources: Array<{ id: string }> } | undefined;
  return (structured?.sources ?? []).map((entry) => entry.id);
}
