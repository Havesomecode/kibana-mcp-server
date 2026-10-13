import { createHash } from "node:crypto";

const MAX_PROFILE_NAME_LENGTH = 256;
const MAX_PROFILE_SLUG_LENGTH = 64;

/**
 * Normalizes a profile name supplied by the transport identity or the startup configuration.
 */
export function normalizeProfileName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error("Profile name must not be empty.");
  }
  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    throw new Error(`Profile name must not exceed ${MAX_PROFILE_NAME_LENGTH} characters.`);
  }
  return name;
}

/**
 * Derives a filesystem-safe key from a profile name. Names that are not already a plain slug get a
 * digest suffix. Literal names ending in that suffix are hashed too, reserving the generated
 * namespace so that they cannot impersonate another identity's key.
 */
export function toProfileKey(profileName: string): string {
  const name = normalizeProfileName(profileName);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PROFILE_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (slug === name && !/-[a-f0-9]{12}$/.test(name)) {
    return slug;
  }

  const digest = createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `${slug || "profile"}-${digest}`;
}
