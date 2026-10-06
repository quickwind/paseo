import {
  GitLabAuthenticationError,
  GitLabCliMissingError,
  GitLabCommandError,
  createGitLabPythonClient,
  parseGitLabHttpStatus,
  type GitLabClient,
  type GitLabPythonClientOptions,
} from "./gitlab-python-client.js";
import { buildGitLabCloneUrl, type GitLabForgeConfig } from "./gitlab-forge-config.js";
import type {
  GitLabApprovals,
  GitLabDiscussion,
  GitLabIssue,
  GitLabMergeRequest,
  GitLabNote,
  GitLabNoteLineRangeEndpoint,
  GitLabPipelineDetails,
  GitLabPipelineJob,
} from "./gitlab-rest-schemas.js";
import {
  compareTimelineItems,
  createUnavailableSearchResult,
  normalizeForgeSearchKinds,
  parseOptionalTime,
} from "./forge-service.js";
import type {
  CheckDetails,
  CreatePullRequestOptions,
  CurrentPullRequestStatus,
  DisablePullRequestAutoMergeOptions,
  EnablePullRequestAutoMergeOptions,
  ForgeReadOptions,
  ForgeRepositorySummary,
  ForgeService,
  GetCheckDetailsOptions,
  GetPullRequestOptions,
  GetPullRequestTimelineOptions,
  IssueSummary,
  ListIssuesOptions,
  ListPullRequestsOptions,
  MergePullRequestOptions,
  PipelineDetails,
  PipelineJob,
  PipelineJobStatus,
  PipelineStage,
  PullRequestAutoMergeResult,
  PullRequestCheck,
  PullRequestChecksStatus,
  PullRequestCheckoutTarget,
  PullRequestCreateResult,
  PullRequestMergeable,
  PullRequestMergeMethod,
  PullRequestMergeResult,
  PullRequestSummary,
  PullRequestTimeline,
  PullRequestTimelineCommentLocation,
  PullRequestTimelineError,
  PullRequestTimelineErrorKind,
  PullRequestTimelineItem,
  SearchIssuesAndPrsOptions,
  SearchResult,
} from "./forge-service.js";
import {
  CHECK_TRAIT_ACTION_REQUIRED,
  CHECK_TRAIT_MANUAL,
  CHECK_TRAIT_WARNING,
} from "@getpaseo/protocol/check-traits";
import { GITLAB_ACTIVE_PIPELINE_STATUS_SET } from "@getpaseo/protocol/gitlab-pipeline";
import { isGitLabStatusFacts, type GitLabStatusFacts } from "./gitlab-facts.js";

const GITLAB_DETAILED_MERGEABLE_STATUS = "mergeable";
const GITLAB_LEGACY_MERGEABLE_STATUS = "can_be_merged";

/**
 * Internal edition: options for the GitLab adapter. `config` locates the
 * company GitLab; the rest are test seams for the python-gitlab client.
 */
export interface CreateGitLabServiceOptions extends Omit<GitLabPythonClientOptions, "config"> {
  config: GitLabForgeConfig;
  /** Replaces the python-gitlab client entirely. */
  client?: GitLabClient;
}

const TIMELINE_PAGE_SIZE = 100;

function mapMergeRequestState(state: string): string {
  if (state === "opened") {
    return "open";
  }
  return state === "merged" ? "merged" : "closed";
}

/**
 * Direct-merge readiness from GitLab's merge signals. `detailed_merge_status` is
 * GitLab 15.6+ only; when it is absent (older self-managed instances) fall back
 * to the legacy `merge_status === "can_be_merged"` with no conflicts instead of
 * refusing every merge.
 */
function isGitLabMergeReady(params: {
  detailedMergeStatus: string | null | undefined;
  mergeStatus: string | null | undefined;
  hasConflicts: boolean;
}): boolean {
  if (params.detailedMergeStatus != null) {
    return params.detailedMergeStatus === GITLAB_DETAILED_MERGEABLE_STATUS;
  }
  return params.mergeStatus === GITLAB_LEGACY_MERGEABLE_STATUS && !params.hasConflicts;
}

function mapMergeable(mr: GitLabMergeRequest): PullRequestMergeable {
  if (mr.has_conflicts === true) {
    return "CONFLICTING";
  }
  if (
    isGitLabMergeReady({
      detailedMergeStatus: mr.detailed_merge_status,
      mergeStatus: mr.merge_status,
      hasConflicts: mr.has_conflicts ?? false,
    })
  ) {
    return "MERGEABLE";
  }
  return "UNKNOWN";
}

