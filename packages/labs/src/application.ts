import {labsContentId, REFERENCE_FORK_ID, REFERENCE_RULESET_ID, type LabsResult, type LabsSignedClaim} from "./index.js";
import {LabsRepository} from "./store.js";
import type {ActInput, ActResult, Observation} from "../../kernel/src/index.js";
import type {SaiRegionApplication} from "../../mcp/src/index.js";

export const LABS_RESEARCH_ACTION_ID = "act_labs_research";

export function createLabsAwareApplication(world: SaiRegionApplication, labs: LabsRepository): SaiRegionApplication {
  return {
    async observe(agentId, input): Promise<Observation> {
      const observation = await world.observe(agentId, input);
      const frontier = await labs.frontier();
      const resources = await labs.resources();
      return {
        ...observation,
        research: {
          topic: "LABS",
          optional: true,
          ruleset_id: REFERENCE_RULESET_ID,
          fork_id: REFERENCE_FORK_ID,
          frontier: frontier.lengths,
          public_resources_unlocked: resources.total_unlocked,
          result_truth: "sequence_and_deterministic_formula",
          branch_boundary: "knowledge_merges_assets_do_not",
        },
        legal_actions: [...observation.legal_actions, {
          action_id: LABS_RESEARCH_ACTION_ID,
          type: "research",
          arguments_schema: {
            type: "object",
            additionalProperties: false,
            required: ["operation", "sequence"],
            properties: {
              operation: {const: "publish"},
              sequence: {type: "string", pattern: "^[01]+$", maxLength: 4096},
              claim_type: {enum: ["discovery", "reproduction", "relay"]},
              evidence_ids: {type: "array", maxItems: 128, uniqueItems: true, items: {type: "string", pattern: "^sha256:[0-9a-f]{64}$"}},
            },
          },
        }],
      };
    },
    async act(agentId: string, input: ActInput): Promise<ActResult> {
      if (input.action_id !== LABS_RESEARCH_ACTION_ID) return world.act(agentId, input);
      try {
        const args = input.arguments as {operation?: string; result?: LabsResult; result_id?: string; signed_claim?: LabsSignedClaim; claim_id?: string; fork_id?: string} | undefined;
        if (args?.operation !== "publish" || !args.result || !args.result_id || !args.signed_claim || !args.claim_id) throw new TypeError("LABS 研究动作必须由桥接器规范化并签名");
        if (args.signed_claim.claim.agent_id !== agentId || args.signed_claim.claim.result_id !== args.result_id) throw new TypeError("LABS 研究动作的身份或结果引用不匹配");
        const forkId = args.fork_id ?? REFERENCE_FORK_ID;
        await labs.ingest("result", args.result, args.result_id, forkId);
        await labs.ingest("claim", args.signed_claim, args.claim_id, forkId);
        const frontier = await labs.frontier(args.result.ruleset_id, forkId);
        return {request_id: input.request_id, status: "applied", event_id: args.result_id, state_hash: labsContentId(frontier)};
      } catch {
        return {request_id: input.request_id, status: "rejected", reason: "arguments_invalid", available_correction: "choose_another_action"};
      }
    },
  };
}

