import { describe, expect, it } from "vitest";

import { normalizeProfileName, toProfileKey } from "../../src/profiles/names.js";

describe("profile keys", () => {
  it("does not let a literal profile name impersonate a generated key", () => {
    const alice = toProfileKey("Alice");
    expect(alice).toBe("alice-3bc51062973c");
    expect(toProfileKey("alice-3bc51062973c")).not.toBe(alice);
    expect(toProfileKey(toProfileKey(alice))).not.toBe(toProfileKey(alice));
  });

  it("keeps ordinary slugs stable and names deterministic, case-sensitive and path-safe", () => {
    expect(toProfileKey("prod")).toBe("prod");
    expect(toProfileKey(" Alice ")).toBe(toProfileKey("Alice"));
    expect(toProfileKey("alice")).not.toBe(toProfileKey("Alice"));
    for (const name of ["../Alice", "用户", "a".repeat(256)]) {
      expect(toProfileKey(name)).toMatch(/^[a-z0-9-]+$/);
    }
    expect(() => normalizeProfileName(" ")).toThrow("must not be empty");
    expect(() => normalizeProfileName("a".repeat(257))).toThrow("must not exceed");
  });
});
