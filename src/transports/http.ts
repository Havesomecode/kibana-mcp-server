import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import {
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";

import {
  HTTP_AUTH_TOKEN_ENV,
  HTTP_HOST_ENV,
  HTTP_OIDC_ENV,
  HTTP_PATH_ENV,
  HTTP_PORT_ENV,
  HTTP_PROFILE_HEADER_ENV,
} from "../config/config_file.js";
import { type StartupConfiguration, loadStartupConfiguration } from "../config/startup.js";
import { ProfileRuntimeRegistry } from "../profiles/runtime.js";
import { createApplication } from "../server.js";
import { isLoopbackHost } from "../utils/net.js";
import {
  type HttpAuthOptions,
  type HttpAuthenticator,
  type HttpCaller,
  httpAuthMode,
} from "./http_auth.js";
import { oidcOptionsFromEnv } from "./oidc.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_PATH = "/mcp";
const HEALTH_PATH = "/healthz";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_LEGACY_SESSIONS = 128;
const MAX_LEGACY_SESSION_REQUESTS = 1024;
const LEGACY_SESSION_IDLE_MS = 30 * 60 * 1000;

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
  auth: HttpAuthOptions;
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
    const resolved = resolveHttpOptions(env, options);
    const authMode = httpAuthMode(resolved.auth);
    const registry = createProfileRegistry(authMode.perCallerProfile, startupConfiguration);
    // Local checks first: OIDC discovery reaches the issuer over the network.
    const authenticator = await authMode.createAuthenticator();
    return await listen(resolved, startupConfiguration, registry, authenticator);
  } catch (error) {
    await startupConfiguration.close().catch(() => {});
    throw error;
  }
}

function createProfileRegistry(
  perCallerProfile: string | undefined,
  startupConfiguration: StartupConfiguration,
): ProfileRuntimeRegistry {
  const registry = new ProfileRuntimeRegistry(startupConfiguration);
  if (perCallerProfile && !registry.supportsNamedProfiles) {
    throw new Error(
      `${perCallerProfile} requires named profiles: use saved profiles, a store in the configuration file, or the {profile} placeholder in KIBANA_SOURCE_CATALOG_PATH.`,
    );
  }
  if (!perCallerProfile && !registry.hasDefault) {
    throw new Error(
      "The HTTP transport needs a profile header, or a default profile named with --profile or KIBANA_PROFILE to serve every caller the same catalog.",
    );
  }
  return registry;
}

