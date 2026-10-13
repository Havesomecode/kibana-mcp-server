import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";

import { type KibanaClient, KibanaRequestError } from "./kibana/client.js";
import { requireProfileRuntime, runWithProfileRuntime } from "./profiles/context.js";
import { type ProfileRuntime, ProfileRuntimeRegistry } from "./profiles/runtime.js";
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
    discover: (input: unknown) => Promise<ReturnType<typeof executeDiscover>>;
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
    profileRegistry?: ProfileRuntimeRegistry;
    requestProfile?: string;
  },
): Application {
  const server = new McpServer({
    name: "kibana-log-investigation",
    version: "0.1.0",
  });
  const registry =
    dependencies?.profileRegistry ??
    new ProfileRuntimeRegistry({
      defaultConfig: initialConfig,
      defaultKibanaClient: dependencies?.kibanaClient,
      kibanaClientFactory: dependencies?.kibanaClientFactory,
    });

  // The profile is resolved once per tool call, then read back through the async context.
  async function withProfile<T>(
    operation: (runtime: ProfileRuntime) => T | Promise<T>,
  ): Promise<T> {
    const runtime = await registry.resolve(dependencies?.requestProfile);
    return runWithProfileRuntime(runtime, () => operation(runtime));
  }

  async function withKibanaToolDeadline<T>(
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = requireProfileRuntime().config.kibana.timeoutMs;
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

  const configureHandler = async (input: unknown) => {
    const current = registry.getDefault()?.config;
    const { nextConfig, result } = await executeConfigure(configureInputSchema.parse(input), {
      sourceCatalogPath: current?.sourceCatalogPath,
    });
    registry.setDefault({
      ...nextConfig,
      sourceCatalogPath: result.source_catalog_path,
      profileName: current?.profileName,
      sourceCatalogOrigin: current?.sourceCatalogOrigin,
    });
    return result;
  };

  const configureIndexHandler = async (input: unknown, callerSignal?: AbortSignal) => {
    if (!registry.isConfigured) {
      throw new Error("No saved Kibana connection is available. Run connection bootstrap first.");
    }
    const configureIndexFn = dependencies?.configureIndexFn ?? executeConfigureIndex;
    return withProfile((runtime) =>
      withKibanaToolDeadline(callerSignal, async (signal) => {
        const { sources, result, catalogContent } = await configureIndexFn(
          configureIndexInputSchema.parse(input),
          {
            config: runtime.config,
            kibanaClient: runtime.kibanaClient,
            callerSignal: signal,
          },
        );
        registry.replaceSources(runtime, sources, catalogContent);
        return result;
      }),
    );
  };

  const describeFieldsHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withProfile((runtime) =>
      withKibanaToolDeadline(callerSignal, (signal) =>
        executeDescribeFields(
          describeFieldsInputSchema.parse(input),
          runtime.sourceCatalog,
          runtime.schemaCatalog,
          signal,
        ),
      ),
    );
  const discoverHandler = (input: unknown) =>
    withProfile((runtime) =>
      executeDiscover(discoverInputSchema.parse(input), runtime.sourceCatalog),
    );
  const filterHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withProfile((runtime) =>
      withKibanaToolDeadline(callerSignal, (signal) =>
        executeFilter(filterInputSchema.parse(input), runtime.sourceCatalog, runtime.kibanaClient, {
          schemaCatalog: runtime.schemaCatalog,
          callerSignal: signal,
        }),
      ),
    );
  const queryHandler = (input: unknown, callerSignal?: AbortSignal) =>
    withProfile((runtime) =>
      withKibanaToolDeadline(callerSignal, (signal) =>
        executeQuery(queryInputSchema.parse(input), runtime.sourceCatalog, runtime.kibanaClient, {
          schemaCatalog: runtime.schemaCatalog,
          callerSignal: signal,
        }),
      ),
    );

  if (!registry.isConfigured) {
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
    async (input) => createDiscoverCallToolResult(await discoverHandler(input)),
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
