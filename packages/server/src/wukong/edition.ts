// Wukong edition entry. daemon-worker calls this first, before it loads config or opens a
// socket. Everything Wukong-specific that has to run at
// daemon start lives here, which keeps upstream files to a one-line import.

import { activateWukongPolicy, isWukongActive } from "./policy.js";
import { devinUsageHosts } from "./devin-hosts.js";
import { allowEgressHost, installEgressGuard } from "./egress-guard.js";

export function applyWukongEdition(): void {
  if (isWukongActive()) {
    return;
  }
  // The relay is a cloud service. A launch-time override also locks it against config edits.
  process.env.PASEO_RELAY_ENABLED = "false";

  // Wukong has no desktop app: the daemon serves the web UI unless the launch says otherwise.
  process.env.PASEO_WEB_UI_ENABLED ??= "true";

  // No dictation or voice mode, so no speech models: nothing to download at startup.
  process.env.PASEO_DICTATION_ENABLED = "false";
  process.env.PASEO_VOICE_MODE_ENABLED = "false";

  for (const host of (process.env.WUKONG_ALLOWED_HOSTS ?? "").split(",")) {
    if (host.trim()) {
      allowEgressHost(host);
    }
  }

  // The Devin usage plugin runs inside this guard and must reach Devin's own servers.
  for (const host of devinUsageHosts()) {
    allowEgressHost(host);
  }

  activateWukongPolicy();

  installEgressGuard({
    onBlocked: (error) => {
      process.stderr.write(`[wukong] ${error.message}\n`);
    },
  });
}

// daemon-worker imports this module first so the policy is in force before upstream modules
// (the forge registry builds itself at import time) are evaluated.
applyWukongEdition();
