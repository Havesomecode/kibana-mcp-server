const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Whether a listen host or URL hostname (IPv6 with or without brackets) is loopback. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.replace(/^\[(.*)\]$/, "$1"));
}
