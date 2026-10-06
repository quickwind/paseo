import { describe, expect, it } from "vitest";

import {
  GitLabForgeConfigSchema,
  matchesGitLabForgeHost,
  parseGitLabProjectPath,
  resolveGitLabCloneTarget,
  resolveGitLabForgeHosts,
} from "./gitlab-forge-config.js";

const CONFIG = GitLabForgeConfigSchema.parse({
  url: "https://git.corp.example",
  sshHost: "ssh.corp.example:2222",
});

describe("GitLabForgeConfigSchema", () => {
  it("accepts a minimal config and a full one", () => {
    expect(GitLabForgeConfigSchema.parse({ url: "https://git.corp.example" })).toEqual({
      url: "https://git.corp.example",
    });
    expect(
      GitLabForgeConfigSchema.parse({
        url: "https://git.corp.example/gitlab",
        sshHost: "git.corp.example",
        configSection: "corp",
        command: ["/opt/bin/gitlab", "--debug"],
      }),
    ).toMatchObject({ configSection: "corp", command: ["/opt/bin/gitlab", "--debug"] });
  });

  it.each([
    [{}, /url/i],
    [{ url: "http://git.corp.example" }, /must use https/],
    [{ url: "git.corp.example" }, /https URL/],
    [{ url: "https://user:secret@git.corp.example" }, /credentials/],
    [{ url: "https://git.corp.example/?a=1" }, /query string/],
    [{ url: "https://git.corp.example", sshHost: "git@git.corp.example" }, /sshHost/],
    [{ url: "https://git.corp.example", sshHost: "git.corp.example:70000" }, /sshHost/],
    [{ url: "https://git.corp.example", configSection: "--help" }, /configSection/],
    [{ url: "https://git.corp.example", command: [] }, /executable/],
    [{ url: "https://git.corp.example", token: "x" }, /token|unrecognized/i],
  ])("rejects %j", (input, message) => {
    const result = GitLabForgeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(message);
  });
});

describe("GitLab host helpers", () => {
  it("derives web and ssh hosts, defaulting ssh to the web host", () => {
    expect(resolveGitLabForgeHosts(CONFIG)).toEqual({
      webHost: "git.corp.example",
      webPathPrefix: "",
      sshHost: "ssh.corp.example",
      sshPort: "2222",
    });
    expect(
      resolveGitLabForgeHosts(
        GitLabForgeConfigSchema.parse({ url: "https://Git.Corp.example/gl/" }),
      ),
    ).toEqual({ webHost: "git.corp.example", webPathPrefix: "gl", sshHost: "git.corp.example" });
  });

  it("matches only the configured hosts", () => {
    expect(matchesGitLabForgeHost(CONFIG, "git.corp.example")).toBe(true);
    expect(matchesGitLabForgeHost(CONFIG, "ssh.corp.example")).toBe(true);
    expect(matchesGitLabForgeHost(CONFIG, "gitlab.com")).toBe(false);
  });
});

describe("parseGitLabProjectPath", () => {
  it.each([
    ["git@git.corp.example:group/sub/project.git", "group/sub/project"],
    ["ssh://git@ssh.corp.example:2222/group/sub/project.git", "group/sub/project"],
    ["ssh://git@git.corp.example/group/project", "group/project"],
    ["https://git.corp.example/group/sub/deep/project.git", "group/sub/deep/project"],
    ["https://oauth2:tok@git.corp.example/group/project.git/", "group/project"],
  ])("resolves %s", (remote, expected) => {
    expect(parseGitLabProjectPath(CONFIG, remote)).toBe(expected);
  });

  it("returns null for foreign hosts and unparsable remotes", () => {
    expect(parseGitLabProjectPath(CONFIG, "git@github.com:owner/repo.git")).toBeNull();
    expect(parseGitLabProjectPath(CONFIG, "not a remote")).toBeNull();
  });

  it("strips the web path prefix of a GitLab served under a sub-path", () => {
    const prefixed = GitLabForgeConfigSchema.parse({ url: "https://git.corp.example/gitlab" });
    expect(
      parseGitLabProjectPath(prefixed, "https://git.corp.example/gitlab/group/project.git"),
    ).toBe("group/project");
    expect(parseGitLabProjectPath(prefixed, "git@git.corp.example:group/project.git")).toBe(
      "group/project",
    );
    expect(
      parseGitLabProjectPath(prefixed, "https://git.corp.example/other/project.git"),
    ).toBeNull();
  });
});

describe("resolveGitLabCloneTarget", () => {
  const https = GitLabForgeConfigSchema.parse({ url: "https://git.corp.example" });

  it("builds an https clone URL from shorthand when no ssh host is configured", () => {
    expect(resolveGitLabCloneTarget(https, { repo: "payments/core/billing" })).toEqual({
      name: "billing",
      displayName: "payments/core/billing",
      cloneUrl: "https://git.corp.example/payments/core/billing.git",
    });
  });

  it("prefers ssh when an ssh host is configured, with the port form when it has a port", () => {
    const withPort = GitLabForgeConfigSchema.parse({
      url: "https://git.corp.example",
      sshHost: "ssh.corp.example:2222",
    });
    const withoutPort = GitLabForgeConfigSchema.parse({
      url: "https://git.corp.example",
      sshHost: "ssh.corp.example",
    });
    expect(resolveGitLabCloneTarget(withPort, { repo: "a/b" }).cloneUrl).toBe(
      "ssh://git@ssh.corp.example:2222/a/b.git",
    );
    expect(resolveGitLabCloneTarget(withoutPort, { repo: "a/b.git" }).cloneUrl).toBe(
      "git@ssh.corp.example:a/b.git",
    );
    expect(
      resolveGitLabCloneTarget(withPort, { repo: "a/b", cloneProtocol: "https" }).cloneUrl,
    ).toBe("https://git.corp.example/a/b.git");
  });

  it("keeps a full remote URL on the configured host as given", () => {
    const config = GitLabForgeConfigSchema.parse({
      url: "https://git.corp.example",
      sshHost: "ssh.corp.example:2222",
    });
    for (const repo of [
      "https://git.corp.example/a/sub/b.git",
      "git@ssh.corp.example:a/sub/b.git",
      "ssh://git@ssh.corp.example:2222/a/sub/b.git",
    ]) {
      expect(resolveGitLabCloneTarget(config, { repo })).toEqual({
        name: "b",
        displayName: "a/sub/b",
        cloneUrl: repo,
      });
    }
  });

  it.each([
    ["https://github.com/owner/repo.git", /Only repositories on git\.corp\.example/],
    ["git@gitlab.com:group/project.git", /Only repositories on/],
    ["http://git.corp.example/a/b.git", /plain http/],
    ["onlyone", /group\/project format/],
    ["a/../b", /group\/project format/],
    ["a/-b", /group\/project format/],
    ["a/b c", /group\/project format/],
    ["", /required/],
  ])("rejects %s", (repo, message) => {
    expect(() => resolveGitLabCloneTarget(https, { repo })).toThrow(message);
  });
});
