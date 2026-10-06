import { describe, expect, it } from "vitest";

import type { ForgeCliRunner, ForgeCliRunnerResult } from "./forge-cli-command.js";
import type { PullRequestCommandStatus } from "./forge-service.js";
import { GITLAB_ACTIVE_PIPELINE_STATUS_SET } from "@getpaseo/protocol/gitlab-pipeline";
import type { GitLabStatusFacts } from "./gitlab-facts.js";
import {
  GitLabAuthenticationError,
  GitLabCliMissingError,
  GitLabCommandError,
} from "./gitlab-python-client.js";
import { type CreateGitLabServiceOptions, createGitLabService } from "./gitlab-service.js";

// The fake CLI is keyed by argv. Every call starts with the global python-gitlab
// options below; responders and recorded calls see only what follows them.
const CONFIG = { url: "https://gitlab.example.com" } as const;
const GLOBAL_ARGS = ["--output=json", "--skip-login", "--server-url=https://gitlab.example.com"];
const PROJECT = "example-group/example-project";
const PROJECT_FLAG = `--project-id=${PROJECT}`;

type Responder = (args: string[]) => ForgeCliRunnerResult | Promise<ForgeCliRunnerResult>;

function ok(stdout: string): ForgeCliRunnerResult {
  return { stdout, stderr: "" };
}

function json(value: unknown): ForgeCliRunnerResult {
  return ok(JSON.stringify(value));
}

function command(args: string[]): string {
  return `${args[0]} ${args[1]}`;
}

/** Answers by `<resource> <action>`; anything unlisted fails the test loudly. */
function byCommand(table: Record<string, (args: string[]) => ForgeCliRunnerResult>): Responder {
  return (args) => {
    const handler = table[command(args)];
    if (!handler) {
      throw new Error(`unexpected call: ${args.join(" ")}`);
    }
    return handler(args);
  };
}

function makeService(responder: Responder, overrides: Partial<CreateGitLabServiceOptions> = {}) {
  const calls: string[][] = [];
  const runner: ForgeCliRunner = async (args) => {
    expect(args.slice(0, GLOBAL_ARGS.length)).toEqual(GLOBAL_ARGS);
    const rest = args.slice(GLOBAL_ARGS.length);
    calls.push(rest);
    return responder(rest);
  };
  const service = createGitLabService({
    config: CONFIG,
    runner,
    resolveExecutable: async () => "/usr/bin/gitlab",
    resolveRemoteUrl: async () => "git@gitlab.example.com:example-group/example-project.git",
    ...overrides,
  });
  return { service, calls };
}

function currentMrListArgs(headRef: string): string[] {
  return [
    "project-merge-request",
    "list",
    PROJECT_FLAG,
    "--order-by=updated_at",
    "--sort=desc",
    "--per-page=100",
    "--no-get-all",
    `--source-branch=${headRef}`,
  ];
}

function mrGetArgs(iid: number): string[] {
  return ["project-merge-request", "get", PROJECT_FLAG, `--iid=${iid}`];
}

function gitlabAutoMergeStatus(
  overrides: Partial<GitLabStatusFacts> = {},
): PullRequestCommandStatus {
  return {
    forgeSpecific: {
      forge: "gitlab",
      detailedMergeStatus: "ci_still_running",
      hasConflicts: false,
      blockingDiscussionsResolved: true,
      approvalsRequired: 0,
      approvalsGiven: 0,
      pipelineStatus: "running",
      pipelineId: 306,
      pipelineUrl: null,
      mergeWhenPipelineSucceeds: false,
      ...overrides,
    },
  };
}

function mergeableStatus(): PullRequestCommandStatus {
  return {
    forgeSpecific: {
      forge: "gitlab",
      detailedMergeStatus: "mergeable",
      hasConflicts: false,
      blockingDiscussionsResolved: true,
      approvalsRequired: 0,
      approvalsGiven: 0,
      pipelineStatus: "success",
      pipelineId: null,
      pipelineUrl: null,
      mergeWhenPipelineSucceeds: false,
    },
  };
}

const OPEN_MR = {
  iid: 14,
  title: "chore(release): 0.4.0",
  web_url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/14",
  state: "opened",
  source_branch: "release/v0.4.0",
  target_branch: "main",
  sha: "1111111111111111111111111111111111111111",
  source_project_id: 101,
  target_project_id: 101,
  draft: false,
  work_in_progress: false,
  has_conflicts: false,
  merged_at: null,
  detailed_merge_status: "mergeable",
  description: "Release notes",
  labels: ["release"],
  updated_at: "2026-06-25T19:00:00.000Z",
  references: { full: "example-group/example-project!14", short: "!14" },
  head_pipeline: { status: "success" },
};

function mergeRequestWithPipeline(status = "success") {
  return {
    ...OPEN_MR,
    head_pipeline: {
      id: 306,
      status,
      web_url: "https://gitlab.example.com/example-group/example-project/-/pipelines/306",
    },
  };
}

const OPEN_ISSUE = {
  iid: 7,
  title: "Login button misaligned",
  web_url: "https://gitlab.example.com/example-group/example-project/-/issues/7",
  state: "opened",
  description: "On mobile the login button overflows",
  labels: ["bug"],
  updated_at: "2026-06-24T08:00:00.000Z",
};

// Verbatim issue item from the REST issues endpoint (GitLab.com). The list
// endpoint returns far more than the neutral mapping needs, and `web_url` points
// at `/-/work_items/<iid>`, not `/-/issues/<iid>`.
const REAL_GITLAB_ISSUE = {
  id: 193324690,
  iid: 1,
  external_id: "",
  state: "opened",
  description: "Simple test",
  health_status: "",
  author: {
    id: 13341367,
    state: "active",
    web_url: "https://gitlab.com/example-user",
    name: "example-user",
    username: "example-user",
  },
  milestone: null,
  project_id: 83778606,
  assignees: [],
  updated_at: "2026-06-26T09:11:19.642Z",
  closed_at: null,
  title: "Test",
  created_at: "2026-06-26T09:11:19.642Z",
  labels: [],
  web_url: "https://gitlab.com/example-user/sample-repo/-/work_items/1",
  references: { short: "#1", relative: "#1", full: "example-user/sample-repo#1" },
  confidential: false,
  issue_type: "issue",
  user_notes_count: 0,
};

