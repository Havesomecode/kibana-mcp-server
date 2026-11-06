import { createHash } from "node:crypto";

import {
  type AuthInfo,
  type BearerAuthOptions,
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
  oauthMetadataResponse,
  resourceUrlFromServerUrl,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import * as oauth from "oauth4webapi";

import { normalizeProfileName } from "../profiles/names.js";
import { isLoopbackHost } from "../utils/net.js";
import type { HttpOidcOptions } from "./http_auth.js";

const DEFAULT_PROFILE_CLAIM = "sub";
const INTROSPECTION_CACHE_MS = 60 * 1000;
const MAX_ANSWERS = 1024;
const MAX_REFUSALS = 256;
// Failures caused by the token itself; anything else is an unreachable or broken issuer.
const INVALID_TOKEN_CODES = new Set<string | undefined>([
  oauth.INVALID_REQUEST,
  oauth.INVALID_RESPONSE,
  oauth.PARSE_ERROR,
  oauth.JWT_TIMESTAMP_CHECK,
  oauth.JWT_CLAIM_COMPARISON,
  oauth.KEY_SELECTION,
]);

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
      ? await offlineVerifier(as, audience, httpOptions)
      : introspectionVerifier(as, audience, options, httpOptions);

  const readProfile = (claims: Claims | undefined): string => {
    const value = claims?.[profileClaim];
    if (typeof value !== "string" || !value.trim()) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, `Token has no '${profileClaim}' claim`);
    }
    try {
      // The same claim value at another issuer is another person.
      return normalizeProfileName(`${as.issuer}#${value}`);
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

async function offlineVerifier(
  as: oauth.AuthorizationServer,
  audience: string,
  httpOptions: oauth.HttpRequestOptions<"GET">,
): Promise<(token: string) => Promise<Claims>> {
  if (!as.jwks_uri) {
    throw new Error("The OIDC issuer publishes no jwks_uri: use the introspection mode.");
  }
  const jwksUri = as.jwks_uri;
  // The URL oauth4webapi fetches is the normalized one.
  const jwksHref = new URL(jwksUri).href;
  // oauth4webapi reports a malformed JWKS with the same code as a bad token: refuse it here, as a
  // fault of the issuer rather than of the caller.
  const fetchJwks: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (String(url) !== jwksHref) return response;
    const body = (await response
      .clone()
      .json()
      .catch(() => undefined)) as { keys?: unknown } | undefined;
    const keys = body?.keys;
    if (
      !response.ok ||
      !Array.isArray(keys) ||
      !keys.every((key) => key !== null && typeof key === "object" && !Array.isArray(key))
    ) {
      throw new Error(`The OIDC issuer JWKS at '${jwksUri}' is unavailable or malformed.`);
    }
    return response;
  };
  // Loaded once now, so a broken jwks_uri fails at startup and concurrent first requests share it;
  // oauth4webapi refreshes it from there.
  const jwksCache: oauth.JWKSCacheInput = {};
  const response = await fetchJwks(jwksHref, { headers: { Accept: "application/json" } });
  Object.assign(jwksCache, { jwks: await response.json(), uat: Math.floor(Date.now() / 1000) });
  return async (token) => {
    try {
      const request = new Request("http://resource.invalid", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return await oauth.validateJwtAccessToken(as, request, audience, {
        ...httpOptions,
        [oauth.customFetch]: fetchJwks,
        [oauth.jwksCache]: jwksCache,
      });
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
  // Refused tokens are cached too, so a client retrying one does not reach the issuer each time,
  // but in a smaller cache of their own: callers inventing tokens cannot evict accepted ones.
  // Only issuer faults are forgotten at once.
  type Entry = { claims: Promise<Claims>; until: number };
  const answers = new Map<string, Entry>();
  const refusals = new Map<string, Entry>();
  const remember = (cache: Map<string, Entry>, key: string, entry: Entry, max: number) => {
    cache.delete(key);
    if (cache.size >= max) cache.delete(cache.keys().next().value as string);
    cache.set(key, entry);
  };
  return (token) => {
    const key = createHash("sha256").update(token).digest("base64url");
    const cache = refusals.has(key) ? refusals : answers;
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) {
      remember(cache, key, cached, cache === answers ? MAX_ANSWERS : MAX_REFUSALS);
      return cached.claims;
    }
    refusals.delete(key);

    const entry = { claims: introspect(token), until: Date.now() + INTROSPECTION_CACHE_MS };
    entry.claims.then(
      (claims) => {
        if (typeof claims.exp === "number") entry.until = Math.min(entry.until, claims.exp * 1000);
      },
      (error: unknown) => {
        if (answers.get(key) !== entry) return;
        answers.delete(key);
        if (error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken) {
          remember(refusals, key, entry, MAX_REFUSALS);
        }
      },
    );
    remember(answers, key, entry, MAX_ANSWERS);
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
