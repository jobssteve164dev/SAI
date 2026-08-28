import {LABS_RESEARCH_CANDIDATES_PER_UNIT, LABS_RESEARCH_RECORD_PROTOCOL, LABS_RESEARCH_TASK_PROTOCOL, REFERENCE_RESULTS, REFERENCE_RULESET, REFERENCE_RULESET_ID, REFERENCE_SEARCH_METHOD_ARTIFACT_ID, createLabsWorldBranch, executeLabsWorldResearch, verifyLabsWorldSubmission, type LabsWorldBranch} from "../../labs/src/index.js";
import {sha256} from "./canonical.js";
import type {AgentState, EcosystemWorldSupplyState, RegionState, WorldSupplyBlock, WorldSupplyObservation} from "./types.js";

export const WORLD_SUPPLY_PROTOCOL = "sai-world-supply-schedule/3" as const;
export const WORLD_SUPPLY_STATE_PROTOCOL = "sai-world-supply-state/3" as const;
export const WORLD_SUPPLY_BLOCK_PROTOCOL = "sai-world-supply-block/2" as const;
export const WORLD_RESOURCE_TILE_AXIS = 16;
export const WORLD_REWARDED_BRANCH_COUNT = 2 ** 24;
export const WORLD_RESOURCE_STRATA = 32;
export const WORLD_BRANCHES_PER_STRATUM = 2 ** 19;
export const WORLD_SUPPLY_PROOF_BITS = 8;
export const WORLD_MAX_SUPPLY = WORLD_BRANCHES_PER_STRATUM * (WORLD_RESOURCE_STRATA * (WORLD_RESOURCE_STRATA + 1) / 2);
export const WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS = 512;
export const WORLD_SUPPLY_MAX_EXCHANGE_BYTES = 4_194_304;
export const LABS_CONFORMANCE_AGENT_ID = "agent:ed25519-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const ORDINAL_MODULUS = 1n << 24n;
const ORDINAL_MULTIPLIER = 5_939_339n;
const ORDINAL_OFFSET = 11_841_497n;
const POSITION_SEED = "sai-world-strata-position-2026-08";
const RESOURCE_CLASSES = [
  {kind: "crystal", length: 451, baseline_energy: "12625"},
  {kind: "fiber", length: 518, baseline_energy: "18463"},
  {kind: "catalyst", length: 573, baseline_energy: "22558"},
] as const;
export const PREVIOUS_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_ID = "sha256:634f2b6e6030d2207330b8c84af8ed95f608445042abcb30f1c55e9623e47e2a";
export const PREVIOUS_ECOSYSTEM_ECONOMIC_NETWORK_ID = `network:${PREVIOUS_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_ID}`;
export const ARCHIVED_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_IDS = Object.freeze([
  PREVIOUS_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_ID,
  "sha256:ba1e35330ba996ff4aa7d1b1bdeb443723d6e331cc9ee324f500c5c5f197f2c1",
]);

export const LEGACY_WORLD_MAX_SUPPLY = 31_500;
export const LEGACY_WORLD_SUPPLY_ALLOCATIONS = [
  {resource_id: "resource-alpha", kind: "crystal", amount: 10_500, x: 1, y: 0, length: 451, energy_at_most: "12625"},
  {resource_id: "resource-beta", kind: "fiber", amount: 10_500, x: 3, y: 3, length: 518, energy_at_most: "18463"},
  {resource_id: "resource-gamma", kind: "catalyst", amount: 10_500, x: 6, y: 6, length: 573, energy_at_most: "22558"},
] as const;
export const WORLD_RESOURCE_KINDS = Object.freeze(RESOURCE_CLASSES.map((item) => item.kind));

