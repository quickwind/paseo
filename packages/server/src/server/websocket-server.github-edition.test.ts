import { describe, expect, it } from "vitest";

import { createDisabledGitHubService } from "../services/github-service-disabled.js";
import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

// Internal edition: the app offers GitHub clone and repository search only when
// the daemon advertises them, so a disabled GitHub service must advertise neither.
function featuresFor(github: unknown): Record<string, unknown> {
  const server = Object.create(VoiceAssistantWebSocketServer.prototype) as Record<string, unknown>;
  Object.assign(server, {
    serverId: "srv",
    daemonVersion: "0.0.0",
    github,
    workspaceGitService: {},
  });
  const build = server.buildServerInfoStatusPayload as (session: unknown) => {
    features: Record<string, unknown>;
  };
  return build.call(server, { getPermissions: () => [] }).features;
}

describe("server_info GitHub features", () => {
  it("reports projectGithubClone and workspaceGithubRepositorySearch as false when GitHub is disabled", () => {
    const features = featuresFor(createDisabledGitHubService());

    expect(features.projectGithubClone).toBe(false);
    expect(features.workspaceGithubRepositorySearch).toBe(false);
  });

  it("still advertises them for a real GitHub service", () => {
    const features = featuresFor({ invalidate: () => {} });

    expect(features.projectGithubClone).toBe(true);
    expect(features.workspaceGithubRepositorySearch).toBe(true);
  });
});
