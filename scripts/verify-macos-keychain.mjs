// Bundle with esbuild (platform=node, format=esm) before copying to a native Mac.
// Run only in a new scratch directory. Never uses the default keychain.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { resolveProfilePaths } from "../src/profiles/paths.js";
import { createSecretStore, runCommand } from "../src/profiles/secret_store.js";
import { ProfileStore } from "../src/profiles/store.js";
import { runBootstrap } from "../src/setup/bootstrap.js";

assert.equal(process.platform, "darwin");
const root = await mkdtemp(join(tmpdir(), "kibana-keychain-56-"));
const keychain = join(root, "isolated.keychain-db");
assert.ok(isAbsolute(keychain));
const quote = (s) => `"${s.replace(/["\\]/g, "\\$&")}"`;
const command = async (args, stdin) => {
  const result = await runCommand("/usr/bin/security", args, { stdin });
  assert.equal(result.exitCode, 0, "native fixture command failed (output suppressed)");
  return result.stdout;
};
const searchList = await command(["list-keychains", "-d", "user"]);
let created = false;
let assertions = 0;
const check = (condition, label) => {
  assert.ok(condition, label);
  assertions += 1;
  console.log(`PASS ${label}`);
};
const nativeRunner = async (_command, args, options) => {
  if (args[0] === "-i") {
    assert.ok(options.stdin.endsWith("\n"));
    return runCommand("/usr/bin/security", args, {
      ...options,
      stdin: `${options.stdin.slice(0, -1)} ${quote(keychain)}\n`,
    });
  }
  assert.ok(["find-generic-password", "delete-generic-password"].includes(args[0]));
  return runCommand("/usr/bin/security", [...args, keychain], options);
};
const serviceName = "com.example.kibana.issue56";
const store = createSecretStore("darwin", nativeRunner, serviceName);
const old = { username: "fictitious-user", password: "fictitious-old" };
const special = {
  username: "élastic 雪",
  password: `quotes '" backslash \\ newline\n tabs\t NUL\0 emoji 😀 ${"long".repeat(60)}`,
};

try {
  await command(
    ["-i"],
    `create-keychain -p ${randomBytes(24).toString("hex")} ${quote(keychain)}\n`,
  );
  created = true;
  check(
    (await command(["list-keychains", "-d", "user"])) === searchList,
    "search list unchanged after create",
  );
  await store.save("prod", old);
  check(JSON.stringify(await store.load("prod")) === JSON.stringify(old), "create/read exact");
  await store.save("prod", special);
  check(
    JSON.stringify(await store.load("prod")) === JSON.stringify(special),
    "update/read Unicode and special characters exact",
  );
  const quotedStore = createSecretStore("darwin", nativeRunner, 'test "\\ 雪');
  await quotedStore.save('account "\\ 雪', special);
  check(
    JSON.stringify(await quotedStore.load('account "\\ 雪')) === JSON.stringify(special),
    "quoted Unicode identifiers round trip",
  );
  await quotedStore.delete('account "\\ 雪');
  const large = { username: "u", password: "a".repeat(1700) };
  await store.save("prod", large);
  check(
    JSON.stringify(await store.load("prod")) === JSON.stringify(large),
    "long credential round trip",
  );
  await assert.rejects(
    store.save("prod", { username: "u", password: "雪".repeat(1000) }),
    /too long/,
  );
  check(
    JSON.stringify(await store.load("prod")) === JSON.stringify(large),
    "oversized write preserves previous secret",
  );
  const paths = resolveProfilePaths({ KIBANA_STATE_DIR: join(root, "state") });
  const profileStore = new ProfileStore(paths);
  const options = {
    profileName: "prod",
    baseUrl: "https://example.invalid",
    ...old,
    client: "none",
    makeDefault: true,
    mcpName: "kibana-issue56-test",
    packageSpecifier: "@havesomecode/kibana-mcp-server",
  };
  const deps = { paths, profileStore, secretStore: store, verifier: { async verify() {} } };
  await runBootstrap(options, deps);
  await assert.rejects(
    runBootstrap(
      { ...options, ...special, client: "codex" },
      {
        ...deps,
        clientRegistrar: {
          async preflight() {
            return { alreadyRegistered: false };
          },
          async register() {
            throw new Error("synthetic registration failure");
          },
          async rollback() {},
        },
      },
    ),
    /synthetic registration failure/,
  );
  const profile = await profileStore.getDefaultProfile();
  check(
    JSON.stringify(await store.load(profile.id)) === JSON.stringify(old),
    "bootstrap restores previous native secret",
  );
  let writes = 0;
  await assert.rejects(
    runBootstrap(
      { ...options, ...special, client: "codex" },
      {
        ...deps,
        secretStore: {
          load: (id) => store.load(id),
          delete: (id) => store.delete(id),
          async save(id, secret) {
            if (++writes === 2) throw new Error("synthetic restoration failure");
            await store.save(id, secret);
          },
        },
        clientRegistrar: {
          async preflight() {
            return { alreadyRegistered: false };
          },
          async register() {
            throw new Error("synthetic registration failure");
          },
          async rollback() {},
        },
      },
    ),
    /Rollback also failed: synthetic restoration failure/,
  );
  check(writes === 2, "rollback failure remains visible");
  const invalidStore = createSecretStore(
    "darwin",
    (_cmd, args, opts) =>
      runCommand("/usr/bin/security", args, {
        ...opts,
        // Force a real duplicate-item error, still scoped to the existing fixture.
        stdin: `${opts.stdin.slice(0, -1).replace(" -U ", " ")} ${quote(keychain)}\n`,
      }),
    serviceName,
  );
  await assert.rejects(
    invalidStore.save(profile.id, special),
    /macOS Keychain command failed \(exit \d+\)/,
  );
  check(true, "native failure sanitized");
  await store.delete("prod");
  await store.delete("prod");
  await assert.rejects(store.load("prod"), { code: "NOT_FOUND" });
  check(true, "delete and missing semantics");

  if (process.argv.includes("--timeout")) {
    const pidFile = join(root, "timeout.pid");
    const started = Date.now();
    await assert.rejects(
      runCommand(process.execPath, [
        "-e",
        'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
        pidFile,
      ]),
      /timed out after 30000ms/,
    );
    check(Date.now() - started >= 30000 && Date.now() - started < 35000, "native timeout bounded");
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    check(true, "timed-out child reaped");
  }
  console.log(
    `PASS native Keychain: ${assertions} checks; Node ${process.version}; ${process.arch}`,
  );
} catch (error) {
  console.log(`FAIL native check after ${assertions} checks; error type ${error.name}`);
  throw error;
} finally {
  if (created) await command(["delete-keychain", keychain]);
  assert.equal(await command(["list-keychains", "-d", "user"]), searchList, "search list changed");
  await rm(root, { recursive: true, force: true });
  console.log("PASS isolated keychain/files removed; user search list unchanged");
}
