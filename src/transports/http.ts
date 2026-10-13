import { createHash, timingSafeEqual } from "node:crypto";
import {
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { createMcpHandler } from "@modelcontextprotocol/server";

import {
  HTTP_AUTH_TOKEN_ENV,
  HTTP_HOST_ENV,
  HTTP_PATH_ENV,
  HTTP_PORT_ENV,
  HTTP_PROFILE_HEADER_ENV,
} from "../config/config_file.js";
import { type StartupConfiguration, loadStartupConfiguration } from "../config/startup.js";
import { normalizeProfileName } from "../profiles/names.js";
import { ProfileRuntimeRegistry } from "../profiles/runtime.js";
import { createApplication } from "../server.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_PATH = "/mcp";
const HEALTH_PATH = "/healthz";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface HttpServerOptions {
  host?: string;
  port?: number;
  path?: string;
  profileHeader?: string;
}

export interface HttpServerHandle {
  url: string;
  close: () => Promise<void>;
}

interface ResolvedHttpOptions {
  host: string;
  port: number;
  path: string;
  profileHeader?: string;
  authToken?: string;
}

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startHttpMcpServer(
  envInput: NodeJS.ProcessEnv = process.env,
  options: HttpServerOptions = {},
  dependencies: {
    startupConfiguration?: StartupConfiguration;
  } = {},
): Promise<HttpServerHandle> {
  const { env, startupConfiguration } = dependencies.startupConfiguration
    ? { env: envInput, startupConfiguration: dependencies.startupConfiguration }
    : await loadStartupConfiguration(envInput);
  try {
    return await listen(resolveHttpOptions(env, options), startupConfiguration);
  } catch (error) {
    await startupConfiguration.close().catch(() => {});
    throw error;
  }
}

async function listen(
  resolved: ResolvedHttpOptions,
  startupConfiguration: StartupConfiguration,
): Promise<HttpServerHandle> {
  const registry = new ProfileRuntimeRegistry(startupConfiguration);

  if (resolved.profileHeader && !registry.supportsNamedProfiles) {
    throw new Error(
      "A profile header requires named profiles: use saved profiles, a store in the configuration file, or the {profile} placeholder in KIBANA_SOURCE_CATALOG_PATH.",
    );
  }
  if (!resolved.profileHeader && !registry.hasDefault) {
    throw new Error(
      "The HTTP transport needs a profile header, or a default profile named with --profile or KIBANA_PROFILE to serve every caller the same catalog. The legacy 'configure' tool is available over stdio only.",
    );
  }

  // One MCP server per request; the registry is the only state shared between requests.
  const handler = createMcpHandler((context) => {
    const requestProfile = resolved.profileHeader
      ? readProfileHeader(context.requestInfo?.headers, resolved.profileHeader)
      : undefined;
    return createApplication(undefined, { profileRegistry: registry, requestProfile }).server;
  });

  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, resolved, handler.fetch).catch(() => {
      if (!response.headersSent) {
        writeJson(response, 500, { error: "internal_error" });
        return;
      }
      response.destroy();
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(resolved.port, resolved.host, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${urlHost}:${address.port}${resolved.path}`,
    close: async () => {
      await handler.close();
      await closeHttpServer(httpServer);
      await startupConfiguration.close();
    },
  };
}

function resolveHttpOptions(
  envInput: NodeJS.ProcessEnv,
  options: HttpServerOptions,
): ResolvedHttpOptions {
  const host = options.host?.trim() || envInput[HTTP_HOST_ENV]?.trim() || DEFAULT_HOST;
  const port = options.port ?? parsePort(envInput[HTTP_PORT_ENV]) ?? DEFAULT_PORT;
  const path = options.path?.trim() || envInput[HTTP_PATH_ENV]?.trim() || DEFAULT_PATH;
  const profileHeader = (
    options.profileHeader?.trim() || envInput[HTTP_PROFILE_HEADER_ENV]?.trim()
  )?.toLowerCase();
  const authToken = envInput[HTTP_AUTH_TOKEN_ENV]?.trim() || undefined;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("HTTP port must be an integer between 0 and 65535.");
  }
  if (!path.startsWith("/") || path === HEALTH_PATH) {
    throw new Error(`HTTP path must start with '/' and differ from ${HEALTH_PATH}.`);
  }
  if (profileHeader && !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(profileHeader)) {
    throw new Error("Profile header must be a valid HTTP header name.");
  }
  if (profileHeader === "authorization") {
    throw new Error("Profile header must not be 'authorization'.");
  }
  // Without a token anyone who reaches the port can query Kibana and assert any profile.
  if (!authToken && !LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to listen on non-loopback host '${host}' without ${HTTP_AUTH_TOKEN_ENV}.`,
    );
  }

  return { host, port, path, profileHeader, authToken };
}

export function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedHttpOptions,
  fetchHandler: (request: Request) => Promise<Response>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === HEALTH_PATH && request.method === "GET") {
    writeJson(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname !== options.path) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  if (options.authToken && !isAuthorized(request.headers.authorization, options.authToken)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    writeJson(response, 401, { error: "invalid_token" });
    return;
  }

  let webRequest: Request;
  const abortController = new AbortController();
  response.once("close", () => abortController.abort());
  try {
    const headers = toWebHeaders(request);
    // Refused here to answer with a plain HTTP status; the MCP handler reads the value again.
    if (options.profileHeader) {
      readProfileHeader(headers, options.profileHeader);
    }
    webRequest = await toWebRequest(request, url, headers, abortController.signal);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      writeJson(response, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  const webResponse = await fetchHandler(webRequest);
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  if (!webResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(webResponse.body as Parameters<typeof Readable.fromWeb>[0])
    .on("error", () => response.destroy())
    .pipe(response);
}

function readProfileHeader(headers: Headers | undefined, headerName: string): string {
  const value = headers?.get(headerName)?.trim();
  if (!value) {
    throw new HttpRequestError(401, `Missing required '${headerName}' header.`);
  }
  try {
    return normalizeProfileName(value);
  } catch (error) {
    throw new HttpRequestError(400, error instanceof Error ? error.message : String(error));
  }
}

function isAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  const match = /^Bearer +(.+)$/i.exec(authorization?.trim() ?? "");
  if (!match) {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expectedToken));
}

function toWebHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function toWebRequest(
  request: IncomingMessage,
  url: URL,
  headers: Headers,
  signal: AbortSignal,
): Promise<Request> {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers, signal });
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpRequestError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks), signal });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function closeHttpServer(httpServer: NodeHttpServer): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    httpServer.close((error) => (error ? rejectClose(error) : resolveClose()));
    httpServer.closeAllConnections();
  });
}