export function createWorldSupplySchedule() {
  return {
    protocol: WORLD_SUPPLY_PROTOCOL,
    base_unit: "world_resource_unit" as const,
    world_axis: 65_536,
    world_cells: 2 ** 32,
    resource_tile_axis: WORLD_RESOURCE_TILE_AXIS,
    rewarded_branch_count: WORLD_REWARDED_BRANCH_COUNT,
    strata: WORLD_RESOURCE_STRATA,
    branches_per_stratum: WORLD_BRANCHES_PER_STRATUM,
    branch_capacity_formula: "one_based_stratum" as const,
    settlement_reward_formula: "one_unit_per_verified_unique_research_partition" as const,
    candidates_per_research_unit: LABS_RESEARCH_CANDIDATES_PER_UNIT,
    research_partition_address_bits: 29,
    research_partition_variable_bits: 16,
    research_challenge_bits: 128,
    research_partition_encoding: "xor31_of_branch_ordinal_24bit_and_unit_index_5bit" as const,
    research_challenge_encoding: "sha256_128_of_network_parent_and_claimant" as const,
    research_task_protocol: LABS_RESEARCH_TASK_PROTOCOL,
    research_record_protocol: LABS_RESEARCH_RECORD_PROTOCOL,
    research_method_artifact_id: REFERENCE_SEARCH_METHOD_ARTIFACT_ID,
    cumulative_supply_formula: "2^18*k*(k+1)" as const,
    max_supply: WORLD_MAX_SUPPLY,
    ordinal_permutation: {algorithm: "affine_mod_2^24" as const, multiplier: Number(ORDINAL_MULTIPLIER), offset: Number(ORDINAL_OFFSET)},
    position_formula: {algorithm: "sha256_tile_offset" as const, seed: POSITION_SEED},
    resource_classes: RESOURCE_CLASSES,
    proof_bits: WORLD_SUPPLY_PROOF_BITS,
    fork_choice: "cumulative_work_then_smallest_tip" as const,
    season_reset: false as const,
    ruleset_id: REFERENCE_RULESET_ID,
  };
}

export const WORLD_SUPPLY_SCHEDULE_BODY = createWorldSupplySchedule();
export const WORLD_SUPPLY_SCHEDULE_ID = `sha256:${sha256(WORLD_SUPPLY_SCHEDULE_BODY)}`;
export const ECONOMIC_NETWORK_ID = `network:${WORLD_SUPPLY_SCHEDULE_ID}`;

