// Wukong edition entry. daemon-worker calls this first, before it loads config or opens a
// socket. Everything Wukong-specific that has to run at
// daemon start lives here, which keeps upstream files to a one-line import.

import { activateWukongProviders } from "./providers.js";
import { allowEgressHost, installEgressGuard } from "./egress-guard.js";

export function applyWukongEdition(): void {
  // The relay is a cloud service. A launch-time override also locks it against config edits.
  process.env.PASEO_RELAY_ENABLED = "false";

  for (const host of (process.env.WUKONG_ALLOWED_HOSTS ?? "").split(",")) {
    if (host.trim()) {
      allowEgressHost(host);
    }
  }

  activateWukongProviders();

  installEgressGuard({
    onBlocked: (error) => {
      process.stderr.write(`[wukong] ${error.message}\n`);
    },
  });
}
