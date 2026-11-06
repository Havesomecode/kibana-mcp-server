import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

import { toProfileKey } from "../../src/profiles/names.js";
import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
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

export const PROTOCOL_VERSION = "2026-07-28";
export const requestMeta = {
  [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
  [CLIENT_INFO_META_KEY]: { name: "http-test", version: "1.0.0" },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};

export function sendRpc(
  url: string,
  message: Record<string, unknown>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const params = (message.params ?? {}) as Record<string, unknown>;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "Mcp-Method": String(message.method),
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...message,
      params: {
        ...params,
        _meta: requestMeta,
      },
    }),
    signal,
  });
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

export async function callModernTool(
  url: string,
  name: string,
  headers: Record<string, string> = {},
  toolArguments: Record<string, unknown> = {},
): Promise<{ status: number; result?: Record<string, unknown> }> {
  const response = await sendRpc(
    url,
    { id: 1, method: "tools/call", params: { name, arguments: toolArguments } },
    headers,
  );
  const payload = await response.json();
  return { status: response.status, result: payload.result };
}

/** Writes the catalog of `profile` under a `{profile}` catalog path rooted at `directory`. */
export async function writeProfileCatalog(
  directory: string,
  profile: string,
  ids: string[],
): Promise<void> {
  await mkdir(join(directory, toProfileKey(profile)), { recursive: true });
  await writeFile(
    join(directory, toProfileKey(profile), "sources.json"),
    JSON.stringify(createGeneratedCatalog(ids.map(source))),
  );
}
