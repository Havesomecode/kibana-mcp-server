import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JWTPayload, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import { type HttpServerHandle, startHttpMcpServer } from "../../src/transports/http.js";
import {
  callModernTool,
  callTool,
  sendRpc,
  source,
  sourceIds,
  writeProfileCatalog,
} from "./helpers.js";

const RESOURCE = "http://127.0.0.1/mcp";

interface FakeIssuer {
  url: string;
  sign: (claims: JWTPayload, options?: { expiresIn?: string; typ?: string }) => Promise<string>;
  introspection: Map<string, Record<string, unknown>>;
  introspectionCalls: number;
  discoveredIssuer?: string;
  jwks?: unknown;
  close: () => Promise<void>;
}

async function startFakeIssuer(): Promise<FakeIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
  const issuer: FakeIssuer = {
    url: "",
    introspection: new Map(),
    introspectionCalls: 0,
    sign: (claims, options = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test", typ: options.typ ?? "at+jwt" })
        .setIssuer(issuer.url)
        .setJti(crypto.randomUUID())
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? "5m")
        .sign(privateKey),
    close: async () => {},
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.url === "/.well-known/openid-configuration") {
        json(200, {
          issuer: issuer.discoveredIssuer ?? issuer.url,
          authorization_endpoint: `${issuer.url}/authorize`,
          token_endpoint: `${issuer.url}/token`,
          response_types_supported: ["code"],
          jwks_uri: `${issuer.url}/jwks`,
          introspection_endpoint: `${issuer.url}/introspect`,
        });
      } else if (request.url === "/jwks") {
        json(200, issuer.jwks ?? { keys: [jwk] });
      } else if (request.url === "/introspect") {
        issuer.introspectionCalls += 1;
        if (request.headers.authorization !== `Basic ${btoa("mcp:shh")}`) {
          json(401, { error: "invalid_client" });
          return;
        }
        const token = new URLSearchParams(Buffer.concat(chunks).toString()).get("token") ?? "";
        json(200, issuer.introspection.get(token) ?? { active: false });
      } else {
        json(404, {});
      }
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  issuer.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer.close = () =>
    new Promise((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
  return issuer;
}

describe("startHttpMcpServer with OIDC", () => {
  let issuer: FakeIssuer;
  let directory: string;
  let handle: HttpServerHandle | undefined;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    issuer = await startFakeIssuer();
  });

  afterAll(async () => {
    await issuer.close();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-oidc-"));
    issuer.introspection.clear();
    issuer.introspectionCalls = 0;
    issuer.discoveredIssuer = undefined;
    issuer.jwks = undefined;
    env = {
      KIBANA_BASE_URL: "https://kibana.example.com",
      KIBANA_USERNAME: "elastic",
      KIBANA_PASSWORD: "secret",
      KIBANA_SOURCE_CATALOG_PATH: join(directory, "{profile}", "sources.json"),
      KIBANA_HTTP_OIDC_ISSUER: issuer.url,
      KIBANA_HTTP_OIDC_RESOURCE: RESOURCE,
    };
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  const writeCatalog = (profile: string, ids: string[]) =>
    writeProfileCatalog(directory, profile, ids);

  const token = (claims: JWTPayload = {}, options?: { expiresIn?: string; typ?: string }) =>
    issuer.sign({ sub: "alice", aud: RESOURCE, client_id: "claude", ...claims }, options);

  const bearer = async (claims?: JWTPayload) => ({
    Authorization: `Bearer ${await token(claims)}`,
  });

  it.each([false, true])(
    "serves each caller the catalog of its token subject (modern=%s)",
    async (modern) => {
      await writeCatalog("alice", ["orders"]);
      await writeCatalog("bob", ["payments"]);
      handle = await startHttpMcpServer(env, { port: 0 });
      const call = modern ? callModernTool : callTool;
      const discover = async (headers: Record<string, string>) =>
        sourceIds((await call(handle?.url ?? "", "discover", headers)).result);

      expect(await discover(await bearer({ sub: "alice" }))).toEqual(["orders"]);
      expect(await discover(await bearer({ sub: "bob" }))).toEqual(["payments"]);
      // A profile header cannot override the token.
      expect(await discover({ ...(await bearer({ sub: "bob" })), "X-Profile": "alice" })).toEqual([
        "payments",
      ]);
    },
  );

  it("reads the profile from the configured claim", async () => {
    await writeCatalog("alice@example.com", ["orders"]);
    handle = await startHttpMcpServer(
      { ...env, KIBANA_HTTP_OIDC_PROFILE_CLAIM: "email" },
      { port: 0 },
    );

    const ok = await callTool(handle.url, "discover", await bearer({ email: "alice@example.com" }));
    const missing = await callTool(handle.url, "discover", await bearer());

    expect(sourceIds(ok.result)).toEqual(["orders"]);
    expect(missing.status).toBe(401);
  });

  it("challenges unauthenticated calls with the protected resource metadata", async () => {
    handle = await startHttpMcpServer(env, { port: 0 });

    const response = await sendRpc(handle.url, { id: 1, method: "tools/list" });
    const metadataUrl = new URL(handle.url);
    metadataUrl.pathname = "/.well-known/oauth-protected-resource/mcp";
    const metadata = await fetch(metadataUrl);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource/mcp"',
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [issuer.url],
    });
  });

  it("rejects tokens for another audience, expired, or lacking a required scope", async () => {
    handle = await startHttpMcpServer(
      { ...env, KIBANA_HTTP_OIDC_REQUIRED_SCOPES: "logs:read" },
      { port: 0 },
    );
    const status = async (headers: Record<string, string>) =>
      (await callTool(handle?.url ?? "", "discover", headers)).status;

    expect(await status(await bearer({ scope: "logs:read", aud: "https://other.example" }))).toBe(
      401,
    );
    expect(
      await status({
        Authorization: `Bearer ${await token({ scope: "logs:read" }, { expiresIn: "-1m" })}`,
      }),
    ).toBe(401);
    expect(await status({ Authorization: "Bearer not-a-jwt" })).toBe(401);
    // Offline verification expects RFC 9068 access tokens, not plain JWTs.
    expect(
      await status({
        Authorization: `Bearer ${await token({ scope: "logs:read" }, { typ: "JWT" })}`,
      }),
    ).toBe(401);
    expect(await status(await bearer({ scope: "profile" }))).toBe(403);
    expect(await status(await bearer({ scope: "profile logs:read" }))).toBe(200);
  });

  it("verifies opaque tokens by introspection and caches the answer", async () => {
    await writeCatalog("alice", ["orders"]);
    issuer.introspection.set("opaque-alice", {
      active: true,
      sub: "alice",
      aud: RESOURCE,
      client_id: "claude",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    issuer.introspection.set("opaque-revoked", { active: false });
    handle = await startHttpMcpServer(
      { ...env, KIBANA_HTTP_OIDC_CLIENT_ID: "mcp", KIBANA_HTTP_OIDC_CLIENT_SECRET: "shh" },
      { port: 0 },
    );

    const first = await callTool(handle.url, "discover", { Authorization: "Bearer opaque-alice" });
    const second = await callTool(handle.url, "discover", { Authorization: "Bearer opaque-alice" });
    const revoked = async () =>
      (await callTool(handle?.url ?? "", "discover", { Authorization: "Bearer opaque-revoked" }))
        .status;

    expect(sourceIds(first.result)).toEqual(["orders"]);
    expect(sourceIds(second.result)).toEqual(["orders"]);
    // A refused token is cached too: retrying it does not reach the issuer again.
    expect(await revoked()).toBe(401);
    expect(await revoked()).toBe(401);
    expect(issuer.introspectionCalls).toBe(2);
  });

  it("answers 500, not 401, when the issuer JWKS is malformed", async () => {
    handle = await startHttpMcpServer(env, { port: 0 });
    issuer.jwks = { keys: {} };

    const response = await callTool(handle.url, "discover", await bearer());

    expect(response.status).toBe(500);
  });

  it.each([
    [{ KIBANA_HTTP_AUTH_TOKEN: "secret" }, {}, "mutually exclusive"],
    [{}, { profileHeader: "x-profile" }, "drop the profile header"],
    [{ KIBANA_HTTP_OIDC_RESOURCE: "" }, {}, "KIBANA_HTTP_OIDC_RESOURCE is required"],
    [{ KIBANA_HTTP_OIDC_MODE: "magic" }, {}, "must be 'offline' or 'introspection'"],
    [{ KIBANA_HTTP_OIDC_MODE: "introspection" }, {}, "client id and a client secret"],
    [{ KIBANA_HTTP_OIDC_RESOURCE: "http://mcp.example.com/mcp" }, {}, "must use HTTPS"],
  ])("refuses an inconsistent configuration %j %j", async (overrides, options, message) => {
    await expect(
      startHttpMcpServer({ ...env, ...overrides }, { port: 0, ...options }),
    ).rejects.toThrow(message);
  });

  it("refuses an issuer whose discovery document names another issuer", async () => {
    issuer.discoveredIssuer = "https://evil.example";

    await expect(startHttpMcpServer(env, { port: 0 })).rejects.toThrow("OIDC discovery failed");
  });

  it("requires named profiles", async () => {
    await writeFile(
      join(directory, "sources.json"),
      JSON.stringify(createGeneratedCatalog([source("orders")])),
    );
    await expect(
      startHttpMcpServer(
        { ...env, KIBANA_SOURCE_CATALOG_PATH: join(directory, "sources.json") },
        { port: 0 },
      ),
    ).rejects.toThrow("requires named profiles");
  });
});
