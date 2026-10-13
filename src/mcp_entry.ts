#!/usr/bin/env node

import { startMcpServer } from "./transports/stdio.js";

startMcpServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
