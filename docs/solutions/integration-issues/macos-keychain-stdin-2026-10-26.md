---
title: Save macOS Keychain credentials without terminal password prompts
date: 2026-10-26
category: integration-issues
module: profiles/secret_store
problem_type: integration_issue
tags: [macos, keychain, credentials, bootstrap, rollback]
---

# Save macOS Keychain credentials without terminal password prompts

Use one `security -i` command on piped stdin. Supply the serialized JSON as
hexadecimal password data (`-X`), never as process arguments. This preserves the
stored JSON format and the shared bootstrap, setup, and rollback storage contract.

`security add-generic-password -w` without a value calls `getpass()`, which reads
the controlling terminal before stdin. Detaching alone also retains getpass's
input-length limit. The interactive command reader instead consumes stdin.
Quote service/account tokens, reject line breaks and NUL in those identifiers,
and reject commands of 4096 bytes or more before spawning: Apple's interactive
reader has a 4096-byte buffer. Hex encoding counts toward this limit. Oversized
credentials must fail without replacing an existing item.

Keep the 30-second timeout and reap failed children. Do not surface raw command
output or malformed stored JSON in errors. Linux and Windows transports remain
unchanged.

Decode all-hex macOS readback before parsing JSON: `find-generic-password -w`
prints non-ASCII data as hex. Native testing exposed this second issue with UTF-8
credentials. Both ordinary JSON and previously stored UTF-8 JSON remain readable.

The original implementation entered in `d311fda` to keep secrets off argv.
`runBootstrap()` saves after verification and restores the previous secret on
failure; guided `runSetupFlow()` calls the same store. No caller/input-mode
workaround is needed. The shared runner now kills timed-out/broken-pipe children
and waits for `close`, so rollback cannot race a still-running writer.

Apple implementation references: [password prompting and hex input](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/keychain_add.c),
[interactive parser and buffer](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.c),
[hex readback](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/keychain_find.c),
and [private keychains excluded from the search list](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/StorageManager.cpp)
(`shouldAddToSearchList`). Native `man getpass` also documents its input limit.

## Validation

Executed 2026-10-26 against base `20c67bd5baf107088b3b898ab419bc08aa2a2c7f`.
Live issue #56 had no comments. No dependencies added or lockfile changed.

| Check | Exact result |
| --- | --- |
| Before implementation: `npm test -- test/secret_store.test.ts` | 4 failed, 3 passed |
| Additional UTF-8 readback regression, before decoder | 1 failed, 7 passed |
| Focused green: `npm test -- test/secret_store.test.ts test/secret_store_runner.test.ts test/bootstrap.test.ts test/setup_flow.test.ts` | 4 files, 31 tests passed |
| Sabotage: restore only the old `save()` transport in an isolated `/tmp/kibana-56-sabotage` copy; `npm test -- --root /tmp/kibana-56-sabotage test/secret_store.test.ts` | 3 failed, 6 passed; working tree unchanged |
| Final `npm run verify` | 45 files, 379 tests passed; types, lint, format, build, installed-plugin MCP entrypoint, release contract, packlist passed |
| Native libc probe | Without TTY reads piped bytes; with controlling TTY ignores pipe and blocks; killed/reaped after 2 seconds; no keychain access |
| Native store, no TTY | 12 checks passed; exit 0; password_prompt=False |
| Native store, controlling TTY + piped stdin | 10 checks passed; exit 0; password_prompt=False |

Native host: macOS 15.6.1 (24G90), arm64, existing Node v22.23.2 at
`/Users/zacariachtatar/.hermes/node/bin/node`, existing `/usr/bin/python3`.
Each run created a fresh private keychain under native scratch, supplied explicit
keychain paths for every item operation, and deleted its keychain and state files
in `finally`. User search-list snapshots matched before/after. All six staging
job directories were removed after testing. No login/default keychain, real
credentials, client registration, or production Kibana was accessed or modified.

Native coverage includes create/update/read/delete, missing items, quotes,
backslashes, newlines, tabs, NUL, Unicode/emoji, quoted identifiers, a 1700-character
password, oversize rejection preserving the previous secret, a real duplicate-item
error, bootstrap restoration using the native store, and visible simulated
restoration failure. The real 30000 ms timeout killed a child that ignored
SIGTERM; completion was under 35000 ms and its PID no longer existed.

### Reproduce the native checks

1. Build locally: `node scripts/build-macos-keychain-check.mjs /tmp/native.mjs`.
2. Archive the bundle, `src/`, the three `scripts/*macos-keychain*` files, and
   `package.json`/`package-lock.json`. Create a **new** directory using
   `mktemp -d "$(getconf DARWIN_USER_TEMP_DIR)kibana-56-job.XXXXXXXX"` on the Mac.
   Transport with SCP and verify SHA256 before extracting; never copy over a checkout.
3. Run these exact native commands inside that job directory:

   ```sh
   /usr/bin/python3 scripts/verify-macos-keychain-tty.py --probe-getpass
   /usr/bin/python3 scripts/verify-macos-keychain-tty.py /Users/zacariachtatar/.hermes/node/bin/node ./native.mjs
   ```

4. Remove only the job directory created for this run after cleanup succeeds.

SSH/SCP used `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ConnectTimeout=10`
and the authorized `mac-worker` alias. Final transported archive SHA256:
`dc4a9c38af23697ec87705ca478f5d9c47d620353c8ce4da17333180c58103ab`.
Tested `src/profiles/secret_store.ts` SHA256:
`d91213a99c7c3a714b31cd2cd88d2dfda3cbcaee5c7a99596b9d8810db616053`.

### Limits and excluded evidence

The encoded command must be below 4096 bytes, including metadata and newline;
this deliberately rejects oversized writes before Apple's reader can truncate
them. There is no fixed character limit because UTF-8 and hex encoding affect size.
The store retains JSON bytes and the same service/account identity.

The Mac run verifies the actual Security CLI and Keychain boundary; bootstrap's
network verifier and client registrar were synthetic. Native guided prompts,
production Kibana connectivity, macOS GUI authorization, other macOS versions,
and native Linux/Windows stores were not exercised. Linux/Windows unit contracts
and existing setup/CLI tests passed. No GUI bypass or global prerequisite install
was needed.

Early native harness runs exposed UTF-8 hex readback and two fixture mistakes
(duplicate check after deletion, then a mismatched service name); these were
corrected before the final green run. An attempted full baseline native run with
the positional keychain before bare `-w` failed before useful reproduction and
is **not** counted as bug evidence. The independent libc probe demonstrates the
old terminal behavior safely; the isolated local sabotage proves the regression
tests reject the old writer. The native green run proves the replacement works.
