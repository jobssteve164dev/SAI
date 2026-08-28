import {describe, expect, it} from "vitest";
import {WORLD_MAX_SUPPLY, buildObservation, createWorld, expandWorldForPopulation, replay, stateHash, transition, worldResourceBranch, worldSupplyActiveTip, worldSupplyObservation, type ActionCommand, type RegionState} from "../../packages/kernel/src/index.js";
import {createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {REFERENCE_RULESET, createClaimBody, executeLabsWorldResearch, signLabsClaim, type LabsWorldBranch} from "../../packages/labs/src/index.js";

async function prepared(state: RegionState, agentId: string, identity: AgentIdentity) {
  const stored = buildObservation(state, agentId)!;
  const command = Object.values(stored.commands).find((item) => item.type === "research") as ActionCommand;
  const resource = stored.observation.nearby.find((item) => item.type === "resource" && item.id === command.target)!;
  const branch = resource.type === "resource" ? resource.labs_branch as LabsWorldBranch : undefined;
  if (!branch) throw new Error("missing LABS branch");
  if (!state.supply || state.supply.protocol !== "sai-world-supply-state/3") throw new Error("missing current economic state");
  const research = executeLabsWorldResearch(REFERENCE_RULESET, branch, {economic_parent_id: worldSupplyActiveTip(state.supply), claimant_agent_id: identity.agentId});
  const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
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

  it("settles exactly one contribution-backed unit, rejects a stale race, and preserves the remaining branch research", async () => {
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
    expect(first.state.agents[a.agentId]!.inventory[branch.kind]).toBe(1);
    expect(first.state.supply?.protocol).toBe("sai-world-supply-state/3");
    const afterSupply = worldSupplyObservation(first.state)!;
    expect(afterSupply.issued_supply).toBe(1);
    expect(afterSupply.verified_new_canonical_candidates).toBe("65536");
    expect(visibleRemaining(first.state, branch.resource_id)).toBe(branch.amount - 1);
    expect(afterSupply.reserve_supply + afterSupply.issued_supply).toBe(WORLD_MAX_SUPPLY);
    expect(beforeSupply.reserve_supply).toBe(WORLD_MAX_SUPPLY);
    expect(stateHash(replay(initial, [first.event]))).toBe(stateHash(first.state));
    const second = transition(first.state, b.agentId, "world-labs-b", pb.command, pb.argumentsValue);
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.result.reason).toBe("target_unavailable");

    const nextUnit = await prepared(first.state, b.agentId, b);
    expect(nextUnit.branch.unit_index).toBe(1);
    expect(nextUnit.branch.branch_id).not.toBe(pa.branch.branch_id);
    const next = transition(first.state, b.agentId, "world-labs-b-next", nextUnit.command, nextUnit.argumentsValue);
    expect(next.status).toBe("applied");
    if (next.status === "applied") {
      expect(next.result.received).toEqual({[branch.kind]: 1});
      expect(next.result.economic_settlement).toMatchObject({
        protocol: "sai-economic-settlement-receipt/1",
        parent_id: afterSupply.active_tip_id,
        branch_ordinal: branch.branch_ordinal,
        unit_index: 1,
        resource_kind: branch.kind,
        reward_units: 1,
        agent_id: b.agentId,
      });
      expect(worldSupplyObservation(next.state)!.issued_supply).toBe(2);
    }
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

  it("rejects every forged contribution binding without issuing a resource unit", async () => {
    const identity = await createIdentity();
    const impostor = await createIdentity();
    const branch = worldResourceBranch(0);
    const initial = createWorld("binding-matrix", [{id: identity.agentId, x: branch.x, y: branch.y, energy: 20, inventory: {}}]);
    const valid = await prepared(initial, identity.agentId, identity);
    const zeroId = `sha256:${"0".repeat(64)}`;
    const cases: Array<[string, (value: any) => Promise<void> | void]> = [
      ["candidate sequence", (value) => { value.candidate_sequence = `${value.candidate_sequence[0] === "0" ? "1" : "0"}${value.candidate_sequence.slice(1)}`; }],
      ["exact energy", (value) => { value.result.energy = "0"; }],
      ["result digest", (value) => { value.result_id = zeroId; }],
      ["task branch", (value) => { value.research_task.branch_ordinal += 1; }],
      ["task economic parent", (value) => { value.research_task.economic_parent_id = zeroId; }],
      ["task claimant", (value) => { value.research_task.claimant_agent_id = impostor.agentId; }],
      ["task challenge bits", (value) => { value.research_task.challenge_bits = `${value.research_task.challenge_bits[0] === "0" ? "1" : "0"}${value.research_task.challenge_bits.slice(1)}`; }],
      ["task digest", (value) => { value.task_id = zeroId; }],
      ["method artifact", (value) => { value.method_artifact.content += "\nforged"; }],
      ["artifact digest", (value) => { value.artifact_id = zeroId; }],
      ["evaluated candidates", (value) => { value.research_record.evaluated_candidates = 65_535; }],
      ["new canonical candidates", (value) => { value.research_record.new_canonical_candidates = 65_535; }],
      ["coverage partition", (value) => { value.research_record.coverage_partition_id = zeroId; }],
      ["coverage digest", (value) => { value.research_record.coverage_digest = zeroId; }],
      ["reward amount", (value) => { value.research_record.reward_units = 2; }],
      ["record digest", (value) => { value.record_id = zeroId; }],
      ["economic network", (value) => { value.economic_network_id = `network:${zeroId}`; }],
      ["world unit", (value) => { value.branch_id = zeroId; }],
      ["claim type", (value) => {
        const signed = signLabsClaim(createClaimBody(value.result_id, identity, "reproduction", [valid.branch.branch_id, value.task_id, value.artifact_id, value.record_id]), identity);
        value.signed_claim = signed.signed_claim;
        value.claim_id = signed.claim_id;
      }],
      ["claim author", (value) => {
        const signed = signLabsClaim(createClaimBody(value.result_id, impostor, "coverage", [valid.branch.branch_id, value.task_id, value.artifact_id, value.record_id]), impostor);
        value.signed_claim = signed.signed_claim;
        value.claim_id = signed.claim_id;
      }],
      ["claim evidence", (value) => {
        const signed = signLabsClaim(createClaimBody(value.result_id, identity, "coverage", [valid.branch.branch_id, value.task_id, value.artifact_id]), identity);
        value.signed_claim = signed.signed_claim;
        value.claim_id = signed.claim_id;
      }],
    ];
    for (const [label, mutate] of cases) {
      const forged = structuredClone(valid.argumentsValue) as any;
      await mutate(forged);
      const outcome = transition(initial, identity.agentId, `forged-${label}`, valid.command, forged);
      expect(outcome.status, label).toBe("rejected");
      expect(stateHash(outcome.state), label).toBe(stateHash(initial));
      expect(worldSupplyObservation(outcome.state)!.issued_supply, label).toBe(0);
    }
  }, 30_000);

  it("cannot redirect a copied public record to another Agent or a later economic parent", async () => {
    const author = await createIdentity();
    const copier = await createIdentity();
    const branch = worldResourceBranch(0);
    const initial = createWorld("copy-resistance", [
      {id: author.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}},
      {id: copier.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}},
    ]);
    const authored = await prepared(initial, author.agentId, author);
    const copierCommand = buildObservation(initial, copier.agentId)!.commands;
    const researchCommand = Object.values(copierCommand).find((item) => item.type === "research")!;
    const copied = structuredClone(authored.argumentsValue);
    const resigned = signLabsClaim(createClaimBody(copied.result_id, copier, "coverage", [authored.branch.branch_id, copied.task_id, copied.artifact_id, copied.record_id]), copier);
    copied.signed_claim = resigned.signed_claim;
    copied.claim_id = resigned.claim_id;
    const redirected = transition(initial, copier.agentId, "redirect-copy", researchCommand, copied);
    expect(redirected.status).toBe("rejected");
    expect(worldSupplyObservation(redirected.state)!.issued_supply).toBe(0);

    const advancer = await createIdentity();
    const advanceBranch = worldResourceBranch(1);
    let fork = expandWorldForPopulation(createWorld("parent-bound", [
      {id: author.agentId, x: 0, y: 0, energy: 5, inventory: {}},
      {id: advancer.agentId, x: 0, y: 0, energy: 5, inventory: {}},
    ]), 2, {width: Math.max(branch.x, advanceBranch.x) + 1, height: Math.max(branch.y, advanceBranch.y) + 1});
    fork.agents[author.agentId]!.x = branch.x;
    fork.agents[author.agentId]!.y = branch.y;
    fork.agents[advancer.agentId]!.x = advanceBranch.x;
    fork.agents[advancer.agentId]!.y = advanceBranch.y;
    const precomputed = await prepared(fork, author.agentId, author);
    const advancing = await prepared(fork, advancer.agentId, advancer);
    const advanced = transition(fork, advancer.agentId, "advance-parent", advancing.command, advancing.argumentsValue);
    expect(advanced.status).toBe("applied");
    if (advanced.status !== "applied") return;
    const currentCommand = Object.values(buildObservation(advanced.state, author.agentId)!.commands).find((item) => item.type === "research")!;
    const staleParent = transition(advanced.state, author.agentId, "stale-parent-copy", currentCommand, precomputed.argumentsValue);
    expect(staleParent.status).toBe("rejected");
    expect(worldSupplyObservation(staleParent.state)!.issued_supply).toBe(1);
  }, 30_000);

  it("requires one complete new partition per unit until a finite branch is exhausted", async () => {
    const identity = await createIdentity();
    const branch = worldResourceBranch(1);
    expect(branch.amount).toBe(2);
    let state = expandWorldForPopulation(createWorld("finite-branch", [{id: identity.agentId, x: 0, y: 0, energy: 5, inventory: {}}]), 1, {width: branch.x + 1, height: branch.y + 1});
    state.agents[identity.agentId]!.x = branch.x;
    state.agents[identity.agentId]!.y = branch.y;
    const contributionIds = new Set<string>();
    for (let expectedUnit = 0; expectedUnit < branch.amount; expectedUnit += 1) {
      const work = await prepared(state, identity.agentId, identity);
      expect(work.branch.unit_index).toBe(expectedUnit);
      expect(contributionIds.has(work.argumentsValue.record_id)).toBe(false);
      contributionIds.add(work.argumentsValue.record_id);
      const outcome = transition(state, identity.agentId, `unit-${expectedUnit}`, work.command, work.argumentsValue);
      expect(outcome.status).toBe("applied");
      if (outcome.status !== "applied") return;
      state = outcome.state;
      expect(worldSupplyObservation(state)!.issued_supply).toBe(expectedUnit + 1);
      expect(state.agents[identity.agentId]!.inventory[branch.kind]).toBe(expectedUnit + 1);
    }
    const finalObservation = buildObservation(state, identity.agentId)!.observation;
    const finalResource = finalObservation.nearby.find((item) => item.type === "resource" && item.id === branch.resource_id);
    expect(finalResource).toBeUndefined();
    expect(finalObservation.legal_actions.some((item) => item.type === "research" && item.target === branch.resource_id)).toBe(false);
    expect(worldSupplyObservation(state)!.settled_branch_count).toBe(1);
    expect(worldSupplyObservation(state)!.verified_new_canonical_candidates).toBe(String(branch.amount * 65_536));
  }, 30_000);

  it("binds branch capacity to genesis while every settlement remains one verified research unit", () => {
    for (const ordinal of [0, 1, 2 ** 20, 2 ** 23, 2 ** 24 - 1]) {
      const branch = worldResourceBranch(ordinal);
      expect(branch.amount).toBe(branch.stratum);
      expect(branch.amount).toBeGreaterThanOrEqual(1);
      expect(branch.amount).toBeLessThanOrEqual(32);
      expect(branch.labs_branch.resource_amount).toBe(branch.amount);
      expect(branch.labs_branch.reward_amount).toBe(1);
      expect(branch.labs_branch.unit_index).toBe(0);
      expect(branch.labs_branch.candidates_per_unit).toBe(65_536);
      expect(branch.labs_branch.branch_ordinal).toBe(ordinal);
    }
  });
});

function visibleRemaining(state: RegionState, resourceId: string): number | undefined {
  const agentId = Object.keys(state.agents)[0]!;
  const item = buildObservation(state, agentId)?.observation.nearby.find((candidate) => candidate.type === "resource" && candidate.id === resourceId);
  return item?.type === "resource" ? item.remaining : undefined;
}
