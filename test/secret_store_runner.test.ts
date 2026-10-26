import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

import { runCommand } from "../src/profiles/secret_store.js";

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("credential command cleanup", () => {
  it("kills a timed-out process and waits for close before rejecting", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const result = runCommand("security", ["-i"], { stdin: "test\n" });
    const rejected = expect(result).rejects.toThrow("timed out after 30000ms");
    let settled = false;
    void result.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills and reaps a child when writing stdin fails", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const result = runCommand("security", ["-i"]);
    const rejected = expect(result).rejects.toThrow("write EPIPE");
    child.stdin.emit("error", new Error("write EPIPE"));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", 1);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains native exit status and clears the timer on ordinary failure", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const result = runCommand("security", ["-i"]);
    child.stderr.write("native diagnostic");
    child.emit("close", 45);
    await expect(result).resolves.toMatchObject({ exitCode: 45, stderr: "native diagnostic" });
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
