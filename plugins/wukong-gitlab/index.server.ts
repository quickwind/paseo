import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cloneProjectRpc, searchProjectsRpc } from "./shared/rpc.js";
import { clone, search } from "./server/projects.js";

export default function contribute(server: PluginServerContext) {
  server.handle(searchProjectsRpc, search);
  server.handle(cloneProjectRpc, clone);
  return () => {};
}
