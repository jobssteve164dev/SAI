import {describe, expect, it} from "vitest";
import {
  REFERENCE_FRONTIER,
  REFERENCE_RESULTS,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  addResultToFrontier,
  canonicalLabsSequence,
  createClaimBody,
  createInitialFrontier,
  createLabsResult,
  exactMeritFactor,
  labsCanonicalJson,
  labsContentId,
  labsEnergy,
  labsResourceId,
  labsResourceSummary,
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
  referenceResources,
  referenceResult,
  referenceRulesetId,
  referenceSymmetries,
} from "../../reference/labs-reference.mjs";

function syntheticRuleset(): LabsRuleset {
  const sequence = canonicalLabsSequence("00000000000");
  const energy = labsEnergy(sequence).toString();
  return {
    ...REFERENCE_RULESET,
    name: "LABS conformance fixture",
    summary: "A deliberately weak public baseline used only by deterministic conformance tests.",
    baselines: [{length: 11, sequence, energy, resource_multiplier: "2", resource_cap: (BigInt(energy) * 2n).toString(), source: {title: "Deterministic conformance fixture", authors: ["SAI contributors"], publication: "SAI LABS test vectors", url: "https://social.szlk.ai/labs/v1"}}],
  };
}

function id(seed: string): string { return labsContentId({seed}); }

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

  it("unlocks fork-local public resources monotonically, without duplication or overflow", () => {
    const ruleset = syntheticRuleset();
    const initial = createInitialFrontier(ruleset, "fork:resource-test");
    const improved = createLabsResult(ruleset, "00011101101");
    const advanced = addResultToFrontier(initial, improved.result, improved.result_id);
    const first = labsResourceSummary(ruleset, advanced);
    const repeated = labsResourceSummary(ruleset, mergeLabsFrontiers(advanced, advanced));
    expect(BigInt(first.total_unlocked)).toBeGreaterThan(0n);
    expect(repeated).toEqual(first);
    expect(BigInt(first.total_unlocked)).toBeLessThanOrEqual(BigInt(first.total_cap));
    expect(labsResourceId(ruleset, advanced, 11, improved.result.energy, "0")).toBe(labsResourceId(ruleset, advanced, 11, improved.result.energy, "0"));
    expect(labsResourceSummary(ruleset, initial).total_unlocked).toBe("0");
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

  it("matches the independent implementation byte for byte", () => {
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
    const production = labsResourceSummary(REFERENCE_RULESET, REFERENCE_FRONTIER);
    expect(referenceResources(REFERENCE_RULESET, REFERENCE_FRONTIER)).toEqual({by_length: Object.fromEntries(Object.entries(production.by_length).map(([length, value]) => [length, value.unlocked])), total_unlocked: production.total_unlocked});
  });

  it("rejects forged energy, oversized input, worse-than-baseline spam, and malicious frontiers", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const record = REFERENCE_RESULTS["451"]!;
    expect(() => verifyLabsResult(REFERENCE_RULESET, {...record.result, energy: "0"})).toThrow("能量不匹配");
    expect(() => verifyLabsResult(REFERENCE_RULESET, {...record.result, server_sequence: 1} as typeof record.result)).toThrow("schema 无效");
    expect(() => labsEnergy("0".repeat(4097))).toThrow("长度不能超过");
    const worse = createLabsResult(REFERENCE_RULESET, "0".repeat(451));
    await expect(repository.ingest("result", worse.result, worse.result_id)).rejects.toThrow("只接受达到规则集公开基线");
    const bundle = await repository.bundle();
    const forged: LabsExchangeBundle = structuredClone(bundle);
    forged.frontier.lengths[451] = {best_energy: "0", result_ids: [record.result_id]};
    await expect(repository.importBundle(forged)).rejects.toThrow("前沿与结果正文不一致");
    await expect(repository.importBundle({...bundle, received_at: "now"} as LabsExchangeBundle)).rejects.toThrow("结构无效");
    await expect(repository.importBundle({...bundle, objects: Array.from({length: 513}, () => bundle.objects[0]!) })).rejects.toThrow("交换包无效或过大");
  });
});
