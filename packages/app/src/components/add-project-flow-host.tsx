import { AddProjectFlow } from "@/components/add-project-flow";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
import { WukongAddProjectRedirect } from "@/wukong/add-project-redirect"; // Wukong
import { WUKONG_BUILD } from "@/wukong/build"; // Wukong

export function AddProjectFlowHost() {
  const request = useAddProjectFlowStore((state) => state.request);
  const close = useAddProjectFlowStore((state) => state.close);

  if (WUKONG_BUILD) return <WukongAddProjectRedirect request={request} onClose={close} />; // Wukong
  if (!request) return null;

  return <AddProjectFlow key={request.id} request={request} onClose={close} />;
}
