import {describe, expect, it} from "vitest";
import {WORLD_SUPPLY_SCHEDULE_ID, buildObservation, createWorld, replay, stateHash, transition, validateState, worldIssuedAtHeight, type ActionCommand, type RegionState} from "../../packages/kernel/src/index.js";
import {createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {REFERENCE_RULESET, createClaimBody, createLabsResult, labsSymmetries, signLabsClaim, type LabsWorldBranch} from "../../packages/labs/src/index.js";

async function prepared(state: RegionState, agentId: string, identity: AgentIdentity) {
  const stored = buildObservation(state, agentId)!;
  const command = Object.values(stored.commands).find((item) => item.type === "research") as ActionCommand;
  const resource = stored.observation.nearby.find((item) => item.type === "resource" && item.id === command.target)!;
  const branch = resource.type === "resource" ? resource.labs_branch as LabsWorldBranch : undefined;
  if (!branch) throw new Error("missing LABS branch");
  const baseline = REFERENCE_RULESET.baselines.find((item) => item.length === branch.length)!;
  const candidate_sequence = labsSymmetries(baseline.sequence).find((item) => item.startsWith(branch.sequence_prefix))!;
  const {result, result_id} = createLabsResult(REFERENCE_RULESET, candidate_sequence);
  const {signed_claim, claim_id} = signLabsClaim(createClaimBody(result_id, identity, "reproduction", [branch.branch_id]), identity);
  return {command, branch, argumentsValue: {operation: "settle_branch", branch_id: branch.branch_id, world_fork_id: branch.world_fork_id, candidate_sequence, result, result_id, signed_claim, claim_id}};
}

function crystalConservation(state: RegionState): number {
  return state.resources["resource-alpha"]!.remaining + Object.values(state.agents).reduce((sum, agent) => sum + (agent.inventory.crystal ?? 0), 0);
}

function worldAtHeight(height: number, agentId: string): RegionState {
  const state = createWorld("halving", [{id: agentId, x: 3, y: 3, energy: 5, inventory: {}}]);
  let issued = worldIssuedAtHeight(height);
  for (const resource of Object.values(state.resources).sort((a, b) => a.id.localeCompare(b.id))) {
    const consumed = Math.min(issued, resource.remaining);
    resource.remaining -= consumed;
    issued -= consumed;
  }
  state.supply = {protocol: "sai-world-supply-state/1", schedule_id: WORLD_SUPPLY_SCHEDULE_ID, research_height: height, previous_settlement_id: `sha256:${"a".repeat(64)}`};
  validateState(state);
  return state;
}

describe("LABS finite-world settlement", () => {
  it("reveals a branch only near its finite resource and offers settlement only on the resource cell", () => {
    const state = createWorld("spatial", [{id: "agent:a", x: 7, y: 0, energy: 5, inventory: {}}]);
    const far = buildObservation(state, "agent:a")!.observation;
    expect(far.nearby.some((item) => item.type === "resource" && item.labs_branch)).toBe(false);
    expect(far.legal_actions.some((item) => item.type === "research")).toBe(false);
    state.agents["agent:a"]!.x = 2;
    state.agents["agent:a"]!.y = 0;
    const near = buildObservation(state, "agent:a")!.observation;
    expect(near.nearby.some((item) => item.type === "resource" && item.labs_branch)).toBe(true);
    expect(near.legal_actions.some((item) => item.type === "research")).toBe(false);
    state.agents["agent:a"]!.x = 1;
    expect(buildObservation(state, "agent:a")!.observation.legal_actions.some((item) => item.type === "research")).toBe(true);
  });

  it("atomically transfers the current subsidy, conserves supply, changes the next branch, and replays byte-for-byte", async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const initial = createWorld("race", [
      {id: a.agentId, x: 1, y: 0, energy: 5, inventory: {}},
      {id: b.agentId, x: 1, y: 0, energy: 5, inventory: {}},
    ]);
    const beforeTotal = crystalConservation(initial);
    const pa = await prepared(initial, a.agentId, a);
    const pb = await prepared(initial, b.agentId, b);
    expect(pa.branch.branch_id).toBe(pb.branch.branch_id);
    const first = transition(initial, a.agentId, "world-labs-a", pa.command, pa.argumentsValue);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.state.resources["resource-alpha"]!.remaining).toBe(10_492);
    expect(first.state.agents[a.agentId]!.inventory.crystal).toBe(8);
    expect(first.state.supply?.research_height).toBe(1);
    expect(crystalConservation(first.state)).toBe(beforeTotal);
    expect(stateHash(replay(initial, [first.event]))).toBe(stateHash(first.state));
    const second = transition(first.state, b.agentId, "world-labs-b", pb.command, pb.argumentsValue);
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.result.reason).toBe("target_unavailable");
  });

  it("rejects forged, replayed, or branch-mismatched computation without changing supply", async () => {
    const identity = await createIdentity();
    const initial = createWorld("invalid", [{id: identity.agentId, x: 1, y: 0, energy: 5, inventory: {}}]);
    const preparedAction = await prepared(initial, identity.agentId, identity);
    const forged = structuredClone(preparedAction.argumentsValue);
    forged.result.energy = "0";
    const rejected = transition(initial, identity.agentId, "forged", preparedAction.command, forged);
    expect(rejected.status).toBe("rejected");
    expect(stateHash(rejected.state)).toBe(stateHash(initial));

    const first = transition(initial, identity.agentId, "valid", preparedAction.command, preparedAction.argumentsValue);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    const next = buildObservation(first.state, identity.agentId)!;
    const nextCommand = Object.values(next.commands).find((item) => item.type === "research")!;
    const replayed = transition(first.state, identity.agentId, "replayed", nextCommand, preparedAction.argumentsValue);
    expect(replayed.status).toBe("rejected");
    expect(stateHash(replayed.state)).toBe(stateHash(first.state));
  });

  it("halves by research height and exposes no branch after the permanent cap is released", async () => {
    const identity = await createIdentity();
    const beforeHalving = worldAtHeight(2_099, identity.agentId);
    const preparedAction = await prepared(beforeHalving, identity.agentId, identity);
    expect(preparedAction.branch.subsidy).toBe(8);
    const outcome = transition(beforeHalving, identity.agentId, "halving-edge", preparedAction.command, preparedAction.argumentsValue);
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.state.supply?.research_height).toBe(2_100);
    const nextResource = buildObservation(outcome.state, identity.agentId)!.observation.nearby.find((item) => item.type === "resource" && item.labs_branch);
    const nextBranch = nextResource?.type === "resource" ? nextResource.labs_branch : undefined;
    expect(nextBranch?.subsidy).toBe(4);

    const terminal = worldAtHeight(8_400, identity.agentId);
    const terminalObservation = buildObservation(terminal, identity.agentId)!.observation;
    expect(terminalObservation.legal_actions.some((action) => action.type === "research")).toBe(false);
    expect(terminalObservation.nearby.some((item) => item.type === "resource" && item.labs_branch)).toBe(false);
  });
});
