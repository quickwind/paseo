import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cloneProjectRpc, pickFolderRpc, searchProjectsRpc } from "./shared/rpc.js";
import { pickFolder } from "./server/pick-folder.js";
import { clone, search } from "./server/projects.js";

export default function contribute(server: PluginServerContext) {
  server.handle(searchProjectsRpc, search);
  server.handle(cloneProjectRpc, clone);
  server.handle(pickFolderRpc, async ({ title }) => {
    // These lines land in the daemon log, so a dialog that never appears can be traced.
    console.log(`[wukong-gitlab] opening the folder dialog on ${process.platform}`);
    try {
      const path = await pickFolder(title);
      console.log(`[wukong-gitlab] folder dialog closed: ${path ?? "cancelled"}`);
      return { path };
    } catch (error) {
      console.error(`[wukong-gitlab] folder dialog failed: ${(error as Error).message}`);
      throw error;
    }
  });
  return () => {};
}
