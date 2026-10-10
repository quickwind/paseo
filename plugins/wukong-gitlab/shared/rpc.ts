import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const GitLabProjectSchema = z.object({
  path: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  webUrl: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});

export type GitLabProject = z.infer<typeof GitLabProjectSchema>;

export const searchProjectsRpc = defineRpc({
  name: "wukong.gitlab.search",
  input: z.object({ query: z.string(), limit: z.number().int().min(1).max(100).optional() }),
  output: z.object({
    /** Where clones go unless the user picks another folder. */
    cloneRoot: z.string(),
    projects: z.array(GitLabProjectSchema),
  }),
});

export const cloneProjectRpc = defineRpc({
  name: "wukong.gitlab.clone",
  input: z.object({
    /** Full project path such as `group/sub/project`. */
    path: z.string(),
    /** Folder to clone into; defaults to the configured clone root. */
    parentDirectory: z.string().optional(),
  }),
  output: z.object({ directory: z.string(), workspaceId: z.string(), alreadyCloned: z.boolean() }),
});

export const pickFolderRpc = defineRpc({
  name: "wukong.pick-folder",
  input: z.object({ title: z.string().max(200).optional() }),
  /** `null` when the user cancels the dialog. */
  output: z.object({ path: z.string().nullable() }),
});
