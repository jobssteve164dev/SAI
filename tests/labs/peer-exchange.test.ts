import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {startLocalNode, type LocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {canonicalLabsSequence, createLabsResult, labsContentId, labsEnergy, labsResourceSummary, rulesetId, type LabsRuleset} from "../../packages/labs/src/index.js";
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
    protocol: "sai-labs-ruleset/1",
    name: "Partition recovery acceptance fixture",
    summary: "A public deterministic ruleset used to prove direct peer convergence without a reference node.",
    objective: "minimize_aperiodic_autocorrelation_energy",
    sequence_alphabet: "binary_pm1",
    symmetry: "complement_reverse_alternating_group_8",
    energy_formula: "sum_k_1_to_L_minus_1(sum_i_1_to_L_minus_k(s_i*s_i_plus_k))^2",
    merit_factor_formula: "L^2/(2E)",
    resource_kind: "labs-public-research-unit",
    max_object_bytes: 131072,
    max_sequence_length: 4096,
    baselines: [{length: 11, sequence, energy, resource_multiplier: "1", resource_cap: energy, source: {title: "Acceptance fixture", authors: ["SAI contributors"], publication: "SAI LABS public test vector", url: "https://social.szlk.ai/labs/v1"}}],
  };
}

describe("LABS direct exchange", () => {
  it("keeps sai_observe / sai_act as the low-capability Agent path", async () => {
    const participant = await node("agent-path");
    const identity = await createIdentity();
    const bridge = new SaiBridge(participant.url, identity);
    await bridge.register();
    await bridge.connect();
    const observation = await bridge.observe({max_bytes: 32_768});
    expect(observation.research?.topic).toBe("LABS");
    const research = observation.legal_actions.find((action) => action.type === "research")!;
    const baseline = (await bridge.labsRuleset()).ruleset.baselines[0]!;
    const result = await bridge.act({observation_id: observation.observation_id, action_id: research.action_id, arguments: {operation: "publish", sequence: baseline.sequence, claim_type: "reproduction"}, request_id: "labs-observe-act"});
    expect(result.status).toBe("applied");
    await bridge.close();
  });

  it("converges two participants while the reference node is offline and never double-unlocks", async () => {
    const reference = await node("offline-reference");
    const participantA = await node("participant-a");
    const participantB = await node("participant-b");
    const ruleset = exchangeRuleset();
    const id = rulesetId(ruleset);
    const fork = "fork:partition-acceptance";
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
    const once = labsResourceSummary(ruleset, convergedB);
    await syncLabsFromPeer(participantB.labs, participantA.url, id, fork);
    expect(labsResourceSummary(ruleset, await participantB.labs.frontier(id, fork))).toEqual(once);
  });
});

