import {REFERENCE_FORK_ID, REFERENCE_RULESET_ID} from "../../labs/src/index.js";
import {sha256} from "./canonical.js";
import type {AgentState, RegionState, WorldSupplyObservation, WorldSupplyState} from "./types.js";

export const WORLD_SUPPLY_PROTOCOL = "sai-world-supply-schedule/1" as const;
export const WORLD_SUPPLY_INITIAL_SUBSIDY = 8;
export const WORLD_SUPPLY_HALVING_INTERVAL = 2_100;
export const WORLD_SUPPLY_TERMINAL_HEIGHT = 8_400;

export const WORLD_SUPPLY_ALLOCATIONS = [
    {resource_id: "resource-alpha", kind: "crystal", amount: 10_500, x: 1, y: 0, length: 451, energy_at_most: "12625"},
    {resource_id: "resource-beta", kind: "fiber", amount: 10_500, x: 3, y: 3, length: 518, energy_at_most: "18463"},
    {resource_id: "resource-gamma", kind: "catalyst", amount: 10_500, x: 6, y: 6, length: 573, energy_at_most: "22558"},
] as const;

export function createWorldSupplySchedule(worldForkId = REFERENCE_FORK_ID) {
  if (!/^fork:[A-Za-z0-9._:-]{1,120}$/.test(worldForkId)) throw new TypeError("世界分叉标识无效");
  return {
    protocol: WORLD_SUPPLY_PROTOCOL,
    world_fork_id: worldForkId,
    base_unit: "world_resource_unit" as const,
    initial_subsidy: WORLD_SUPPLY_INITIAL_SUBSIDY,
    halving_interval: WORLD_SUPPLY_HALVING_INTERVAL,
    terminal_height: WORLD_SUPPLY_TERMINAL_HEIGHT,
    season_reset: false as const,
    difficulty_policy: "immutable_public_labs_tiers" as const,
    ruleset_id: REFERENCE_RULESET_ID,
    allocations: WORLD_SUPPLY_ALLOCATIONS,
  };
}

export const WORLD_SUPPLY_SCHEDULE_BODY = createWorldSupplySchedule();

export const WORLD_SUPPLY_SCHEDULE_ID = `sha256:${sha256(WORLD_SUPPLY_SCHEDULE_BODY)}`;

export function worldSupplyScheduleId(worldForkId: string): string {
  return `sha256:${sha256(createWorldSupplySchedule(worldForkId))}`;
}

export function worldSubsidyAtHeight(height: number): number {
  if (!Number.isSafeInteger(height) || height < 0) throw new RangeError("研究高度必须是非负安全整数");
  const epoch = Math.floor(height / WORLD_SUPPLY_HALVING_INTERVAL);
  return epoch >= 4 ? 0 : WORLD_SUPPLY_INITIAL_SUBSIDY / (2 ** epoch);
}

export function worldMaxSupply(): number {
  let total = 0;
  for (let height = 0; height < WORLD_SUPPLY_TERMINAL_HEIGHT; height += WORLD_SUPPLY_HALVING_INTERVAL) {
    total += worldSubsidyAtHeight(height) * WORLD_SUPPLY_HALVING_INTERVAL;
  }
  return total;
}

export const WORLD_MAX_SUPPLY = worldMaxSupply();

export function worldIssuedAtHeight(height: number): number {
  if (!Number.isSafeInteger(height) || height < 0) throw new RangeError("研究高度必须是非负安全整数");
  const bounded = Math.min(height, WORLD_SUPPLY_TERMINAL_HEIGHT);
  let issued = 0;
  for (let cursor = 0; cursor < bounded;) {
    const epochEnd = Math.min(bounded, (Math.floor(cursor / WORLD_SUPPLY_HALVING_INTERVAL) + 1) * WORLD_SUPPLY_HALVING_INTERVAL);
    issued += (epochEnd - cursor) * worldSubsidyAtHeight(cursor);
    cursor = epochEnd;
  }
  return issued;
}

export function createWorldSupplyState(worldForkId = REFERENCE_FORK_ID): WorldSupplyState {
  const scheduleId = worldSupplyScheduleId(worldForkId);
  return {protocol: "sai-world-supply-state/1", schedule_id: scheduleId, research_height: 0, previous_settlement_id: scheduleId};
}

export function assertForkScopedSupplyImportAllowed(state: RegionState, agent: AgentState): void {
  if (!state.supply) return;
  const carriesForkSupply = Object.entries(agent.inventory).some(([kind, amount]) => amount > 0 && WORLD_SUPPLY_ALLOCATIONS.some((allocation) => allocation.kind === kind));
  if (carriesForkSupply) throw new Error("fork_scoped_supply_requires_world_proof");
}

export function worldSupplyObservation(state: RegionState): WorldSupplyObservation | undefined {
  if (!state.supply) return undefined;
  const reserve = WORLD_SUPPLY_ALLOCATIONS.reduce((sum, allocation) => sum + (state.resources[allocation.resource_id]?.remaining ?? 0), 0);
  const issued = worldIssuedAtHeight(state.supply.research_height);
  const locallyHeld = Object.values(state.agents).reduce((sum, agent) => sum + Object.entries(agent.inventory)
    .filter(([kind]) => WORLD_SUPPLY_ALLOCATIONS.some((allocation) => allocation.kind === kind))
    .reduce((inventorySum, [, amount]) => inventorySum + amount, 0), 0);
  const subsidy = worldSubsidyAtHeight(state.supply.research_height);
  const nextHalving = subsidy === 0 ? null : Math.min(WORLD_SUPPLY_TERMINAL_HEIGHT, (Math.floor(state.supply.research_height / WORLD_SUPPLY_HALVING_INTERVAL) + 1) * WORLD_SUPPLY_HALVING_INTERVAL);
  return {
    protocol: "sai-world-supply-observation/1",
    schedule_id: state.supply.schedule_id,
    world_fork_id: state.world_fork_id,
    max_supply: WORLD_MAX_SUPPLY,
    reserve_supply: reserve,
    issued_supply: issued,
    locally_held_supply: locallyHeld,
    external_or_in_transit_supply: Math.max(0, issued - locallyHeld),
    burned_supply: 0,
    research_height: state.supply.research_height,
    current_subsidy: subsidy,
    next_halving_height: nextHalving,
    remaining_to_halving: nextHalving === null ? 0 : nextHalving - state.supply.research_height,
    terminal_height: WORLD_SUPPLY_TERMINAL_HEIGHT,
    season_reset: false,
  };
}