export const LABS_CONFORMANCE_VECTORS = Object.freeze({
  protocol: "sai-labs-test-vectors/1",
  published_at: "2026-08-28",
  description: "Self-contained byte-conformance inputs and expected outputs for the current contribution-conserving LABS economic protocol.",
  ruleset: {expected_ruleset_id: "sha256:00e98f457d47ed2de88d956987d66c2398bc26da1292fe9d098bc3120a3db621", body: REFERENCE_RULESET},
  baseline_results: Object.values(REFERENCE_RESULTS).map(({result, result_id}) => ({length: result.length, expected_energy: result.energy, expected_result_id: result_id})),
  symmetry: {
    input: "00101100101",
    expected_transforms: ["00001100001", "00101100101", "01011001011", "01111001111", "10000110000", "10100110100", "11010011010", "11110011110"],
    expected_canonical: "00001100001",
  },
  supply_schedule: {
    expected_schedule_id: "sha256:ac510bf401925dc49eab350da013204b47e710f5e3f4bb86152ab0a2ef430ea7",
    expected_economic_network_id: "network:sha256:ac510bf401925dc49eab350da013204b47e710f5e3f4bb86152ab0a2ef430ea7",
    body: WORLD_SUPPLY_SCHEDULE_BODY,
  },
  research_challenge: {economic_parent_id: WORLD_SUPPLY_SCHEDULE_ID, claimant_agent_id: LABS_CONFORMANCE_AGENT_ID},
  research_units: [
    {branch_ordinal: 0, unit_index: 0, length: 573, expected_branch_id: "sha256:3e024b0050b7120c920d7740b1ffddbf85c34274a092fbb4272b6d5a2a8218ca", expected_task_id: "sha256:ed1bd8e3895203f0398ceea125a69659571a09fa4f56c06eeac63cd649b8c09f", expected_coverage_partition_id: "sha256:9f75425d44f67a48600ae7a385abf8d91f69a59ca98266801fd84ed39b344901", expected_coverage_digest: "sha256:5f8c0d961389b7e8e33b545a2e1c8f4bf8714f60fb3bd3fcbb49ce9a2a698146", expected_record_id: "sha256:ccb8fbb15033c74a1242cacbe9a72af4a115a2e8c709ece3af8e4c591a5dc047", expected_result_id: "sha256:b52f19aaefda0fdd867a07d835288a24969834bdaf46ea67113d5b7aeaba7001", expected_best_energy: "109822", expected_energy_delta: "-87264", expected_tied_result_count: 1, expected_tied_result_digest: "sha256:1fb08e03dbed0f4cd344caeb6ed3197ce6915c825fcd6c7c2e8a81a6bbed960c", expected_artifact_id: "sha256:26ab5bc877c548e31c596cc0b405284b92d6ccf1f1b7951a232c74d1245c69e4"},
    {branch_ordinal: 1, unit_index: 0, length: 451, expected_branch_id: "sha256:f1284ac03be71d2a5163ab141e1ae3c006fc4ff5253e606b3ff6c44a08348d18", expected_task_id: "sha256:310ea5a19c906e6055529e8d48e1702eadc061bf98de4169c9b615f94772d13a", expected_coverage_partition_id: "sha256:5eb71982746e8774bca9b2ed0672749f9fdca7b8618241bd58b4489b6cb911b5", expected_coverage_digest: "sha256:b36f79650d9d4600648d66c0f0e7b946d5ed59489b0acc3d965855089b817628", expected_record_id: "sha256:add228f1748a5208b5f67188ff3b090c22f8906d36e9d459cefac980b6826ef5", expected_result_id: "sha256:02626639b60d446b988552bcfd5894680861dd447f3add001607f84e89ab6eb4", expected_best_energy: "80529", expected_energy_delta: "-67904", expected_tied_result_count: 1, expected_tied_result_digest: "sha256:5e2195c2da3bedc18cc1003b4c14b4a7b087f0fb36a8740db5a885ec588ce46c", expected_artifact_id: "sha256:26ab5bc877c548e31c596cc0b405284b92d6ccf1f1b7951a232c74d1245c69e4"},
    {branch_ordinal: 3, unit_index: 0, length: 518, expected_branch_id: "sha256:442d5d1904118e6defae174784347802228b9c689c40f871a6d6d4bfc840e2f6", expected_task_id: "sha256:e46ee8c988f2f0b69b6c9a93705f2ea4b2f003bda237529a1e760b7c7d486124", expected_coverage_partition_id: "sha256:d089417dc8fcf0fa0550f52da982614be6c73d21410125f61570435c930c2c7b", expected_coverage_digest: "sha256:a794a49472da9406bf8ec4bb9168f9a0c703d043cd0ad4cee35604ccabe4a9b7", expected_record_id: "sha256:5ccbaa2468a728e5ebea7b30d0512d8606b00043d815c7f070b1a18dd66fea08", expected_result_id: "sha256:a536b9d77ee6cba0b8326f3a9760e3b611a36d3302981d1897ae8a4c3929635d", expected_best_energy: "109519", expected_energy_delta: "-91056", expected_tied_result_count: 1, expected_tied_result_digest: "sha256:247d70657e34e8135aa4076724dbc4d2e73263d81b864c8abbddf8b661b39d71", expected_artifact_id: "sha256:26ab5bc877c548e31c596cc0b405284b92d6ccf1f1b7951a232c74d1245c69e4"},
  ],
  cumulative_supply: Array.from({length: WORLD_RESOURCE_STRATA + 1}, (_, stratum) => ({stratum, expected_total: WORLD_BRANCHES_PER_STRATUM * stratum * (stratum + 1) / 2})),
});

export interface WorldResourceBranch {
  branch_ordinal: number;
  resource_id: string;
  kind: typeof RESOURCE_CLASSES[number]["kind"];
  amount: number;
  x: number;
  y: number;
  stratum: number;
  length: number;
  baseline_energy: string;
  labs_branch: LabsWorldBranch;
}

function assertBranchOrdinal(ordinal: number): void {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= WORLD_REWARDED_BRANCH_COUNT) throw new RangeError("世界资源分支序号超出创世范围");
}

export function permutedWorldBranchOrdinal(ordinal: number): number {
  assertBranchOrdinal(ordinal);
  return Number((BigInt(ordinal) * ORDINAL_MULTIPLIER + ORDINAL_OFFSET) % ORDINAL_MODULUS);
}