const NESTED_GROUP_MR = {
  ...OPEN_MR,
  iid: 73,
  web_url: "https://gitlab.example.com/example-group/nested/example-project/-/merge_requests/73",
  references: { full: "example-group/nested/example-project!73", short: "!73" },
};

const PIPELINE_WITH_JOBS = {
  id: 306,
  status: "failed",
  ref: "feat/sample-change",
  sha: "85e734528c160941f997703c63563d2587736a3e",
  web_url: "https://gitlab.example.com/example-group/example-project/-/pipelines/306",
  jobs: [
    {
      id: 929,
      name: "lint",
      stage: "test",
      status: "success",
      allow_failure: false,
      web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/929",
      duration: 12.3,
    },
    {
      id: 931,
      name: "unit",
      stage: "test",
      status: "failed",
      allow_failure: false,
      web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/931",
      duration: 38.2,
    },
    {
      id: 932,
      name: "flaky",
      stage: "test",
      status: "failed",
      allow_failure: true,
      web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/932",
      duration: 5,
    },
    {
      id: 933,
      name: "deploy-prod",
      stage: "deploy",
      status: "skipped",
      allow_failure: false,
      web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/933",
      duration: null,
    },
  ],
};

const APPROVALS = {
  approvals_required: 2,
  approvals_left: 1,
  approved_by: [{ user: { username: "reviewer-a" } }],
};

// Mirrors `GET /projects/:id/merge_requests/:iid/discussions` (GitLab 16+).
const DISCUSSIONS = [
  {
    id: "sys-1",
    individual_note: true,
    notes: [
      {
        id: 399,
        type: null,
        system: true,
        body: "enabled an automatic merge",
        created_at: "2026-06-25T19:24:04.180Z",
        author: { username: "claude", name: "Claude", web_url: "https://gl/claude" },
      },
    ],
  },
  {
    id: "note-1",
    individual_note: true,
    notes: [
      {
        id: 401,
        type: null,
        system: false,
        body: "Looks good to me",
        created_at: "2026-06-25T20:00:00.000Z",
        author: {
          username: "reviewer-a",
          name: "Reviewer A",
          web_url: "https://gl/reviewer-a",
          avatar_url: "https://gl/avatar-a.png",
        },
      },
    ],
  },
  {
    id: "thread-1",
    individual_note: false,
    notes: [
      {
        id: 402,
        type: "DiffNote",
        system: false,
        body: "This line needs a guard",
        created_at: "2026-06-25T19:55:00.000Z",
        resolvable: true,
        resolved: false,
        author: { username: "reviewer-b", web_url: "https://gl/reviewer-b" },
        position: { new_path: "src/app.ts", old_path: "src/app.ts", new_line: 42, old_line: null },
      },
    ],
  },
];

function pipelineSummary(pipeline: typeof PIPELINE_WITH_JOBS) {
  const { jobs: _jobs, ...summary } = pipeline;
  return { ...summary, project_id: 101 };
}

/** The two calls behind a pipeline read: the MR's pipelines, then that pipeline's jobs. */
function pipelineResponders(pipeline: { jobs: unknown[] } & typeof PIPELINE_WITH_JOBS) {
  return {
    "project-merge-request-pipeline list": () => json([pipelineSummary(pipeline)]),
    "project-pipeline get": () => json(pipelineSummary(pipeline)),
    "project-pipeline-job list": () => json(pipeline.jobs),
  };
}

function discussionsOnly(discussions: unknown[], mr: unknown = NESTED_GROUP_MR): Responder {
  return byCommand({
    "project-merge-request get": () => json(mr),
    "project-merge-request-discussion list": () => json(discussions),
  });
}

function throwCli(stderr: string): never {
  throw { code: 1, stderr };
}

