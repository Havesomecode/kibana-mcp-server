#!/usr/bin/env node

import { startMcpServer } from "./transports/stdio.js";

await startMcpServer();
