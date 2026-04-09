#!/usr/bin/env node

import { runCli } from "./cli.js";

runCli()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
