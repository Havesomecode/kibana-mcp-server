import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGeneratedSource,
  chooseGeneratedSourceFields,
  createGeneratedCatalog,
  resolveCurrentPackageSpecifier,
  runBootstrap,
} from "../src/bootstrap.js";
import { resolveProfilePaths } from "../src/profile_paths.js";
import { ProfileStore } from "../src/profile_store.js";
import { SecretStoreError } from "../src/secret_store.js";
import type { SavedSecret, SourceFieldDescriptor } from "../src/types.js";

const tempDirectories: string[] = [];

const fields: SourceFieldDescriptor[] = [
  {
    name: "@timestamp",
    type: "date",
    searchable: true,
    aggregatable: true,
    subfields: [],
  },
  {
    name: "message",
    type: "text",
    searchable: true,
    aggregatable: false,
    subfields: [],
  },
  {
    name: "trace.id",
    type: "keyword",
    searchable: true,
    aggregatable: true,
    subfields: [],
  },
];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deterministic bootstrap", () => {
  it("builds a stable source definition from one or more index patterns", () => {
    expect(buildGeneratedSource(["consumer-*", "consumer-dead-letter-*"], "Consumer logs")).toEqual(
      {
        id: "consumer-logs",
        name: "Consumer logs",
        description:
          "Generated from Elasticsearch index patterns: consumer-*, consumer-dead-letter-*.",
        tags: ["generated"],
        timeField: "@timestamp",
        backend: {
          kind: "kibana_internal_search_es",
          path: "/internal/search/es",
          index: ["consumer-*", "consumer-dead-letter-*"],
        },
        schema: {
          kind: "kibana_data_views_fields",
          index: ["consumer-*", "consumer-dead-letter-*"],
        },
        fieldHints: [],
        defaultTextFields: ["message"],
        evidenceFields: [],
      },
    );
  });

  it("pins Codex registration to the package version running bootstrap", async () => {
    await expect(resolveCurrentPackageSpecifier()).resolves.toBe(
      "@havesomecode/kibana-mcp-server@0.1.0",
    );
  });

  it("marks generated catalogs with a content hash for overwrite provenance", () => {
    const catalog = createGeneratedCatalog(buildGeneratedSource(["consumer-*"]));
    expect(catalog.generatedBy).toMatchObject({
      tool: "@havesomecode/kibana-mcp-server",
      formatVersion: 1,
    });
    expect(catalog.generatedBy?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("chooses time, text, and evidence fields deterministically from discovered fields", () => {
    expect(chooseGeneratedSourceFields(fields)).toEqual({
      timeField: "@timestamp",
      defaultTextFields: ["message"],
      evidenceFields: ["trace.id"],
    });
  });

  it("requires an explicit time field when discovery finds no deterministic candidate", () => {
    expect(() =>
      chooseGeneratedSourceFields([
        {
          name: "message",
          type: "text",
          searchable: true,
          subfields: [],
        },
      ]),
    ).toThrow("--time-field");
  });

  it("verifies before writing, saves the generated profile, and registers Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const secrets = new Map<string, SavedSecret>();
    const events: string[] = [];

    const result = await runBootstrap(
      {
        profileName: "prod",
        baseUrl: "https://kibana.example.com/",
        username: "elastic",
        password: "secret",
        indexes: ["consumer-*"],
        client: "codex",
        makeDefault: true,
        mcpName: "kibana-log-investigation",
        packageSpecifier: "@havesomecode/kibana-mcp-server",
      },
      {
        paths,
        profileStore,
        secretStore: {
          async load(profileId) {
            const secret = secrets.get(profileId);
            if (!secret) throw new SecretStoreError("missing", "NOT_FOUND");
            return secret;
          },
          async save(profileId, secret) {
            events.push("secret:save");
            secrets.set(profileId, secret);
          },
          async delete(profileId) {
            events.push("secret:delete");
            secrets.delete(profileId);
          },
        },
        verifier: {
          async verify() {
            events.push("verify");
            return fields;
          },
        },
        clientRegistrar: {
          async preflight() {
            events.push("client:preflight");
            return { alreadyRegistered: false };
          },
          async register() {
            events.push("client:register");
            return { added: true };
          },
          async rollback() {
            events.push("client:rollback");
          },
        },
      },
    );

    expect(events).toEqual(["client:preflight", "verify", "secret:save", "client:register"]);
    expect(result).toMatchObject({
      profileName: "prod",
      profileId: "prod",
      sourceId: "consumer",
      indexes: ["consumer-*"],
      client: "codex",
      registered: true,
      verified: true,
    });
    expect((await profileStore.getDefaultProfile())?.name).toBe("prod");
    expect(secrets.get("prod")).toEqual({ username: "elastic", password: "secret" });
    const catalog = JSON.parse(await readFile(result.sourceCatalogPath, "utf8"));
    expect(catalog.sources[0]).toMatchObject({
      id: "consumer",
      timeField: "@timestamp",
      defaultTextFields: ["message"],
      evidenceFields: ["trace.id"],
    });
  });

  it("does not write any machine state when verification fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const writes: string[] = [];

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "secret",
          indexes: ["missing-*"],
          client: "none",
          makeDefault: true,
          mcpName: "kibana-log-investigation",
          packageSpecifier: "@havesomecode/kibana-mcp-server",
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              throw new SecretStoreError("missing", "NOT_FOUND");
            },
            async save() {
              writes.push("secret");
            },
            async delete() {},
          },
          verifier: {
            async verify() {
              throw new Error("index pattern did not resolve to fields");
            },
          },
        },
      ),
    ).rejects.toThrow("index pattern did not resolve to fields");

    expect(writes).toEqual([]);
    expect((await profileStore.listProfiles()).length).toBe(0);
  });

  it("cleans up a possibly written new credential when secret persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    let deleteCalled = false;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              throw new SecretStoreError("missing", "NOT_FOUND");
            },
            async save() {
              throw new Error("credential store unavailable");
            },
            async delete() {
              deleteCalled = true;
            },
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("credential store unavailable");

    expect(deleteCalled).toBe(true);
    expect(await profileStore.listProfiles()).toEqual([]);
    await expect(
      readFile(join(paths.sourceCatalogsDir, "prod.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("protects an orphaned catalog even when profiles.json has no matching profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const catalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    const orphanedContent = `${JSON.stringify({
      sources: [buildGeneratedSource(["legacy-*"])],
    })}\n`;
    await writeFile(catalogPath, orphanedContent, "utf8");
    let verified = false;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore: new ProfileStore(paths),
          secretStore: {
            async load() {
              throw new SecretStoreError("missing", "NOT_FOUND");
            },
            async save() {},
            async delete() {},
          },
          verifier: {
            async verify() {
              verified = true;
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("--replace");

    expect(verified).toBe(false);
    expect(await readFile(catalogPath, "utf8")).toBe(orphanedContent);
  });

  it("refuses to overwrite an existing hand-authored catalog without --replace", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const catalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await profileStore.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://old.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: catalogPath,
      },
      { makeDefault: true },
    );
    const tamperedCatalog = createGeneratedCatalog(buildGeneratedSource(["consumer-*"])) as {
      generatedBy: { tool: string; formatVersion: number; sourceHash: string };
      sources: Array<Record<string, unknown>>;
    };
    tamperedCatalog.sources[0].operatorNotes = "preserve this annotation";
    const tamperedContent = `${JSON.stringify(tamperedCatalog)}\n`;
    await writeFile(catalogPath, tamperedContent, "utf8");
    let verified = false;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              return { username: "old", password: "old" };
            },
            async save() {},
            async delete() {},
          },
          verifier: {
            async verify() {
              verified = true;
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("--replace");

    expect(verified).toBe(false);
    expect(await readFile(catalogPath, "utf8")).toBe(tamperedContent);
  });

  it("repairs an existing generated profile when its credential entry is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const catalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await profileStore.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://old.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: catalogPath,
      },
      { makeDefault: true },
    );
    await writeFile(
      catalogPath,
      JSON.stringify(createGeneratedCatalog(buildGeneratedSource(["consumer-*"]))),
      "utf8",
    );
    let saved = false;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "replacement",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              throw new SecretStoreError("missing", "NOT_FOUND");
            },
            async save() {
              saved = true;
            },
            async delete() {},
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
        },
      ),
    ).resolves.toMatchObject({ profileName: "prod", verified: true });

    expect(saved).toBe(true);
  });

  it("restores the previous credential when replacement fails after mutating the store", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const catalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await profileStore.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://old.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: catalogPath,
      },
      { makeDefault: true },
    );
    await writeFile(
      catalogPath,
      JSON.stringify(createGeneratedCatalog(buildGeneratedSource(["consumer-*"]))),
      "utf8",
    );
    let stored: SavedSecret | undefined = { username: "old", password: "old-secret" };
    let saveAttempts = 0;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://new.example.com",
          username: "new",
          password: "new-secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              if (!stored) throw new SecretStoreError("missing", "NOT_FOUND");
              return stored;
            },
            async save(_profileId, secret) {
              saveAttempts += 1;
              if (saveAttempts === 1) {
                stored = undefined;
                throw new Error("credential write interrupted");
              }
              stored = secret;
            },
            async delete() {
              stored = undefined;
            },
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("credential write interrupted");

    expect(saveAttempts).toBe(2);
    expect(stored).toEqual({ username: "old", password: "old-secret" });
  });

  it("restores an orphan credential when replacement fails before a profile exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const catalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await writeFile(
      catalogPath,
      JSON.stringify(createGeneratedCatalog(buildGeneratedSource(["consumer-*"]))),
      "utf8",
    );
    let stored: SavedSecret | undefined = { username: "orphan", password: "recoverable" };
    let saveAttempts = 0;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://new.example.com",
          username: "new",
          password: "new-secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore: new ProfileStore(paths),
          secretStore: {
            async load() {
              if (!stored) throw new SecretStoreError("missing", "NOT_FOUND");
              return stored;
            },
            async save(_profileId, secret) {
              saveAttempts += 1;
              if (saveAttempts === 1) {
                stored = undefined;
                throw new Error("credential write interrupted");
              }
              stored = secret;
            },
            async delete() {
              stored = undefined;
            },
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("credential write interrupted");

    expect(saveAttempts).toBe(2);
    expect(stored).toEqual({ username: "orphan", password: "recoverable" });
  });

  it("restores a pre-existing credential when no profile or catalog exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    let stored: SavedSecret | undefined = { username: "existing", password: "preserve-me" };
    let saveAttempts = 0;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://new.example.com",
          username: "new",
          password: "new-secret",
          indexes: ["consumer-*"],
          client: "none",
          makeDefault: true,
        },
        {
          paths,
          profileStore: new ProfileStore(paths),
          secretStore: {
            async load() {
              if (!stored) throw new SecretStoreError("missing", "NOT_FOUND");
              return stored;
            },
            async save(_profileId, secret) {
              saveAttempts += 1;
              if (saveAttempts === 1) {
                stored = undefined;
                throw new Error("credential write interrupted");
              }
              stored = secret;
            },
            async delete() {
              stored = undefined;
            },
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
        },
      ),
    ).rejects.toThrow("credential write interrupted");

    expect(saveAttempts).toBe(2);
    expect(stored).toEqual({ username: "existing", password: "preserve-me" });
  });

  it("retries Codex rollback once before reporting a partial installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    let rollbackAttempts = 0;

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://kibana.example.com",
          username: "elastic",
          password: "secret",
          indexes: ["consumer-*"],
          client: "codex",
          makeDefault: true,
          mcpName: "kibana-log-investigation",
          packageSpecifier: "@havesomecode/kibana-mcp-server",
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load() {
              throw new SecretStoreError("missing", "NOT_FOUND");
            },
            async save() {},
            async delete() {},
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
          clientRegistrar: {
            async preflight() {
              return { alreadyRegistered: false };
            },
            async register() {
              throw new Error("codex registration failed");
            },
            async rollback() {
              rollbackAttempts += 1;
              if (rollbackAttempts === 1) {
                throw new Error("transient removal failure");
              }
            },
          },
        },
      ),
    ).rejects.toThrow("codex registration failed");

    expect(rollbackAttempts).toBe(2);
  });

  it("restores an existing profile and credentials when client registration fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-bootstrap-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const oldCatalogPath = join(paths.sourceCatalogsDir, "prod.json");
    await profileStore.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://old.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: oldCatalogPath,
      },
      { makeDefault: true },
    );
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(paths.sourceCatalogsDir, { recursive: true }).then(() =>
        writeFile(oldCatalogPath, '{"sources":[{"old":true}]}\n', "utf8"),
      ),
    );
    const secrets = new Map<string, SavedSecret>([
      ["prod", { username: "old-user", password: "old-secret" }],
    ]);

    await expect(
      runBootstrap(
        {
          profileName: "prod",
          baseUrl: "https://new.example.com",
          username: "new-user",
          password: "new-secret",
          indexes: ["consumer-*"],
          client: "codex",
          makeDefault: true,
          replaceExisting: true,
          mcpName: "kibana-log-investigation",
          packageSpecifier: "@havesomecode/kibana-mcp-server",
        },
        {
          paths,
          profileStore,
          secretStore: {
            async load(profileId) {
              const secret = secrets.get(profileId);
              if (!secret) throw new SecretStoreError("missing", "NOT_FOUND");
              return secret;
            },
            async save(profileId, secret) {
              secrets.set(profileId, secret);
            },
            async delete(profileId) {
              secrets.delete(profileId);
            },
          },
          verifier: {
            async verify() {
              return fields;
            },
          },
          clientRegistrar: {
            async preflight() {
              return { alreadyRegistered: false };
            },
            async register() {
              throw new Error("codex registration failed");
            },
            async rollback() {},
          },
        },
      ),
    ).rejects.toThrow("codex registration failed");

    expect((await profileStore.getDefaultProfile())?.baseUrl).toBe("https://old.example.com");
    expect(secrets.get("prod")).toEqual({ username: "old-user", password: "old-secret" });
    expect(await readFile(oldCatalogPath, "utf8")).toBe('{"sources":[{"old":true}]}\n');
  });
});
