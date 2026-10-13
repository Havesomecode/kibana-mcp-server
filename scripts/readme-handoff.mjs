import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const rawRoot = "https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
}

function resolveCommit(repo, ref) {
  try {
    return git(repo, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`)
      .toString("utf8")
      .trim();
  } catch {
    return undefined;
  }
}

function readReadme(repo, commit) {
  try {
    if (git(repo, "cat-file", "-t", `${commit}:README.md`).toString("utf8").trim() !== "blob") {
      throw new Error("README is not a file");
    }
    return git(repo, "show", `${commit}:README.md`);
  } catch {
    throw new Error(`README.md is missing or unreadable at resolved commit ${commit}`);
  }
}

// Resolve only explicit branch/tag names or full commit SHAs, never HEAD/revision expressions.
export function resolveReadmeHandoff(repo, installationRef) {
  if (
    typeof installationRef !== "string" ||
    !installationRef ||
    installationRef !== installationRef.trim() ||
    installationRef.startsWith("-") ||
    installationRef === "HEAD" ||
    (installationRef.startsWith("refs/") &&
      !installationRef.startsWith("refs/heads/") &&
      !installationRef.startsWith("refs/tags/"))
  ) {
    throw new Error("An installation ref must be a branch, tag, or full commit SHA");
  }

  let ref = installationRef;
  let commit;
  if (/^[a-f0-9]{40}$/i.test(ref)) {
    ref = ref.toLowerCase();
    commit = resolveCommit(repo, ref);
    if (commit && commit !== ref) {
      throw new Error(
        `Installation ref ${ref} is not a commit SHA; use the tag ref or resolved commit`,
      );
    }
  } else {
    const candidates = ref.startsWith("refs/") ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
    for (const candidate of candidates) {
      try {
        git(repo, "check-ref-format", candidate);
      } catch {
        throw new Error(`Invalid installation ref: ${installationRef}`);
      }
    }
    const matches = candidates
      .map((candidate) => ({ ref: candidate, commit: resolveCommit(repo, candidate) }))
      .filter((candidate) => candidate.commit);
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous installation ref ${installationRef}; specify refs/heads/ or refs/tags/`,
      );
    }
    if (matches.length === 1) ({ ref, commit } = matches[0]);
  }
  if (!commit) {
    throw new Error(
      `Cannot resolve installation ref ${installationRef}; fetch that exact ref before retrying`,
    );
  }
  readReadme(repo, commit);
  return { ref, commit, url: `${rawRoot}/${commit}/README.md` };
}

// Emit no version-matched handoff until the remote README matches the selected Git object.
export async function verifyReadmeHandoff(repo, installationRef, fetchReadme = fetch) {
  const handoff = resolveReadmeHandoff(repo, installationRef);
  let response;
  let retrieved;
  try {
    response = await fetchReadme(handoff.url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    retrieved = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`Cannot retrieve README at ${handoff.url}: ${error.message}`);
  }
  if (!retrieved.equals(readReadme(repo, handoff.commit))) {
    throw new Error(
      `README at ${handoff.url} does not match resolved commit ${handoff.commit}; no handoff emitted`,
    );
  }
  return handoff;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: node scripts/readme-handoff.mjs <resolved-installation-ref>");
    }
    console.log(JSON.stringify(await verifyReadmeHandoff(process.cwd(), process.argv[2]), null, 2));
  } catch (error) {
    console.error(`readme-handoff: ${error.message}`);
    process.exitCode = 1;
  }
}