describe("createGitLabService", () => {
  it("maps a merge request read to the neutral current PR status", async () => {
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([OPEN_MR]),
        "project-merge-request get": () => json(OPEN_MR),
        "project-merge-request-approval get": () => json({}),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status).toMatchObject({
      number: 14,
      url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/14",
      title: "chore(release): 0.4.0",
      state: "open",
      baseRefName: "main",
      headRefName: "release/v0.4.0",
      isMerged: false,
      isDraft: false,
      mergeable: "MERGEABLE",
      checksStatus: "success",
      reviewDecision: null,
      repoOwner: "example-group",
      repoName: "example-project",
      projectPath: "example-group/example-project",
    });
    expect(status?.forgeSpecific).toMatchObject({
      forge: "gitlab",
      detailedMergeStatus: "mergeable",
      hasConflicts: false,
      pipelineStatus: "success",
      mergeWhenPipelineSucceeds: false,
    });
    expect(calls[0]).toEqual(currentMrListArgs("release/v0.4.0"));
    expect(calls[1]).toEqual(mrGetArgs(14));
  });

  it("reports a conflicting merge request as CONFLICTING", async () => {
    const conflicting = {
      ...OPEN_MR,
      source_branch: "x",
      has_conflicts: true,
      detailed_merge_status: "broken_status",
    };
    const { service } = makeService(
      byCommand({
        "project-merge-request list": () => json([conflicting]),
        "project-merge-request get": () => json(conflicting),
        "project-merge-request-approval get": () => json({}),
      }),
    );
    const status = await service.getCurrentPullRequestStatus({ cwd: "/repo", headRef: "x" });
    expect(status?.mergeable).toBe("CONFLICTING");
  });

  it("prefers auto_merge_enabled over the deprecated merge_when_pipeline_succeeds", async () => {
    const mr = {
      ...OPEN_MR,
      merge_when_pipeline_succeeds: false,
      auto_merge_enabled: true,
      auto_merge_strategy: "merge_when_checks_pass",
    };
    const { service } = makeService(
      byCommand({
        "project-merge-request list": () => json([mr]),
        "project-merge-request get": () => json(mr),
        "project-merge-request-approval get": () => json({}),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status?.forgeSpecific).toMatchObject({ mergeWhenPipelineSucceeds: true });
  });

  it("uses detailed_merge_status and ignores the deprecated merge_status when both are present", async () => {
    const mr = {
      ...OPEN_MR,
      detailed_merge_status: "ci_still_running",
      merge_status: "can_be_merged",
    };
    const { service } = makeService(
      byCommand({
        "project-merge-request list": () => json([mr]),
        "project-merge-request get": () => json(mr),
        "project-merge-request-approval get": () => json({}),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status?.mergeable).toBe("UNKNOWN");
  });

  it("returns null when no merge request exists for the branch", async () => {
    const { service } = makeService(() => ok("[]"));
    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "feature/x",
    });
    expect(status).toBeNull();
  });

  it("selects a terminal merge request only when its head SHA matches the checkout", async () => {
    const branch = "dev";
    const checkoutSha = "2222222222222222222222222222222222222222";
    const newestStale = {
      ...OPEN_MR,
      iid: 271,
      state: "merged",
      source_branch: branch,
      sha: "1111111111111111111111111111111111111111",
      updated_at: "2026-07-17T12:00:00.000Z",
    };
    const exactOlder = {
      ...OPEN_MR,
      iid: 270,
      state: "merged",
      source_branch: branch,
      sha: checkoutSha,
      updated_at: "2026-07-16T12:00:00.000Z",
    };
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([newestStale, exactOlder]),
        "project-merge-request get": (args) => {
          expect(args).toEqual(mrGetArgs(270));
          return json(exactOlder);
        },
        "project-merge-request-approval get": () => json({}),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: branch,
      headSha: checkoutSha,
    });

    expect(status?.number).toBe(270);
    expect(calls[1]).toEqual(mrGetArgs(270));
  });

  it("does not attach the latest historical merge request after a reused branch advances", async () => {
    const stale = {
      ...OPEN_MR,
      state: "merged",
      source_branch: "dev",
      sha: "1111111111111111111111111111111111111111",
    };
    const { service, calls } = makeService(() => json([stale]));

    await expect(
      service.getCurrentPullRequestStatus({
        cwd: "/repo",
        headRef: "dev",
        headSha: "2222222222222222222222222222222222222222",
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([currentMrListArgs("dev")]);
  });

  it("looks up a numeric current branch through the source-branch list filter", async () => {
    const numericBranchMr = {
      ...OPEN_MR,
      iid: 21,
      source_branch: "1234",
      title: "Fix numeric branch",
      web_url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/21",
      references: { full: "example-group/example-project!21", short: "!21" },
    };
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([numericBranchMr]),
        "project-merge-request get": (args) => {
          expect(args).toEqual(mrGetArgs(21));
          return json(numericBranchMr);
        },
        "project-merge-request-approval get": () => json({}),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "1234",
      headSha: "2222222222222222222222222222222222222222",
    });

    expect(status).toMatchObject({
      number: 21,
      title: "Fix numeric branch",
      headRefName: "1234",
    });
    expect(calls[0]).toEqual(currentMrListArgs("1234"));
    expect(calls[1]).toEqual(mrGetArgs(21));
    expect(calls).not.toContainEqual(mrGetArgs(1234));
  });

  it("returns null when a numeric current branch has no open merge request", async () => {
    const { service, calls } = makeService(
      byCommand({ "project-merge-request list": () => ok("[]") }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "1234",
    });

    expect(status).toBeNull();
    expect(calls).toEqual([currentMrListArgs("1234")]);
  });

  it("passes branch names and queries that look like flags or file references through safely", async () => {
    const { service, calls } = makeService(() => ok("[]"));

    await service.getCurrentPullRequestStatus({ cwd: "/repo", headRef: "@/etc/passwd" });
    await service.listPullRequests({ cwd: "/repo", query: "--help" });
    await service.listPullRequests({ cwd: "/repo", query: "@@x" });

    // python-gitlab reads a value starting with `@` from that file; a doubled `@` escapes it.
    expect(calls[0]).toContain("--source-branch=@@/etc/passwd");
    expect(calls[1]).toContain("--search=--help");
    expect(calls[2]).toContain("--search=@@@x");
  });

  it("lists merge requests as neutral PR summaries", async () => {
    const { service, calls } = makeService(() => json([OPEN_MR]));
    const list = await service.listPullRequests({ cwd: "/repo", limit: 5 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 14, title: "chore(release): 0.4.0", state: "open" });
    expect(calls[0]).toEqual([
      "project-merge-request",
      "list",
      PROJECT_FLAG,
      "--order-by=updated_at",
      "--sort=desc",
      "--per-page=5",
      "--no-get-all",
      "--state=opened",
    ]);
  });

  it("resolves the python-gitlab executable once per service instance, not per invocation", async () => {
    let resolveCalls = 0;
    const { service } = makeService(() => json([OPEN_MR]), {
      resolveExecutable: async () => {
        resolveCalls += 1;
        return "/usr/bin/gitlab";
      },
    });

    await service.listPullRequests({ cwd: "/repo", limit: 5 });
    await service.listPullRequests({ cwd: "/repo", limit: 5 });

    expect(resolveCalls).toBe(1);
  });

  it("resolves nested-group projects from ssh:// remotes with a port", async () => {
    const { service, calls } = makeService(() => json([OPEN_MR]), {
      resolveRemoteUrl: async () =>
        "ssh://git@gitlab.example.com:2222/example-group/nested/example-project.git",
    });

    await service.listPullRequests({ cwd: "/repo" });

    expect(calls[0]).toContain("--project-id=example-group/nested/example-project");
  });

  it("resolves the project from an https remote", async () => {
    const { service, calls } = makeService(() => json([OPEN_MR]), {
      resolveRemoteUrl: async () => "https://gitlab.example.com/example-group/example-project.git",
    });

    await service.listPullRequests({ cwd: "/repo" });

    expect(calls[0]).toContain(PROJECT_FLAG);
  });

  it("refuses to call GitLab for a remote on another host", async () => {
    const { service, calls } = makeService(() => json([OPEN_MR]), {
      resolveRemoteUrl: async () => "git@github.com:owner/repo.git",
    });

    await expect(service.listPullRequests({ cwd: "/repo" })).rejects.toBeInstanceOf(
      GitLabCommandError,
    );
    expect(calls).toHaveLength(0);
  });

  it("passes the configured section, url and command prefix to the CLI", async () => {
    const seen: string[][] = [];
    const service = createGitLabService({
      config: {
        url: "https://git.corp.example/",
        configSection: "corp",
        command: ["uvx", "--from", "python-gitlab", "gitlab"],
      },
      runner: async (args) => {
        seen.push(args);
        return ok("[]");
      },
      resolveExecutable: async () => "/usr/bin/uvx",
      resolveRemoteUrl: async () => "git@git.corp.example:group/project.git",
    });

    await service.listPullRequests({ cwd: "/repo" });

    expect(seen[0]?.slice(0, 8)).toEqual([
      "--from",
      "python-gitlab",
      "gitlab",
      "--output=json",
      "--skip-login",
      "--server-url=https://git.corp.example/",
      "--gitlab=corp",
      "project-merge-request",
    ]);
  });

  it("maps a same-repo merge request read to a checkout target", async () => {
    const { service, calls } = makeService(() => json(OPEN_MR));

    await expect(
      service.getPullRequestCheckoutTarget?.({ cwd: "/repo", number: 14 }),
    ).resolves.toEqual({
      number: 14,
      baseRefName: "main",
      headRefName: "release/v0.4.0",
      checkoutRefs: [
        { remoteName: "origin", remoteRef: "refs/merge-requests/14/head" },
        { remoteName: "origin", remoteRef: "refs/heads/release/v0.4.0" },
      ],
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      headRepositoryUrl: null,
      isCrossRepository: false,
    });
    expect(calls[0]).toEqual(mrGetArgs(14));
  });

  it("marks fork merge request checkout targets as cross-repository", async () => {
    const { service } = makeService(() =>
      json({
        ...OPEN_MR,
        source_project_id: 202,
        target_project_id: 101,
      }),
    );

    await expect(
      service.getPullRequestCheckoutTarget?.({ cwd: "/repo", number: 14 }),
    ).resolves.toMatchObject({
      number: 14,
      headRefName: "release/v0.4.0",
      isCrossRepository: true,
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      headRepositoryUrl: null,
    });
  });

  it("creates a merge request and reads the URL and iid from the created object", async () => {
    const { service, calls } = makeService(() =>
      json({
        ...OPEN_MR,
        iid: 15,
        web_url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/15",
      }),
    );
    const result = await service.createPullRequest({
      cwd: "/repo",
      repo: "example-group/example-project",
      title: "@looks-like-a-file",
      head: "release/v0.4.0",
      base: "main",
      body: "",
    });
    expect(result).toEqual({
      url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/15",
      number: 15,
    });
    expect(calls[0]).toEqual([
      "project-merge-request",
      "create",
      PROJECT_FLAG,
      "--source-branch=release/v0.4.0",
      "--target-branch=main",
      "--title=@@looks-like-a-file",
      "--description=",
    ]);
  });

  it("merges with a merge commit without touching the squash setting", async () => {
    const { service, calls } = makeService(() => json({ ...OPEN_MR, state: "merged" }));
    const result = await service.mergePullRequest({
      cwd: "/repo",
      prNumber: 14,
      mergeMethod: "merge",
      status: mergeableStatus(),
    });
    expect(result).toEqual({ success: true });
    // Omitting merge_when_pipeline_succeeds makes GitLab merge now.
    expect(calls).toEqual([["project-merge-request", "merge", PROJECT_FLAG, "--iid=14"]]);
  });

  it("squashes by updating the merge request before merging when GitLab reports it mergeable", async () => {
    const { service, calls } = makeService(() => json({ ...OPEN_MR, squash: true }));
    const result = await service.mergePullRequest({
      cwd: "/repo",
      prNumber: 14,
      mergeMethod: "squash",
      status: mergeableStatus(),
    });
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      ["project-merge-request", "update", PROJECT_FLAG, "--iid=14", "--squash=true"],
      ["project-merge-request", "merge", PROJECT_FLAG, "--iid=14"],
    ]);
  });

  it("does not merge when the squash update fails", async () => {
    const { service, calls } = makeService((args) => {
      if (command(args) === "project-merge-request update") {
        throwCli("Impossible to update object (403: 403 Forbidden)");
      }
      return json({});
    });

    await expect(
      service.mergePullRequest({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "squash",
        status: mergeableStatus(),
      }),
    ).rejects.toBeInstanceOf(GitLabAuthenticationError);
    expect(calls).toHaveLength(1);
  });

  it("rejects the rebase merge method for GitLab before making any call", async () => {
    const { service, calls } = makeService(() => json({}));
    await expect(
      service.mergePullRequest({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "rebase",
        status: mergeableStatus(),
      }),
    ).rejects.toThrow(/Rebase merge is not supported for GitLab/);
    await expect(
      service.enablePullRequestAutoMerge({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "rebase",
        status: gitlabAutoMergeStatus(),
      }),
    ).rejects.toThrow(/Rebase merge is not supported for GitLab/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a direct merge when GitLab does not report the MR as mergeable", async () => {
    const { service, calls } = makeService(() => ok(""));
    await expect(
      service.mergePullRequest({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "merge",
        status: gitlabAutoMergeStatus(),
      }),
    ).rejects.toThrow(/ready for direct merge/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a failed merge as a command error carrying GitLab's reason", async () => {
    const { service } = makeService(() =>
      throwCli("gitlab.exceptions.GitlabMRClosedError: 405: 405 Method Not Allowed"),
    );
    await expect(
      service.mergePullRequest({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "merge",
        status: mergeableStatus(),
      }),
    ).rejects.toMatchObject({
      name: "GitLabCommandError",
      stderr: expect.stringContaining("405 Method Not Allowed"),
    });
  });

  it("enables auto-merge by scheduling merge when the pipeline succeeds", async () => {
    const { service, calls } = makeService(() =>
      json({ ...OPEN_MR, merge_when_pipeline_succeeds: true }),
    );
    const result = await service.enablePullRequestAutoMerge({
      cwd: "/repo",
      prNumber: 14,
      mergeMethod: "squash",
      status: gitlabAutoMergeStatus(),
    });
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      ["project-merge-request", "update", PROJECT_FLAG, "--iid=14", "--squash=true"],
      [
        "project-merge-request",
        "merge",
        PROJECT_FLAG,
        "--iid=14",
        "--merge-when-pipeline-succeeds=true",
      ],
    ]);
  });

  it("enables auto-merge without a squash update for the plain merge method", async () => {
    const { service, calls } = makeService(() => json({}));
    await service.enablePullRequestAutoMerge({
      cwd: "/repo",
      prNumber: 14,
      mergeMethod: "merge",
      status: gitlabAutoMergeStatus(),
    });
    expect(calls).toEqual([
      [
        "project-merge-request",
        "merge",
        PROJECT_FLAG,
        "--iid=14",
        "--merge-when-pipeline-succeeds=true",
      ],
    ]);
  });

  it("refuses to enable auto-merge without an active pipeline because it would merge immediately", async () => {
    const { service, calls } = makeService(() => ok(""));
    await expect(
      service.enablePullRequestAutoMerge({
        cwd: "/repo",
        prNumber: 14,
        mergeMethod: "squash",
        status: gitlabAutoMergeStatus({ pipelineStatus: "success" }),
      }),
    ).rejects.toThrow(/in-progress pipeline/);
    expect(calls).toHaveLength(0);
  });

  it("disables auto-merge with the dedicated cancel action", async () => {
    const { service, calls } = makeService(() => json({ status: "success" }));
    const result = await service.disablePullRequestAutoMerge({
      cwd: "/repo",
      prNumber: 14,
    });
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      ["project-merge-request", "cancel-merge-when-pipeline-succeeds", PROJECT_FLAG, "--iid=14"],
    ]);
  });

  it("surfaces the head pipeline id and url on the gitlab status facts", async () => {
    const pipelineMr = mergeRequestWithPipeline("canceling");
    const { service } = makeService(
      byCommand({
        "project-merge-request list": () => json([pipelineMr]),
        "project-merge-request get": () => json(pipelineMr),
        "project-merge-request-approval get": () => json({}),
        ...pipelineResponders(PIPELINE_WITH_JOBS),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    // checksStatus follows the pipeline whose jobs are listed (the fetched
    // one, status "failed"), while the facts keep head_pipeline's raw status.
    expect(status?.checksStatus).toBe("failure");
    expect(status?.forgeSpecific).toMatchObject({
      forge: "gitlab",
      pipelineStatus: "canceling",
      pipelineId: 306,
      pipelineUrl: "https://gitlab.example.com/example-group/example-project/-/pipelines/306",
    });
  });

  it("populates sidebar checks from the merge request's latest pipeline", async () => {
    const pipelineMr = mergeRequestWithPipeline();
    const pipeline = {
      ...PIPELINE_WITH_JOBS,
      status: "success",
      jobs: [
        PIPELINE_WITH_JOBS.jobs[0],
        PIPELINE_WITH_JOBS.jobs[2],
        {
          id: 934,
          name: "optional-deploy",
          stage: "deploy",
          status: "manual",
          allow_failure: true,
          web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/934",
        },
        {
          id: 935,
          name: "release",
          stage: "deploy",
          status: "manual",
          allow_failure: false,
          web_url: "https://gitlab.example.com/example-group/example-project/-/jobs/935",
        },
      ],
    };
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([pipelineMr]),
        "project-merge-request get": () => json(pipelineMr),
        "project-merge-request-approval get": () => json({}),
        ...pipelineResponders(pipeline),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(calls).toContainEqual([
      "project-merge-request-pipeline",
      "list",
      PROJECT_FLAG,
      "--mr-iid=14",
      "--per-page=20",
      "--no-get-all",
    ]);
    // Jobs are read from the project the pipeline reports (a fork's own project).
    expect(calls).toContainEqual([
      "project-pipeline-job",
      "list",
      "--project-id=101",
      "--pipeline-id=306",
      "--per-page=100",
      "--get-all",
    ]);
    expect(status?.checksStatus).toBe("success");
    expect(status?.checks).toEqual([
      {
        name: "lint",
        status: "success",
        url: "https://gitlab.example.com/example-group/example-project/-/jobs/929",
        workflow: "test",
        checkRunId: 929,
      },
      {
        name: "flaky",
        status: "success",
        traits: ["warning"],
        url: "https://gitlab.example.com/example-group/example-project/-/jobs/932",
        workflow: "test",
        checkRunId: 932,
      },
      {
        name: "optional-deploy",
        status: "skipped",
        traits: ["manual"],
        url: "https://gitlab.example.com/example-group/example-project/-/jobs/934",
        workflow: "deploy",
        checkRunId: 934,
      },
      {
        name: "release",
        status: "pending",
        traits: ["manual", "action_required"],
        url: "https://gitlab.example.com/example-group/example-project/-/jobs/935",
        workflow: "deploy",
        checkRunId: 935,
      },
    ]);
  });

  it("uses the newest pipeline when the merge request has several", async () => {
    const pipelineMr = mergeRequestWithPipeline();
    const older = { ...pipelineSummary(PIPELINE_WITH_JOBS), id: 300, status: "failed" };
    const newer = { ...pipelineSummary(PIPELINE_WITH_JOBS), id: 310, status: "success" };
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([pipelineMr]),
        "project-merge-request get": () => json(pipelineMr),
        "project-merge-request-approval get": () => json({}),
        "project-merge-request-pipeline list": () => json([older, newer]),
        "project-pipeline-job list": () => json([]),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status?.checksStatus).toBe("success");
    expect(calls).toContainEqual(expect.arrayContaining(["--pipeline-id=310"]));
  });

  it.each([
    ["unavailable", () => throwCli("Impossible to list objects (500: 500 Internal Server Error)")],
    ["malformed", () => json({ jobs: "invalid" })],
  ] as const)(
    "keeps the merge request status when pipeline job details are %s",
    async (_, load) => {
      const pipelineMr = mergeRequestWithPipeline();
      const { service } = makeService(
        byCommand({
          "project-merge-request list": () => json([pipelineMr]),
          "project-merge-request get": () => json(pipelineMr),
          "project-merge-request-approval get": () => json({}),
          "project-merge-request-pipeline list": load,
        }),
      );

      const status = await service.getCurrentPullRequestStatus({
        cwd: "/repo",
        headRef: "release/v0.4.0",
      });

      expect(status).toMatchObject({ number: 14, checks: [], checksStatus: "success" });
    },
  );

  it("keeps cancellation transitions active", () => {
    expect(GITLAB_ACTIVE_PIPELINE_STATUS_SET.has("canceling")).toBe(true);
  });

  it("fetches a pipeline's stages and jobs as neutral check details", async () => {
    const { service, calls } = makeService(byCommand(pipelineResponders(PIPELINE_WITH_JOBS)));

    const details = await service.getCheckDetails({
      cwd: "/repo",
      checkRunId: 306,
    });

    expect(calls[0]).toEqual(["project-pipeline", "get", PROJECT_FLAG, "--id=306"]);
    expect(details).toMatchObject({
      checkRunId: 306,
      name: "Pipeline (feat/sample-change)",
      failedJobs: [],
      annotations: [],
      truncated: false,
    });
    expect(details.pipeline).toMatchObject({
      id: 306,
      status: "failed",
      rawStatus: "failed",
      ref: "feat/sample-change",
      stages: [
        {
          name: "test",
          status: "failed",
          jobs: [
            { id: 929, name: "lint" },
            {
              id: 931,
              name: "unit",
              status: "failed",
              allowFailure: false,
              durationSeconds: 38.2,
            },
            { id: 932, name: "flaky", status: "failed", allowFailure: true },
          ],
        },
        {
          name: "deploy",
          status: "skipped",
          jobs: [{ id: 933, name: "deploy-prod", durationSeconds: null }],
        },
      ],
    });
  });

  it("addresses the change request's latest pipeline by iid (fork/detached safe)", async () => {
    const { service, calls } = makeService(byCommand(pipelineResponders(PIPELINE_WITH_JOBS)));

    await service.getCheckDetails({
      cwd: "/repo",
      checkRunId: 306,
      changeRequestNumber: 14,
    });

    expect(calls[0]).toEqual([
      "project-merge-request-pipeline",
      "list",
      PROJECT_FLAG,
      "--mr-iid=14",
      "--per-page=20",
      "--no-get-all",
    ]);
    expect(calls).not.toContainEqual(["project-pipeline", "get", PROJECT_FLAG, "--id=306"]);
  });

  it("reports a merge request without pipelines when its check details are requested", async () => {
    const { service } = makeService(
      byCommand({ "project-merge-request-pipeline list": () => ok("[]") }),
    );

    await expect(
      service.getCheckDetails({ cwd: "/repo", changeRequestNumber: 14 }),
    ).rejects.toThrow(/no pipeline/);
  });

  it.each([
    ["allowed failure", "success", "failed", true, "success", "success", "failed"],
    ["optional manual", "success", "manual", true, "success", "success", "manual"],
    ["blocking manual", "manual", "manual", false, "manual", "manual", "manual"],
    ["cancellation transition", "canceling", "canceling", false, "pending", "pending", "pending"],
  ] as const)(
    "maps %s without distorting the pipeline result",
    async (
      _case,
      pipelineStatus,
      jobStatus,
      allowFailure,
      expectedPipeline,
      expectedStage,
      expectedJob,
    ) => {
      const { service } = makeService(
        byCommand(
          pipelineResponders({
            ...PIPELINE_WITH_JOBS,
            status: pipelineStatus,
            jobs: [
              {
                id: 940,
                name: "build",
                stage: "test",
                status: "success",
                allow_failure: false,
              },
              {
                id: 941,
                name: "subject",
                stage: "test",
                status: jobStatus,
                allow_failure: allowFailure,
              },
            ],
          }),
        ),
      );

      const details = await service.getCheckDetails({ cwd: "/repo", checkRunId: 306 });
      expect(details.pipeline).toMatchObject({
        status: expectedPipeline,
        rawStatus: pipelineStatus,
        stages: [{ status: expectedStage }],
      });
      expect(details.pipeline?.stages[0]?.jobs[1]).toMatchObject({
        status: expectedJob,
        rawStatus: jobStatus,
        allowFailure,
      });
    },
  );

  it("populates approval counts from the approvals endpoint", async () => {
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request list": () => json([OPEN_MR]),
        "project-merge-request get": () => json(OPEN_MR),
        "project-merge-request-approval get": () => json(APPROVALS),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status?.forgeSpecific).toMatchObject({
      forge: "gitlab",
      approvalsRequired: 2,
      approvalsGiven: 1,
    });
    expect(calls).toContainEqual([
      "project-merge-request-approval",
      "get",
      PROJECT_FLAG,
      "--mr-iid=14",
    ]);
  });

  it("falls back to zero approvals when the approvals endpoint returns an error", async () => {
    const { service } = makeService(
      byCommand({
        "project-merge-request list": () => json([OPEN_MR]),
        "project-merge-request get": () => json(OPEN_MR),
        "project-merge-request-approval get": () =>
          throwCli("Impossible to get object (500: 500 Internal Server Error)"),
      }),
    );

    const status = await service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: "release/v0.4.0",
    });

    expect(status?.number).toBe(14);
    expect(status?.forgeSpecific).toMatchObject({
      forge: "gitlab",
      approvalsRequired: 0,
      approvalsGiven: 0,
    });
  });

  it("maps MR discussions to a neutral timeline, dropping system notes", async () => {
    const { service, calls } = makeService(discussionsOnly(DISCUSSIONS));

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 73,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    expect(calls[1]).toEqual([
      "project-merge-request-discussion",
      "list",
      PROJECT_FLAG,
      "--mr-iid=73",
      "--per-page=100",
      "--no-get-all",
    ]);
    expect(timeline.error).toBeNull();
    expect(timeline.truncated).toBe(false);
    // System note 399 is dropped; the diff note (19:55) sorts before the comment (20:00).
    expect(timeline.items.map((item) => item.id)).toEqual(["402", "401"]);

    const [diffNote, comment] = timeline.items;
    expect(diffNote).toMatchObject({
      kind: "comment",
      id: "402",
      author: "reviewer-b",
      url: "https://gitlab.example.com/example-group/nested/example-project/-/merge_requests/73#note_402",
      location: { path: "src/app.ts", line: 42, threadId: "thread-1", isResolved: false },
    });
    expect(comment).toMatchObject({
      kind: "comment",
      id: "401",
      author: "reviewer-a",
      authorUrl: "https://gl/reviewer-a",
      avatarUrl: "https://gl/avatar-a.png",
      body: "Looks good to me",
    });
    expect(comment).not.toHaveProperty("location");
  });

  it("groups general (non-file) discussion replies under one top-level thread id", async () => {
    const discussions = [
      {
        id: "disc-general",
        individual_note: false,
        notes: [
          {
            id: 501,
            system: false,
            body: "Can you clarify the rollout plan?",
            created_at: "2026-06-25T20:00:00.000Z",
            author: { username: "reviewer-a" },
          },
          {
            id: 502,
            system: false,
            body: "Sure, staged behind a flag.",
            created_at: "2026-06-25T20:05:00.000Z",
            author: { username: "author-b" },
          },
        ],
      },
      {
        id: "disc-standalone",
        individual_note: true,
        notes: [
          {
            id: 503,
            system: false,
            body: "Nice work overall.",
            created_at: "2026-06-25T20:10:00.000Z",
            author: { username: "reviewer-c" },
          },
        ],
      },
    ];
    const { service } = makeService(discussionsOnly(discussions));

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 73,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    const byId = new Map(timeline.items.map((item) => [item.id, item]));
    expect(byId.get("501")).toMatchObject({ kind: "comment", threadId: "disc-general" });
    expect(byId.get("502")).toMatchObject({ kind: "comment", threadId: "disc-general" });
    expect(byId.get("501")).not.toHaveProperty("location");
    // A standalone (individual) note must not be turned into a thread.
    expect(byId.get("503")).not.toHaveProperty("threadId");
  });

  it("maps general resolvable discussion resolution to threadIsResolved", async () => {
    const discussions = [
      {
        id: "disc-unresolved",
        individual_note: false,
        notes: [
          {
            id: 511,
            system: false,
            body: "Still open question.",
            created_at: "2026-06-25T20:00:00.000Z",
            author: { username: "reviewer-a" },
            resolvable: true,
            resolved: false,
          },
        ],
      },
      {
        id: "disc-resolved",
        individual_note: false,
        notes: [
          {
            id: 512,
            system: false,
            body: "Addressed, thanks.",
            created_at: "2026-06-25T20:05:00.000Z",
            author: { username: "author-b" },
            resolvable: true,
            resolved: true,
          },
        ],
      },
      {
        id: "disc-plain",
        individual_note: true,
        notes: [
          {
            id: 513,
            system: false,
            body: "Just a plain comment.",
            created_at: "2026-06-25T20:10:00.000Z",
            author: { username: "reviewer-c" },
          },
        ],
      },
    ];
    const { service } = makeService(discussionsOnly(discussions));

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 73,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    const byId = new Map(timeline.items.map((item) => [item.id, item]));
    expect(byId.get("511")).toMatchObject({ threadIsResolved: false });
    expect(byId.get("512")).toMatchObject({ threadIsResolved: true });
    // A non-resolvable plain comment must not gain a resolution state.
    expect(byId.get("513")).not.toHaveProperty("threadIsResolved");
    // General discussions carry no file position, so no location either.
    expect(byId.get("511")).not.toHaveProperty("location");
  });

  it("maps a multiline diff range to startLine and omits resolution state for non-resolvable notes", async () => {
    const discussions = [
      {
        id: "disc-range",
        individual_note: false,
        notes: [
          {
            id: 601,
            system: false,
            body: "This block spans several lines.",
            created_at: "2026-06-25T21:00:00.000Z",
            author: { username: "reviewer-a" },
            position: {
              new_path: "src/app.ts",
              old_path: "src/app.ts",
              new_line: 48,
              old_line: null,
              line_range: {
                start: { new_line: 42, old_line: null },
                end: { new_line: 48, old_line: null },
              },
            },
          },
        ],
      },
      {
        id: "disc-plain",
        individual_note: true,
        notes: [
          {
            id: 602,
            system: false,
            body: "General comment without a resolvable flag.",
            created_at: "2026-06-25T21:05:00.000Z",
            author: { username: "reviewer-b" },
          },
        ],
      },
    ];
    const { service } = makeService(discussionsOnly(discussions));

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 73,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    const rangeNote = timeline.items.find((item) => item.id === "601");
    expect(rangeNote).toMatchObject({
      kind: "comment",
      location: { path: "src/app.ts", line: 48, startLine: 42 },
    });
    expect(rangeNote && "location" in rangeNote ? rangeNote.location : null).not.toHaveProperty(
      "isResolved",
    );

    const plainNote = timeline.items.find((item) => item.id === "602");
    expect(plainNote).not.toHaveProperty("location");
  });

  it("returns a not_found timeline error when discussions cannot be fetched", async () => {
    const { service } = makeService(
      byCommand({
        "project-merge-request get": () => json(OPEN_MR),
        "project-merge-request-discussion list": () =>
          throwCli("Impossible to list objects (404: 404 Not Found)"),
      }),
    );

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 14,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    expect(timeline.items).toEqual([]);
    expect(timeline.error).toMatchObject({ kind: "not_found" });
  });

  it.each([
    "Impossible to list objects (403: 403 Forbidden)",
    "gitlab.exceptions.GitlabAuthenticationError: 401: 401 Unauthorized",
  ])("returns a forbidden timeline error for %s", async (stderr) => {
    const { service } = makeService(
      byCommand({
        "project-merge-request get": () => json(OPEN_MR),
        "project-merge-request-discussion list": () => throwCli(stderr),
      }),
    );

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 14,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    expect(timeline).toMatchObject({
      items: [],
      truncated: false,
      error: { kind: "forbidden" },
    });
  });

  it("flags truncation when a next-page probe finds more discussions", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `discussion-${index}`,
      notes: [],
    }));
    const { service, calls } = makeService(
      byCommand({
        "project-merge-request get": () => json(OPEN_MR),
        // The next-page probe asks for page 101; reply with one more discussion.
        "project-merge-request-discussion list": (args) =>
          args.includes("--page=101") ? json([{ id: "overflow", notes: [] }]) : json(firstPage),
      }),
    );

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 14,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    expect(calls.some((call) => call.includes("--page=101") && call.includes("--per-page=1"))).toBe(
      true,
    );
    expect(timeline).toMatchObject({ items: [], truncated: true, error: null });
  });

  it("does not flag truncation when exactly one full page of discussions exists", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `discussion-${index}`,
      notes: [],
    }));
    const { service } = makeService(
      byCommand({
        "project-merge-request get": () => json(OPEN_MR),
        // The probe of page 101 comes back empty: there is no 101st discussion.
        "project-merge-request-discussion list": (args) =>
          args.includes("--page=101") ? json([]) : json(firstPage),
      }),
    );

    const timeline = await service.getPullRequestTimeline({
      cwd: "/repo",
      prNumber: 14,
      repoOwner: "example-group",
      repoName: "example-project",
    });

    expect(timeline).toMatchObject({ truncated: false, error: null });
  });

  it("reports authentication when the current-user call succeeds", async () => {
    const { service, calls } = makeService(
      byCommand({ "current-user get": () => json({ id: 1, username: "dev" }) }),
    );
    await expect(service.isAuthenticated({ cwd: "/repo" })).resolves.toBe(true);
    expect(calls[0]).toEqual(["current-user", "get"]);
  });

  it("reports unauthenticated when the current-user call fails", async () => {
    const { service } = makeService(() =>
      throwCli("Impossible to get object (401: 401 Unauthorized)"),
    );
    await expect(service.isAuthenticated({ cwd: "/repo" })).resolves.toBe(false);
  });

  it("throws GitLabCliMissingError with install guidance when python-gitlab is not installed", async () => {
    const { service } = makeService(() => ok("{}"), { resolveExecutable: async () => null });
    const error = await service.getPullRequest({ cwd: "/repo", number: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(GitLabCliMissingError);
    expect(error.message).toBe(
      "python-gitlab CLI `gitlab` not found; install with `uv tool install python-gitlab`",
    );
  });

  it("classifies a missing executable at spawn time as GitLabCliMissingError", async () => {
    const { service } = makeService(() => {
      throw Object.assign(new Error("spawn gitlab ENOENT"), { code: "ENOENT" });
    });
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabCliMissingError,
    );
  });

  it.each([
    "Impossible to get object (401: 401 Unauthorized)",
    "Impossible to get object (403: 403 Forbidden)",
    "gitlab.exceptions.GitlabAuthenticationError: 401: 401 Unauthorized",
  ])("normalizes %s into GitLabAuthenticationError", async (stderr) => {
    const { service } = makeService(() => throwCli(stderr));
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabAuthenticationError,
    );
  });

  it("does not mistake other failures for authentication problems", async () => {
    const { service } = makeService(() =>
      throwCli("Impossible to get object (404: 404 Not Found) after 401 retries"),
    );
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabCommandError,
    );
  });

  it("surfaces non-JSON stdout as a GitLabCommandError", async () => {
    const { service } = makeService(() => ok("not json at all"));
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabCommandError,
    );
  });

  it("surfaces empty stdout (an action that printed nothing) as a GitLabCommandError", async () => {
    const { service } = makeService(() => ok(""));
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabCommandError,
    );
  });

  it("surfaces schema-mismatched JSON as a GitLabCommandError", async () => {
    const { service } = makeService(() => json({ unexpected: true }));
    await expect(service.getPullRequest({ cwd: "/repo", number: 1 })).rejects.toBeInstanceOf(
      GitLabCommandError,
    );
  });

  it("searches issues and merge requests and maps them to neutral results", async () => {
    const { service, calls } = makeService(
      byCommand({
        "project-issue list": () => json([OPEN_ISSUE]),
        "project-merge-request list": () => json([OPEN_MR]),
      }),
    );

    const result = await service.searchIssuesAndPrs({ cwd: "/repo", query: "login", limit: 10 });

    expect(result.featuresEnabled).toBe(true);
    expect(result.authState).toBe("authenticated");
    expect(result.githubFeaturesEnabled).toBe(true);
    expect(result.items).toEqual([
      {
        kind: "change_request",
        number: 14,
        title: "chore(release): 0.4.0",
        url: "https://gitlab.example.com/example-group/example-project/-/merge_requests/14",
        state: "open",
        body: "Release notes",
        labels: ["release"],
        projectPath: "example-group/example-project",
        baseRefName: "main",
        headRefName: "release/v0.4.0",
        updatedAt: "2026-06-25T19:00:00.000Z",
      },
      {
        kind: "issue",
        number: 7,
        title: "Login button misaligned",
        url: "https://gitlab.example.com/example-group/example-project/-/issues/7",
        state: "opened",
        body: "On mobile the login button overflows",
        labels: ["bug"],
        baseRefName: null,
        headRefName: null,
        updatedAt: "2026-06-24T08:00:00.000Z",
      },
    ]);

    expect(calls.find((args) => args[0] === "project-merge-request")).toEqual([
      "project-merge-request",
      "list",
      PROJECT_FLAG,
      "--order-by=updated_at",
      "--sort=desc",
      "--per-page=10",
      "--no-get-all",
      "--state=opened",
      "--search=login",
    ]);
    expect(calls.find((args) => args[0] === "project-issue")).toEqual([
      "project-issue",
      "list",
      PROJECT_FLAG,
      "--order-by=updated_at",
      "--sort=desc",
      "--state=opened",
      "--per-page=10",
      "--no-get-all",
      "--search=login",
    ]);
  });

  it("parses the real issue payload shape", async () => {
    const { service } = makeService(
      byCommand({
        "project-issue list": () => json([REAL_GITLAB_ISSUE]),
        "project-merge-request list": () => ok("[]"),
      }),
    );

    const result = await service.searchIssuesAndPrs({ cwd: "/repo", query: "" });

    expect(result).toEqual({
      featuresEnabled: true,
      authState: "authenticated",
      githubFeaturesEnabled: true,
      items: [
        {
          kind: "issue",
          number: 1,
          title: "Test",
          url: "https://gitlab.com/example-user/sample-repo/-/work_items/1",
          state: "opened",
          body: "Simple test",
          labels: [],
          projectPath: "example-user/sample-repo",
          baseRefName: null,
          headRefName: null,
          updatedAt: "2026-06-26T09:11:19.642Z",
        },
      ],
    });
  });

  it("restricts search to merge requests when only the PR kind is requested", async () => {
    const { service, calls } = makeService(
      byCommand({ "project-merge-request list": () => json([OPEN_MR]) }),
    );

    const result = await service.searchIssuesAndPrs({
      cwd: "/repo",
      query: "release",
      kinds: ["github-pr"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "change_request", number: 14 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--search=release");
  });

  it("reports forge features disabled when python-gitlab is unavailable or unauthenticated", async () => {
    const missing = makeService(() => ok("[]"), { resolveExecutable: async () => null }).service;
    await expect(missing.searchIssuesAndPrs({ cwd: "/repo", query: "x" })).resolves.toEqual({
      items: [],
      featuresEnabled: false,
      authState: "cli_missing",
      githubFeaturesEnabled: false,
    });

    const unauthenticated = makeService(() =>
      throwCli("Impossible to list objects (401: 401 Unauthorized)"),
    ).service;
    await expect(unauthenticated.searchIssuesAndPrs({ cwd: "/repo", query: "x" })).resolves.toEqual(
      {
        items: [],
        featuresEnabled: false,
        authState: "unauthenticated",
        githubFeaturesEnabled: false,
      },
    );
  });

  it("rejects search when one requested kind fails for a non-auth reason", async () => {
    const { service } = makeService((args) => {
      if (args[0] === "project-issue") {
        throwCli("Impossible to list objects (500: 500 Internal Server Error)");
      }
      return json([OPEN_MR]);
    });

    await expect(service.searchIssuesAndPrs({ cwd: "/repo", query: "release" })).rejects.toThrow(
      GitLabCommandError,
    );
  });
});
