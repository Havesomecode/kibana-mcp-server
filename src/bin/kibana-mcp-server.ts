#!/usr/bin/env node
import { runCli } from "./run_cli.js";

process.exitCode = await runCli();