function mapPipelineChecksStatus(status: string | undefined): PullRequestChecksStatus {
  switch (status) {
    case "success":
    case "passed":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
    case "cancelled":
      return "none";
    case "manual":
      return "pending";
    default:
      return status && GITLAB_ACTIVE_PIPELINE_STATUS_SET.has(status) ? "pending" : "none";
  }
}

function splitProjectPath(fullReference: string | undefined): {
  owner?: string;
  name?: string;
} {
  if (!fullReference) {
    return {};
  }
  const projectPath = fullReference.split("!")[0]?.split("#")[0];
  if (!projectPath) {
    return {};
  }
  const segments = projectPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return {};
  }
  return { owner: segments[0], name: segments[segments.length - 1] };
}

function toPullRequestSummary(mr: GitLabMergeRequest): PullRequestSummary {
  const projectPath = extractProjectPath(mr.references?.full);
  return {
    number: mr.iid,
    title: mr.title,
    url: mr.web_url,
    state: mapMergeRequestState(mr.state),
    body: mr.description ?? null,
    baseRefName: mr.target_branch,
    headRefName: mr.source_branch,
    labels: mr.labels ?? [],
    ...(projectPath ? { projectPath } : {}),
    updatedAt: mr.updated_at ?? "",
  };
}

function toIssueSummary(issue: GitLabIssue): IssueSummary {
  const projectPath = extractProjectPath(issue.references?.full);
  return {
    number: issue.iid,
    title: issue.title,
    url: issue.web_url,
    state: issue.state,
    body: issue.description ?? null,
    labels: issue.labels ?? [],
    ...(projectPath ? { projectPath } : {}),
    updatedAt: issue.updated_at ?? "",
  };
}

function extractProjectPath(fullReference: string | undefined): string | undefined {
  if (!fullReference) {
    return undefined;
  }
  const projectPath = fullReference.split("!")[0]?.split("#")[0];
  return projectPath && projectPath.length > 0 ? projectPath : undefined;
}

function countApprovalsGiven(approvals: GitLabApprovals | null | undefined): number | null {
  if (!approvals) {
    return null;
  }
  if (Array.isArray(approvals.approved_by)) {
    return approvals.approved_by.length;
  }
  if (approvals.approvals_required != null && approvals.approvals_left != null) {
    return Math.max(0, approvals.approvals_required - approvals.approvals_left);
  }
  return null;
}

function toGitLabStatusFacts(
  mr: GitLabMergeRequest,
  approvals?: GitLabApprovals | null,
): GitLabStatusFacts {
  return {
    detailedMergeStatus: mr.detailed_merge_status ?? null,
    mergeStatus: mr.merge_status ?? null,
    hasConflicts: mr.has_conflicts ?? false,
    blockingDiscussionsResolved: mr.blocking_discussions_resolved ?? true,
    approvalsRequired: approvals?.approvals_required ?? mr.approvals_required ?? 0,
    approvalsGiven: countApprovalsGiven(approvals) ?? mr.approvals_given ?? 0,
    pipelineStatus: mr.head_pipeline?.status ?? null,
    pipelineId: mr.head_pipeline?.id ?? null,
    pipelineUrl: mr.head_pipeline?.web_url ?? null,
    mergeWhenPipelineSucceeds: mr.merge_when_pipeline_succeeds ?? false,
  };
}

function parseGitLabTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A GitLab discussion is a reply chain when it is not an explicit standalone
 * note (`individual_note: true`). Older payloads may omit the flag, so a
 * discussion that already holds multiple notes is also treated as a thread.
 */
function isThreadDiscussion(discussion: GitLabDiscussion): boolean {
  if (discussion.individual_note === true) {
    return false;
  }
  return discussion.individual_note === false || discussion.notes.length > 1;
}

function resolvePositionLine(endpoint: GitLabNoteLineRangeEndpoint): number | undefined {
  return endpoint.new_line ?? endpoint.old_line ?? undefined;
}

function toTimelineCommentLocation(
  note: GitLabNote,
  discussion: GitLabDiscussion,
): PullRequestTimelineCommentLocation | undefined {
  const position = note.position;
  const path = position?.new_path ?? position?.old_path ?? undefined;
  if (!position || !path) {
    return undefined;
  }
  const line = resolvePositionLine(position);
  const start = position.line_range?.start;
  const startLine = start ? resolvePositionLine(start) : undefined;
  // Only emit a resolution state GitLab can actually own: a note that is not
  // resolvable (ordinary comments, system context) has no meaningful resolved
  // flag, and defaulting it to `false` would render a fake "unresolved" badge.
  const isResolved = note.resolvable === true ? (note.resolved ?? false) : undefined;
  return {
    path,
    ...(line != null ? { line } : {}),
    ...(startLine != null && startLine !== line ? { startLine } : {}),
    threadId: discussion.id,
    ...(isResolved !== undefined ? { isResolved } : {}),
  };
}

