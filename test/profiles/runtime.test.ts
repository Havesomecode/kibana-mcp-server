import { describe, expect, it } from "vitest";

import {
  getProfileRuntime,
  requireProfileRuntime,
  runWithProfileRuntime,
} from "../../src/profiles/context.js";
import { normalizeProfileName, toProfileKey } from "../../src/profiles/names.js";
import { ProfileRuntimeRegistry } from "../../src/profiles/runtime.js";
import { createApplication } from "../../src/server.js";
import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import type { ResolvedAppConfig } from "../../src/types.js";
import { source } from "../transports/helpers.js";

function config(overrides: Partial<ResolvedAppConfig> = {}): ResolvedAppConfig {
  return {
    kibana: {
      baseUrl: "https://kibana.example.com",
      username: "u",
      password: "p",
      timeoutMs: 1000,
    },
    sources: [],
    ...overrides,
  };
}

const kibanaClientFactory = () => ({ describeFields: async () => [] }) as never;

describe("profile names", () => {
  it("trims names and refuses empty or oversized ones", () => {
    expect(normalizeProfileName("  alice ")).toBe("alice");
    expect(() => normalizeProfileName("   ")).toThrow("must not be empty");
    expect(() => normalizeProfileName("a".repeat(257))).toThrow("must not exceed 256 characters");
  });

  it("derives distinct, bounded, filesystem-safe keys", () => {
    expect(toProfileKey("alice-01")).toBe("alice-01");
    expect(toProfileKey("Alice")).toMatch(/^alice-[a-f0-9]{12}$/);
    expect(toProfileKey("a/b")).not.toBe(toProfileKey("a.b"));
    expect(toProfileKey("@@@")).toMatch(/^profile-[a-f0-9]{12}$/);
    expect(toProfileKey(`${"a".repeat(70)}-tail`)).toMatch(/^a{64}-[a-f0-9]{12}$/);
    expect(toProfileKey("../../etc/passwd")).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("ProfileRuntimeRegistry", () => {
  it("serves the default profile, also under its own name, and replaces it on reconfiguration", async () => {
    const registry = new ProfileRuntimeRegistry({
      defaultConfig: config({ profileName: "Production" }),
      kibanaClientFactory,
    });

    const initial = await registry.resolve();
    expect(await registry.resolve(" Production ")).toBe(initial);
    expect(registry.hasDefault).toBe(true);
    expect(registry.supportsNamedProfiles).toBe(false);
    await expect(registry.resolve("staging")).rejects.toThrow(
      "Profile selection is not available on this server",
    );

    const reconfigured = registry.setDefault(config({ sources: [source("orders")] }));
    expect(await registry.resolve()).toBe(reconfigured);
    expect(registry.getDefault()?.sourceCatalog.count()).toBe(1);
  });

  it("asks for configuration when it has neither a default nor named profiles", async () => {
    const registry = new ProfileRuntimeRegistry({ kibanaClientFactory });

    expect(registry.hasDefault).toBe(false);
    await expect(registry.resolve()).rejects.toThrow("Call the 'configure' tool first");
    await expect(registry.resolve(" ")).rejects.toThrow("must not be empty");
  });

  it("shares one Kibana client between profiles of the same connection only", async () => {
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      loadProfileConfig: async (profileName) =>
        config({
          profileName,
          kibana: {
            baseUrl:
              profileName === "other" ? "https://other.example.com" : "https://kibana.example.com",
            username: "u",
            password: "p",
            timeoutMs: 1000,
          },
        }),
    });

    const [alice, bob, other] = await Promise.all(
      ["alice", "bob", "other"].map((name) => registry.resolve(name)),
    );

    expect(alice.kibanaClient).toBe(bob.kibanaClient);
    expect(other.kibanaClient).not.toBe(alice.kibanaClient);
    expect(alice.schemaCatalog).not.toBe(bob.schemaCatalog);
  });

  it("re-reads a store-backed catalog on every call and keeps caches while it is unchanged", async () => {
    let content: string | undefined;
    let reads = 0;
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      loadProfileConfig: async (profileName) =>
        config({
          profileName,
          catalog: {
            location: `memory://${profileName}`,
            read: async () => {
              reads += 1;
              return content;
            },
            replace: async () => {},
          },
        }),
    });

    const empty = await registry.resolve("alice");
    expect(empty.sourceCatalog.count()).toBe(0);
    const schemaCatalog = empty.schemaCatalog;

    expect((await registry.resolve("alice")).schemaCatalog).toBe(schemaCatalog);

    content = JSON.stringify(createGeneratedCatalog([source("orders")]));
    const updated = await registry.resolve("alice");
    expect(updated).toBe(empty);
    expect(updated.sourceCatalog.count()).toBe(1);
    expect(updated.schemaCatalog).not.toBe(schemaCatalog);
    expect(reads).toBe(3);

    content = "{ not json";
    await expect(registry.resolve("alice")).rejects.toThrow();
  });

  it("serves the first cold discover while a newer read is still pending", async () => {
    const reads: ((content: string) => void)[] = [];
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      defaultConfig: config({
        catalog: {
          location: "memory://alice",
          read: () => new Promise((resolve) => reads.push(resolve)),
          replace: async () => {},
        },
      }),
    });
    const app = createApplication(undefined, { profileRegistry: registry });
    const first = app.handlers.discover({});
    const second = app.handlers.discover({});
    const content = JSON.stringify(createGeneratedCatalog([source("orders")]));
    reads[0](content);
    const firstResult = await first;
    reads[1](content);
    const secondResult = await second;

    expect(firstResult.total).toBe(1);
    expect(firstResult.sources.map((entry) => entry.id)).toEqual(["orders"]);
    expect(secondResult).toEqual(firstResult);
  });

  it.each([
    ["read rejection", "before"],
    ["read rejection", "after"],
    ["invalid catalog", "before"],
    ["invalid catalog", "after"],
  ])("keeps an earlier valid refresh when newer %s completes %s it", async (failure, order) => {
    const reads: { resolve: (content: string) => void; reject: (error: Error) => void }[] = [];
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      defaultConfig: config({
        catalog: {
          location: "memory://alice",
          read: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
          replace: async () => {},
        },
      }),
    });
    const earlier = registry.resolve();
    const newer = registry.resolve();
    const rejected = expect(newer).rejects.toThrow();
    const failNewer = () => {
      if (failure === "read rejection") reads[1].reject(new Error("store unavailable"));
      else reads[1].resolve("{ not json");
      return rejected;
    };
    if (order === "before") await failNewer();
    const content = JSON.stringify(createGeneratedCatalog([source("orders")]));
    reads[0].resolve(content);
    const runtime = await earlier;
    const schemaCatalog = runtime.schemaCatalog;
    const sourceIds = runtime.config.sources.map((entry) => entry.id);
    if (order === "after") await failNewer();

    expect(sourceIds).toEqual(["orders"]);
    expect(runtime.catalogContent).toBe(content);
    expect(runtime.sourceCatalog.count()).toBe(1);
    expect(runtime.schemaCatalog).toBe(schemaCatalog);
  });

  it("applies a newer refresh after an earlier refresh completed first", async () => {
    const reads: ((content: string) => void)[] = [];
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      defaultConfig: config({
        catalog: {
          location: "memory://alice",
          read: () => new Promise((resolve) => reads.push(resolve)),
          replace: async () => {},
        },
      }),
    });
    const earlier = registry.resolve();
    const newer = registry.resolve();
    reads[0](JSON.stringify(createGeneratedCatalog([source("earlier")])));
    const runtime = await earlier;
    const earlierIds = runtime.config.sources.map((entry) => entry.id);
    reads[1](JSON.stringify(createGeneratedCatalog([source("newer")])));
    expect(await newer).toBe(runtime);

    expect(earlierIds).toEqual(["earlier"]);
    expect(runtime.config.sources.map((entry) => entry.id)).toEqual(["newer"]);
  });

  it.each([false, true])(
    "does not let an older refresh overwrite a newer catalog (unchanged: %s)",
    async (unchanged) => {
      const reads: ((content: string) => void)[] = [];
      const registry = new ProfileRuntimeRegistry({
        kibanaClientFactory,
        defaultConfig: config({
          catalog: {
            location: "memory://alice",
            read: () => new Promise((resolve) => reads.push(resolve)),
            replace: async () => {},
          },
        }),
      });

      const content = JSON.stringify(createGeneratedCatalog([source("newer")]));
      if (unchanged) {
        const initial = registry.resolve();
        reads.shift()?.(content);
        await initial;
      }
      const older = registry.resolve();
      const newer = registry.resolve();
      reads[1](content);
      const runtime = await newer;
      const schemaCatalog = runtime.schemaCatalog;
      reads[0](JSON.stringify(createGeneratedCatalog([source("older")])));
      await older;

      expect(runtime.config.sources.map((entry) => entry.id)).toEqual(["newer"]);
      expect(runtime.schemaCatalog).toBe(schemaCatalog);
    },
  );

  it("does not let an in-flight refresh undo configure_index replacement", async () => {
    let finishRead: ((content: string) => void) | undefined;
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      defaultConfig: config({
        catalog: {
          location: "memory://alice",
          read: () =>
            new Promise((resolve) => {
              finishRead = resolve;
            }),
          replace: async () => {},
        },
      }),
    });
    const pending = registry.resolve();
    const runtime = registry.getDefault();
    if (!runtime) throw new Error("Default runtime was not created");
    const content = JSON.stringify(createGeneratedCatalog([source("configured")]));
    registry.replaceSources(runtime, [source("configured")], content);
    const schemaCatalog = runtime.schemaCatalog;
    finishRead?.(JSON.stringify(createGeneratedCatalog([source("older")])));
    await pending;

    expect(runtime.catalogContent).toBe(content);
    expect(runtime.config.sources.map((entry) => entry.id)).toEqual(["configured"]);
    expect(runtime.schemaCatalog).toBe(schemaCatalog);
  });

  it("loads each profile once and evicts the least recently used one", async () => {
    const loaded: string[] = [];
    const registry = new ProfileRuntimeRegistry({
      maxProfiles: 2,
      kibanaClientFactory,
      loadProfileConfig: async (profileName) => {
        loaded.push(profileName);
        return config({ profileName });
      },
    });

    const [first, again] = await Promise.all([registry.resolve("a"), registry.resolve("a")]);
    expect(first).toBe(again);
    await registry.resolve("b");
    await registry.resolve("a");
    await registry.resolve("c");
    await registry.resolve("b");

    expect(loaded).toEqual(["a", "b", "c", "b"]);
    await expect(registry.resolve()).rejects.toThrow("No profile was supplied");
  });

  it("keeps profiles whose names differ only by case apart", async () => {
    const registry = new ProfileRuntimeRegistry({
      defaultConfig: config({ profileName: "alice" }),
      kibanaClientFactory,
      loadProfileConfig: async (profileName) => config({ profileName }),
    });

    const lower = await registry.resolve("alice");
    const upper = await registry.resolve("Alice");

    expect(lower).toBe(registry.getDefault());
    expect(upper).not.toBe(lower);
    expect(upper.config.profileName).toBe("Alice");
    expect(await registry.resolve("Alice")).toBe(upper);
  });

  it("does not cache a profile whose configuration failed to load", async () => {
    let attempts = 0;
    const registry = new ProfileRuntimeRegistry({
      kibanaClientFactory,
      loadProfileConfig: async (profileName) => {
        attempts += 1;
        if (attempts === 1) throw new Error("store unavailable");
        return config({ profileName });
      },
    });

    await expect(registry.resolve("alice")).rejects.toThrow("store unavailable");
    expect((await registry.resolve("alice")).config.profileName).toBe("alice");
  });
});

describe("profile context", () => {
  it("exposes the bound profile inside a tool call only, across awaits", async () => {
    const registry = new ProfileRuntimeRegistry({ defaultConfig: config(), kibanaClientFactory });
    const runtime = await registry.resolve();

    expect(getProfileRuntime()).toBeUndefined();
    expect(() => requireProfileRuntime()).toThrow("No profile is bound to the current tool call");

    const seen = await runWithProfileRuntime(runtime, async () => {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 1));
      return [getProfileRuntime(), requireProfileRuntime()];
    });

    expect(seen).toEqual([runtime, runtime]);
    expect(getProfileRuntime()).toBeUndefined();
  });
});
