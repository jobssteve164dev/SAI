import {REFERENCE_FORK_ID, type LabsResult, type LabsSignedClaim} from "./index.js";
import {LabsRepository} from "./store.js";
import type {ActInput, ActResult, Observation} from "../../kernel/src/index.js";
import type {SaiRegionApplication} from "../../mcp/src/index.js";

export function createLabsAwareApplication(world: SaiRegionApplication, labs: LabsRepository): SaiRegionApplication {
  return {
    async observe(agentId, input): Promise<Observation> { return world.observe(agentId, input); },
    async act(agentId: string, input: ActInput): Promise<ActResult> {
      const args = input.arguments as {operation?: string; result?: LabsResult; result_id?: string; signed_claim?: LabsSignedClaim; claim_id?: string; economic_network_id?: string} | undefined;
      if (args?.operation !== "settle_branch") return world.act(agentId, input);
      try {
        if (!args.result || !args.result_id || !args.signed_claim || !args.claim_id || !/^network:sha256:[0-9a-f]{64}$/.test(args.economic_network_id ?? "")) throw new TypeError("LABS 世界研究动作必须由桥接器规范化并签名");
        if (args.signed_claim.claim.agent_id !== agentId || args.signed_claim.claim.result_id !== args.result_id) throw new TypeError("LABS 研究动作的身份或结果引用不匹配");
        await labs.ingest("result", args.result, args.result_id, REFERENCE_FORK_ID);
        await labs.ingest("claim", args.signed_claim, args.claim_id, REFERENCE_FORK_ID);
        return world.act(agentId, input);
      } catch {
        return {request_id: input.request_id, status: "rejected", reason: "arguments_invalid", available_correction: "choose_another_action"};
      }
    },
  };
}
