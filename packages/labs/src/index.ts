import {createHash, createPrivateKey, createPublicKey, sign, verify, type JsonWebKey} from "node:crypto";
import {agentIdFromJwk, type AgentIdentity} from "../../identity/src/index.js";
import {assertLabsClaim, assertLabsFrontier, assertLabsResult, assertLabsRuleset, assertLabsWorldBranch} from "./validation.js";

export const LABS_RULESET_PROTOCOL = "sai-labs-ruleset/2" as const;
export const LABS_RESULT_PROTOCOL = "sai-labs-result/1" as const;
export const LABS_CLAIM_PROTOCOL = "sai-labs-claim/1" as const;
export const LABS_FRONTIER_PROTOCOL = "sai-labs-frontier/1" as const;
export const LABS_MAX_OBJECT_BYTES = 131_072;
export const LABS_MAX_SEQUENCE_LENGTH = 4_096;
export const LEGACY_REFERENCE_FORK_ID = "fork:sai-public-world-1";
export const PREVIOUS_REFERENCE_FORK_ID = "fork:sai-emission-world-1";
export const REFERENCE_FORK_ID = "fork:sai-strata-world-1";

export type LabsClaimType = "discovery" | "reproduction" | "relay";

export interface LabsSource {
  title: string;
  authors: string[];
  publication: string;
  url: string;
}

export interface LabsBaseline {
  length: number;
  sequence: string;
  energy: string;
  source: LabsSource;
}

export interface LabsRuleset {
  protocol: typeof LABS_RULESET_PROTOCOL;
  name: string;
  summary: string;
  objective: "minimize_aperiodic_autocorrelation_energy";
  sequence_alphabet: "binary_pm1";
  symmetry: "complement_reverse_alternating_group_8";
  energy_formula: "sum_k_1_to_L_minus_1(sum_i_1_to_L_minus_k(s_i*s_i_plus_k))^2";
  merit_factor_formula: "L^2/(2E)";
  max_object_bytes: number;
  max_sequence_length: number;
  baselines: LabsBaseline[];
}

export interface LabsResult {
  protocol: typeof LABS_RESULT_PROTOCOL;
  ruleset_id: string;
  length: number;
  sequence: string;
  energy: string;
}

export interface LabsClaimBody {
  protocol: typeof LABS_CLAIM_PROTOCOL;
  result_id: string;
  agent_id: string;
  claim_type: LabsClaimType;
  evidence_ids: string[];
}

export interface LabsSignedClaim {
  claim: LabsClaimBody;
  public_jwk: JsonWebKey;
  signature: string;
}

export interface LabsFrontierEntry {
  best_energy: string;
  result_ids: string[];
}

export interface LabsFrontier {
  protocol: typeof LABS_FRONTIER_PROTOCOL;
  ruleset_id: string;
  fork_id: string;
  lengths: Record<string, LabsFrontierEntry>;
}

export interface LabsWorldBranch {
  protocol: "sai-labs-world-branch/3";
  branch_id: string;
  economic_network_id: string;
  schedule_id: string;
  branch_ordinal: number;
  resource_id: string;
  resource_kind: string;
  resource_amount: number;
  x: number;
  y: number;
  stratum: number;
  ruleset_id: string;
  length: number;
  energy_at_most: string;
  sequence_prefix: string;
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("LABS canonical JSON 只允许安全整数");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) output[key] = normalize(record[key]);
    }
    return output;
  }
  throw new TypeError(`LABS canonical JSON 不支持 ${typeof value}`);
}

export function labsCanonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function labsContentId(value: unknown): string {
  return `sha256:${createHash("sha256").update(labsCanonicalJson(value)).digest("hex")}`;
}

export function labsObjectBytes(value: unknown): number {
  return Buffer.byteLength(labsCanonicalJson(value), "utf8");
}

