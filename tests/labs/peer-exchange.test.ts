import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {startLocalNode, type LocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {canonicalLabsSequence, createClaimBody, createLabsResult, executeLabsWorldResearch, labsContentId, labsEnergy, rulesetId, signLabsClaim, type LabsRuleset} from "../../packages/labs/src/index.js";
import {syncLabsFromPeer} from "../../packages/labs/src/store.js";
import {WORLD_MAX_SUPPLY, createWorldSupplyState, mergeWorldSupplyStates, syncWorldSupplyFromPeer, worldResourceBranch, worldSupplyActiveTip, worldSupplyObservation} from "../../packages/kernel/src/index.js";

const directories: string[] = [];
const nodes: LocalNode[] = [];

async function node(name: string): Promise<LocalNode> {
  const directory = await mkdtemp(join(tmpdir(), `sai-labs-${name}-`));
  directories.push(directory);
  const started = await startLocalNode({dataDirectory: directory, regionId: name});
  nodes.push(started);
  return started;
}

afterEach(async () => {
  while (nodes.length) await nodes.pop()?.close();
  while (directories.length) await rm(directories.pop()!, {recursive: true, force: true});
});

function exchangeRuleset(): LabsRuleset {
  const sequence = canonicalLabsSequence("00000000000");
  const energy = labsEnergy(sequence).toString();
  return {
    protocol: "sai-labs-ruleset/2",
    name: "Partition recovery acceptance fixture",
    summary: "A public deterministic ruleset used to prove direct peer convergence without a reference node.",
    objective: "minimize_aperiodic_autocorrelation_energy",
    sequence_alphabet: "binary_pm1",
    symmetry: "complement_reverse_alternating_group_8",
    energy_formula: "sum_k_1_to_L_minus_1(sum_i_1_to_L_minus_k(s_i*s_i_plus_k))^2",
    merit_factor_formula: "L^2/(2E)",
    max_object_bytes: 131072,
    max_sequence_length: 4096,
    baselines: [{length: 11, sequence, energy, source: {title: "Acceptance fixture", authors: ["SAI contributors"], publication: "SAI LABS public test vector", url: "https://proofwild.science/labs/v1"}}],
  };
}

describe("LABS direct exchange", () => {
  it("keeps sai_observe / sai_act as the low-capability Agent path", async () => {
    const participant = await node("agent-path");
    const identity = await createIdentity();
    const bridge = new SaiBridge(participant.url, identity);
    await bridge.register();
    await bridge.connect();
    const genesisBranch = worldResourceBranch(0);
    let observation = await bridge.observe({max_bytes: 65_536});
    while (observation.self.x !== genesisBranch.x || observation.self.y !== genesisBranch.y) {
      const direction = observation.self.x > genesisBranch.x ? "west" : observation.self.x < genesisBranch.x ? "east" : observation.self.y > genesisBranch.y ? "north" : "south";
      const move = observation.legal_actions.find((action) => action.type === "move" && action.direction === direction) ?? observation.legal_actions.find((action) => action.type === "wait")!;
      await bridge.act({observation_id: observation.observation_id, action_id: move.action_id, request_id: `move-${observation.cursor}-${direction}`});
      observation = await bridge.observe({max_bytes: 65_536});
    }
    if (!observation.legal_actions.some((action) => action.type === "research")) {
      const wait = observation.legal_actions.find((action) => action.type === "wait")!;
      await bridge.act({observation_id: observation.observation_id, action_id: wait.action_id, request_id: `rest-${observation.cursor}`});
      observation = await bridge.observe({max_bytes: 65_536});
    }
    const research = observation.legal_actions.find((action) => action.type === "research")!;
    expect(research).toBeDefined();
    expect(research.arguments_schema).toEqual({
      type: "object",
      required: ["operation"],
      properties: {
        operation: {const: "run_search"},
        evidence_ids: {type: "array", maxItems: 128, uniqueItems: true, items: {type: "string", pattern: "^sha256:[0-9a-f]{64}$"}},
      },
      additionalProperties: false,
    });
    const resource = observation.nearby.find((item) => item.type === "resource" && item.id === research.target)!;
    const before = worldSupplyObservation(participant.region.currentState())!;
    const result = await bridge.act({observation_id: observation.observation_id, action_id: research.action_id, arguments: {operation: "run_search"}, request_id: "labs-observe-act"});
    expect(result.status).toBe("applied");
    expect(bridge.lastLabsResearch()).toMatchObject({
      contribution_type: expect.stringMatching(/^(search_coverage|frontier_improvement)$/),
      evaluated_candidates: 65_536,
      new_canonical_candidates: 65_536,
      reward_units: 1,
      result_page: expect.stringContaining("/research/sha256%3A"),
      reproducibility_bundle: expect.stringContaining("/labs/v1/results/sha256%3A"),
    });
    const after = participant.region.currentState();
    expect(after.agents[identity.agentId]!.inventory[genesisBranch.kind]).toBe(1);
    const supply = worldSupplyObservation(after)!;
    expect(supply.issued_supply).toBe(before.issued_supply + 1);
    expect(supply.reserve_supply + supply.issued_supply).toBe(WORLD_MAX_SUPPLY);
    await bridge.close();
  });

  it("converges two knowledge participants while the reference node is offline without changing world resources", async () => {
    const reference = await node("offline-reference");
    const participantA = await node("participant-a");
    const participantB = await node("participant-b");
    const ruleset = exchangeRuleset();
    const id = rulesetId(ruleset);
    const fork = "fork:partition-acceptance";
    const worldA = participantA.region.currentState();
    const worldB = participantB.region.currentState();
    await participantA.labs.ingest("ruleset", ruleset, id, fork);
    await participantB.labs.ingest("ruleset", ruleset, id, fork);
    const improved = createLabsResult(ruleset, "00011101101");
    await participantA.labs.ingest("result", improved.result, improved.result_id, fork);
    await reference.close();
    nodes.splice(nodes.indexOf(reference), 1);

    const before = await participantB.labs.frontier(id, fork);
    expect(before.lengths[11]?.best_energy).not.toBe(improved.result.energy);
    const convergedB = await syncLabsFromPeer(participantB.labs, participantA.url, id, fork);
    expect(convergedB.lengths[11]).toEqual({best_energy: improved.result.energy, result_ids: [improved.result_id]});
    const convergedA = await syncLabsFromPeer(participantA.labs, participantB.url, id, fork);
    expect(labsContentId(convergedA)).toBe(labsContentId(convergedB));
    const once = labsContentId(convergedB);
    await syncLabsFromPeer(participantB.labs, participantA.url, id, fork);
    expect(labsContentId(await participantB.labs.frontier(id, fork))).toEqual(once);
    expect(participantA.region.currentState()).toEqual(worldA);
    expect(participantB.region.currentState()).toEqual(worldB);
  });

  it("converges competing economic claims by direct peer exchange while the reference node is offline", async () => {
    const reference = await node("offline-economic-reference");
    const participantA = await node("economic-participant-a");
    const participantB = await node("economic-participant-b");
    const identityA = await createIdentity();
    const identityB = await createIdentity();
    const branch = worldResourceBranch(0);
    await participantA.region.importAgent({id: identityA.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}});
    await participantB.region.importAgent({id: identityB.agentId, x: branch.x, y: branch.y, energy: 5, inventory: {}});
    await reference.close();
    nodes.splice(nodes.indexOf(reference), 1);

    const settle = async (participant: LocalNode, identity: typeof identityA, requestId: string) => {
      const observation = await participant.region.observe(identity.agentId, {max_bytes: 32_768});
      const action = observation.legal_actions.find((item) => item.type === "research")!;
      const resource = observation.nearby.find((item) => item.type === "resource" && item.id === action.target)!;
      if (resource.type !== "resource" || !resource.labs_branch) throw new Error("missing economic acceptance branch");
      const ruleset = await participant.labs.ruleset(resource.labs_branch.ruleset_id);
      const supply = participant.region.currentState().supply;
      if (!supply || supply.protocol !== "sai-world-supply-state/3") throw new Error("missing economic challenge");
      const research = executeLabsWorldResearch(ruleset, resource.labs_branch, {economic_parent_id: worldSupplyActiveTip(supply), claimant_agent_id: identity.agentId});
      const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
      const evidence = [resource.labs_branch.branch_id, research.task_id, research.artifact_id, research.record_id];
      const {signed_claim, claim_id} = signLabsClaim(createClaimBody(research.result_id, identity, claimType, evidence), identity);
      return participant.region.act(identity.agentId, {
        observation_id: observation.observation_id,
        action_id: action.action_id,
        request_id: requestId,
        arguments: {operation: "settle_branch", branch_id: resource.labs_branch.branch_id, economic_network_id: resource.labs_branch.economic_network_id, candidate_sequence: research.candidate_sequence, result: research.result, result_id: research.result_id, signed_claim, claim_id, research_task: research.task, task_id: research.task_id, method_artifact: research.artifact, artifact_id: research.artifact_id, research_record: research.record, record_id: research.record_id},
      });
    };

    expect((await settle(participantA, identityA, "economic-a")).status).toBe("applied");
    expect((await settle(participantB, identityB, "economic-b")).status).toBe("applied");
    expect(worldSupplyObservation(participantA.region.currentState())!.issued_supply).toBe(1);
    expect(worldSupplyObservation(participantB.region.currentState())!.issued_supply).toBe(1);
    const stateA = participantA.region.currentState().supply!;
    const stateB = participantB.region.currentState().supply!;
    if (stateA.protocol !== "sai-world-supply-state/3" || stateB.protocol !== "sai-world-supply-state/3") throw new Error("missing ecosystem supply state");
    const empty = createWorldSupplyState();
    expect(mergeWorldSupplyStates(stateA, stateB)).toEqual(mergeWorldSupplyStates(stateB, stateA));
    expect(mergeWorldSupplyStates(stateA, stateA)).toEqual(stateA);
    expect(mergeWorldSupplyStates(mergeWorldSupplyStates(stateA, stateB), empty)).toEqual(mergeWorldSupplyStates(stateA, mergeWorldSupplyStates(stateB, empty)));

    await syncWorldSupplyFromPeer(participantB.url, participantA.url);
    await syncWorldSupplyFromPeer(participantA.url, participantB.url);
    const supplyA = worldSupplyObservation(participantA.region.currentState())!;
    const supplyB = worldSupplyObservation(participantB.region.currentState())!;
    expect(supplyA.active_tip_id).toBe(supplyB.active_tip_id);
    expect(supplyA.issued_supply).toBe(1);
    expect(supplyB.issued_supply).toBe(1);
    expect(supplyA.settled_branch_count).toBe(0);
    expect(supplyB.settled_branch_count).toBe(0);
    expect(supplyA.settled_research_unit_count).toBe(1);
    expect(supplyB.settled_research_unit_count).toBe(1);
    await syncWorldSupplyFromPeer(participantB.url, participantA.url);
    expect(worldSupplyObservation(participantB.region.currentState())).toEqual(supplyB);
  });

  it("serializes two simultaneous submissions for the same finite resource branch", async () => {
    const participant = await node("concurrent-world");
    const a = await createIdentity();
    const b = await createIdentity();
    const genesisBranch = worldResourceBranch(0);
    await participant.region.importAgent({id: a.agentId, x: genesisBranch.x, y: genesisBranch.y, energy: 5, inventory: {}});
    await participant.region.importAgent({id: b.agentId, x: genesisBranch.x, y: genesisBranch.y, energy: 5, inventory: {}});

    const prepare = async (identity: typeof a, request_id: string) => {
      const observation = await participant.region.observe(identity.agentId, {max_bytes: 32_768});
      const action = observation.legal_actions.find((item) => item.type === "research")!;
      const resource = observation.nearby.find((item) => item.type === "resource" && item.id === action.target)!;
      if (resource.type !== "resource" || !resource.labs_branch) throw new Error("missing concurrent LABS branch");
      const ruleset = await participant.labs.ruleset(resource.labs_branch.ruleset_id);
      const supply = participant.region.currentState().supply;
      if (!supply || supply.protocol !== "sai-world-supply-state/3") throw new Error("missing economic challenge");
      const research = executeLabsWorldResearch(ruleset, resource.labs_branch, {economic_parent_id: worldSupplyActiveTip(supply), claimant_agent_id: identity.agentId});
      const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
      const evidence = [resource.labs_branch.branch_id, research.task_id, research.artifact_id, research.record_id];
      const {signed_claim, claim_id} = signLabsClaim(createClaimBody(research.result_id, identity, claimType, evidence), identity);
      return {
        agent_id: identity.agentId,
        input: {
          observation_id: observation.observation_id,
          action_id: action.action_id,
          request_id,
          arguments: {operation: "settle_branch", branch_id: resource.labs_branch.branch_id, economic_network_id: resource.labs_branch.economic_network_id, candidate_sequence: research.candidate_sequence, result: research.result, result_id: research.result_id, signed_claim, claim_id, research_task: research.task, task_id: research.task_id, method_artifact: research.artifact, artifact_id: research.artifact_id, research_record: research.record, record_id: research.record_id},
        },
      };
    };

    const [preparedA, preparedB] = await Promise.all([prepare(a, "concurrent-a"), prepare(b, "concurrent-b")]);
    const outcomes = await Promise.all([
      participant.region.act(preparedA.agent_id, preparedA.input),
      participant.region.act(preparedB.agent_id, preparedB.input),
    ]);
    expect(outcomes.map((item) => item.status).sort()).toEqual(["applied", "rejected"]);
    const state = participant.region.currentState();
    expect(state.supply?.protocol === "sai-world-supply-state/3" ? state.supply.active_chain.length : -1).toBe(1);
    expect((state.agents[a.agentId]!.inventory[genesisBranch.kind] ?? 0) + (state.agents[b.agentId]!.inventory[genesisBranch.kind] ?? 0)).toBe(1);
  });
});