/**
 * Maps a GitLab note to a neutral timeline item. The forge has no GitHub-style
 * review verdict on a note, so every human note becomes a `comment`; approvals
 * are surfaced separately on the status facts, not as timeline reviews. System
 * notes (events like "approved", "mentioned in commit") are dropped.
 */
function toTimelineComment(
  note: GitLabNote,
  discussion: GitLabDiscussion,
  mrWebUrl: string,
): PullRequestTimelineItem | null {
  if (note.system === true) {
    return null;
  }
  const location = toTimelineCommentLocation(note, discussion);
  // Top-level thread id groups every note of a reply chain — including general
  // (non-file) discussions that carry no `location` — into one timeline thread.
  const threadId = isThreadDiscussion(discussion) ? discussion.id : undefined;
  // A resolvable discussion without a file position (a general thread) carries its
  // resolution here, since `location.isResolved` only exists for file threads.
  const threadIsResolved =
    !location && note.resolvable === true ? (note.resolved ?? false) : undefined;
  return {
    kind: "comment",
    id: String(note.id),
    author: note.author?.username ?? note.author?.name ?? "unknown",
    authorUrl: note.author?.web_url ?? null,
    avatarUrl: note.author?.avatar_url ?? null,
    body: note.body ?? "",
    createdAt: parseGitLabTimestamp(note.created_at),
    url: `${mrWebUrl}#note_${note.id}`,
    ...(threadId ? { threadId } : {}),
    ...(threadIsResolved !== undefined ? { threadIsResolved } : {}),
    ...(location ? { location } : {}),
  };
}

function classifyGitLabTimelineErrorKind(error: GitLabCommandError): PullRequestTimelineErrorKind {
  const status = parseGitLabHttpStatus(error.stderr);
  if (status === 404) {
    return "not_found";
  }
  if (status === 401 || status === 403) {
    return "forbidden";
  }
  const normalized = error.stderr.toLowerCase();
  if (normalized.includes("not found")) {
    return "not_found";
  }
  return normalized.includes("forbidden") ? "forbidden" : "unknown";
}

