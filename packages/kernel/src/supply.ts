import {REFERENCE_RULESET, REFERENCE_RULESET_ID, createLabsWorldBranch, verifyLabsWorldSubmission, type LabsWorldBranch} from "../../labs/src/index.js";
import {sha256} from "./canonical.js";
import type {AgentState, EcosystemWorldSupplyState, RegionState, WorldSupplyBlock, WorldSupplyObservation} from "./types.js";

export const WORLD_SUPPLY_PROTOCOL = "sai-world-supply-schedule/2" as const;
export const WORLD_SUPPLY_STATE_PROTOCOL = "sai-world-supply-state/2" as const;
export const WORLD_SUPPLY_BLOCK_PROTOCOL = "sai-world-supply-block/1" as const;
export const WORLD_RESOURCE_TILE_AXIS = 16;
export const WORLD_REWARDED_BRANCH_COUNT = 2 ** 24;
export const WORLD_RESOURCE_STRATA = 32;
export const WORLD_BRANCHES_PER_STRATUM = 2 ** 19;
export const WORLD_SUPPLY_PROOF_BITS = 8;
export const WORLD_MAX_SUPPLY = WORLD_BRANCHES_PER_STRATUM * (WORLD_RESOURCE_STRATA * (WORLD_RESOURCE_STRATA + 1) / 2);
export const WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS = 512;
export const WORLD_SUPPLY_MAX_EXCHANGE_BYTES = 4_194_304;

const ORDINAL_MODULUS = 1n << 24n;
const ORDINAL_MULTIPLIER = 5_939_339n;
const ORDINAL_OFFSET = 11_841_497n;
const POSITION_SEED = "sai-world-strata-position-2026-08";
const RESOURCE_CLASSES = [
  {kind: "crystal", length: 451, energy_at_most: "12625"},
  {kind: "fiber", length: 518, energy_at_most: "18463"},
  {kind: "catalyst", length: 573, energy_at_most: "22558"},
] as const;

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
    stratum_amount_formula: "one_based_stratum" as const,
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

export interface WorldResourceBranch {
  branch_ordinal: number;
  resource_id: string;
  kind: typeof RESOURCE_CLASSES[number]["kind"];
  amount: number;
  x: number;
  y: number;
  stratum: number;
  length: number;
  energy_at_most: string;
  labs_branch: LabsWorldBranch;
}

function assertBranchOrdinal(ordinal: number): void {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= WORLD_REWARDED_BRANCH_COUNT) throw new RangeError("世界资源分支序号超出创世范围");
}

export function permutedWorldBranchOrdinal(ordinal: number): number {
  assertBranchOrdinal(ordinal);
  return Number((BigInt(ordinal) * ORDINAL_MULTIPLIER + ORDINAL_OFFSET) % ORDINAL_MODULUS);
}

export function worldResourceBranch(ordinal: number): WorldResourceBranch {
  assertBranchOrdinal(ordinal);
  const tileX = ordinal % 4_096;
  const tileY = Math.floor(ordinal / 4_096);
  const positionDigest = sha256({algorithm: "sha256_tile_offset", seed: POSITION_SEED, ordinal});
  const x = tileX * WORLD_RESOURCE_TILE_AXIS + (Number.parseInt(positionDigest.slice(0, 2), 16) % WORLD_RESOURCE_TILE_AXIS);
  const y = tileY * WORLD_RESOURCE_TILE_AXIS + (Number.parseInt(positionDigest.slice(2, 4), 16) % WORLD_RESOURCE_TILE_AXIS);
  const permuted = permutedWorldBranchOrdinal(ordinal);
  const stratum = Math.floor(permuted / WORLD_BRANCHES_PER_STRATUM) + 1;
  const resourceClass = RESOURCE_CLASSES[permuted % RESOURCE_CLASSES.length]!;
  const resourceId = `resource:world:${ordinal}`;
  const labsBranch = createLabsWorldBranch(REFERENCE_RULESET, {
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    branch_ordinal: ordinal,
    resource_id: resourceId,
    resource_kind: resourceClass.kind,
    resource_amount: stratum,
    x,
    y,
    stratum,
    length: resourceClass.length,
    energy_at_most: resourceClass.energy_at_most,
  });
  return {branch_ordinal: ordinal, resource_id: resourceId, kind: resourceClass.kind, amount: stratum, x, y, stratum, length: resourceClass.length, energy_at_most: resourceClass.energy_at_most, labs_branch: labsBranch};
}