export function worldResourceBranch(ordinal: number, unitIndex = 0): WorldResourceBranch {
  assertBranchOrdinal(ordinal);
  const tileX = ordinal % 4_096;
  const tileY = Math.floor(ordinal / 4_096);
  const positionDigest = sha256({algorithm: "sha256_tile_offset", seed: POSITION_SEED, ordinal});
  const x = tileX * WORLD_RESOURCE_TILE_AXIS + (Number.parseInt(positionDigest.slice(0, 2), 16) % WORLD_RESOURCE_TILE_AXIS);
  const y = tileY * WORLD_RESOURCE_TILE_AXIS + (Number.parseInt(positionDigest.slice(2, 4), 16) % WORLD_RESOURCE_TILE_AXIS);
  const permuted = permutedWorldBranchOrdinal(ordinal);
  const stratum = Math.floor(permuted / WORLD_BRANCHES_PER_STRATUM) + 1;
  if (!Number.isSafeInteger(unitIndex) || unitIndex < 0 || unitIndex >= stratum) throw new RangeError("世界资源研究单位超出分支容量");
  const resourceClass = RESOURCE_CLASSES[permuted % RESOURCE_CLASSES.length]!;
  const resourceId = `resource:world:${ordinal}`;
  const labsBranch = createLabsWorldBranch(REFERENCE_RULESET, {
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    branch_ordinal: ordinal,
    resource_id: resourceId,
    resource_kind: resourceClass.kind,
    resource_amount: stratum,
    unit_index: unitIndex,
    x,
    y,
    stratum,
    length: resourceClass.length,
  });
  return {branch_ordinal: ordinal, resource_id: resourceId, kind: resourceClass.kind, amount: stratum, x, y, stratum, length: resourceClass.length, baseline_energy: resourceClass.baseline_energy, labs_branch: labsBranch};
}

export function worldResourceAt(x: number, y: number, unitIndex = 0): WorldResourceBranch | undefined {
  if (![x, y].every((value) => Number.isSafeInteger(value) && value >= 0 && value < 65_536)) return undefined;
  const ordinal = Math.floor(y / WORLD_RESOURCE_TILE_AXIS) * 4_096 + Math.floor(x / WORLD_RESOURCE_TILE_AXIS);
  const branch = worldResourceBranch(ordinal, unitIndex);
  return branch.x === x && branch.y === y ? branch : undefined;
}

export function worldResourceBranchesInBounds(width: number, height: number, limit = 1_024): WorldResourceBranch[] {
  if (![width, height, limit].every((value) => Number.isSafeInteger(value) && value >= 0) || width > 65_536 || height > 65_536) throw new RangeError("世界资源枚举范围无效");
  const output: WorldResourceBranch[] = [];
  const tilesX = Math.ceil(width / WORLD_RESOURCE_TILE_AXIS);
  const tilesY = Math.ceil(height / WORLD_RESOURCE_TILE_AXIS);
  for (let tileY = 0; tileY < tilesY && output.length < limit; tileY += 1) {
    for (let tileX = 0; tileX < tilesX && output.length < limit; tileX += 1) {
      const branch = worldResourceBranch(tileY * 4_096 + tileX);
      if (branch.x < width && branch.y < height) output.push(branch);
    }
  }
  return output;
}

export function createWorldSupplyState(): EcosystemWorldSupplyState {
  return {protocol: WORLD_SUPPLY_STATE_PROTOCOL, economic_network_id: ECONOMIC_NETWORK_ID, schedule_id: WORLD_SUPPLY_SCHEDULE_ID, active_chain: []};
}

export function worldSupplyUnitKey(branchOrdinal: number, unitIndex: number): string {
  return `${branchOrdinal}:${unitIndex}`;
}

export function worldSupplyClaimedUnits(state: EcosystemWorldSupplyState): Set<string> {
  return new Set(state.active_chain.map((block) => worldSupplyUnitKey(block.branch_ordinal, block.unit_index)));
}

export function worldSupplyNextUnitIndex(state: EcosystemWorldSupplyState, branchOrdinal: number): number | undefined {
  const resource = worldResourceBranch(branchOrdinal);
  const claimed = worldSupplyClaimedUnits(state);
  for (let unitIndex = 0; unitIndex < resource.amount; unitIndex += 1) if (!claimed.has(worldSupplyUnitKey(branchOrdinal, unitIndex))) return unitIndex;
  return undefined;
}

