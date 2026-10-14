import { createHash } from "node:crypto";

import {
  type AuthInfo,
  type BearerAuthOptions,
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  resourceUrlFromServerUrl,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import * as oauth from "oauth4webapi";

import { HTTP_OIDC_ENV } from "../config/config_file.js";
import { normalizeProfileName } from "../profiles/names.js";
import { isLoopbackHost } from "../utils/net.js";

const DEFAULT_PROFILE_CLAIM = "sub";
const INTROSPECTION_CACHE_MS = 60 * 1000;
const MAX_INTROSPECTION_CACHE_ENTRIES = 1024;
// Failures caused by the token itself; anything else is an unreachable or broken issuer.
const INVALID_TOKEN_CODES = new Set<string | undefined>([
  oauth.INVALID_REQUEST,
  oauth.INVALID_RESPONSE,
  oauth.PARSE_ERROR,
  oauth.JWT_TIMESTAMP_CHECK,
  oauth.JWT_CLAIM_COMPARISON,
  oauth.KEY_SELECTION,
]);

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
  /** Claim naming the caller's profile. Defaults to `sub`. */
  profileClaim?: string;
  /** Allow a non-HTTPS issuer or resource. Local development only. */
  allowInsecureRequests?: boolean;
}

export interface OidcResourceServer {
  /** Answers the RFC 9728 and RFC 8414 discovery documents, or `undefined` for other paths. */
  metadataResponse: (request: Request) => Response | undefined;
  /**
   * Verifies the `Authorization` header and reads the caller's profile from the token, or
   * returns the 401/403/500 challenge to send back.
   */
  authenticate: (
    authorization: string | undefined,
  ) => Promise<{ authInfo: AuthInfo; profile: string } | Response>;
}

type Claims = Record<string, unknown>;

/** Reads the OIDC options from the environment, or `undefined` when no issuer is set. */
export function oidcOptionsFromEnv(envInput: NodeJS.ProcessEnv): HttpOidcOptions | undefined {
  const read = (name: string) => envInput[name]?.trim() || undefined;
  const list = (name: string) =>
    read(name)
      ?.split(/[\s,]+/)
      .filter(Boolean);
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

export async function createOidcResourceServer(
  options: HttpOidcOptions,
): Promise<OidcResourceServer> {
  const issuer = parseUrl(options.issuer, "OIDC issuer");
  const resource = parseUrl(options.resource, "OIDC resource");
  if (!options.allowInsecureRequests) {
    for (const [label, url] of [
      ["issuer", issuer],
      ["resource", resource],
    ] as const) {
      if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
        throw new Error(`OIDC ${label} '${url.href}' must use HTTPS.`);
      }
    }
  }
  const mode = options.mode ?? (options.clientId ? "introspection" : "offline");
  if (mode === "introspection" && (!options.clientId || !options.clientSecret)) {
    throw new Error("The OIDC introspection mode needs a client id and a client secret.");
  }
  const audience = options.audience?.trim() || resource.href;
  const profileClaim = options.profileClaim?.trim() || DEFAULT_PROFILE_CLAIM;
  // Reached only for a loopback issuer or with allowInsecureRequests, checked above.
  const httpOptions = { [oauth.allowInsecureRequests]: issuer.protocol === "http:" };

  const as = await discover(issuer, httpOptions);
  const verifyClaims =
    mode === "offline"
      ? offlineVerifier(as, audience, httpOptions)
      : introspectionVerifier(as, audience, options, httpOptions);

  const readProfile = (claims: Claims | undefined): string => {
    const value = claims?.[profileClaim];
    if (typeof value !== "string" || !value.trim()) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, `Token has no '${profileClaim}' claim`);
    }
    try {
      return normalizeProfileName(value);
    } catch {
      throw new OAuthError(OAuthErrorCode.InvalidToken, `Token '${profileClaim}' claim is invalid`);
    }
  };

  const bearerOptions: BearerAuthOptions = {
    verifier: {
      async verifyAccessToken(token) {
        const claims = await verifyClaims(token);
        return {
          token,
          clientId: stringClaim(claims.client_id) ?? stringClaim(claims.azp) ?? "",
          scopes: readScopes(claims),
          expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
          resource,
          extra: claims,
        };
      },
    },
    requiredScopes: options.requiredScopes ?? [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  };

  const metadataOptions = {
    oauthMetadata: as as unknown as OAuthMetadata,
    resourceServerUrl: resource,
    scopesSupported: options.scopesSupported?.length ? options.scopesSupported : undefined,
    resourceName: "Kibana MCP",
    dangerouslyAllowInsecureIssuerUrl: options.allowInsecureRequests,
  };
  // Fails at startup rather than on the first discovery request.
  buildOAuthProtectedResourceMetadata(metadataOptions);
  return {
    metadataResponse: (request) => oauthMetadataResponse(request, metadataOptions),
    async authenticate(authorization) {
      try {
        // Like requireBearerAuth: only the first of several credentials is considered.
        const authInfo = await verifyBearerToken(
          authorization?.split(",")[0] || undefined,
          bearerOptions,
        );
        return { authInfo, profile: readProfile(authInfo.extra) };
      } catch (error) {
        return bearerAuthChallengeResponse(error, bearerOptions);
      }
    },
  };
}

