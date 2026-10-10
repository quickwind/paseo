import { z } from "zod";

const PLUGIN_ID = "wukong-gitlab";
const METHOD = "wukong.pick-folder";
const OutputSchema = z.object({ path: z.string().nullable() });

interface PluginRpcClient {
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
}

/**
 * Asks the daemon to show the system folder dialog. The web UI cannot: a browser never reveals a
 * folder's real path, and the daemon, which listens on this machine only, can. Returns null when
 * the user cancels.
 */
export async function pickDirectoryOnDaemon(
  client: PluginRpcClient | null,
  title?: string,
): Promise<string | null> {
  if (!client) {
    throw new Error("Not connected to the daemon.");
  }
  const output = await client.invokePluginRpc(PLUGIN_ID, METHOD, title ? { title } : {});
  return OutputSchema.parse(output).path;
}