function settledBranchCount(state: EcosystemWorldSupplyState): number {
  const counts = new Map<number, number>();
  for (const block of state.active_chain) counts.set(block.branch_ordinal, (counts.get(block.branch_ordinal) ?? 0) + 1);
  let settled = 0;
  for (const [branchOrdinal, count] of counts) if (count === worldResourceBranch(branchOrdinal).amount) settled += 1;
  return settled;
}

function blockId(block: WorldSupplyBlock): string { return `sha256:${sha256(block)}`; }

export function worldSupplyBlockId(block: WorldSupplyBlock): string {
  assertWorldSupplyBlockShape(block);
  return blockId(block);
}

function hasLeadingZeroBits(hex: string, bits: number): boolean {
  const fullNibbles = Math.floor(bits / 4);
  if (!hex.startsWith("0".repeat(fullNibbles))) return false;
  const remainder = bits % 4;
  if (remainder === 0) return true;
  return Number.parseInt(hex[fullNibbles] ?? "f", 16) < 2 ** (4 - remainder);
}

function assertWorldSupplyBlockShape(block: WorldSupplyBlock): void {
  if (block.protocol !== WORLD_SUPPLY_BLOCK_PROTOCOL || block.economic_network_id !== ECONOMIC_NETWORK_ID || block.schedule_id !== WORLD_SUPPLY_SCHEDULE_ID) throw new TypeError("世界资源区块网络绑定无效");
  const integers = [block.height, block.branch_ordinal, block.unit_index, block.evaluated_candidates, block.reward_amount, block.proof_bits, block.nonce];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0) || block.height < 1 || block.proof_bits !== WORLD_SUPPLY_PROOF_BITS) throw new RangeError("世界资源区块整数参数无效");
  if (block.evaluated_candidates !== LABS_RESEARCH_CANDIDATES_PER_UNIT || block.reward_amount !== 1) throw new RangeError("世界资源区块研究贡献数量无效");
  if (![block.parent_id, block.branch_id, block.task_id, block.record_id, block.coverage_partition_id, block.coverage_digest, block.result_id, block.claim_id].every((value) => /^sha256:[0-9a-f]{64}$/.test(value))) throw new TypeError("世界资源区块摘要无效");
}

function assertMinimalProof(block: WorldSupplyBlock): void {
  if (!hasLeadingZeroBits(blockId(block).slice("sha256:".length), block.proof_bits)) throw new TypeError("世界资源区块工作证明不足");
  for (let nonce = 0; nonce < block.nonce; nonce += 1) if (hasLeadingZeroBits(blockId({...block, nonce}).slice("sha256:".length), block.proof_bits)) throw new TypeError("世界资源区块必须使用首个有效 nonce");
}

export type WorldSupplySettlement = Pick<WorldSupplyBlock, "candidate_sequence" | "result" | "result_id" | "signed_claim" | "claim_id"> & {research_task: import("../../labs/src/index.js").LabsResearchTask; task_id: string; research_record: import("../../labs/src/index.js").LabsResearchRecord; record_id: string; method_artifact: import("../../labs/src/index.js").LabsResearchArtifact; artifact_id: string};