async function listen(
  resolved: ResolvedHttpOptions,
  startupConfiguration: StartupConfiguration,
  registry: ProfileRuntimeRegistry,
  authenticator: HttpAuthenticator,
): Promise<HttpServerHandle> {
  // The SDK builds servers inside the request it serves: the caller follows it there.
  const currentCaller = new AsyncLocalStorage<HttpCaller>();

  // Modern and handshake-free legacy calls stay per-request.
  const handler = createMcpHandler(() => {
    const caller = currentCaller.getStore();
    if (!caller) {
      throw new Error("MCP request reached the handler without an authenticated caller.");
    }
    return createApplication(undefined, {
      profileRegistry: registry,
      requestProfile: caller.profile,
    }).server;
  });

  const legacySessions = new Map<
    string,
    {
      server: McpServer;
      transport: WebStandardStreamableHTTPServerTransport;
      profile: string | undefined;
      lastUsed: number;
      requests: number;
    }
  >();
  let initializingSessions = 0;
  const fetchHandler = (request: Request, caller: HttpCaller): Promise<Response> =>
    currentCaller.run(caller, () => serve(request, caller));
  const serve = async (request: Request, { authInfo, profile }: HttpCaller): Promise<Response> => {
    if (!(await isLegacyRequest(request))) return handler.fetch(request, { authInfo });
    for (const session of legacySessions.values()) {
      if (Date.now() - session.lastUsed >= LEGACY_SESSION_IDLE_MS) await session.server.close();
    }
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
      let session = legacySessions.get(sessionId);
      // ponytail: recycle bounded sessions until the SDK releases cancelled request metadata.
      if (
        session &&
        session.profile === profile &&
        session.requests >= MAX_LEGACY_SESSION_REQUESTS
      ) {
        await session.server.close();
        session = undefined;
      }
      if (!session || session.profile !== profile) {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "Session not found" },
          },
          { status: 404 },
        );
      }
      session.lastUsed = Date.now();
      session.requests += 1;
      return session.transport.handleRequest(request, { authInfo });
    }
    const body =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    if (body?.method !== "initialize") return handler.fetch(request, { authInfo });
    if (legacySessions.size + initializingSessions >= MAX_LEGACY_SESSIONS) {
      return Response.json(
        { error: "Too many MCP sessions. Close an existing session and retry." },
        { status: 503 },
      );
    }

    // The SDK owns request IDs and cancellation inside each unguessable client session.
    initializingSessions += 1;
    const server = createApplication(undefined, {
      profileRegistry: registry,
      requestProfile: profile,
    }).server;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        legacySessions.set(id, { server, transport, profile, lastUsed: Date.now(), requests: 0 });
      },
    });
    transport.onclose = () => {
      legacySessions.delete(transport.sessionId ?? "");
    };
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body, authInfo });
      if (!transport.sessionId || response.status >= 400) await server.close();
      return response;
    } catch (error) {
      await server.close().catch(() => {});
      throw error;
    } finally {
      initializingSessions -= 1;
    }
  };

  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, resolved.path, authenticator, fetchHandler).catch(() => {
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
      await Promise.all([...legacySessions.values()].map((session) => session.server.close()));
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

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("HTTP port must be an integer between 0 and 65535.");
  }
  if (!path.startsWith("/") || path === HEALTH_PATH) {
    throw new Error(`HTTP path must start with '/' and differ from ${HEALTH_PATH}.`);
  }
  const auth = resolveAuthOptions(envInput, options);
  // Clients reach the endpoint, and its metadata, at the path of the resource URL.
  if (auth.kind === "oidc" && URL.canParse(auth.oidc.resource)) {
    const resourcePath = new URL(auth.oidc.resource).pathname.replace(/(.)\/+$/, "$1");
    if (resourcePath !== path) {
      throw new Error(
        `The path of ${HTTP_OIDC_ENV.resource} ('${resourcePath}') must be the HTTP path '${path}': clients call the resource URL and look up its metadata from that path. Behind a proxy, keep the path unchanged or set --path to match.`,
      );
    }
  }
  // Without authentication anyone who reaches the port can query Kibana and assert any profile.
  if (auth.kind === "local" && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to listen on non-loopback host '${host}' without ${HTTP_AUTH_TOKEN_ENV} or ${HTTP_OIDC_ENV.issuer}.`,
    );
  }
  return { host, port, path, auth };
}

function resolveAuthOptions(
  envInput: NodeJS.ProcessEnv,
  options: HttpServerOptions,
): HttpAuthOptions {
  const profileHeader = (
    options.profileHeader?.trim() || envInput[HTTP_PROFILE_HEADER_ENV]?.trim()
  )?.toLowerCase();
  const token = envInput[HTTP_AUTH_TOKEN_ENV]?.trim() || undefined;
  const oidc = oidcOptionsFromEnv(envInput);

  if (profileHeader && !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(profileHeader)) {
    throw new Error("Profile header must be a valid HTTP header name.");
  }
  if (profileHeader === "authorization") {
    throw new Error("Profile header must not be 'authorization'.");
  }
  if (!oidc) {
    return token ? { kind: "token", token, profileHeader } : { kind: "local", profileHeader };
  }
  if (token) {
    throw new Error(`${HTTP_OIDC_ENV.issuer} and ${HTTP_AUTH_TOKEN_ENV} are mutually exclusive.`);
  }
  // A caller-supplied header would let any authenticated user act as any profile.
  if (profileHeader) {
    throw new Error(
      `${HTTP_OIDC_ENV.issuer} reads the profile from a token claim: drop the profile header and choose the claim with ${HTTP_OIDC_ENV.profileClaim}.`,
    );
  }
  return { kind: "oidc", oidc };
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
  path: string,
  authenticator: HttpAuthenticator,
  fetchHandler: (request: Request, caller: HttpCaller) => Promise<Response>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === HEALTH_PATH && request.method === "GET") {
    writeJson(response, 200, { status: "ok" });
    return;
  }
  const headers = toWebHeaders(request);
  if (url.pathname.startsWith("/.well-known/")) {
    const metadata = authenticator.metadataResponse(
      new Request(url, { method: request.method, headers }),
    );
    if (metadata) {
      writeWebResponse(response, metadata);
      return;
    }
  }
  if (url.pathname !== path) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  // Before the body is read: unauthenticated callers cannot make the server buffer it.
  const caller = await authenticator.authenticate(headers);
  if (caller instanceof Response) {
    writeWebResponse(response, caller);
    return;
  }

  let webRequest: Request;
  const abortController = new AbortController();
  response.once("close", () => abortController.abort());
  try {
    webRequest = await toWebRequest(request, url, headers, abortController.signal);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      writeJson(response, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  writeWebResponse(response, await fetchHandler(webRequest, caller), abortController.signal);
}

function writeWebResponse(
  response: ServerResponse,
  webResponse: Response,
  signal?: AbortSignal,
): void {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  if (!webResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(webResponse.body as Parameters<typeof Readable.fromWeb>[0], { signal })
    .on("error", () => response.destroy())
    .pipe(response);
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
