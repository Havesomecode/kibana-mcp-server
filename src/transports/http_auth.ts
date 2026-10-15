import { createHash, timingSafeEqual } from "node:crypto";

import {
  type AuthInfo,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";

import { normalizeProfileName } from "../profiles/names.js";
import { type HttpOidcOptions, createOidcResourceServer } from "./oidc.js";

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
