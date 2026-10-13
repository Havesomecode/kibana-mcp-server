import fallback from "./contributors.json";

export interface Contributor {
  login: string;
  url: string;
  avatarUrl: string;
  contributions: number;
}

interface GitHubContributor {
  login: string;
  type: string;
  html_url: string;
  avatar_url: string;
  contributions: number;
}

declare const data: Contributor[];
export { data };

const CONTRIBUTORS_URL =
  "https://api.github.com/repos/Havesomecode/kibana-mcp-server/contributors?per_page=100";

export default {
  // The wall is refreshed from GitHub when a token is available (the Pages workflow); every other
  // build uses the checked-in list, so that building the site never depends on the network.
  async load(): Promise<Contributor[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return fallback;
    }

    try {
      const response = await fetch(CONTRIBUTORS_URL, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return fallback;
      }
      const contributors = ((await response.json()) as GitHubContributor[])
        .filter((contributor) => contributor.type === "User")
        .map((contributor) => ({
          login: contributor.login,
          url: contributor.html_url,
          avatarUrl: contributor.avatar_url,
          contributions: contributor.contributions,
        }));
      return contributors.length > 0 ? contributors : fallback;
    } catch {
      return fallback;
    }
  },
};
