import {describe, expect, it} from "vitest";
import {WORLD_MAX_SUPPLY, buildObservation, createWorld, replay, stateHash, transition, worldResourceBranch, worldSupplyObservation, type ActionCommand, type RegionState} from "../../packages/kernel/src/index.js";
import {createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {REFERENCE_RULESET, createClaimBody, executeLabsWorldResearch, signLabsClaim, type LabsWorldBranch} from "../../packages/labs/src/index.js";

async function prepared(state: RegionState, agentId: string, identity: AgentIdentity) {
  const stored = buildObservation(state, agentId)!;
  const command = Object.values(stored.commands).find((item) => item.type === "research") as ActionCommand;
  const resource = stored.observation.nearby.find((item) => item.type === "resource" && item.id === command.target)!;
  const branch = resource.type === "resource" ? resource.labs_branch as LabsWorldBranch : undefined;
  if (!branch) throw new Error("missing LABS branch");
  const research = executeLabsWorldResearch(REFERENCE_RULESET, branch);
  const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "reproduction";
  const evidence = [branch.branch_id, research.task_id, research.artifact_id, research.record_id];
  const {signed_claim, claim_id} = signLabsClaim(createClaimBody(research.result_id, identity, claimType, evidence), identity);
  return {command, branch, argumentsValue: {
    operation: "settle_branch",
    branch_id: branch.branch_id,
    economic_network_id: branch.economic_network_id,
    candidate_sequence: research.candidate_sequence,
    result: research.result,
    result_id: research.result_id,
    signed_claim,
    claim_id,
    research_task: research.task,
    task_id: research.task_id,
    method_artifact: research.artifact,
    artifact_id: research.artifact_id,
    research_record: research.record,
    record_id: research.record_id,
  }};
}

describe("LABS finite-world settlement", () => {
  it("reveals a branch only near its finite resource and offers settlement only on the resource cell", () => {
    const branch = worldResourceBranch(0);
    const farX = branch.x >= 3 ? branch.x - 3 : branch.x + 3;
    const state = createWorld("spatial", [{id: "agent:a", x: farX, y: branch.y, energy: 5, inventory: {}}]);
    const far = buildObservation(state, "agent:a")!.observation;
    expect(far.nearby.some((item) => item.type === "resource" && item.labs_branch)).toBe(false);
    expect(far.legal_actions.some((item) => item.type === "research")).toBe(false);
    state.agents["agent:a"]!.x = branch.x === 0 ? 1 : branch.x - 1;
    state.agents["agent:a"]!.y = branch.y;
    const near = buildObservation(state, "agent:a")!.observation;
    expect(near.nearby.some((item) => item.type === "resource" && item.labs_branch)).toBe(true);
    expect(near.legal_actions.some((item) => item.type === "research")).toBe(false);
    state.agents["agent:a"]!.x = branch.x;
    expect(buildObservation(state, "agent:a")!.observation.legal_actions.some((item) => item.type === "research")).toBe(true);
  });

  it("atomically claims the finite branch amount once, conserves the ecosystem cap, and replays byte-for-byte", async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const branch = worldResourceBranch(0);
    const initial = createWorld("race", [
      {id: a.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}},
      {id: b.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}},
    ]);
    const beforeSupply = worldSupplyObservation(initial)!;
    const pa = await prepared(initial, a.agentId, a);
    const pb = await prepared(initial, b.agentId, b);
    expect(pa.branch.branch_id).toBe(pb.branch.branch_id);
    const first = transition(initial, a.agentId, "world-labs-a", pa.command, pa.argumentsValue);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.state.agents[a.agentId]!.inventory[branch.kind]).toBe(branch.amount);
    expect(first.state.supply?.protocol).toBe("sai-world-supply-state/2");
    const afterSupply = worldSupplyObservation(first.state)!;
    expect(afterSupply.issued_supply).toBe(branch.amount);
    expect(afterSupply.reserve_supply + afterSupply.issued_supply).toBe(WORLD_MAX_SUPPLY);
    expect(beforeSupply.reserve_supply).toBe(WORLD_MAX_SUPPLY);
    expect(stateHash(replay(initial, [first.event]))).toBe(stateHash(first.state));
    const second = transition(first.state, b.agentId, "world-labs-b", pb.command, pb.argumentsValue);
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.result.reason).toBe("target_unavailable");
  });

  it("rejects forged, replayed, or branch-mismatched computation without changing supply", async () => {
    const identity = await createIdentity();
    const branch = worldResourceBranch(0);
    const initial = createWorld("invalid", [{id: identity.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}}]);
    const preparedAction = await prepared(initial, identity.agentId, identity);
    const forged = structuredClone(preparedAction.argumentsValue);
    forged.result.energy = "0";
    const rejected = transition(initial, identity.agentId, "forged", preparedAction.command, forged);
    expect(rejected.status).toBe("rejected");
    expect(stateHash(rejected.state)).toBe(stateHash(initial));

    const first = transition(initial, identity.agentId, "valid", preparedAction.command, preparedAction.argumentsValue);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    const replayed = transition(first.state, identity.agentId, "replayed", preparedAction.command, preparedAction.argumentsValue);
    expect(replayed.status).toBe("rejected");
    expect(stateHash(replayed.state)).toBe(stateHash(first.state));
  });

  it("binds branch value to its genesis stratum instead of time, season, or fork", () => {
    for (const ordinal of [0, 1, 2 ** 20, 2 ** 23, 2 ** 24 - 1]) {
      const branch = worldResourceBranch(ordinal);
      expect(branch.amount).toBe(branch.stratum);
      expect(branch.amount).toBeGreaterThanOrEqual(1);
      expect(branch.amount).toBeLessThanOrEqual(32);
      expect(branch.labs_branch.resource_amount).toBe(branch.amount);
      expect(branch.labs_branch.branch_ordinal).toBe(ordinal);
    }
  });
});