async function discover(
  issuer: URL,
  httpOptions: oauth.HttpRequestOptions<"GET">,
): Promise<oauth.AuthorizationServer> {
  let failure: unknown;
  for (const algorithm of ["oidc", "oauth2"] as const) {
    try {
      const response = await oauth.discoveryRequest(issuer, { ...httpOptions, algorithm });
      return await oauth.processDiscoveryResponse(issuer, response);
    } catch (error) {
      failure ??= error;
      // A mismatching issuer is an answer, not a missing document.
      if (
        error instanceof oauth.OperationProcessingError &&
        error.code === oauth.JSON_ATTRIBUTE_COMPARISON
      ) {
        break;
      }
    }
  }
  throw new Error(
    `OIDC discovery failed for issuer '${issuer.href}': ${failure instanceof Error ? failure.message : String(failure)}`,
    { cause: failure },
  );
}

function offlineVerifier(
  as: oauth.AuthorizationServer,
  audience: string,
  httpOptions: oauth.HttpRequestOptions<"GET">,
): (token: string) => Promise<Claims> {
  if (!as.jwks_uri) {
    throw new Error("The OIDC issuer publishes no jwks_uri: use the introspection mode.");
  }
  return async (token) => {
    try {
      const request = new Request("http://resource.invalid", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return await oauth.validateJwtAccessToken(as, request, audience, httpOptions);
    } catch (error) {
      throw toOAuthError(error);
    }
  };
}

function introspectionVerifier(
  as: oauth.AuthorizationServer,
  audience: string,
  options: HttpOidcOptions,
  httpOptions: oauth.HttpRequestOptions<"POST", URLSearchParams>,
): (token: string) => Promise<Claims> {
  if (!as.introspection_endpoint) {
    throw new Error("The OIDC issuer publishes no introspection_endpoint: use the offline mode.");
  }
  const client: oauth.Client = { client_id: options.clientId ?? "" };
  const clientAuth = oauth.ClientSecretBasic(options.clientSecret ?? "");
  const introspect = async (token: string): Promise<Claims> => {
    let claims: Claims;
    try {
      const response = await oauth.introspectionRequest(as, client, clientAuth, token, {
        ...httpOptions,
        additionalParameters: { token_type_hint: "access_token" },
      });
      claims = { ...(await oauth.processIntrospectionResponse(as, client, response)) };
    } catch {
      throw new OAuthError(OAuthErrorCode.ServerError, "Token verification is unavailable");
    }
    // An introspection answer without our audience was issued for another resource.
    if (
      claims.active !== true ||
      (claims.iss !== undefined && claims.iss !== as.issuer) ||
      !hasAudience(claims.aud, audience)
    ) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
    }
    return claims;
  };

  // Least recently used first; concurrent calls with one token share a single introspection.
  const cache = new Map<string, { claims: Promise<Claims>; until: number }>();
  return (token) => {
    const key = createHash("sha256").update(token).digest("base64url");
    const cached = cache.get(key);
    cache.delete(key);
    if (cached && cached.until > Date.now()) {
      cache.set(key, cached);
      return cached.claims;
    }

    const entry = { claims: introspect(token), until: Date.now() + INTROSPECTION_CACHE_MS };
    entry.claims.then(
      (claims) => {
        if (typeof claims.exp === "number") entry.until = Math.min(entry.until, claims.exp * 1000);
      },
      () => cache.delete(key),
    );
    if (cache.size >= MAX_INTROSPECTION_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
    cache.set(key, entry);
    return entry.claims;
  };
}

function toOAuthError(error: unknown): OAuthError {
  const isTokenFault =
    error instanceof oauth.UnsupportedOperationError ||
    (error instanceof oauth.OperationProcessingError && INVALID_TOKEN_CODES.has(error.code));
  return isTokenFault
    ? new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token")
    : new OAuthError(OAuthErrorCode.ServerError, "Token verification is unavailable");
}

function hasAudience(value: unknown, audience: string): boolean {
  return Array.isArray(value) ? value.includes(audience) : value === audience;
}

function readScopes(claims: Claims): string[] {
  // `scope` per RFC 9068 and RFC 7662; `scp` for Entra ID and some others.
  const value = claims.scope ?? claims.scp;
  if (Array.isArray(value)) return value.filter((scope) => typeof scope === "string");
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseUrl(value: string, label: string): URL {
  try {
    return resourceUrlFromServerUrl(value);
  } catch {
    throw new Error(`${label} '${value}' is not a valid URL.`);
  }
}
