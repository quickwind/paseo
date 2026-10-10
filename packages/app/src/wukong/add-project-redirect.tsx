import { useRouter } from "expo-router";
import { useEffect } from "react";

import type { AddProjectFlowRequest } from "@/stores/add-project-flow-store";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHosts } from "@/runtime/host-runtime";
import { buildPluginSurfaceRoute } from "@/plugins/routes";

const GITLAB_PLUGIN_ID = "wukong-gitlab";
const GITLAB_SCREEN_ID = "add-from-gitlab";

export function resolveGitLabProjectRoute(input: {
  preferredHostId?: string;
  localServerId: string | null;
  hostIds: readonly string[];
}) {
  const serverId = input.preferredHostId ?? input.localServerId ?? input.hostIds[0] ?? null;
  return serverId
    ? buildPluginSurfaceRoute(serverId, GITLAB_PLUGIN_ID, { kind: "surface", id: GITLAB_SCREEN_ID })
    : null;
}

/**
 * Wukong has one way to add a project: the "Add project from GitLab" screen of the bundled
 * plugin. Every Add Project entry point (sidebar, command center, shortcut, empty states) still
 * opens the shared flow request, and this sends that request to the GitLab screen instead.
 */
export function WukongAddProjectRedirect({
  request,
  onClose,
}: {
  request: AddProjectFlowRequest | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const localServerId = useLocalDaemonServerId();
  const hosts = useHosts();

  useEffect(() => {
    if (!request) return;
    const route = resolveGitLabProjectRoute({
      preferredHostId: request.preferredHostId,
      localServerId,
      hostIds: hosts.map((host) => host.serverId),
    });
    if (route) router.push(route);
    onClose();
  }, [request, localServerId, hosts, router, onClose]);

  return null;
}
