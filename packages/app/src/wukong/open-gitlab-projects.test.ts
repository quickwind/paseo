import { describe, expect, it } from "vitest";

import { buildGitLabProjectsRoute } from "./open-gitlab-projects";

describe("buildGitLabProjectsRoute", () => {
  it("points at the bundled plugin's GitLab screen on the given host", () => {
    expect(buildGitLabProjectsRoute("srv-1")).toBe(
      "/h/srv-1/plugin/wukong-gitlab/surface/add-from-gitlab",
    );
  });
});
