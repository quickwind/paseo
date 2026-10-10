import { mkdir, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { cloneProjectRpc, searchProjectsRpc } from "../shared/rpc.js";
import { expandHome, loadSettings } from "./config.js";
import { assertProjectPath, cloneUrl, gitClone, remoteOf, searchProjects } from "./gitlab.js";

export async function search({
  query,
  limit,
}: RpcInput<typeof searchProjectsRpc>): Promise<RpcOutput<typeof searchProjectsRpc>> {
  const settings = loadSettings();
  return {
    cloneRoot: settings.cloneRoot,
    projects: await searchProjects(settings, query, limit ?? 30),
  };
}

function resolveParent(input: string | undefined, fallback: string): string {
  const value = input?.trim();
  if (!value) return fallback;
  const expanded = expandHome(value);
  if (!isAbsolute(expanded)) {
    throw new Error("The clone folder must be an absolute path");
  }
  return resolve(expanded);
}

/**
 * `git remote get-url` applies the user's `url.<base>.insteadOf` rewrites, so the stored URL may
 * be an ssh form of the https URL we cloned from. The project path at the end is what identifies it.
 */
function isCloneOf(remote: string | null, projectPath: string): boolean {
  const normalized = remote?.replace(/\/+$/u, "").replace(/\.git$/u, "") ?? "";
  return normalized.endsWith(`/${projectPath}`) || normalized.endsWith(`:${projectPath}`);
}

export async function clone(
  input: RpcInput<typeof cloneProjectRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof cloneProjectRpc>> {
  const settings = loadSettings();
  assertProjectPath(input.path);
  const url = cloneUrl(settings, input.path);
  const parent = resolveParent(input.parentDirectory, settings.cloneRoot);
  const directory = join(parent, basename(input.path));

  const existing = await readdir(directory).catch(() => null);
  let alreadyCloned = false;
  if (existing && existing.length > 0) {
    // Reuse a previous clone of the same project; never write into an unrelated folder.
    if (!isCloneOf(await remoteOf(directory), input.path)) {
      throw new Error(`${directory} already exists and is not a clone of ${input.path}`);
    }
    alreadyCloned = true;
  } else {
    await mkdir(parent, { recursive: true });
    await gitClone(url, directory);
  }

  const workspace = await paseo.workspaces.open(directory);
  return { directory, workspaceId: workspace.id, alreadyCloned };
}
