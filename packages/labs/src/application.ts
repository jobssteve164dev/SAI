import {REFERENCE_FORK_ID, type LabsResearchArtifact, type LabsResearchRecord, type LabsResearchTask, type LabsResult, type LabsSignedClaim} from "./index.js";
import {LabsRepository} from "./store.js";
import {ECONOMIC_NETWORK_ID, type ActInput, type ActResult, type AgentObservation} from "../../kernel/src/index.js";
import type {SaiRegionApplication} from "../../mcp/src/index.js";

export function createLabsAwareApplication(world: SaiRegionApplication, labs: LabsRepository): SaiRegionApplication {
  return {
    async observe(agentId, input): Promise<AgentObservation> { return world.observe(agentId, input); },
    async memory(agentId, input) { return world.memory(agentId, input); },
    async season(agentId, input) { return world.season(agentId, input); },
    async activity(agentId, input) { return world.activity(agentId, input); },
    async act(agentId: string, input: ActInput): Promise<ActResult> {
      const args = input.arguments as {operation?: string; result?: LabsResult; result_id?: string; signed_claim?: LabsSignedClaim; claim_id?: string; economic_network_id?: string; research_task?: LabsResearchTask; task_id?: string; method_artifact?: LabsResearchArtifact; artifact_id?: string; research_record?: LabsResearchRecord; record_id?: string} | undefined;
      if (args?.operation !== "settle_branch") return world.act(agentId, input);
      try {
        if (!args.result || !args.result_id || !args.signed_claim || !args.claim_id || !args.research_task || !args.task_id || !args.method_artifact || !args.artifact_id || !args.research_record || !args.record_id || args.economic_network_id !== ECONOMIC_NETWORK_ID) throw new TypeError("LABS 世界研究动作必须绑定现行经济网络并由桥接器生成完整可复现记录和签名");
        if (args.signed_claim.claim.agent_id !== agentId || args.signed_claim.claim.result_id !== args.result_id) throw new TypeError("LABS 研究动作的身份或结果引用不匹配");
        await labs.ingest("artifact", args.method_artifact, args.artifact_id, REFERENCE_FORK_ID);
        await labs.ingest("task", args.research_task, args.task_id, REFERENCE_FORK_ID);
        await labs.ingest("record", args.research_record, args.record_id, REFERENCE_FORK_ID);
        await labs.ingest("result", args.result, args.result_id, REFERENCE_FORK_ID);
        await labs.ingest("claim", args.signed_claim, args.claim_id, REFERENCE_FORK_ID);
        return world.act(agentId, input);
      } catch {
        return {request_id: input.request_id, status: "rejected", reason: "arguments_invalid", available_correction: "choose_another_action"};
      }
    },
  };
}
