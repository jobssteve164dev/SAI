import {describe, expect, it} from "vitest";
import {
  REFERENCE_FRONTIER,
  REFERENCE_RESULTS,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  REFERENCE_SEARCH_METHOD_ARTIFACT,
  REFERENCE_SEARCH_METHOD_ARTIFACT_ID,
  addResultToFrontier,
  canonicalLabsSequence,
  createClaimBody,
  createInitialFrontier,
  createLabsResult,
  createLabsResearchTask,
  createLabsWorldBranch,
  exactMeritFactor,
  executeLabsWorldResearch,
  labsCanonicalJson,
  labsContentId,
  labsEnergy,
  labsResearchAddressCode,
  labsResearchCandidate,
  labsSymmetries,
  mergeLabsFrontiers,
  rulesetId,
  signLabsClaim,
  verifyLabsClaim,
  verifyLabsResult,
  type LabsFrontier,
  type LabsRuleset,
} from "../../packages/labs/src/index.js";
import {LabsRepository, MemoryLabsPersistence, type LabsExchangeBundle} from "../../packages/labs/src/store.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {
  referenceCanonicalJson,
  referenceCanonicalSequence,
  referenceContentId,
  referenceEnergy,
  referenceMergeFrontiers,
  referenceExecuteResearch,
  referenceMergeSupplyStates,
  referenceWorldBranch,
  referenceWorldResource,
  referenceResult,
  referenceRulesetId,
  referenceSymmetries,
  referenceCumulativeSupply,
  referenceSupplyScheduleId,
  referenceSearchMethodArtifact,
  referenceSearchMethodArtifactId,
} from "../../reference/labs-reference.mjs";
import {ECONOMIC_NETWORK_ID, LABS_CONFORMANCE_AGENT_ID, LABS_CONFORMANCE_VECTORS, WORLD_BRANCHES_PER_STRATUM, WORLD_MAX_SUPPLY, WORLD_REWARDED_BRANCH_COUNT, WORLD_RESOURCE_STRATA, WORLD_SUPPLY_SCHEDULE_BODY, WORLD_SUPPLY_SCHEDULE_ID, assertEcosystemSupplyImportAllowed, createWorld, createWorldSupplyState, mergeWorldSupplyStates, validateState, worldResourceBranch} from "../../packages/kernel/src/index.js";

function syntheticRuleset(): LabsRuleset {
  const sequence = canonicalLabsSequence("00000000000");
  const energy = labsEnergy(sequence).toString();
  return {
    ...REFERENCE_RULESET,
    name: "LABS conformance fixture",
    summary: "A deliberately weak public baseline used only by deterministic conformance tests.",
    baselines: [{length: 11, sequence, energy, source: {title: "Deterministic conformance fixture", authors: ["SAI contributors"], publication: "SAI LABS test vectors", url: "https://proofwild.science/labs/v1"}}],
  };
}

function id(seed: string): string { return labsContentId({seed}); }
const CONFORMANCE_CHALLENGE = {economic_parent_id: WORLD_SUPPLY_SCHEDULE_ID, claimant_agent_id: LABS_CONFORMANCE_AGENT_ID};

