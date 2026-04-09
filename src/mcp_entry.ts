#!/usr/bin/env node

import { startMcpServer } from "./mcp_runtime.js";

startMcpServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
