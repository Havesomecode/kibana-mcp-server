import { McpServer } from "@modelcontextprotocol/server";

import { KibanaClient } from "./kibana_client.js";
import { SchemaCatalog } from "./schema_catalog.js";
import { SourceCatalog } from "./source_catalog.js";
import {
  configureInputSchema,
  configureOutputSchema,
  createConfigureCallToolResult,
  executeConfigure,
} from "./tools/configure.js";
import {
  createDescribeFieldsCallToolResult,
  describeFieldsInputSchema,
  describeFieldsOutputSchema,
  executeDescribeFields,
} from "./tools/describe_fields.js";
import {
  createDiscoverCallToolResult,
  discoverInputSchema,
  discoverOutputSchema,
  executeDiscover,
} from "./tools/discover.js";
import {
  createFilterCallToolResult,
  executeFilter,
  filterInputSchema,
  filterOutputSchema,
} from "./tools/filter.js";
import {
  createQueryCallToolResult,
  executeQuery,
  queryInputSchema,
  queryOutputSchema,
} from "./tools/query.js";
import type { AppConfig } from "./types.js";
import type { ResolvedAppConfig } from "./types.js";

export interface Application {
  server: McpServer;
  handlers: {
    configure: (input: unknown) => Promise<Awaited<ReturnType<typeof executeConfigure>>["result"]>;
    describe_fields: (input: unknown) => Promise<Awaited<ReturnType<typeof executeDescribeFields>>>;
    discover: (input: unknown) => ReturnType<typeof executeDiscover>;
    filter: (input: unknown) => ReturnType<typeof executeFilter>;
    query: (input: unknown) => ReturnType<typeof executeQuery>;
  };
}

export function createApplication(
  initialConfig?: ResolvedAppConfig,
  dependencies?: {
    kibanaClient?: KibanaClient;
    kibanaClientFactory?: (config: AppConfig["kibana"]) => KibanaClient;
  },
): Application {
  const server = new McpServer({
    name: "kibana-log-investigation",
    version: "0.1.0",
  });
  const kibanaClientFactory =
    dependencies?.kibanaClientFactory ??
    ((config: AppConfig["kibana"]) => new KibanaClient(config));

  let activeConfig = initialConfig;
  let sourceCatalog = activeConfig ? new SourceCatalog(activeConfig.sources) : null;
  let kibanaClient = activeConfig
    ? (dependencies?.kibanaClient ?? kibanaClientFactory(activeConfig.kibana))
    : null;
  let schemaCatalog = kibanaClient ? new SchemaCatalog(kibanaClient) : null;

  function requireConfigured(): {
    sourceCatalog: SourceCatalog;
    kibanaClient: Pick<KibanaClient, "executeMany" | "describeFields">;
    schemaCatalog: SchemaCatalog;
  } {
    if (!sourceCatalog || !kibanaClient || !schemaCatalog) {
      throw new Error("Server is not configured. Call the 'configure' tool first.");
    }

    return { sourceCatalog, kibanaClient, schemaCatalog };
  }

  const configureHandler = async (input: unknown) => {
    const { nextConfig, result } = await executeConfigure(configureInputSchema.parse(input), {
      sourceCatalogPath: activeConfig?.sourceCatalogPath,
    });
    activeConfig = {
      ...nextConfig,
      sourceCatalogPath: result.source_catalog_path,
      profileName: activeConfig?.profileName,
      sourceCatalogOrigin: activeConfig?.sourceCatalogOrigin,
    };
    sourceCatalog = new SourceCatalog(nextConfig.sources);
    kibanaClient = kibanaClientFactory(nextConfig.kibana);
    schemaCatalog = new SchemaCatalog(kibanaClient);
    return result;
  };

  const describeFieldsHandler = (input: unknown) =>
    executeDescribeFields(
      describeFieldsInputSchema.parse(input),
      requireConfigured().sourceCatalog,
      requireConfigured().schemaCatalog,
    );
  const discoverHandler = (input: unknown) =>
    executeDiscover(discoverInputSchema.parse(input), requireConfigured().sourceCatalog);
  const filterHandler = (input: unknown) =>
    executeFilter(
      filterInputSchema.parse(input),
      requireConfigured().sourceCatalog,
      requireConfigured().kibanaClient,
      {
        schemaCatalog: requireConfigured().schemaCatalog,
      },
    );
  const queryHandler = (input: unknown) =>
    executeQuery(
      queryInputSchema.parse(input),
      requireConfigured().sourceCatalog,
      requireConfigured().kibanaClient,
      {
        schemaCatalog: requireConfigured().schemaCatalog,
      },
    );

  server.registerTool(
    "configure",
    {
      description:
        "Configure the Kibana connection and logical source catalog for this server session.",
      inputSchema: configureInputSchema,
      outputSchema: configureOutputSchema,
    },
    async (input) => createConfigureCallToolResult(await configureHandler(input)),
  );

  server.registerTool(
    "describe_fields",
    {
      description: "Describe the effective field capabilities for a configured logical source.",
      inputSchema: describeFieldsInputSchema,
      outputSchema: describeFieldsOutputSchema,
    },
    async (input) => createDescribeFieldsCallToolResult(await describeFieldsHandler(input)),
  );

  server.registerTool(
    "discover",
    {
      description: "List configured logical log sources and field hints for investigation work.",
      inputSchema: discoverInputSchema,
      outputSchema: discoverOutputSchema,
    },
    async (input) => createDiscoverCallToolResult(discoverHandler(input)),
  );

  server.registerTool(
    "filter",
    {
      description:
        "Run an exact-field filter when the field name is already known, bypassing alias resolution.",
      inputSchema: filterInputSchema,
      outputSchema: filterOutputSchema,
    },
    async (input) => createFilterCallToolResult(await filterHandler(input)),
  );

  server.registerTool(
    "query",
    {
      description:
        "Query one or more logical log sources over an absolute time window with text, filters, and aggregate modes.",
      inputSchema: queryInputSchema,
      outputSchema: queryOutputSchema,
    },
    async (input) => createQueryCallToolResult(await queryHandler(input)),
  );

  return {
    server,
    handlers: {
      configure: configureHandler,
      describe_fields: describeFieldsHandler,
      discover: discoverHandler,
      filter: filterHandler,
      query: queryHandler,
    },
  };
}