export function worldResourceAt(x: number, y: number): WorldResourceBranch | undefined {
  if (![x, y].every((value) => Number.isSafeInteger(value) && value >= 0 && value < 65_536)) return undefined;
  const ordinal = Math.floor(y / WORLD_RESOURCE_TILE_AXIS) * 4_096 + Math.floor(x / WORLD_RESOURCE_TILE_AXIS);
  const branch = worldResourceBranch(ordinal);
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
  const integers = [block.height, block.branch_ordinal, block.proof_bits, block.nonce];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0) || block.height < 1 || block.proof_bits !== WORLD_SUPPLY_PROOF_BITS) throw new RangeError("世界资源区块整数参数无效");
  if (!/^sha256:[0-9a-f]{64}$/.test(block.parent_id) || !/^sha256:[0-9a-f]{64}$/.test(block.branch_id) || !/^sha256:[0-9a-f]{64}$/.test(block.result_id) || !/^sha256:[0-9a-f]{64}$/.test(block.claim_id)) throw new TypeError("世界资源区块摘要无效");
}

function assertMinimalProof(block: WorldSupplyBlock): void {
  if (!hasLeadingZeroBits(blockId(block).slice("sha256:".length), block.proof_bits)) throw new TypeError("世界资源区块工作证明不足");
  for (let nonce = 0; nonce < block.nonce; nonce += 1) if (hasLeadingZeroBits(blockId({...block, nonce}).slice("sha256:".length), block.proof_bits)) throw new TypeError("世界资源区块必须使用首个有效 nonce");
}

export type WorldSupplySettlement = Pick<WorldSupplyBlock, "candidate_sequence" | "result" | "result_id" | "signed_claim" | "claim_id">;

export function mineWorldSupplyBlock(state: EcosystemWorldSupplyState, branch: LabsWorldBranch, settlement: WorldSupplySettlement, agentId: string): WorldSupplyBlock {
  assertWorldSupplyChain(state);
  const resource = worldResourceBranch(branch.branch_ordinal);
  if (resource.labs_branch.branch_id !== branch.branch_id) throw new TypeError("世界资源分支与创世公式不匹配");
  if (state.active_chain.some((block) => block.branch_ordinal === branch.branch_ordinal)) throw new Error("resource_branch_already_settled");
  verifyLabsWorldSubmission(REFERENCE_RULESET, branch, settlement, agentId);
  const body = {
    protocol: WORLD_SUPPLY_BLOCK_PROTOCOL,
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    height: state.active_chain.length + 1,
    parent_id: state.active_chain.length ? blockId(state.active_chain.at(-1)!) : WORLD_SUPPLY_SCHEDULE_ID,
    branch_ordinal: branch.branch_ordinal,
    branch_id: branch.branch_id,
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
  const claimed = new Set<number>();
  let parentId = WORLD_SUPPLY_SCHEDULE_ID;
  let issued = 0;
  for (let index = 0; index < state.active_chain.length; index += 1) {
    const block = state.active_chain[index]!;
    assertWorldSupplyBlockShape(block);
    if (block.height !== index + 1 || block.parent_id !== parentId) throw new TypeError("世界资源区块链高度或父摘要不连续");
    if (claimed.has(block.branch_ordinal)) throw new TypeError("同一世界资源分支不能重复结算");
    const resource = worldResourceBranch(block.branch_ordinal);
    if (resource.labs_branch.branch_id !== block.branch_id) throw new TypeError("世界资源区块引用了错误分支");
    verifyLabsWorldSubmission(REFERENCE_RULESET, resource.labs_branch, block, block.agent_id);
    assertMinimalProof(block);
    claimed.add(block.branch_ordinal);
    issued += resource.amount;
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
export function worldSupplyCumulativeWork(state: EcosystemWorldSupplyState): bigint { return BigInt(state.active_chain.length) * (1n << BigInt(WORLD_SUPPLY_PROOF_BITS)); }

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
    inventory[resource.kind] = (inventory[resource.kind] ?? 0) + resource.amount;
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
  const issued = state.supply.active_chain.reduce((sum, block) => sum + worldResourceBranch(block.branch_ordinal).amount, 0);
  const localAgentIds = new Set(Object.keys(state.agents));
  const locallyHeld = Object.entries(balances).filter(([agentId]) => localAgentIds.has(agentId)).reduce((sum, [, inventory]) => sum + Object.values(inventory).reduce((inner, amount) => inner + amount, 0), 0);
  return {
    protocol: "sai-world-supply-observation/2",
    economic_network_id: ECONOMIC_NETWORK_ID,
    schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
    max_supply: WORLD_MAX_SUPPLY,
    reserve_supply: WORLD_MAX_SUPPLY - issued,
    issued_supply: issued,
    locally_held_supply: locallyHeld,
    external_or_in_transit_supply: issued - locallyHeld,
    burned_supply: 0,
    rewarded_branch_count: WORLD_REWARDED_BRANCH_COUNT,
    settled_branch_count: state.supply.active_chain.length,
    remaining_branch_count: WORLD_REWARDED_BRANCH_COUNT - state.supply.active_chain.length,
    strata: WORLD_RESOURCE_STRATA,
    branches_per_stratum: WORLD_BRANCHES_PER_STRATUM,
    active_height: state.supply.active_chain.length,
    active_tip_id: worldSupplyActiveTip(state.supply),
    cumulative_work: worldSupplyCumulativeWork(state.supply).toString(),
    season_reset: false,
  };
}