describe("LABS exact protocol", () => {
  it("recomputes all public 2026 reference records with BigInt", () => {
    expect(REFERENCE_RULESET_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(REFERENCE_RULESET.baselines.map(({length, energy}) => [length, energy])).toEqual([[451, "12625"], [518, "18463"], [573, "22558"]]);
    for (const baseline of REFERENCE_RULESET.baselines) {
      expect(labsEnergy(baseline.sequence).toString()).toBe(baseline.energy);
      expect(REFERENCE_RESULTS[String(baseline.length)]?.result.energy).toBe(baseline.energy);
    }
    expect(exactMeritFactor(451, 12625n)).toEqual({numerator: "203401", denominator: "25250", decimal: "8.05548515"});
  });

  it("generates all eight equivalent transforms and one invariant canonical sequence", () => {
    const sequence = "00101100101";
    const variants = labsSymmetries(sequence);
    expect(variants).toHaveLength(8);
    expect(new Set(variants.map((item) => labsEnergy(item).toString()))).toEqual(new Set([labsEnergy(sequence).toString()]));
    for (const variant of variants) expect(canonicalLabsSequence(variant)).toBe(canonicalLabsSequence(sequence));
  });

  it("does not cross the Number boundary during settlement", () => {
    const energy = labsEnergy("0".repeat(4096));
    expect(typeof energy).toBe("bigint");
    expect(energy).toBe(4095n * 4096n * 8191n / 6n);
    expect(exactMeritFactor(4096, 9_007_199_254_740_993n).denominator).toBe("9007199254740993");
  });

  it("separates result identity from signed authorship and rejects tampering", async () => {
    const identity = await createIdentity();
    const record = REFERENCE_RESULTS["451"]!;
    expect(Object.keys(record.result)).not.toContain("agent_id");
    expect(verifyLabsResult(REFERENCE_RULESET, record.result, record.result_id)).toBe(record.result_id);
    const signed = signLabsClaim(createClaimBody(record.result_id, identity, "reproduction"), identity);
    expect(verifyLabsClaim(signed.signed_claim, signed.claim_id)).toBe(signed.claim_id);
    const tampered = structuredClone(signed.signed_claim);
    tampered.claim.claim_type = "discovery";
    expect(() => verifyLabsClaim(tampered)).toThrow("签名无效");
  });

  it("merges ties commutatively, associatively, and idempotently", () => {
    const base: LabsFrontier = {protocol: "sai-labs-frontier/1", ruleset_id: REFERENCE_RULESET_ID, fork_id: "fork:test", lengths: {451: {best_energy: "12625", result_ids: [id("base")]}}};
    const a: LabsFrontier = {...base, lengths: {451: {best_energy: "12000", result_ids: [id("a")]}}};
    const b: LabsFrontier = {...base, lengths: {451: {best_energy: "12000", result_ids: [id("b")]}}};
    const c: LabsFrontier = {...base, lengths: {451: {best_energy: "11999", result_ids: [id("c")]}}};
    expect(mergeLabsFrontiers(a, b)).toEqual(mergeLabsFrontiers(b, a));
    expect(mergeLabsFrontiers(mergeLabsFrontiers(a, b), c)).toEqual(mergeLabsFrontiers(a, mergeLabsFrontiers(b, c)));
    expect(mergeLabsFrontiers(a, a)).toEqual(a);
    expect(mergeLabsFrontiers(a, b).lengths[451]?.result_ids).toEqual([id("a"), id("b")].sort());
  });

  it("derives an ecosystem-scoped finite-resource branch without minting resources", () => {
    const branch = worldResourceBranch(0).labs_branch;
    const {branch_id: _branchId, ...scope} = branch;
    expect(branch).toEqual(referenceWorldBranch(REFERENCE_RULESET, scope));
    expect(createLabsWorldBranch(REFERENCE_RULESET, {...scope, branch_ordinal: 1}).branch_id).not.toBe(branch.branch_id);
  });

  it("does not import ecosystem supply through migration without its economic proof", () => {
    const state = createWorld("import-boundary");
    expect(() => assertEcosystemSupplyImportAllowed(state, {id: "agent:test", x: 0, y: 0, energy: 5, inventory: {crystal: 1}})).toThrow("economic_network_sync_required");
    expect(() => assertEcosystemSupplyImportAllowed(state, {id: "agent:test", x: 0, y: 0, energy: 5, inventory: {ore: 1}})).not.toThrow();
    state.agents["agent:forged"] = {id: "agent:forged", x: 0, y: 0, energy: 5, inventory: {crystal: 1}};
    expect(() => validateState(state)).toThrow("经济网络不一致");
  });

  it("retains every equal-energy result received concurrently", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const ruleset = syntheticRuleset();
    const ruleset_id = rulesetId(ruleset);
    const fork_id = "fork:concurrent-tie";
    await repository.ingest("ruleset", ruleset, ruleset_id, fork_id);
    const a = createLabsResult(ruleset, "00000000110");
    const b = createLabsResult(ruleset, "00000001001");
    expect(a.result.energy).toBe(b.result.energy);
    expect(a.result_id).not.toBe(b.result_id);
    await Promise.all([
      repository.ingest("result", a.result, a.result_id, fork_id),
      repository.ingest("result", b.result, b.result_id, fork_id),
    ]);
    expect((await repository.frontier(ruleset_id, fork_id)).lengths[11]).toEqual({best_energy: a.result.energy, result_ids: [a.result_id, b.result_id].sort()});
  });

  it("matches the independent implementation byte for byte across every candidate in all three reference lengths", () => {
    expect(referenceRulesetId(LABS_CONFORMANCE_VECTORS.ruleset.body)).toBe(LABS_CONFORMANCE_VECTORS.ruleset.expected_ruleset_id);
    expect(referenceCanonicalJson(REFERENCE_RULESET)).toBe(labsCanonicalJson(REFERENCE_RULESET));
    expect(referenceRulesetId(REFERENCE_RULESET)).toBe(rulesetId(REFERENCE_RULESET));
    for (const baseline of REFERENCE_RULESET.baselines) {
      expect(referenceEnergy(baseline.sequence)).toBe(labsEnergy(baseline.sequence));
      expect(referenceSymmetries(baseline.sequence)).toEqual(labsSymmetries(baseline.sequence));
      expect(referenceCanonicalSequence(baseline.sequence)).toBe(canonicalLabsSequence(baseline.sequence));
      expect(referenceResult(REFERENCE_RULESET, baseline.sequence)).toEqual(createLabsResult(REFERENCE_RULESET, baseline.sequence));
    }
    expect(referenceContentId(REFERENCE_FRONTIER)).toBe(labsContentId(REFERENCE_FRONTIER));
    expect(referenceMergeFrontiers(REFERENCE_FRONTIER, REFERENCE_FRONTIER)).toEqual(mergeLabsFrontiers(REFERENCE_FRONTIER, REFERENCE_FRONTIER));
    expect(referenceSupplyScheduleId(LABS_CONFORMANCE_VECTORS.supply_schedule.body)).toBe(LABS_CONFORMANCE_VECTORS.supply_schedule.expected_schedule_id);
    expect(WORLD_SUPPLY_SCHEDULE_ID).toBe(LABS_CONFORMANCE_VECTORS.supply_schedule.expected_schedule_id);
    expect(ECONOMIC_NETWORK_ID).toBe(LABS_CONFORMANCE_VECTORS.supply_schedule.expected_economic_network_id);
    expect(referenceSymmetries(LABS_CONFORMANCE_VECTORS.symmetry.input)).toEqual(LABS_CONFORMANCE_VECTORS.symmetry.expected_transforms);
    expect(referenceCanonicalSequence(LABS_CONFORMANCE_VECTORS.symmetry.input)).toBe(LABS_CONFORMANCE_VECTORS.symmetry.expected_canonical);
    for (const ordinal of [0, 1, 4_095, 4_096, 1_048_575, WORLD_REWARDED_BRANCH_COUNT - 1]) expect(referenceWorldResource(REFERENCE_RULESET, WORLD_SUPPLY_SCHEDULE_BODY, ordinal)).toEqual(worldResourceBranch(ordinal));
    expect(referenceSearchMethodArtifact).toEqual(REFERENCE_SEARCH_METHOD_ARTIFACT);
    expect(referenceSearchMethodArtifactId).toBe(REFERENCE_SEARCH_METHOD_ARTIFACT_ID);
    for (const vector of LABS_CONFORMANCE_VECTORS.research_units) {
      const branch = worldResourceBranch(vector.branch_ordinal, vector.unit_index).labs_branch;
      const reference = referenceExecuteResearch(REFERENCE_RULESET, branch, CONFORMANCE_CHALLENGE);
      const production = executeLabsWorldResearch(REFERENCE_RULESET, branch, CONFORMANCE_CHALLENGE);
      expect(referenceCanonicalJson(reference)).toBe(labsCanonicalJson(production));
      expect(branch.branch_id).toBe(vector.expected_branch_id);
      expect(production.task_id).toBe(vector.expected_task_id);
      expect(production.record.coverage_partition_id).toBe(vector.expected_coverage_partition_id);
      expect(production.record.coverage_digest).toBe(vector.expected_coverage_digest);
      expect(production.record_id).toBe(vector.expected_record_id);
      expect(production.result_id).toBe(vector.expected_result_id);
      expect(production.record.best_energy).toBe(vector.expected_best_energy);
      expect(production.record.energy_delta).toBe(vector.expected_energy_delta);
      expect(production.record.tied_result_count).toBe(vector.expected_tied_result_count);
      expect(production.record.tied_result_digest).toBe(vector.expected_tied_result_digest);
      expect(production.artifact_id).toBe(vector.expected_artifact_id);
    }
    expect(referenceMergeSupplyStates(createWorldSupplyState(), createWorldSupplyState())).toEqual(mergeWorldSupplyStates(createWorldSupplyState(), createWorldSupplyState()));
    expect(WORLD_MAX_SUPPLY).toBe(276_824_064);
    for (const vector of LABS_CONFORMANCE_VECTORS.cumulative_supply) expect(referenceCumulativeSupply(vector.stratum, WORLD_SUPPLY_SCHEDULE_BODY)).toBe(vector.expected_total);
  }, 60_000);

  it("covers every stratum and unit index with a unique nonzero canonical research partition", () => {
    const representatives = new Map<number, number>();
    for (let ordinal = 0; ordinal < 10_000 && representatives.size < 32; ordinal += 1) {
      const resource = worldResourceBranch(ordinal);
      if (!representatives.has(resource.stratum)) representatives.set(resource.stratum, ordinal);
    }
    expect(representatives.size).toBe(32);
    const addresses = new Set<number>();
    const partitions = new Set<string>();
    let units = 0;
    for (let stratum = 1; stratum <= 32; stratum += 1) {
      const ordinal = representatives.get(stratum)!;
      for (let unitIndex = 0; unitIndex < stratum; unitIndex += 1) {
        const branch = worldResourceBranch(ordinal, unitIndex).labs_branch;
        const {task} = createLabsResearchTask(REFERENCE_RULESET, branch, CONFORMANCE_CHALLENGE);
        const address = labsResearchAddressCode(ordinal, unitIndex);
        expect(address).not.toBe(0);
        expect(addresses.has(address)).toBe(false);
        expect(partitions.has(task.coverage_partition_id)).toBe(false);
        addresses.add(address);
        partitions.add(task.coverage_partition_id);
        units += 1;
      }
      expect(() => worldResourceBranch(ordinal, stratum)).toThrow("超出分支容量");
    }
    expect(units).toBe(32 * 33 / 2);
    for (const [ordinal, unitIndex] of [[0, 0], [0, 22], [1, 0], [1, 1], [3, 0], [3, 24]] as const) {
      const {task} = createLabsResearchTask(REFERENCE_RULESET, worldResourceBranch(ordinal, unitIndex).labs_branch, CONFORMANCE_CHALLENGE);
      for (const mask of [0, 1, 65_535]) {
        const candidate = labsResearchCandidate(task, mask);
        expect(canonicalLabsSequence(candidate)).toBe(candidate);
      }
    }
  });

  it("changes the actual candidate partition when the economic parent or claimant changes", () => {
    const branch = worldResourceBranch(0).labs_branch;
    const otherAgent = "agent:ed25519-v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const otherParent = labsContentId({parent: "next"});
    const base = createLabsResearchTask(REFERENCE_RULESET, branch, CONFORMANCE_CHALLENGE);
    const claimantChanged = createLabsResearchTask(REFERENCE_RULESET, branch, {...CONFORMANCE_CHALLENGE, claimant_agent_id: otherAgent});
    const parentChanged = createLabsResearchTask(REFERENCE_RULESET, branch, {...CONFORMANCE_CHALLENGE, economic_parent_id: otherParent});
    expect(new Set([base.task_id, claimantChanged.task_id, parentChanged.task_id]).size).toBe(3);
    expect(new Set([base.task.coverage_partition_id, claimantChanged.task.coverage_partition_id, parentChanged.task.coverage_partition_id]).size).toBe(3);
    expect(base.task.challenge_bits).not.toBe(claimantChanged.task.challenge_bits);
    expect(base.task.challenge_bits).not.toBe(parentChanged.task.challenge_bits);
    expect(labsResearchCandidate(base.task, 0)).not.toBe(labsResearchCandidate(claimantChanged.task, 0));
    expect(labsResearchCandidate(base.task, 0)).not.toBe(labsResearchCandidate(parentChanged.task, 0));
  });

  it("derives its own exact permanent supply from finite geography and 32 strata", () => {
    expect(WORLD_REWARDED_BRANCH_COUNT).toBe(2 ** 24);
    expect(WORLD_BRANCHES_PER_STRATUM).toBe(2 ** 19);
    expect(WORLD_RESOURCE_STRATA).toBe(32);
    let previous = 0;
    for (let stratum = 0; stratum <= WORLD_RESOURCE_STRATA; stratum += 1) {
      const total = referenceCumulativeSupply(stratum, WORLD_SUPPLY_SCHEDULE_BODY);
      expect(total).toBe(WORLD_BRANCHES_PER_STRATUM * stratum * (stratum + 1) / 2);
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
    expect(previous).toBe(WORLD_MAX_SUPPLY);
    expect(WORLD_SUPPLY_SCHEDULE_BODY.season_reset).toBe(false);
  });

  it("rejects forged energy, oversized input, worse-than-baseline spam, and malicious frontiers", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const record = REFERENCE_RESULTS["451"]!;
    expect(() => verifyLabsResult(REFERENCE_RULESET, {...record.result, energy: "0"})).toThrow("能量不匹配");
    expect(() => verifyLabsResult(REFERENCE_RULESET, {...record.result, server_sequence: 1} as typeof record.result)).toThrow("schema 无效");
    expect(() => labsEnergy("0".repeat(4097))).toThrow("长度不能超过");
    const worse = createLabsResult(REFERENCE_RULESET, "0".repeat(451));
    await expect(repository.ingest("result", worse.result, worse.result_id)).rejects.toThrow("必须由完整可复现研究记录引用");
    const bundle = await repository.bundle();
    const forged: LabsExchangeBundle = structuredClone(bundle);
    forged.frontier.lengths[451] = {best_energy: "0", result_ids: [record.result_id]};
    await expect(repository.importBundle(forged)).rejects.toThrow("前沿与结果正文不一致");
    await expect(repository.importBundle({...bundle, received_at: "now"} as LabsExchangeBundle)).rejects.toThrow("结构无效");
    await expect(repository.importBundle({...bundle, objects: Array.from({length: 513}, () => bundle.objects[0]!) })).rejects.toThrow("交换包无效或过大");
  });
});
