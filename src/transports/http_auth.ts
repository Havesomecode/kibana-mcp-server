import { createHash, timingSafeEqual } from "node:crypto";

import {
  type AuthInfo,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";

import { HTTP_OIDC_ENV } from "../config/config_file.js";
import { normalizeProfileName } from "../profiles/names.js";

export interface HttpOidcOptions {
  /** Issuer identifier, as published in its discovery document. */
  issuer: string;
  /** Public URL of the MCP endpoint, as clients reach it. */
  resource: string;
  /** Expected token audience. Defaults to `resource`. */
  audience?: string;
  /**
   * `offline` validates RFC 9068 JWT access tokens with the issuer JWKS; `introspection` asks the
   * issuer (RFC 7662). Defaults to `introspection` when `clientId` is set, `offline` otherwise.
   */
  mode?: "offline" | "introspection";
  /** Credentials of this server at the issuer, required by the introspection mode. */
  clientId?: string;
  clientSecret?: string;
  /** Scopes every token must carry. */
  requiredScopes?: string[];
  /** Scopes advertised in the protected resource metadata. */
  scopesSupported?: string[];
  /** Claim naming the caller within the issuer, which prefixes the profile. Defaults to `sub`. */
  profileClaim?: string;
  /** Allow a non-HTTPS issuer or resource. Local development only. */
  allowInsecureRequests?: boolean;
}

/** Reads the OIDC options from the environment, or `undefined` when no issuer is set. */
export function oidcOptionsFromEnv(envInput: NodeJS.ProcessEnv): HttpOidcOptions | undefined {
  const read = (name: string) => envInput[name]?.trim() || undefined;
  // Scope tokens may contain commas (RFC 6749): only whitespace separates them.
  const list = (name: string) => read(name)?.split(/\s+/).filter(Boolean);
  const issuer = read(HTTP_OIDC_ENV.issuer);
  if (!issuer) return undefined;

  const resource = read(HTTP_OIDC_ENV.resource);
  if (!resource) {
    throw new Error(
      `${HTTP_OIDC_ENV.resource} is required with ${HTTP_OIDC_ENV.issuer}: the public URL of the MCP endpoint.`,
    );
  }
  const mode = read(HTTP_OIDC_ENV.mode);
  if (mode !== undefined && mode !== "offline" && mode !== "introspection") {
    throw new Error(`${HTTP_OIDC_ENV.mode} must be 'offline' or 'introspection'.`);
  }
  return {
    issuer,
    resource,
    audience: read(HTTP_OIDC_ENV.audience),
    mode,
    clientId: read(HTTP_OIDC_ENV.clientId),
    clientSecret: read(HTTP_OIDC_ENV.clientSecret),
    requiredScopes: list(HTTP_OIDC_ENV.requiredScopes),
    scopesSupported: list(HTTP_OIDC_ENV.scopesSupported),
    profileClaim: read(HTTP_OIDC_ENV.profileClaim),
    allowInsecureRequests: read(HTTP_OIDC_ENV.allowInsecureRequests) === "true",
  };
}

/** How the HTTP transport authenticates callers, resolved from the configuration. */
export type HttpAuthOptions =
  | { kind: "local"; profileHeader?: string }
  | { kind: "token"; token: string; profileHeader?: string }
  | { kind: "oidc"; oidc: HttpOidcOptions };

/**
 * An authenticated caller: the verified token handed to MCP handlers, when the caller presented
 * one, and the profile whose catalog it is served.
 */
export interface HttpCaller {
  authInfo?: AuthInfo;
  profile?: string;
}

export interface HttpAuthenticator {
  /** Answers the discovery documents of the authentication scheme, or `undefined`. */
  metadataResponse: (request: Request) => Response | undefined;
  /**
   * Authenticates a request to the MCP endpoint from its headers, before its body is read, or
   * returns the refusal to send back.
   */
  authenticate: (headers: Headers) => Promise<HttpCaller | Response>;
}

export interface HttpAuthMode {
  /**
   * Names where each caller's profile comes from, for startup errors, or `undefined` when every
   * caller is served the default profile.
   */
  perCallerProfile?: string;
  /** Builds the authenticator; OIDC reaches the issuer, so run local checks first. */
  createAuthenticator: () => Promise<HttpAuthenticator>;
}

export function httpAuthMode(auth: HttpAuthOptions): HttpAuthMode {
  switch (auth.kind) {
    case "local":
      return {
        perCallerProfile: auth.profileHeader && "A profile header",
        createAuthenticator: async () => ({
          metadataResponse: () => undefined,
          // Without a secret, only pages and tools of this machine may call: refuse DNS rebinding.
          authenticate: async (headers) =>
            validateHostHeader(headers.get("host"), localhostAllowedHostnames()).ok &&
            validateOriginHeader(headers.get("origin"), localhostAllowedOrigins()).ok
              ? callerFromHeader(headers, auth.profileHeader)
              : refusal(403, "Untrusted Host or Origin."),
        }),
      };
    case "token":
      return {
        perCallerProfile: auth.profileHeader && "A profile header",
        createAuthenticator: async () => ({
          metadataResponse: () => undefined,
          authenticate: async (headers) =>
            matchesToken(headers.get("authorization"), auth.token)
              ? callerFromHeader(headers, auth.profileHeader)
              : refusal(401, "invalid_token", { "WWW-Authenticate": "Bearer" }),
        }),
      };
    case "oidc":
      return {
        perCallerProfile: "OIDC authentication",
        createAuthenticator: async () => {
          // Loaded here: oauth4webapi is only needed when OIDC is configured.
          const { createOidcResourceServer } = await import("./oidc.js");
          const server = await createOidcResourceServer(auth.oidc);
          return {
            metadataResponse: server.metadataResponse,
            authenticate: (headers) =>
              server.authenticate(headers.get("authorization") ?? undefined),
          };
        },
      };
  }
}

// The gateway authenticated the caller; the header names it.
function callerFromHeader(
  headers: Headers,
  profileHeader: string | undefined,
): HttpCaller | Response {
  if (!profileHeader) return {};
  const value = headers.get(profileHeader)?.trim();
  if (!value) return refusal(401, `Missing required '${profileHeader}' header.`);
  try {
    return { profile: normalizeProfileName(value) };
  } catch (error) {
    return refusal(400, error instanceof Error ? error.message : String(error));
  }
}

function matchesToken(authorization: string | null, expectedToken: string): boolean {
  const match = /^Bearer +(.+)$/i.exec(authorization?.trim() ?? "");
  if (!match) {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expectedToken));
}

function refusal(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}