export function mineWorldSupplyBlock(state: EcosystemWorldSupplyState, branch: LabsWorldBranch, settlement: WorldSupplySettlement, agentId: string): WorldSupplyBlock {
  assertWorldSupplyChain(state);
  const resource = worldResourceBranch(branch.branch_ordinal, branch.unit_index);
  if (resource.labs_branch.branch_id !== branch.branch_id) throw new TypeError("世界资源分支与创世公式不匹配");
  if (state.active_chain.some((block) => block.branch_ordinal === branch.branch_ordinal && block.unit_index === branch.unit_index)) throw new Error("resource_research_unit_already_settled");
  const parentId = state.active_chain.length ? blockId(state.active_chain.at(-1)!) : WORLD_SUPPLY_SCHEDULE_ID;
  verifyLabsWorldSubmission(REFERENCE_RULESET, branch, settlement, agentId, parentId);
  const body = {
    protocol: WORLD_SUPPLY_BLOCK_PROTOCOL,
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    height: state.active_chain.length + 1,
    parent_id: parentId,
    branch_ordinal: branch.branch_ordinal,
    unit_index: branch.unit_index,
    branch_id: branch.branch_id,
    task_id: settlement.task_id,
    record_id: settlement.record_id,
    coverage_partition_id: settlement.research_record.coverage_partition_id,
    coverage_digest: settlement.research_record.coverage_digest,
    evaluated_candidates: LABS_RESEARCH_CANDIDATES_PER_UNIT,
    reward_amount: 1 as const,
    agent_id: agentId,
    candidate_sequence: settlement.candidate_sequence,
    result: structuredClone(settlement.result),
    result_id: settlement.result_id,
    signed_claim: structuredClone(settlement.signed_claim),
    claim_id: settlement.claim_id,
    proof_bits: WORLD_SUPPLY_PROOF_BITS,
  } as const;
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce += 1) {
    const block: WorldSupplyBlock = {...body, nonce};
    if (hasLeadingZeroBits(blockId(block).slice("sha256:".length), WORLD_SUPPLY_PROOF_BITS)) return block;
  }
  throw new Error("无法找到世界资源区块工作证明");
}

export function assertWorldSupplyChain(state: EcosystemWorldSupplyState): void {
  if (state.protocol !== WORLD_SUPPLY_STATE_PROTOCOL || state.economic_network_id !== ECONOMIC_NETWORK_ID || state.schedule_id !== WORLD_SUPPLY_SCHEDULE_ID || !Array.isArray(state.active_chain)) throw new TypeError("世界资源经济网络状态无效");
  const claimed = new Set<string>();
  let parentId = WORLD_SUPPLY_SCHEDULE_ID;
  let issued = 0;
  for (let index = 0; index < state.active_chain.length; index += 1) {
    const block = state.active_chain[index]!;
    assertWorldSupplyBlockShape(block);
    if (block.height !== index + 1 || block.parent_id !== parentId) throw new TypeError("世界资源区块链高度或父摘要不连续");
    const unitKey = worldSupplyUnitKey(block.branch_ordinal, block.unit_index);
    if (claimed.has(unitKey)) throw new TypeError("同一世界资源研究单位不能重复结算");
    const resource = worldResourceBranch(block.branch_ordinal, block.unit_index);
    if (resource.labs_branch.branch_id !== block.branch_id) throw new TypeError("世界资源区块引用了错误分支");
    const research = executeLabsWorldResearch(REFERENCE_RULESET, resource.labs_branch, {economic_parent_id: block.parent_id, claimant_agent_id: block.agent_id});
    const submission = {candidate_sequence: block.candidate_sequence, result: block.result, result_id: block.result_id, signed_claim: block.signed_claim, claim_id: block.claim_id, research_task: research.task, task_id: research.task_id, method_artifact: research.artifact, artifact_id: research.artifact_id, research_record: research.record, record_id: research.record_id};
    verifyLabsWorldSubmission(REFERENCE_RULESET, resource.labs_branch, submission, block.agent_id, block.parent_id);
    if (block.task_id !== research.task_id || block.record_id !== research.record_id || block.coverage_partition_id !== research.record.coverage_partition_id || block.coverage_digest !== research.record.coverage_digest) throw new TypeError("世界资源区块没有绑定准确研究贡献");
    assertMinimalProof(block);
    claimed.add(unitKey);
    issued += 1;
    if (issued > WORLD_MAX_SUPPLY) throw new RangeError("世界资源区块链超过永久总量");
    parentId = blockId(block);
  }
}

export function appendWorldSupplyBlock(state: EcosystemWorldSupplyState, block: WorldSupplyBlock): EcosystemWorldSupplyState {
  const next: EcosystemWorldSupplyState = {...structuredClone(state), active_chain: [...state.active_chain, structuredClone(block)]};
  assertWorldSupplyChain(next);
  return next;
}

export function worldSupplyActiveTip(state: EcosystemWorldSupplyState): string { return state.active_chain.length ? blockId(state.active_chain.at(-1)!) : WORLD_SUPPLY_SCHEDULE_ID; }
export function worldSupplyCumulativeWork(state: EcosystemWorldSupplyState): bigint { return BigInt(state.active_chain.length) * BigInt(LABS_RESEARCH_CANDIDATES_PER_UNIT); }

