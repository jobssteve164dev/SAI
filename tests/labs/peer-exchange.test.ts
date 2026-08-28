import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {startLocalNode, type LocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {canonicalLabsSequence, createClaimBody, createLabsResult, labsContentId, labsEnergy, labsSymmetries, rulesetId, signLabsClaim, type LabsRuleset} from "../../packages/labs/src/index.js";
import {syncLabsFromPeer} from "../../packages/labs/src/store.js";

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
    baselines: [{length: 11, sequence, energy, source: {title: "Acceptance fixture", authors: ["SAI contributors"], publication: "SAI LABS public test vector", url: "https://social.szlk.ai/labs/v1"}}],
  };
}

describe("LABS direct exchange", () => {
  it("keeps sai_observe / sai_act as the low-capability Agent path", async () => {
    const participant = await node("agent-path");
    const identity = await createIdentity();
    const bridge = new SaiBridge(participant.url, identity);
    await bridge.register();
    await bridge.connect();
    let observation = await bridge.observe({max_bytes: 32_768});
    while (observation.self.x !== 1 || observation.self.y !== 0) {
      const direction = observation.self.x > 1 ? "west" : observation.self.x < 1 ? "east" : "north";
      const move = observation.legal_actions.find((action) => action.type === "move" && action.direction === direction) ?? observation.legal_actions.find((action) => action.type === "wait")!;
      await bridge.act({observation_id: observation.observation_id, action_id: move.action_id, request_id: `move-${observation.cursor}-${direction}`});
      observation = await bridge.observe({max_bytes: 32_768});
    }
    if (!observation.legal_actions.some((action) => action.type === "research")) {
      const wait = observation.legal_actions.find((action) => action.type === "wait")!;
      await bridge.act({observation_id: observation.observation_id, action_id: wait.action_id, request_id: `rest-${observation.cursor}`});
      observation = await bridge.observe({max_bytes: 32_768});
    }
    const research = observation.legal_actions.find((action) => action.type === "research")!;
    expect(research).toBeDefined();
    const baseline = (await bridge.labsRuleset()).ruleset.baselines[0]!;
    const resource = observation.nearby.find((item) => item.type === "resource" && item.id === research.target)!;
    const sequence = labsSymmetries(baseline.sequence).find((candidate) => candidate.startsWith(resource.type === "resource" ? resource.labs_branch!.sequence_prefix : ""))!;
    const before = participant.region.currentState();
    const result = await bridge.act({observation_id: observation.observation_id, action_id: research.action_id, arguments: {operation: "solve_branch", sequence, claim_type: "reproduction"}, request_id: "labs-observe-act"});
    expect(result.status).toBe("applied");
    const after = participant.region.currentState();
    expect(after.resources[research.target!]!.remaining).toBe(before.resources[research.target!]!.remaining - 8);
    expect(after.agents[identity.agentId]!.inventory.crystal).toBe(8);
    expect(Object.values(after.resources).reduce((sum, item) => sum + item.remaining, 0) + Object.values(after.agents).reduce((sum, item) => sum + Object.values(item.inventory).reduce((total, value) => total + value, 0), 0)).toBe(Object.values(before.resources).reduce((sum, item) => sum + item.remaining, 0) + Object.values(before.agents).reduce((sum, item) => sum + Object.values(item.inventory).reduce((total, value) => total + value, 0), 0));
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

  it("serializes two simultaneous submissions for the same finite resource branch", async () => {
    const participant = await node("concurrent-world");
    const a = await createIdentity();
    const b = await createIdentity();
    await participant.region.importAgent({id: a.agentId, x: 1, y: 0, energy: 5, inventory: {}});
    await participant.region.importAgent({id: b.agentId, x: 1, y: 0, energy: 5, inventory: {}});

    const prepare = async (identity: typeof a, request_id: string) => {
      const observation = await participant.region.observe(identity.agentId, {max_bytes: 32_768});
      const action = observation.legal_actions.find((item) => item.type === "research")!;
      const resource = observation.nearby.find((item) => item.type === "resource" && item.id === action.target)!;
      if (resource.type !== "resource" || !resource.labs_branch) throw new Error("missing concurrent LABS branch");
      const baseline = (await participant.labs.ruleset(resource.labs_branch.ruleset_id)).baselines.find((item) => item.length === resource.labs_branch!.length)!;
      const candidate_sequence = labsSymmetries(baseline.sequence).find((candidate) => candidate.startsWith(resource.labs_branch!.sequence_prefix))!;
      const {result, result_id} = createLabsResult(await participant.labs.ruleset(resource.labs_branch.ruleset_id), candidate_sequence);
      const {signed_claim, claim_id} = signLabsClaim(createClaimBody(result_id, identity, "reproduction", [resource.labs_branch.branch_id]), identity);
      return {
        agent_id: identity.agentId,
        input: {
          observation_id: observation.observation_id,
          action_id: action.action_id,
          request_id,
          arguments: {operation: "settle_branch", branch_id: resource.labs_branch.branch_id, world_fork_id: resource.labs_branch.world_fork_id, candidate_sequence, result, result_id, signed_claim, claim_id},
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
    expect(state.resources["resource-alpha"]!.remaining).toBe(10_492);
    expect((state.agents[a.agentId]!.inventory.crystal ?? 0) + (state.agents[b.agentId]!.inventory.crystal ?? 0)).toBe(8);
  });
});
