import { AsyncLocalStorage } from "node:async_hooks";

import type { ProfileRuntime } from "./runtime.js";

const profileRuntimeStorage = new AsyncLocalStorage<ProfileRuntime>();

export function runWithProfileRuntime<T>(runtime: ProfileRuntime, operation: () => T): T {
  return profileRuntimeStorage.run(runtime, operation);
}

export function getProfileRuntime(): ProfileRuntime | undefined {
  return profileRuntimeStorage.getStore();
}

export function requireProfileRuntime(): ProfileRuntime {
  const runtime = profileRuntimeStorage.getStore();
  if (!runtime) {
    throw new Error("No profile is bound to the current tool call.");
  }
  return runtime;
}