export function mergeWorldSupplyStates(left: EcosystemWorldSupplyState, right: EcosystemWorldSupplyState): EcosystemWorldSupplyState {
  assertWorldSupplyChain(left);
  assertWorldSupplyChain(right);
  const leftWork = worldSupplyCumulativeWork(left);
  const rightWork = worldSupplyCumulativeWork(right);
  const chosen = leftWork > rightWork ? left : rightWork > leftWork ? right : worldSupplyActiveTip(left) <= worldSupplyActiveTip(right) ? left : right;
  return structuredClone(chosen);
}

export function worldSupplyBalances(state: EcosystemWorldSupplyState): Record<string, Record<string, number>> {
  assertWorldSupplyChain(state);
  const balances: Record<string, Record<string, number>> = {};
  for (const block of state.active_chain) {
    const resource = worldResourceBranch(block.branch_ordinal);
    const inventory = balances[block.agent_id] ??= {};
    inventory[resource.kind] = (inventory[resource.kind] ?? 0) + 1;
  }
  return balances;
}

export function reconcileWorldSupplyInventories(state: RegionState): RegionState {
  if (!state.supply || state.supply.protocol !== WORLD_SUPPLY_STATE_PROTOCOL) return structuredClone(state);
  const next = structuredClone(state);
  const balances = worldSupplyBalances(state.supply);
  for (const agent of Object.values(next.agents)) {
    for (const kind of WORLD_RESOURCE_KINDS) delete agent.inventory[kind];
    for (const [kind, amount] of Object.entries(balances[agent.id] ?? {})) agent.inventory[kind] = amount;
  }
  return next;
}

export function assertEcosystemSupplyImportAllowed(state: RegionState, agent: AgentState): void {
  if (!state.supply || state.supply.protocol !== WORLD_SUPPLY_STATE_PROTOCOL) return;
  const expected = worldSupplyBalances(state.supply)[agent.id] ?? {};
  for (const kind of WORLD_RESOURCE_KINDS) if ((agent.inventory[kind] ?? 0) !== (expected[kind] ?? 0)) throw new Error("economic_network_sync_required");
}

export function worldSupplyObservation(state: RegionState): WorldSupplyObservation | undefined {
  if (!state.supply || state.supply.protocol !== WORLD_SUPPLY_STATE_PROTOCOL) return undefined;
  assertWorldSupplyChain(state.supply);
  const balances = worldSupplyBalances(state.supply);
  const issued = state.supply.active_chain.length;
  const localAgentIds = new Set(Object.keys(state.agents));
  const locallyHeld = Object.entries(balances).filter(([agentId]) => localAgentIds.has(agentId)).reduce((sum, [, inventory]) => sum + Object.values(inventory).reduce((inner, amount) => inner + amount, 0), 0);
  return {
    protocol: "sai-world-supply-observation/3",
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    max_supply: WORLD_MAX_SUPPLY,
    reserve_supply: WORLD_MAX_SUPPLY - issued,
    issued_supply: issued,
    locally_held_supply: locallyHeld,
    external_or_in_transit_supply: issued - locallyHeld,
    burned_supply: 0,
    rewarded_branch_count: WORLD_REWARDED_BRANCH_COUNT,
    rewarded_research_unit_count: WORLD_MAX_SUPPLY,
    settled_branch_count: settledBranchCount(state.supply),
    remaining_branch_count: WORLD_REWARDED_BRANCH_COUNT - settledBranchCount(state.supply),
    settled_research_unit_count: issued,
    remaining_research_unit_count: WORLD_MAX_SUPPLY - issued,
    candidates_per_research_unit: LABS_RESEARCH_CANDIDATES_PER_UNIT,
    verified_new_canonical_candidates: (BigInt(issued) * BigInt(LABS_RESEARCH_CANDIDATES_PER_UNIT)).toString(),
    strata: WORLD_RESOURCE_STRATA,
    branches_per_stratum: WORLD_BRANCHES_PER_STRATUM,
    active_height: state.supply.active_chain.length,
    active_tip_id: worldSupplyActiveTip(state.supply),
    cumulative_work: worldSupplyCumulativeWork(state.supply).toString(),
    season_reset: false,
  };
}
