import { createHash } from "node:crypto";

import { sourceCatalogSchema } from "../config/environment.js";
import { KibanaClient } from "../kibana/client.js";
import { SchemaCatalog } from "../kibana/schema_catalog.js";
import { SourceCatalog } from "../kibana/source_catalog.js";
import type { AppConfig, ResolvedAppConfig, SourceDefinition } from "../types.js";
import { normalizeProfileName } from "./names.js";

const DEFAULT_MAX_PROFILES = 200;

export type ProfileConfigLoader = (profileName: string) => Promise<ResolvedAppConfig>;

export interface ProfileRuntime {
  config: ResolvedAppConfig;
  sourceCatalog: SourceCatalog;
  kibanaClient: KibanaClient;
  schemaCatalog: SchemaCatalog;
  /** Content of the store-backed catalog the sources were last built from. */
  catalogContent?: string;
}

export interface ProfileRuntimeRegistryOptions {
  defaultConfig?: ResolvedAppConfig;
  defaultKibanaClient?: KibanaClient;
  loadProfileConfig?: ProfileConfigLoader;
  kibanaClientFactory?: (config: AppConfig["kibana"]) => KibanaClient;
  maxProfiles?: number;
}

export class ProfileRuntimeRegistry {
  private readonly kibanaClientFactory: (config: AppConfig["kibana"]) => KibanaClient;
  private readonly loadProfileConfig?: ProfileConfigLoader;
  private readonly maxProfiles: number;
  private readonly runtimes = new Map<string, ProfileRuntime>();
  private readonly inFlight = new Map<string, Promise<ProfileRuntime>>();
  private readonly clients = new Map<string, KibanaClient>();
  private defaultRuntime?: ProfileRuntime;

  constructor(options: ProfileRuntimeRegistryOptions = {}) {
    this.kibanaClientFactory =
      options.kibanaClientFactory ?? ((config: AppConfig["kibana"]) => new KibanaClient(config));
    this.loadProfileConfig = options.loadProfileConfig;
    this.maxProfiles = options.maxProfiles ?? DEFAULT_MAX_PROFILES;
    if (options.defaultConfig) {
      this.defaultRuntime = this.createRuntime(options.defaultConfig, options.defaultKibanaClient);
    }
  }

  get hasDefault(): boolean {
    return this.defaultRuntime !== undefined;
  }

  get supportsNamedProfiles(): boolean {
    return this.loadProfileConfig !== undefined;
  }

  /** False only for a server started without any configuration, waiting for the legacy 'configure' tool. */
  get isConfigured(): boolean {
    return this.hasDefault || this.supportsNamedProfiles;
  }

  getDefault(): ProfileRuntime | undefined {
    return this.defaultRuntime;
  }

  setDefault(config: ResolvedAppConfig): ProfileRuntime {
    this.defaultRuntime = this.createRuntime(config);
    return this.defaultRuntime;
  }

  async resolve(profileName?: string): Promise<ProfileRuntime> {
    if (profileName === undefined) {
      if (this.defaultRuntime) {
        return this.refresh(this.defaultRuntime);
      }
      throw new Error(
        this.loadProfileConfig
          ? "No profile was supplied for this call and no default profile is configured."
          : "Server is not configured. Call the 'configure' tool first.",
      );
    }

    // Names are compared exactly: two identities differing only by case are two profiles, each
    // with its own catalog.
    const key = normalizeProfileName(profileName);
    if (this.defaultRuntime?.config.profileName === key) {
      return this.refresh(this.defaultRuntime);
    }
    if (!this.loadProfileConfig) {
      throw new Error("Profile selection is not available on this server.");
    }

    const cached = this.runtimes.get(key);
    if (cached) {
      // Refresh recency for the least-recently-used eviction.
      this.runtimes.delete(key);
      this.runtimes.set(key, cached);
      return this.refresh(cached);
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return this.refresh(await pending);
    }

    const loading = this.loadProfileConfig(key).then((config) => {
      const runtime = this.createRuntime(config);
      this.runtimes.set(key, runtime);
      this.evictLeastRecentlyUsed();
      return runtime;
    });
    this.inFlight.set(key, loading);
    try {
      return await this.refresh(await loading);
    } finally {
      this.inFlight.delete(key);
    }
  }

  // Store-backed catalogs are re-read on every call, so that every process sharing the store
  // serves the same sources; the parsed catalog and schema cache are kept while it is unchanged.
  private async refresh(runtime: ProfileRuntime): Promise<ProfileRuntime> {
    const catalog = runtime.config.catalog;
    if (!catalog) {
      return runtime;
    }
    const content = await catalog.read();
    if (content !== runtime.catalogContent) {
      this.replaceSources(
        runtime,
        content === undefined
          ? []
          : sourceCatalogSchema.parse(JSON.parse(content) as unknown).sources,
        content,
      );
    }
    return runtime;
  }

  replaceSources(
    runtime: ProfileRuntime,
    sources: SourceDefinition[],
    catalogContent: string | undefined = runtime.catalogContent,
  ): void {
    runtime.config = { ...runtime.config, sources };
    runtime.catalogContent = catalogContent;
    runtime.sourceCatalog = new SourceCatalog(sources);
    runtime.schemaCatalog = new SchemaCatalog(runtime.kibanaClient);
  }

  private createRuntime(config: ResolvedAppConfig, kibanaClient?: KibanaClient): ProfileRuntime {
    const client = kibanaClient ?? this.clientFor(config.kibana);
    return {
      config,
      sourceCatalog: new SourceCatalog(config.sources),
      kibanaClient: client,
      schemaCatalog: new SchemaCatalog(client),
    };
  }

  // Profiles that share one connection share one client, hence one backend concurrency budget.
  private clientFor(config: AppConfig["kibana"]): KibanaClient {
    // Hashed so that the map does not keep credentials alive as keys.
    const key = createHash("sha256")
      .update(JSON.stringify([config.baseUrl, config.username, config.password, config.timeoutMs]))
      .digest("hex");
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }
    const client = this.kibanaClientFactory(config);
    this.clients.set(key, client);
    return client;
  }

  private evictLeastRecentlyUsed(): void {
    while (this.runtimes.size > this.maxProfiles) {
      const oldest = this.runtimes.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.runtimes.delete(oldest);
    }
  }
}
