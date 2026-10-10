// Hosts the Devin usage plugin asks for the signed-in account's ACU. The plugin has its own
// allowlist for where the login may be sent; the egress guard needs the same hosts open, or
// the request never leaves the machine. wukong-devin-usage's default list must stay in sync
// (devin-hosts.test.ts checks).
export const DEVIN_USAGE_HOSTS: readonly string[] = ["server.codeium.com", "api.devin.ai"];

/** The defaults plus any hosts a company adds with WUKONG_DEVIN_API_HOSTS (comma separated). */
export function devinUsageHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.WUKONG_DEVIN_API_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return [...DEVIN_USAGE_HOSTS, ...extra];
}