function mapGitLabTimelineError(error: unknown): PullRequestTimelineError {
  if (error instanceof GitLabAuthenticationError) {
    return { kind: "forbidden", message: error.stderr || error.message };
  }
  if (error instanceof GitLabCommandError) {
    return {
      kind: classifyGitLabTimelineErrorKind(error),
      message: error.stderr || error.message,
    };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

function normalizePipelineJobStatus(raw: string): PipelineJobStatus {
  switch (raw) {
    case "success":
    case "passed":
      return "success";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "created":
      return "created";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "skipped":
      return "skipped";
    case "manual":
      return "manual";
    default:
      return GITLAB_ACTIVE_PIPELINE_STATUS_SET.has(raw) ? "pending" : "unknown";
  }
}

function getPullRequestCheckMetadata(
  rawStatus: string,
  allowFailure: boolean,
): Pick<PullRequestCheck, "traits"> {
  if (rawStatus === "manual") {
    return {
      traits: allowFailure
        ? [CHECK_TRAIT_MANUAL]
        : [CHECK_TRAIT_MANUAL, CHECK_TRAIT_ACTION_REQUIRED],
    };
  }
  return rawStatus === "failed" && allowFailure ? { traits: [CHECK_TRAIT_WARNING] } : {};
}

const PULL_REQUEST_CHECK_STATUS_BY_PIPELINE_JOB_STATUS = {
  success: "success",
  failed: "failure",
  running: "pending",
  pending: "pending",
  canceled: "cancelled",
  skipped: "skipped",
  manual: "pending",
  created: "pending",
  unknown: "pending",
} as const satisfies Record<PipelineJobStatus, PullRequestCheck["status"]>;

function toPullRequestCheck(job: GitLabPipelineJob): PullRequestCheck {
  const rawStatus = job.status.toLowerCase();
  const allowFailure = job.allow_failure ?? false;

  let status: PullRequestCheck["status"];
  if (rawStatus === "failed" && allowFailure) {
    // GitLab treats this as passed-with-warning: retain a successful aggregate
    // while giving the client the presentation distinction it cannot express
    // through the neutral status enum alone.
    status = "success";
  } else if (rawStatus === "manual" && allowFailure) {
    status = "skipped";
  } else {
    status =
      PULL_REQUEST_CHECK_STATUS_BY_PIPELINE_JOB_STATUS[normalizePipelineJobStatus(rawStatus)];
  }

  return {
    name: job.name,
    status,
    ...getPullRequestCheckMetadata(rawStatus, allowFailure),
    url: job.web_url ?? null,
    workflow: job.stage,
    checkRunId: job.id,
  };
}

function toPullRequestChecks(pipeline: GitLabPipelineDetails): PullRequestCheck[] {
  return [...pipeline.jobs].sort((a, b) => a.id - b.id).map(toPullRequestCheck);
}

const STAGE_STATUS_PRIORITY: PipelineJobStatus[] = [
  "running",
  "failed",
  "pending",
  "created",
  "manual",
  "canceled",
  "skipped",
  "success",
];

function aggregateStageStatus(jobs: PipelineJob[]): PipelineJobStatus {
  const present = new Set(
    jobs.map((job) =>
      job.allowFailure && (job.status === "failed" || job.status === "manual")
        ? "success"
        : job.status,
    ),
  );
  for (const status of STAGE_STATUS_PRIORITY) {
    if (present.has(status)) {
      return status;
    }
  }
  return "unknown";
}

function toPipelineDetails(pipeline: GitLabPipelineDetails): PipelineDetails {
  // Ascending id restores job creation order.
  const jobs: PipelineJob[] = [...pipeline.jobs]
    .sort((a, b) => a.id - b.id)
    .map((job) => ({
      id: job.id,
      name: job.name,
      stage: job.stage,
      status: normalizePipelineJobStatus(job.status),
      rawStatus: job.status,
      url: job.web_url ?? null,
      allowFailure: job.allow_failure ?? false,
      durationSeconds: job.duration ?? null,
    }));

  const stages: PipelineStage[] = [];
  const stageIndex = new Map<string, PipelineStage>();
  for (const job of jobs) {
    let stage = stageIndex.get(job.stage);
    if (!stage) {
      stage = { name: job.stage, status: "unknown", jobs: [] };
      stageIndex.set(job.stage, stage);
      stages.push(stage);
    }
    stage.jobs.push(job);
  }
  for (const stage of stages) {
    stage.status = aggregateStageStatus(stage.jobs);
  }

  return {
    id: pipeline.id,
    status: normalizePipelineJobStatus(pipeline.status),
    rawStatus: pipeline.status,
    url: pipeline.web_url ?? null,
    ref: pipeline.ref ?? null,
    sha: pipeline.sha ?? null,
    stages,
  };
}

function toCheckDetails(pipeline: GitLabPipelineDetails): CheckDetails {
  return {
    checkRunId: pipeline.id,
    workflowRunId: null,
    name: pipeline.ref ? `Pipeline (${pipeline.ref})` : `Pipeline #${pipeline.id}`,
    status: null,
    conclusion: null,
    url: pipeline.web_url ?? null,
    detailsUrl: pipeline.web_url ?? null,
    output: null,
    annotations: [],
    failedJobs: [],
    truncated: false,
    pipeline: toPipelineDetails(pipeline),
  };
}

function toCurrentPullRequestStatus(
  mr: GitLabMergeRequest,
  approvals?: GitLabApprovals | null,
  checks: PullRequestCheck[] = [],
  pipelineStatus?: string | null,
): CurrentPullRequestStatus {
  const { owner, name } = splitProjectPath(mr.references?.full);
  const projectPath = extractProjectPath(mr.references?.full);
  return {
    number: mr.iid,
    ...(owner ? { repoOwner: owner } : {}),
    ...(name ? { repoName: name } : {}),
    ...(projectPath ? { projectPath } : {}),
    url: mr.web_url,
    title: mr.title,
    state: mapMergeRequestState(mr.state),
    baseRefName: mr.target_branch,
    headRefName: mr.source_branch,
    isMerged: mr.state === "merged" || mr.merged_at != null,
    isDraft: mr.draft ?? mr.work_in_progress ?? false,
    mergeable: mapMergeable(mr),
    checks,
    // Aggregate and job list must come from the same pipeline: the client reads
    // the MR's latest pipeline, which can differ from head_pipeline (detached
    // vs branch pipelines, or a newer run). GitLab's own pipeline status stays
    // authoritative for the aggregate - deriving it from the mapped jobs would
    // hold MRs at "pending" forever on post-success manual deploy jobs.
    checksStatus: mapPipelineChecksStatus(pipelineStatus ?? mr.head_pipeline?.status),
    reviewDecision: null,
    forgeSpecific: { forge: "gitlab", ...toGitLabStatusFacts(mr, approvals) },
  };
}

function getGitlabStatusFacts(status: MergePullRequestOptions["status"]): GitLabStatusFacts | null {
  const forgeSpecific = status?.forgeSpecific;
  return isGitLabStatusFacts(forgeSpecific) ? forgeSpecific : null;
}

/**
 * Server-side guard for GitLab auto-merge: `merge_when_pipeline_succeeds` only
 * schedules the merge while a pipeline is active. Without one it merges on the
 * spot, so this is enforced at execution time as well as in UI policy.
 */
export function assertGitLabAutoMergeEnableReady(
  input: Pick<EnablePullRequestAutoMergeOptions, "status">,
): void {
  const gitlab = getGitlabStatusFacts(input.status);
  if (!gitlab) {
    throw new Error("GitLab auto-merge facts are unavailable for this merge request");
  }
  if (gitlab.mergeWhenPipelineSucceeds) {
    throw new Error("Auto-merge is already enabled for this merge request");
  }
  if (
    gitlab.pipelineStatus === null ||
    !GITLAB_ACTIVE_PIPELINE_STATUS_SET.has(gitlab.pipelineStatus)
  ) {
    throw new Error(
      "GitLab auto-merge requires an in-progress pipeline; without one the merge would run immediately",
    );
  }
}

/**
 * Server-side guard for a GitLab direct merge, mirroring the GitHub adapter's
 * assertDirectPullRequestMergeReady: refuse the merge unless GitLab reports the
 * MR as directly mergeable and auto-merge is not already scheduled. Enforced
 * here (not just in the UI policy) because the resolved status can go stale
 * between the client check and execution, and the RPC can be called directly.
 */
function assertGitLabDirectMergeReady(input: Pick<MergePullRequestOptions, "status">): void {
  const gitlab = getGitlabStatusFacts(input.status);
  if (!gitlab) {
    throw new Error("GitLab merge facts are unavailable for this merge request");
  }
  if (gitlab.mergeWhenPipelineSucceeds) {
    throw new Error("Direct merge is not available because auto-merge is already enabled");
  }
  if (
    !isGitLabMergeReady({
      detailedMergeStatus: gitlab.detailedMergeStatus,
      mergeStatus: gitlab.mergeStatus,
      hasConflicts: gitlab.hasConflicts,
    })
  ) {
    throw new Error("GitLab does not report this merge request as ready for direct merge");
  }
}

function isGitLabSearchAuthFailure(reason: unknown): boolean {
  return reason instanceof GitLabCliMissingError || reason instanceof GitLabAuthenticationError;
}

function getGitLabUnavailableSearchAuthState(
  results: PromiseSettledResult<unknown>[],
): "cli_missing" | "unauthenticated" | null {
  if (
    results.length === 0 ||
    !results.every(
      (result) => result.status === "rejected" && isGitLabSearchAuthFailure(result.reason),
    )
  ) {
    return null;
  }
  return results.some(
    (result) => result.status === "rejected" && result.reason instanceof GitLabCliMissingError,
  )
    ? "cli_missing"
    : "unauthenticated";
}

function throwFirstNonGitLabAuthSearchRejection(results: PromiseSettledResult<unknown>[]): void {
  const failed = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected" && !isGitLabSearchAuthFailure(result.reason),
  );
  if (failed) {
    throw failed.reason;
  }
}

const MERGE_METHOD_REBASE_UNSUPPORTED =
  "Rebase merge is not supported for GitLab merge requests; use merge or squash";

function assertGitLabMergeMethodSupported(mergeMethod: PullRequestMergeMethod): void {
  // Internal edition: python-gitlab's `merge` action has no rebase option, and
  // phase 1 ships merge and squash only.
  if (mergeMethod === "rebase") {
    throw new Error(MERGE_METHOD_REBASE_UNSUPPORTED);
  }
}

export function createGitLabService(options: CreateGitLabServiceOptions): ForgeService {
  const client = options.client ?? createGitLabPythonClient(options);

  async function viewMergeRequest(cwd: string, iid: number): Promise<GitLabMergeRequest> {
    return client.getMergeRequest({ cwd, project: await client.resolveProject(cwd), iid });
  }

  async function resolveCurrentMergeRequest(
    cwd: string,
    headRef: string,
    headSha?: string,
  ): Promise<{ mr: GitLabMergeRequest; project: string } | null> {
    const project = await client.resolveProject(cwd);
    const mergeRequests = await client.listMergeRequests({
      cwd,
      project,
      sourceBranch: headRef,
      limit: 100,
    });
    const candidates = mergeRequests.filter((mr) => mr.source_branch === headRef);
    const match =
      candidates.find((mr) => mapMergeRequestState(mr.state) === "open") ??
      candidates.find(
        (mr) =>
          mapMergeRequestState(mr.state) !== "open" && headSha !== undefined && mr.sha === headSha,
      ) ??
      null;
    if (!match) {
      return null;
    }
    return { mr: await client.getMergeRequest({ cwd, project, iid: match.iid }), project };
  }

  /**
   * Detects whether discussions exist beyond the first fetched page. A bare
   * `length >= 100` falsely flags an exactly-full page as truncated, so probe
   * for a single discussion on the next page. Best-effort: if the probe fails we
   * keep the already-fetched notes and conservatively report truncation, since a
   * full first page means at least one page of discussions exists.
   */
  async function hasDiscussionsAfterFirstPage(
    cwd: string,
    project: string,
    iid: number,
  ): Promise<boolean> {
    try {
      const probe = await client.listDiscussions({
        cwd,
        project,
        iid,
        perPage: 1,
        page: TIMELINE_PAGE_SIZE + 1,
      });
      return probe.length > 0;
    } catch {
      return true;
    }
  }

  /**
   * Fetches MR approval counts from the dedicated approvals endpoint. Best-effort:
   * a host without the endpoint must not break the MR status, so failures leave
   * the counts at their fallback (0).
   */
  async function fetchApprovals(
    cwd: string,
    project: string,
    mr: GitLabMergeRequest,
  ): Promise<GitLabApprovals | null> {
    try {
      return await client.getApprovals({ cwd, project, iid: mr.iid });
    } catch {
      return null;
    }
  }

  /**
   * Populates the neutral checks used by the sidebar and hover card. Pipeline
   * drill-down remains independently available, so any command or output
   * failure while loading optional job details must not make the merge request
   * itself disappear. Authentication and missing-CLI failures use separate
   * error classes and still propagate.
   */
  interface PipelineChecksResult {
    checks: PullRequestCheck[];
    pipelineStatus: string | null;
  }

  async function fetchPipelineChecks(
    cwd: string,
    project: string,
    mr: GitLabMergeRequest,
  ): Promise<PipelineChecksResult> {
    if (mr.head_pipeline?.id === undefined) {
      return { checks: [], pipelineStatus: null };
    }
    try {
      const pipeline = await client.getLatestMrPipelineWithJobs({ cwd, project, iid: mr.iid });
      if (!pipeline) {
        return { checks: [], pipelineStatus: null };
      }
      return { checks: toPullRequestChecks(pipeline), pipelineStatus: pipeline.status };
    } catch (error) {
      if (error instanceof GitLabCommandError) {
        console.warn(
          `Failed to load GitLab pipeline jobs for MR !${mr.iid}: ${
            error.stderr?.trim() || error.message
          }`,
        );
        return { checks: [], pipelineStatus: null };
      }
      throw error;
    }
  }

  async function runMergeRequestList(
    input: ListPullRequestsOptions,
  ): Promise<PullRequestSummary[]> {
    const project = await client.resolveProject(input.cwd);
    const mergeRequests = await client.listMergeRequests({
      cwd: input.cwd,
      project,
      state: "opened",
      search: input.query?.trim() || undefined,
      limit: input.limit,
    });
    return mergeRequests.map(toPullRequestSummary);
  }

  async function runIssueList(input: ListIssuesOptions): Promise<IssueSummary[]> {
    const project = await client.resolveProject(input.cwd);
    const issues = await client.listIssues({
      cwd: input.cwd,
      project,
      search: input.query?.trim() || undefined,
      limit: input.limit,
    });
    return issues.map(toIssueSummary);
  }

  /**
   * GitLab's `squash` is an attribute of the merge request, and python-gitlab's
   * `merge` action cannot set it, so squash is switched on first. The attribute
   * stays on the MR if the merge itself then fails.
   */
  async function prepareMerge(input: {
    cwd: string;
    prNumber: number;
    mergeMethod: PullRequestMergeMethod;
  }): Promise<string> {
    const project = await client.resolveProject(input.cwd);
    if (input.mergeMethod === "squash") {
      await client.setSquash({
        cwd: input.cwd,
        project,
        iid: input.prNumber,
        squash: true,
      });
    }
    return project;
  }

  return {
    async searchRepositories(input): Promise<ForgeRepositorySummary[]> {
      const projects = await client.searchProjects({
        cwd: input.cwd,
        query: input.query.trim() || undefined,
        limit: input.limit,
      });
      // `project list --simple` omits visibility, so none is reported.
      const protocol = options.config.sshHost ? "ssh" : "https";
      return projects.map((project) => ({
        id: String(project.id),
        name: project.name ?? project.path_with_namespace.split("/").at(-1) ?? "",
        nameWithOwner: project.path_with_namespace,
        description: project.description ?? null,
        updatedAt: project.last_activity_at ?? "",
        cloneUrl: buildGitLabCloneUrl(options.config, project.path_with_namespace, protocol),
      }));
    },

    async isAuthenticated(input: { cwd: string } & ForgeReadOptions): Promise<boolean> {
      try {
        await client.currentUser(input.cwd);
        return true;
      } catch {
        return false;
      }
    },

    async getCurrentPullRequestStatus(input): Promise<CurrentPullRequestStatus | null> {
      const current = await resolveCurrentMergeRequest(input.cwd, input.headRef, input.headSha);
      if (!current) {
        return null;
      }
      const { mr, project } = current;
      const [approvals, pipelineChecks] = await Promise.all([
        fetchApprovals(input.cwd, project, mr),
        fetchPipelineChecks(input.cwd, project, mr),
      ]);
      return toCurrentPullRequestStatus(
        mr,
        approvals,
        pipelineChecks.checks,
        pipelineChecks.pipelineStatus,
      );
    },

    async getPullRequest(input: GetPullRequestOptions): Promise<PullRequestSummary> {
      const mr = await viewMergeRequest(input.cwd, input.number);
      return toPullRequestSummary(mr);
    },

    async getPullRequestHeadRef(input: GetPullRequestOptions): Promise<string> {
      const mr = await viewMergeRequest(input.cwd, input.number);
      return mr.source_branch;
    },

    async getPullRequestCheckoutTarget(
      input: GetPullRequestOptions,
    ): Promise<PullRequestCheckoutTarget> {
      const mr = await viewMergeRequest(input.cwd, input.number);
      return {
        number: mr.iid,
        baseRefName: mr.target_branch,
        headRefName: mr.source_branch,
        checkoutRefs: [
          { remoteName: "origin", remoteRef: `refs/merge-requests/${mr.iid}/head` },
          { remoteName: "origin", remoteRef: `refs/heads/${mr.source_branch}` },
        ],
        headOwnerLogin: null,
        headRepositorySshUrl: null,
        headRepositoryUrl: null,
        isCrossRepository:
          mr.source_project_id !== undefined &&
          mr.source_project_id !== null &&
          mr.target_project_id !== undefined &&
          mr.target_project_id !== null &&
          mr.source_project_id !== mr.target_project_id,
      };
    },

    listPullRequests(input: ListPullRequestsOptions): Promise<PullRequestSummary[]> {
      return runMergeRequestList(input);
    },

    listIssues(input: ListIssuesOptions): Promise<IssueSummary[]> {
      return runIssueList(input);
    },

    async createPullRequest(input: CreatePullRequestOptions): Promise<PullRequestCreateResult> {
      const created = await client.createMergeRequest({
        cwd: input.cwd,
        project: await client.resolveProject(input.cwd),
        title: input.title,
        description: input.body ?? "",
        sourceBranch: input.head,
        targetBranch: input.base,
      });
      return { url: created.webUrl, number: created.iid };
    },

    async mergePullRequest(input: MergePullRequestOptions): Promise<PullRequestMergeResult> {
      assertGitLabMergeMethodSupported(input.mergeMethod);
      assertGitLabDirectMergeReady(input);
      const project = await prepareMerge(input);
      // Omitting `merge_when_pipeline_succeeds` makes GitLab merge now, so a
      // direct merge never turns into a scheduled auto-merge. The pre-flight
      // guard above stays: both are needed.
      await client.merge({ cwd: input.cwd, project, iid: input.prNumber });
      return { success: true };
    },

    async getPullRequestTimeline(
      input: GetPullRequestTimelineOptions,
    ): Promise<PullRequestTimeline> {
      const identity = {
        prNumber: input.prNumber,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      };
      try {
        const project = await client.resolveProject(input.cwd);
        const mr = await client.getMergeRequest({
          cwd: input.cwd,
          project,
          iid: input.prNumber,
        });
        const discussions = await client.listDiscussions({
          cwd: input.cwd,
          project,
          iid: mr.iid,
          perPage: TIMELINE_PAGE_SIZE,
        });
        const items = discussions
          .flatMap((discussion) =>
            discussion.notes.map((note) => toTimelineComment(note, discussion, mr.web_url)),
          )
          .filter((item): item is PullRequestTimelineItem => item !== null)
          .sort(compareTimelineItems);
        const truncated =
          discussions.length >= TIMELINE_PAGE_SIZE
            ? await hasDiscussionsAfterFirstPage(input.cwd, project, mr.iid)
            : false;
        return {
          ...identity,
          items,
          truncated,
          error: null,
        };
      } catch (error) {
        return { ...identity, items: [], truncated: false, error: mapGitLabTimelineError(error) };
      }
    },

    /**
     * Fetches a pipeline's stages/jobs for the drill-down. Addressing it by MR
     * iid reads the MR's newest pipeline from the project that pipeline reports,
     * so a fork or detached MR pipeline resolves where a bare pipeline id run
     * against the checkout's project would 404.
     */
    async getCheckDetails(input: GetCheckDetailsOptions): Promise<CheckDetails> {
      const project = await client.resolveProject(input.cwd);
      if (input.changeRequestNumber !== undefined) {
        const pipeline = await client.getLatestMrPipelineWithJobs({
          cwd: input.cwd,
          project,
          iid: input.changeRequestNumber,
        });
        if (!pipeline) {
          throw new Error(
            `GitLab merge request !${input.changeRequestNumber} has no pipeline to show`,
          );
        }
        return toCheckDetails(pipeline);
      }
      if (input.checkRunId === undefined) {
        throw new Error("GitLab pipeline details need a pipeline id or a merge request number");
      }
      const pipeline = await client.getPipelineWithJobs({
        cwd: input.cwd,
        project,
        pipelineId: input.checkRunId,
      });
      return toCheckDetails(pipeline);
    },

    async searchIssuesAndPrs(input: SearchIssuesAndPrsOptions): Promise<SearchResult> {
      if (input.force && !input.reason) {
        throw new Error("ForgeService forced read requires a reason");
      }

      const kinds = normalizeForgeSearchKinds(input.kinds);
      const shouldFetchIssues = kinds.includes("issue");
      const shouldFetchMergeRequests = kinds.includes("change_request");
      const [issuesResult, mergeRequestsResult] = await Promise.allSettled([
        shouldFetchIssues
          ? runIssueList({ cwd: input.cwd, query: input.query, limit: input.limit })
          : Promise.resolve(null),
        shouldFetchMergeRequests
          ? runMergeRequestList({ cwd: input.cwd, query: input.query, limit: input.limit })
          : Promise.resolve(null),
      ]);

      const requestedResults = [
        shouldFetchIssues ? issuesResult : null,
        shouldFetchMergeRequests ? mergeRequestsResult : null,
      ].filter((result) => result !== null);
      const unavailableAuthState = getGitLabUnavailableSearchAuthState(requestedResults);
      if (unavailableAuthState) {
        return createUnavailableSearchResult(unavailableAuthState);
      }
      throwFirstNonGitLabAuthSearchRejection(requestedResults);

      const items: SearchResult["items"] = [];
      if (shouldFetchIssues && issuesResult.status === "fulfilled") {
        for (const issue of issuesResult.value ?? []) {
          items.push({
            kind: "issue",
            number: issue.number,
            title: issue.title,
            url: issue.url,
            state: issue.state,
            body: issue.body,
            labels: issue.labels,
            ...(issue.projectPath ? { projectPath: issue.projectPath } : {}),
            baseRefName: null,
            headRefName: null,
            updatedAt: issue.updatedAt,
          });
        }
      }
      if (shouldFetchMergeRequests && mergeRequestsResult.status === "fulfilled") {
        for (const mergeRequest of mergeRequestsResult.value ?? []) {
          items.push({
            kind: "change_request",
            number: mergeRequest.number,
            title: mergeRequest.title,
            url: mergeRequest.url,
            state: mergeRequest.state,
            body: mergeRequest.body,
            labels: mergeRequest.labels,
            ...(mergeRequest.projectPath ? { projectPath: mergeRequest.projectPath } : {}),
            baseRefName: mergeRequest.baseRefName,
            headRefName: mergeRequest.headRefName,
            updatedAt: mergeRequest.updatedAt,
          });
        }
      }
      items.sort(
        (left, right) => parseOptionalTime(right.updatedAt) - parseOptionalTime(left.updatedAt),
      );

      return {
        items,
        featuresEnabled: true,
        authState: "authenticated",
        githubFeaturesEnabled: true,
      };
    },

    async enablePullRequestAutoMerge(
      input: EnablePullRequestAutoMergeOptions,
    ): Promise<PullRequestAutoMergeResult> {
      // GitLab's auto-merge is "merge when pipeline succeeds": setting it while a
      // pipeline is running schedules the merge instead of performing it now.
      // The merge strategy mirrors mergePullRequest.
      assertGitLabMergeMethodSupported(input.mergeMethod);
      assertGitLabAutoMergeEnableReady({ status: input.status });
      const project = await prepareMerge(input);
      await client.merge({
        cwd: input.cwd,
        project,
        iid: input.prNumber,
        whenPipelineSucceeds: true,
      });
      return { success: true };
    },

    async disablePullRequestAutoMerge(
      input: DisablePullRequestAutoMergeOptions,
    ): Promise<PullRequestAutoMergeResult> {
      // Merging again with the flag off would merge immediately rather than
      // cancel the scheduled auto-merge, so use the dedicated cancel action.
      await client.cancelAutoMerge({
        cwd: input.cwd,
        project: await client.resolveProject(input.cwd),
        iid: input.prNumber,
      });
      return { success: true };
    },

    invalidate(_input: { cwd: string }): void {},
  };
}