function assertDecimal(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${label} 必须是无前导零的非负十进制整数`);
  return BigInt(value);
}

export function labsEnergy(sequence: string): bigint {
  if (!/^[01]+$/.test(sequence)) throw new TypeError("LABS 序列必须只包含 0 和 1");
  if (sequence.length > LABS_MAX_SEQUENCE_LENGTH) throw new RangeError(`LABS 序列长度不能超过 ${LABS_MAX_SEQUENCE_LENGTH}`);
  let energy = 0n;
  for (let shift = 1; shift < sequence.length; shift += 1) {
    let correlation = 0n;
    for (let index = 0; index < sequence.length - shift; index += 1) {
      correlation += sequence[index] === sequence[index + shift] ? 1n : -1n;
    }
    energy += correlation * correlation;
  }
  return energy;
}

export function labsSymmetries(sequence: string): string[] {
  if (!/^[01]+$/.test(sequence)) throw new TypeError("LABS 序列必须只包含 0 和 1");
  const flip = (bit: string): string => bit === "0" ? "1" : "0";
  const variants: string[] = [];
  for (const reverse of [false, true]) {
    const base = reverse ? [...sequence].reverse().join("") : sequence;
    for (const alternate of [false, true]) {
      const alternated = [...base].map((bit, index) => alternate && index % 2 === 1 ? flip(bit) : bit).join("");
      variants.push(alternated);
      variants.push([...alternated].map(flip).join(""));
    }
  }
  return variants.sort();
}

export function canonicalLabsSequence(sequence: string): string {
  return labsSymmetries(sequence)[0] as string;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function exactMeritFactor(length: number, energy: bigint, digits = 8): {numerator: string; denominator: string; decimal: string} {
  if (!Number.isSafeInteger(length) || length <= 0) throw new RangeError("LABS 长度必须是正安全整数");
  if (energy <= 0n) throw new RangeError("LABS Merit Factor 要求能量大于 0");
  const rawNumerator = BigInt(length) * BigInt(length);
  const rawDenominator = 2n * energy;
  const divisor = gcd(rawNumerator, rawDenominator);
  const numerator = rawNumerator / divisor;
  const denominator = rawDenominator / divisor;
  const scale = 10n ** BigInt(digits);
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  const integer = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0");
  return {numerator: numerator.toString(), denominator: denominator.toString(), decimal: `${integer}.${fraction}`};
}

function assertRuleset(ruleset: LabsRuleset): void {
  assertLabsRuleset(ruleset);
  if (ruleset.protocol !== LABS_RULESET_PROTOCOL || ruleset.objective !== "minimize_aperiodic_autocorrelation_energy") throw new TypeError("不支持的 LABS 规则集");
  if (ruleset.max_object_bytes !== LABS_MAX_OBJECT_BYTES || ruleset.max_sequence_length > LABS_MAX_SEQUENCE_LENGTH) throw new RangeError("LABS 规则集对象上限无效");
  if (labsObjectBytes(ruleset) > ruleset.max_object_bytes) throw new RangeError("LABS 规则集超过对象大小上限");
  const lengths = new Set<number>();
  for (const baseline of ruleset.baselines) {
    if (!Number.isSafeInteger(baseline.length) || baseline.length < 2 || baseline.length > ruleset.max_sequence_length || baseline.sequence.length !== baseline.length) throw new RangeError("LABS 基线长度无效");
    if (lengths.has(baseline.length)) throw new TypeError("LABS 规则集不能重复长度");
    lengths.add(baseline.length);
    if (canonicalLabsSequence(baseline.sequence) !== baseline.sequence) throw new TypeError(`长度 ${baseline.length} 的基线不是规范序列`);
    const energy = assertDecimal(baseline.energy, "baseline.energy");
    if (labsEnergy(baseline.sequence) !== energy) throw new TypeError(`长度 ${baseline.length} 的基线能量不匹配`);
  }
  if (ruleset.baselines.length === 0) throw new TypeError("LABS 规则集至少需要一个基线");
}

export function rulesetId(ruleset: LabsRuleset): string {
  assertRuleset(ruleset);
  return labsContentId(ruleset);
}

export function createLabsResult(ruleset: LabsRuleset, sequence: string): {result: LabsResult; result_id: string} {
  assertRuleset(ruleset);
  if (!ruleset.baselines.some((item) => item.length === sequence.length)) throw new RangeError("序列长度不属于该 LABS 规则集");
  const canonical = canonicalLabsSequence(sequence);
  const result: LabsResult = {protocol: LABS_RESULT_PROTOCOL, ruleset_id: rulesetId(ruleset), length: canonical.length, sequence: canonical, energy: labsEnergy(canonical).toString()};
  if (labsObjectBytes(result) > ruleset.max_object_bytes) throw new RangeError("LABS 结果超过对象大小上限");
  return {result, result_id: labsContentId(result)};
}

export function verifyLabsResult(ruleset: LabsRuleset, result: LabsResult, expectedId?: string): string {
  assertLabsResult(result);
  const id = rulesetId(ruleset);
  if (result.protocol !== LABS_RESULT_PROTOCOL || result.ruleset_id !== id) throw new TypeError("LABS 结果的规则集不匹配");
  if (result.sequence.length !== result.length || !ruleset.baselines.some((item) => item.length === result.length)) throw new RangeError("LABS 结果长度不在规则集内");
  if (canonicalLabsSequence(result.sequence) !== result.sequence) throw new TypeError("LABS 结果序列未规范化");
  if (labsEnergy(result.sequence) !== assertDecimal(result.energy, "result.energy")) throw new TypeError("LABS 结果能量不匹配");
  if (labsObjectBytes(result) > ruleset.max_object_bytes) throw new RangeError("LABS 结果超过对象大小上限");
  const resultId = labsContentId(result);
  if (expectedId && expectedId !== resultId) throw new TypeError("LABS result_id 不匹配");
  return resultId;
}

function normalizedPublicJwk(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new TypeError("LABS 声明只接受 Ed25519 公钥");
  return {crv: "Ed25519", kty: "OKP", x: jwk.x};
}

export function createClaimBody(resultId: string, identity: AgentIdentity, claimType: LabsClaimType, evidenceIds: string[] = []): LabsClaimBody {
  if (!/^sha256:[0-9a-f]{64}$/.test(resultId)) throw new TypeError("LABS result_id 格式无效");
  const uniqueEvidence = [...new Set(evidenceIds)].sort();
  if (uniqueEvidence.some((id) => !/^sha256:[0-9a-f]{64}$/.test(id))) throw new TypeError("LABS evidence_id 格式无效");
  return {protocol: LABS_CLAIM_PROTOCOL, result_id: resultId, agent_id: identity.agentId, claim_type: claimType, evidence_ids: uniqueEvidence};
}

export function signLabsClaim(body: LabsClaimBody, identity: AgentIdentity): {signed_claim: LabsSignedClaim; claim_id: string} {
  if (body.agent_id !== identity.agentId || agentIdFromJwk(identity.publicJwk) !== identity.agentId) throw new TypeError("LABS 声明身份不匹配");
  const signature = sign(null, Buffer.from(labsCanonicalJson(body)), createPrivateKey({key: identity.privateJwk, format: "jwk"})).toString("base64url");
  const signedClaim: LabsSignedClaim = {claim: body, public_jwk: normalizedPublicJwk(identity.publicJwk), signature};
  assertLabsClaim(signedClaim);
  return {signed_claim: signedClaim, claim_id: labsContentId(signedClaim)};
}

export function verifyLabsClaim(signedClaim: LabsSignedClaim, expectedId?: string): string {
  assertLabsClaim(signedClaim);
  const publicJwk = normalizedPublicJwk(signedClaim.public_jwk);
  if (signedClaim.claim.protocol !== LABS_CLAIM_PROTOCOL || signedClaim.claim.agent_id !== agentIdFromJwk(publicJwk)) throw new TypeError("LABS 声明身份不匹配");
  if (!["discovery", "reproduction", "relay"].includes(signedClaim.claim.claim_type)) throw new TypeError("LABS 声明类型无效");
  if (!/^sha256:[0-9a-f]{64}$/.test(signedClaim.claim.result_id)) throw new TypeError("LABS 声明 result_id 无效");
  if (labsObjectBytes(signedClaim) > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 声明超过对象大小上限");
  const valid = verify(null, Buffer.from(labsCanonicalJson(signedClaim.claim)), createPublicKey({key: publicJwk, format: "jwk"}), Buffer.from(signedClaim.signature, "base64url"));
  if (!valid) throw new TypeError("LABS 声明签名无效");
  const claimId = labsContentId(signedClaim);
  if (expectedId && expectedId !== claimId) throw new TypeError("LABS claim_id 不匹配");
  return claimId;
}

function normalizedEntry(entry: LabsFrontierEntry): LabsFrontierEntry {
  const energy = assertDecimal(entry.best_energy, "frontier.best_energy");
  const ids = [...new Set(entry.result_ids)].sort();
  if (ids.length === 0 || ids.some((id) => !/^sha256:[0-9a-f]{64}$/.test(id))) throw new TypeError("LABS 前沿结果集合无效");
  return {best_energy: energy.toString(), result_ids: ids};
}

export function createInitialFrontier(ruleset: LabsRuleset, forkId: string): LabsFrontier {
  if (!/^fork:[A-Za-z0-9._:-]{1,120}$/.test(forkId)) throw new TypeError("LABS fork_id 无效");
  const lengths: Record<string, LabsFrontierEntry> = {};
  for (const baseline of ruleset.baselines) {
    const reference = createLabsResult(ruleset, baseline.sequence);
    lengths[String(baseline.length)] = {best_energy: baseline.energy, result_ids: [reference.result_id]};
  }
  return {protocol: LABS_FRONTIER_PROTOCOL, ruleset_id: rulesetId(ruleset), fork_id: forkId, lengths};
}

export function mergeLabsFrontiers(left: LabsFrontier, right: LabsFrontier): LabsFrontier {
  assertLabsFrontier(left);
  assertLabsFrontier(right);
  if (left.protocol !== LABS_FRONTIER_PROTOCOL || right.protocol !== LABS_FRONTIER_PROTOCOL || left.ruleset_id !== right.ruleset_id || left.fork_id !== right.fork_id) throw new TypeError("只能合并同一规则集、同一分叉的 LABS 前沿");
  const lengths: Record<string, LabsFrontierEntry> = {};
  for (const length of [...new Set([...Object.keys(left.lengths), ...Object.keys(right.lengths)])].sort((a, b) => Number(a) - Number(b))) {
    const a = left.lengths[length];
    const b = right.lengths[length];
    if (!a) lengths[length] = normalizedEntry(b as LabsFrontierEntry);
    else if (!b) lengths[length] = normalizedEntry(a);
    else {
      const ae = assertDecimal(a.best_energy, "frontier.best_energy");
      const be = assertDecimal(b.best_energy, "frontier.best_energy");
      if (ae < be) lengths[length] = normalizedEntry(a);
      else if (be < ae) lengths[length] = normalizedEntry(b);
      else lengths[length] = normalizedEntry({best_energy: a.best_energy, result_ids: [...a.result_ids, ...b.result_ids]});
    }
  }
  return {protocol: LABS_FRONTIER_PROTOCOL, ruleset_id: left.ruleset_id, fork_id: left.fork_id, lengths};
}

export function addResultToFrontier(frontier: LabsFrontier, result: LabsResult, resultId = labsContentId(result)): LabsFrontier {
  if (frontier.ruleset_id !== result.ruleset_id) throw new TypeError("LABS 前沿与结果规则集不匹配");
  const key = String(result.length);
  const current = frontier.lengths[key];
  if (!current) throw new RangeError("LABS 结果长度不在前沿内");
  const candidate: LabsFrontier = {...frontier, lengths: {...frontier.lengths, [key]: {best_energy: result.energy, result_ids: [resultId]}}};
  return mergeLabsFrontiers(frontier, candidate);
}

export function createLabsWorldBranch(ruleset: LabsRuleset, scope: {economic_network_id: string; schedule_id: string; branch_ordinal: number; resource_id: string; resource_kind: string; resource_amount: number; x: number; y: number; stratum: number; length: number; energy_at_most?: string}): LabsWorldBranch {
  const baseline = ruleset.baselines.find((item) => item.length === scope.length);
  if (!baseline) throw new RangeError("LABS 世界分支长度不在规则集内");
  if (!/^network:sha256:[0-9a-f]{64}$/.test(scope.economic_network_id) || !/^sha256:[0-9a-f]{64}$/.test(scope.schedule_id)) throw new TypeError("LABS 世界分支经济网络绑定无效");
  const integers = [scope.branch_ordinal, scope.resource_amount, scope.x, scope.y, scope.stratum];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0) || scope.resource_amount < 1 || scope.stratum < 1 || scope.stratum > 32) throw new RangeError("LABS 世界分支资源参数无效");
  if (!/^resource:world:[0-9]{1,8}$/.test(scope.resource_id) || !/^[a-z][a-z0-9_-]{0,31}$/.test(scope.resource_kind)) throw new TypeError("LABS 世界分支资源身份无效");
  const energyAtMost = assertDecimal(scope.energy_at_most ?? baseline.energy, "energy_at_most");
  if (energyAtMost > BigInt(baseline.energy)) throw new RangeError("LABS 世界分支门槛不能弱于公开基线");
  const variants = labsSymmetries(baseline.sequence);
  const candidate = variants[scope.branch_ordinal % variants.length] as string;
  const prefixLength = Math.min(candidate.length, 32 + (32 - scope.stratum) * 8);
  const body = {
    protocol: "sai-labs-world-branch/3" as const,
    economic_network_id: scope.economic_network_id,
    schedule_id: scope.schedule_id,
    branch_ordinal: scope.branch_ordinal,
    resource_id: scope.resource_id,
    resource_kind: scope.resource_kind,
    resource_amount: scope.resource_amount,
    x: scope.x,
    y: scope.y,
    stratum: scope.stratum,
    ruleset_id: rulesetId(ruleset),
    length: scope.length,
    energy_at_most: energyAtMost.toString(),
    sequence_prefix: candidate.slice(0, prefixLength),
  };
  const branch = {...body, branch_id: labsContentId(body)};
  assertLabsWorldBranch(branch);
  if (labsObjectBytes(branch) > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 世界分支超过对象大小上限");
  return branch;
}

export function verifyLabsWorldSubmission(ruleset: LabsRuleset, branch: LabsWorldBranch, submission: {candidate_sequence: string; result: LabsResult; result_id: string; signed_claim: LabsSignedClaim; claim_id: string}, agentId: string): void {
  assertLabsWorldBranch(branch);
  const expected = createLabsWorldBranch(ruleset, branch);
  if (labsCanonicalJson(expected) !== labsCanonicalJson(branch)) throw new TypeError("LABS 世界分支与当前资源状态不匹配");
  if (submission.candidate_sequence.length !== branch.length || !submission.candidate_sequence.startsWith(branch.sequence_prefix)) throw new TypeError("LABS 序列不属于当前世界分支");
  const created = createLabsResult(ruleset, submission.candidate_sequence);
  if (created.result_id !== submission.result_id || labsCanonicalJson(created.result) !== labsCanonicalJson(submission.result)) throw new TypeError("LABS 世界结算结果与候选序列不匹配");
  if (BigInt(submission.result.energy) > BigInt(branch.energy_at_most)) throw new RangeError("LABS 结果未达到当前世界分支能量门槛");
  verifyLabsResult(ruleset, submission.result, submission.result_id);
  verifyLabsClaim(submission.signed_claim, submission.claim_id);
  if (submission.signed_claim.claim.agent_id !== agentId || submission.signed_claim.claim.result_id !== submission.result_id || submission.signed_claim.claim.claim_type === "relay" || !submission.signed_claim.claim.evidence_ids.includes(branch.branch_id)) throw new TypeError("LABS 世界结算声明的身份、结果或分支绑定无效");
}

function bitsFromHex(hex: string, length: number): string {
  const bits = [...hex].map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, "0")).join("");
  return bits.slice(-length);
}

const REFERENCE_SOURCE: LabsSource = {
  title: "Prioritizing Search Space Regions in the Low Autocorrelation Binary Sequences Problem",
  authors: ["Blaž Pšeničnik", "Borko Bošković", "Jan Popić", "Janez Brest"],
  publication: "arXiv:2607.09688 (2026)",
  url: "https://arxiv.org/abs/2607.09688",
};

function referenceBaseline(length: number, hex: string, energy: string): LabsBaseline {
  const sequence = canonicalLabsSequence(bitsFromHex(hex, length));
  return {length, sequence, energy, source: REFERENCE_SOURCE};
}

export const REFERENCE_RULESET: LabsRuleset = {
  protocol: LABS_RULESET_PROTOCOL,
  name: "SAI LABS Open Records 2026-08",
  summary: "Self-contained public LABS records for lengths 451, 518, and 573; lower exact energy advances an independently mergeable knowledge frontier.",
  objective: "minimize_aperiodic_autocorrelation_energy",
  sequence_alphabet: "binary_pm1",
  symmetry: "complement_reverse_alternating_group_8",
  energy_formula: "sum_k_1_to_L_minus_1(sum_i_1_to_L_minus_k(s_i*s_i_plus_k))^2",
  merit_factor_formula: "L^2/(2E)",
  max_object_bytes: LABS_MAX_OBJECT_BYTES,
  max_sequence_length: LABS_MAX_SEQUENCE_LENGTH,
  baselines: [
    referenceBaseline(451, "7ffffff8003ff03c3831ce6730c1fe0f187c3e133393e85ce798b1c9b9c93d9a6c85eb1b3316b4a592d6a94d3266c935b4b52ab555aaaaaaa", "12625"),
    referenceBaseline(518, "3ffffffe0003ff800fe03f81ec6363839878c6e4b4e5b25998f259934b0330f237234b30b0f399e34999e31e4f0e46c9699292726c5a952a54aa9552aaa5555555", "18463"),
    referenceBaseline(573, "1fffffffc0003ffc01fc07e1c99a136c3c330e64e485e72d9878c7e1276338c5a1e739273639365a1ec932763a56c9699c365e8e4e64b32d2c73a198da56ad5aad552aaad5555555", "22558"),
  ],
};

export const REFERENCE_RULESET_ID = rulesetId(REFERENCE_RULESET);
export const REFERENCE_RESULTS = Object.fromEntries(REFERENCE_RULESET.baselines.map((baseline) => {
  const record = createLabsResult(REFERENCE_RULESET, baseline.sequence);
  return [String(baseline.length), record];
})) as Record<string, {result: LabsResult; result_id: string}>;
export const REFERENCE_FRONTIER = createInitialFrontier(REFERENCE_RULESET, REFERENCE_FORK_ID);
