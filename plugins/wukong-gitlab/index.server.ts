import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cloneProjectRpc, pickFolderRpc, searchProjectsRpc } from "./shared/rpc.js";
import { pickFolder } from "./server/pick-folder.js";
import { clone, search } from "./server/projects.js";

export default function contribute(server: PluginServerContext) {
  server.handle(searchProjectsRpc, search);
  server.handle(cloneProjectRpc, clone);
  server.handle(pickFolderRpc, async ({ title }) => ({ path: await pickFolder(title) }));
  return () => {};
}
