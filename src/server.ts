import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";

import { KibanaClient, KibanaRequestError } from "./kibana_client.js";
import { SchemaCatalog } from "./schema_catalog.js";
import { SourceCatalog } from "./source_catalog.js";
import {
  configureInputSchema,
  configureOutputSchema,
  createConfigureCallToolResult,
  executeConfigure,
} from "./tools/configure.js";
import {
  configureIndexInputSchema,
  configureIndexOutputSchema,
  createConfigureIndexCallToolResult,
  executeConfigureIndex,
} from "./tools/configure_index.js";
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

async function withKibanaRequestDiagnostics(
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof KibanaRequestError)) {
      throw error;
    }

    return {
      content: [{ type: "text", text: error.message }],
      isError: true,
      _meta: {
        kibana_request_error: {
          code: error.code,
          phase: error.phase,
          source_id: error.sourceId,
          timeout_ms: error.timeoutMs,
          ...(error.status === undefined ? {} : { status: error.status }),
          ...(error.causeCode === undefined ? {} : { cause_code: error.causeCode }),
        },
      },
    };
  }
}

export interface Application {
  server: McpServer;
  handlers: {
    configure: (input: unknown) => Promise<Awaited<ReturnType<typeof executeConfigure>>["result"]>;
    configure_index: (
      input: unknown,
      callerSignal?: AbortSignal,
    ) => Promise<Awaited<ReturnType<typeof executeConfigureIndex>>["result"]>;
    describe_fields: (
      input: unknown,
      callerSignal?: AbortSignal,
    ) => Promise<Awaited<ReturnType<typeof executeDescribeFields>>>;
    discover: (input: unknown) => ReturnType<typeof executeDiscover>;
    filter: (input: unknown, callerSignal?: AbortSignal) => ReturnType<typeof executeFilter>;
    query: (input: unknown, callerSignal?: AbortSignal) => ReturnType<typeof executeQuery>;
  };
}

export function createApplication(
  initialConfig?: ResolvedAppConfig,
  dependencies?: {
    kibanaClient?: KibanaClient;
    kibanaClientFactory?: (config: AppConfig["kibana"]) => KibanaClient;
    configureIndexFn?: typeof executeConfigureIndex;
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

  async function withKibanaToolDeadline<T>(
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = activeConfig?.kibana.timeoutMs;
    if (timeoutMs === undefined) {
      throw new Error("Server is not configured. Call the 'configure' tool first.");
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

    try {
      return await operation(signal);
    } catch (error) {
      if (callerSignal?.aborted || !timeoutSignal.aborted) {
        throw error;
      }
      const requestError = error instanceof KibanaRequestError ? error : undefined;
      throw new KibanaRequestError(
        "KIBANA_TIMEOUT",
        requestError?.phase ?? "request",
        requestError?.sourceId,
        timeoutMs,
        `Kibana tool call exceeded its ${timeoutMs} ms backend deadline.`,
        error,
        requestError?.status,
        requestError?.causeCode,
      );
    }
  }

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

  const configureIndexHandler = async (input: unknown, callerSignal?: AbortSignal) => {
    if (!activeConfig || !kibanaClient) {
      throw new Error("No saved Kibana connection is available. Run connection bootstrap first.");
    }
    const configured = activeConfig;
    const client = kibanaClient;
    const configureIndexFn = dependencies?.configureIndexFn ?? executeConfigureIndex;
    const { sources, result } = await withKibanaToolDeadline(callerSignal, (signal) =>
      configureIndexFn(configureIndexInputSchema.parse(input), {
        config: configured,
        kibanaClient: client,
        callerSignal: signal,
      }),
    );
    activeConfig = { ...activeConfig, sources };
    sourceCatalog = new SourceCatalog(sources);
    schemaCatalog = new SchemaCatalog(client);
    return result;
  };

  const describeFieldsHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withKibanaToolDeadline(callerSignal, (signal) =>
      executeDescribeFields(
        describeFieldsInputSchema.parse(input),
        requireConfigured().sourceCatalog,
        requireConfigured().schemaCatalog,
        signal,
      ),
    );
  const discoverHandler = (input: unknown) =>
    executeDiscover(discoverInputSchema.parse(input), requireConfigured().sourceCatalog);
  const filterHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withKibanaToolDeadline(callerSignal, (signal) =>
      executeFilter(
        filterInputSchema.parse(input),
        requireConfigured().sourceCatalog,
        requireConfigured().kibanaClient,
        {
          schemaCatalog: requireConfigured().schemaCatalog,
          callerSignal: signal,
        },
      ),
    );
  const queryHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withKibanaToolDeadline(callerSignal, (signal) =>
      executeQuery(
        queryInputSchema.parse(input),
        requireConfigured().sourceCatalog,
        requireConfigured().kibanaClient,
        {
          schemaCatalog: requireConfigured().schemaCatalog,
          callerSignal: signal,
        },
      ),
    );

  if (!initialConfig) {
    server.registerTool(
      "configure",
      {
        description:
          "Advanced legacy setup for a server started without a saved profile. Replaces the Kibana connection and full source catalog.",
        inputSchema: configureInputSchema,
        outputSchema: configureOutputSchema,
      },
      async (input) => createConfigureCallToolResult(await configureHandler(input)),
    );
  } else {
    server.registerTool(
      "configure_index",
      {
        description:
          "Configure exactly one Kibana index or index pattern after the user has explicitly named it. Never guess, list, scan, or auto-select indexes before calling this tool.",
        inputSchema: configureIndexInputSchema,
        outputSchema: configureIndexOutputSchema,
      },
      async (input, context) =>
        withKibanaRequestDiagnostics(async () =>
          createConfigureIndexCallToolResult(
            await configureIndexHandler(input, context.mcpReq.signal),
          ),
        ),
    );
  }

  server.registerTool(
    "describe_fields",
    {
      description: "Describe the effective field capabilities for a configured logical source.",
      inputSchema: describeFieldsInputSchema,
      outputSchema: describeFieldsOutputSchema,
    },
    async (input, context) =>
      withKibanaRequestDiagnostics(async () =>
        createDescribeFieldsCallToolResult(
          await describeFieldsHandler(input, context.mcpReq.signal),
        ),
      ),
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
    async (input, context) =>
      withKibanaRequestDiagnostics(async () =>
        createFilterCallToolResult(await filterHandler(input, context.mcpReq.signal)),
      ),
  );

  server.registerTool(
    "query",
    {
      description:
        "Query one or more logical log sources over an absolute time window with text, filters, and aggregate modes.",
      inputSchema: queryInputSchema,
      outputSchema: queryOutputSchema,
    },
    async (input, context) =>
      withKibanaRequestDiagnostics(async () =>
        createQueryCallToolResult(await queryHandler(input, context.mcpReq.signal)),
      ),
  );

  return {
    server,
    handlers: {
      configure: configureHandler,
      configure_index: configureIndexHandler,
      describe_fields: describeFieldsHandler,
      discover: discoverHandler,
      filter: filterHandler,
      query: queryHandler,
    },
  };
}
