import {compactId, sha256} from "./canonical.js";
import {
  REFERENCE_FORK_ID,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  STRATA_REFERENCE_FORK_ID,
  verifyLabsWorldSubmission,
  type LabsResearchArtifact,
  type LabsResearchRecord,
  type LabsResearchTask,
  type LabsResult,
  type LabsSignedClaim,
} from "../../labs/src/index.js";
import {
  PROTOCOL,
  RULES_VERSION,
  type ActResult,
  type ActionCommand,
  type AgentState,
  type Direction,
  type EconomicSettlementReceipt,
  type Inventory,
  type LegalAction,
  type Observation,
  type ResourceState,
  type RegionState,
  type RejectedResult,
  type Snapshot,
  type StoredObservation,
  type TransitionResult,
} from "./types.js";
import {ARCHIVED_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_IDS, ECONOMIC_NETWORK_ID, LEGACY_WORLD_MAX_SUPPLY, LEGACY_WORLD_SUPPLY_ALLOCATIONS, WORLD_MAX_SUPPLY, WORLD_RESOURCE_KINDS, appendWorldSupplyBlock, assertWorldSupplyChain, createWorldSupplyState, mineWorldSupplyBlock, worldResourceAt, worldResourceBranchesInBounds, worldSupplyActiveTip, worldSupplyBalances, worldSupplyBlockId, worldSupplyClaimedUnits, worldSupplyNextUnitIndex, worldSupplyUnitKey} from "./supply.js";

const MAX_ENERGY = 10;
export const MAX_WORLD_ADDRESSES = 2 ** 32;
export const MAX_WORLD_AXIS = 2 ** 16;
const INITIAL_WORLD_AXIS = 16;
const MESSAGE_SCHEMA = {
  type: "object",
  required: ["content"],
  properties: {content: {type: "string", minLength: 1, maxLength: 160}},
  additionalProperties: false,
};
const RESEARCH_SCHEMA = {
  type: "object",
  required: ["operation"],
  properties: {
    operation: {const: "run_search"},
    evidence_ids: {type: "array", maxItems: 128, uniqueItems: true, items: {type: "string", pattern: "^sha256:[0-9a-f]{64}$"}},
  },
  additionalProperties: false,
};

export function createWorld(regionId = "local", agents: AgentState[] = [], worldForkId = REFERENCE_FORK_ID): RegionState {
  const state: RegionState = {
    protocol: PROTOCOL,
    rules_version: RULES_VERSION,
    world_fork_id: worldForkId,
    region_id: regionId,
    event_seq: 0,
    logical_tick: 0,
    width: INITIAL_WORLD_AXIS,
    height: INITIAL_WORLD_AXIS,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, structuredClone(agent)])),
    resources: {},
    supply: createWorldSupplyState(),
    messages: [],
  };
  validateState(state);
  return state;
}

export function upgradeWorldForLabs(state: RegionState): RegionState {
  const next = structuredClone(state);
  const archivedContributionNetwork = next.supply?.protocol === "sai-world-supply-state/3"
    && ARCHIVED_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_IDS.includes(next.supply.schedule_id)
    && next.supply.economic_network_id === `network:${next.supply.schedule_id}`;
  if (next.supply?.protocol === "sai-world-supply-state/2" || archivedContributionNetwork) {
    next.supply = createWorldSupplyState();
    if (next.world_fork_id === STRATA_REFERENCE_FORK_ID) next.world_fork_id = REFERENCE_FORK_ID;
    for (const agent of Object.values(next.agents)) for (const kind of WORLD_RESOURCE_KINDS) delete agent.inventory[kind];
  }
  next.world_fork_id ||= REFERENCE_FORK_ID;
  const bindings: Record<string, {initial_amount: number; length: number; energy_at_most: string}> = next.supply?.protocol === "sai-world-supply-state/1"
    ? Object.fromEntries(LEGACY_WORLD_SUPPLY_ALLOCATIONS.map((allocation) => [allocation.resource_id, {initial_amount: allocation.amount, length: allocation.length, energy_at_most: allocation.energy_at_most}]))
    : {"resource-alpha": {initial_amount: 8, length: 451, energy_at_most: "12625"}, "resource-beta": {initial_amount: 5, length: 518, energy_at_most: "18463"}};
  for (const resource of Object.values(next.resources)) {
    const known = bindings[resource.id];
    resource.initial_amount ??= known?.initial_amount ?? resource.remaining;
    if (known && !resource.labs) resource.labs = {ruleset_id: REFERENCE_RULESET_ID, length: known.length, energy_at_most: known.energy_at_most};
  }
  validateState(next);
  return next;
}

export function worldAddressCapacity(state: Pick<RegionState, "width" | "height">): number {
  return state.width * state.height;
}

export function expandWorldForPopulation(state: RegionState, population: number, minimumDimensions: {width: number; height: number} = {width: 1, height: 1}): RegionState {
  if (!Number.isSafeInteger(population) || population < 0) throw new TypeError("Agent 数量必须是非负安全整数");
  const minimums = [minimumDimensions.width, minimumDimensions.height];
  if (minimums.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new TypeError("世界尺寸要求必须是正安全整数");
  if (population > MAX_WORLD_ADDRESSES || minimums.some((value) => value > MAX_WORLD_AXIS)) throw new Error("world_capacity_exhausted");
  if (worldAddressCapacity(state) >= population && state.width >= minimumDimensions.width && state.height >= minimumDimensions.height) return structuredClone(state);
  let axis = Math.max(INITIAL_WORLD_AXIS, state.width, state.height, minimumDimensions.width, minimumDimensions.height);
  while (axis * axis < population && axis < MAX_WORLD_AXIS) axis *= 2;
  if (axis > MAX_WORLD_AXIS || axis * axis < population) throw new Error("world_capacity_exhausted");
  return axis === state.width && axis === state.height ? structuredClone(state) : {...structuredClone(state), width: axis, height: axis};
}

export function admitAgentAtRandomAddress(state: RegionState, agentId: string, randomUint32: () => number): RegionState {
  if (state.agents[agentId]) return structuredClone(state);
  const population = Object.keys(state.agents).length + 1;
  const next = expandWorldForPopulation(state, population);
  const capacity = worldAddressCapacity(next);
  const random = randomUint32();
  if (!Number.isSafeInteger(random) || random < 0 || random >= MAX_WORLD_ADDRESSES) throw new TypeError("随机地址源必须返回 uint32");
  const occupied = new Set(Object.values(next.agents).map((agent) => agent.y * next.width + agent.x));
  const start = random % capacity;
  let address = start;
  for (let offset = 0; offset <= occupied.size; offset += 1) {
    address = (start + offset) % capacity;
    if (!occupied.has(address)) break;
  }
  if (occupied.has(address)) throw new Error("world_capacity_exhausted");
  const economicInventory = next.supply?.protocol === "sai-world-supply-state/3" ? worldSupplyBalances(next.supply)[agentId] ?? {} : {};
  const agent: AgentState = {id: agentId, x: address % next.width, y: Math.floor(address / next.width), energy: 5, inventory: structuredClone(economicInventory)};
  next.agents[agentId] = agent;
  return next;
}

export function stateHash(state: RegionState): string {
  return `sha256:${sha256(state)}`;
}

export function toSnapshot(state: RegionState): Snapshot {
  return {...structuredClone(state), state_hash: stateHash(state)};
}

export function fromSnapshot(snapshot: Snapshot): RegionState {
  const {state_hash, ...state} = snapshot;
  if (stateHash(state) !== state_hash) throw new Error("snapshot state_hash 不匹配");
  return upgradeWorldForLabs(state);
}

export function validateState(state: RegionState): void {
  const integers = [state.event_seq, state.logical_tick, state.width, state.height];
  for (const agent of Object.values(state.agents)) integers.push(agent.x, agent.y, agent.energy, ...Object.values(agent.inventory));
  for (const resource of Object.values(state.resources)) integers.push(resource.x, resource.y, resource.initial_amount, resource.remaining);
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new TypeError("世界状态含非法整数");
  if (state.width < 1 || state.height < 1) throw new TypeError("世界尺寸必须为正整数");
  if (state.width > MAX_WORLD_AXIS || state.height > MAX_WORLD_AXIS || worldAddressCapacity(state) > MAX_WORLD_ADDRESSES) throw new TypeError("世界地址空间不能超过 2^32");
  if (Object.values(state.agents).some((agent) => agent.x >= state.width || agent.y >= state.height)) throw new TypeError("Agent 坐标超出世界边界");
  if (Object.values(state.resources).some((resource) => resource.x >= state.width || resource.y >= state.height)) throw new TypeError("资源坐标超出世界边界");
  if (!/^fork:[A-Za-z0-9._:-]{1,120}$/.test(state.world_fork_id)) throw new TypeError("世界分叉标识无效");
  if (Object.values(state.resources).some((resource) => resource.remaining > resource.initial_amount)) throw new TypeError("资源余额不能超过创世存量");
  if (Object.values(state.resources).some((resource) => resource.labs && (resource.labs.ruleset_id !== REFERENCE_RULESET_ID || !REFERENCE_RULESET.baselines.some((item) => item.length === resource.labs?.length) || !/^(0|[1-9][0-9]*)$/.test(resource.labs.energy_at_most)))) throw new TypeError("资源 LABS 分支绑定无效");
  if (state.supply?.protocol === "sai-world-supply-state/1") {
    if (!/^sha256:[0-9a-f]{64}$/.test(state.supply.schedule_id) || !/^sha256:[0-9a-f]{64}$/.test(state.supply.previous_settlement_id)) throw new TypeError("旧世界发行状态无效");
    if (!Number.isSafeInteger(state.supply.research_height) || state.supply.research_height < 0 || state.supply.research_height > 8_400) throw new TypeError("旧世界研究高度无效");
    for (const allocation of LEGACY_WORLD_SUPPLY_ALLOCATIONS) {
      const resource = state.resources[allocation.resource_id];
      if (!resource || resource.kind !== allocation.kind || resource.initial_amount !== allocation.amount || resource.labs?.length !== allocation.length) throw new TypeError("世界资源分配与发行规则不匹配");
      const locallyHeld = Object.values(state.agents).reduce((sum, agent) => sum + (agent.inventory[allocation.kind] ?? 0), 0);
      if (locallyHeld > allocation.amount - resource.remaining) throw new TypeError("Agent 库存超过该资源已释放存量");
    }
    const reserve = LEGACY_WORLD_SUPPLY_ALLOCATIONS.reduce((sum, allocation) => sum + (state.resources[allocation.resource_id]?.remaining ?? 0), 0);
    const legacyIssued = state.supply.research_height <= 2_100 ? state.supply.research_height * 8
      : state.supply.research_height <= 4_200 ? 16_800 + (state.supply.research_height - 2_100) * 4
      : state.supply.research_height <= 6_300 ? 25_200 + (state.supply.research_height - 4_200) * 2
      : 29_400 + (state.supply.research_height - 6_300);
    if (reserve + legacyIssued !== LEGACY_WORLD_MAX_SUPPLY) throw new TypeError("旧世界资源总量与发行高度不守恒");
  }
  if (state.supply?.protocol === "sai-world-supply-state/3") {
    assertWorldSupplyChain(state.supply);
    const balances = worldSupplyBalances(state.supply);
    for (const agent of Object.values(state.agents)) {
      for (const kind of WORLD_RESOURCE_KINDS) if ((agent.inventory[kind] ?? 0) !== (balances[agent.id]?.[kind] ?? 0)) throw new TypeError("Agent 世界资源库存与经济网络不一致");
    }
    const issued = Object.values(balances).reduce((sum, inventory) => sum + Object.values(inventory).reduce((inner, amount) => inner + amount, 0), 0);
    if (issued > WORLD_MAX_SUPPLY) throw new TypeError("世界资源经济网络超过永久总量");
  }
}

function actionId(seed: unknown): string {
  return compactId("act", seed);
}

function distance(a: {x: number; y: number}, b: {x: number; y: number}): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function moveTarget(agent: AgentState, direction: Direction): {x: number; y: number} {
  const delta: Record<Direction, [number, number]> = {north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0]};
  const [dx, dy] = delta[direction];
  return {x: agent.x + dx, y: agent.y + dy};
}

function addAction(commands: Record<string, ActionCommand>, agent: AgentState, action: Omit<LegalAction, "action_id">): void {
  const id = actionId({agent: agent.id, x: agent.x, y: agent.y, ...action});
  commands[id] = {action_id: id, ...action, observed_x: agent.x, observed_y: agent.y};
}

function claimedResearchUnits(state: RegionState): Set<string> {
  return state.supply?.protocol === "sai-world-supply-state/3" ? worldSupplyClaimedUnits(state.supply) : new Set<string>();
}

function claimedUnitsForBranch(claimed: Set<string>, branchOrdinal: number, amount: number): number {
  let count = 0;
  for (let unitIndex = 0; unitIndex < amount; unitIndex += 1) if (claimed.has(worldSupplyUnitKey(branchOrdinal, unitIndex))) count += 1;
  return count;
}

export function visibleWorldResources(state: RegionState, limit = 1_024): ResourceState[] {
  const claimed = claimedResearchUnits(state);
  const generated = state.supply?.protocol === "sai-world-supply-state/3"
    ? worldResourceBranchesInBounds(state.width, state.height, limit).map((item) => ({id: item.resource_id, kind: item.kind, x: item.x, y: item.y, initial_amount: item.amount, remaining: item.amount - claimedUnitsForBranch(claimed, item.branch_ordinal, item.amount), labs: {ruleset_id: item.labs_branch.ruleset_id, length: item.length, energy_at_most: item.baseline_energy}}))
    : [];
  return [...Object.values(state.resources).map((item) => structuredClone(item)), ...generated].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildObservation(state: RegionState, agentId: string): StoredObservation | undefined {
  const agent = state.agents[agentId];
  if (!agent) return undefined;
  const claimed = claimedResearchUnits(state);
  const nearbyBranches: Array<NonNullable<ReturnType<typeof worldResourceAt>>> = [];
  if (state.supply?.protocol === "sai-world-supply-state/3") {
    for (let y = Math.max(0, agent.y - 2); y <= Math.min(state.height - 1, agent.y + 2); y += 1) {
      for (let x = Math.max(0, agent.x - 2); x <= Math.min(state.width - 1, agent.x + 2); x += 1) {
        if (Math.abs(agent.x - x) + Math.abs(agent.y - y) > 2) continue;
        const root = worldResourceAt(x, y);
        if (!root) continue;
        const unitIndex = worldSupplyNextUnitIndex(state.supply, root.branch_ordinal);
        if (unitIndex !== undefined) nearbyBranches.push(worldResourceAt(x, y, unitIndex)!);
      }
    }
  }
  const commands: Record<string, ActionCommand> = {};
  addAction(commands, agent, {type: "wait"});
  if (agent.energy > 0) {
    for (const direction of ["north", "east", "south", "west"] as const) {
      const target = moveTarget(agent, direction);
      if (target.x >= 0 && target.y >= 0 && target.x < state.width && target.y < state.height) addAction(commands, agent, {type: "move", direction});
    }
  }
  for (const resource of Object.values(state.resources).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!resource.labs && agent.energy > 0 && resource.remaining > 0 && resource.x === agent.x && resource.y === agent.y) {
      const action: Omit<ActionCommand, "action_id" | "observed_x" | "observed_y"> = {type: "gather", target: resource.id, observed_target_remaining: resource.remaining};
      const id = actionId({agent: agent.id, x: agent.x, y: agent.y, type: action.type, target: action.target, remaining: resource.remaining});
      commands[id] = {action_id: id, observed_x: agent.x, observed_y: agent.y, ...action};
    }
  }
  for (const resource of nearbyBranches) {
    if (agent.energy < 1 || resource.x !== agent.x || resource.y !== agent.y) continue;
    const remaining = resource.amount - claimedUnitsForBranch(claimed, resource.branch_ordinal, resource.amount);
    if (remaining < 1) continue;
    const action = {type: "research" as const, target: resource.resource_id, observed_target_remaining: remaining, observed_branch_id: resource.labs_branch.branch_id, observed_unit_index: resource.labs_branch.unit_index, arguments_schema: RESEARCH_SCHEMA};
    const id = actionId({agent: agent.id, x: agent.x, y: agent.y, type: action.type, target: action.target, branch_id: resource.labs_branch.branch_id});
    commands[id] = {action_id: id, observed_x: agent.x, observed_y: agent.y, ...action};
  }
  for (const target of Object.values(state.agents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (target.id !== agent.id && distance(agent, target) <= 1) addAction(commands, agent, {type: "message", target: target.id, arguments_schema: MESSAGE_SCHEMA});
  }
  const nearby: Observation["nearby"] = [
    ...Object.values(state.agents).filter((item) => item.id !== agent.id && distance(agent, item) <= 2).map((item) => ({id: item.id, type: "agent" as const, x: item.x, y: item.y})),
    ...Object.values(state.resources).filter((item) => distance(agent, item) <= 2).map((item) => ({id: item.id, type: "resource" as const, kind: item.kind, x: item.x, y: item.y, initial_amount: item.initial_amount, remaining: item.remaining})),
    ...nearbyBranches.map((item) => ({id: item.resource_id, type: "resource" as const, kind: item.kind, x: item.x, y: item.y, initial_amount: item.amount, remaining: item.amount - claimedUnitsForBranch(claimed, item.branch_ordinal, item.amount), labs_branch: item.labs_branch})),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const messages = state.messages
    .filter((message) => message.from === agent.id || message.to === agent.id)
    .slice(-24)
    .map((message) => structuredClone(message));
  const cursor = `seq:${state.event_seq}`;
  const legal_actions = Object.values(commands).map(({observed_x: _x, observed_y: _y, observed_target_remaining: _r, observed_branch_id: _b, observed_unit_index: _u, ...publicAction}) => publicAction);
  const observationSeed = {world_fork_id: state.world_fork_id, region: state.region_id, agent: agent.id, cursor, self: agent, nearby, messages, legal_actions};
  const observation: Observation = {
    protocol: PROTOCOL,
    observation_id: compactId("obs", observationSeed),
    world_fork_id: state.world_fork_id,
    region_id: state.region_id,
    cursor,
    self: {agent_id: agent.id, x: agent.x, y: agent.y, energy: agent.energy, inventory: structuredClone(agent.inventory)},
    nearby,
    messages,
    legal_actions,
  };
  return {agent_id: agent.id, observation, commands};
}

function reject(requestId: string, reason: RejectedResult["reason"]): RejectedResult {
  return {request_id: requestId, status: "rejected", reason, available_correction: reason === "arguments_invalid" || reason === "action_not_found" ? "choose_another_action" : "observe_again"};
}

function validMessage(argumentsValue: Record<string, unknown>): argumentsValue is {content: string} {
  return Object.keys(argumentsValue).length === 1 && typeof argumentsValue.content === "string" && argumentsValue.content.length >= 1 && argumentsValue.content.length <= 160;
}

type LabsSettlementArguments = {
  operation: "settle_branch";
  branch_id: string;
  economic_network_id: string;
  candidate_sequence: string;
  result: LabsResult;
  result_id: string;
  signed_claim: LabsSignedClaim;
  claim_id: string;
  research_task: LabsResearchTask;
  task_id: string;
  method_artifact: LabsResearchArtifact;
  artifact_id: string;
  research_record: LabsResearchRecord;
  record_id: string;
};

function labsSettlementArguments(value: Record<string, unknown>): value is LabsSettlementArguments {
  return value.operation === "settle_branch" && typeof value.branch_id === "string" && typeof value.economic_network_id === "string" && typeof value.candidate_sequence === "string" && typeof value.result === "object" && value.result !== null && typeof value.result_id === "string" && typeof value.signed_claim === "object" && value.signed_claim !== null && typeof value.claim_id === "string" && typeof value.research_task === "object" && value.research_task !== null && typeof value.task_id === "string" && typeof value.method_artifact === "object" && value.method_artifact !== null && typeof value.artifact_id === "string" && typeof value.research_record === "object" && value.research_record !== null && typeof value.record_id === "string";
}

export function transition(state: RegionState, agentId: string, requestId: string, command: ActionCommand, argumentsValue: Record<string, unknown> = {}): TransitionResult {
  const current = state.agents[agentId];
  if (!current) return {status: "rejected", state, result: reject(requestId, "agent_not_found")};
  if (current.x !== command.observed_x || current.y !== command.observed_y) return {status: "rejected", state, result: reject(requestId, "position_changed")};
  if (command.type !== "wait" && current.energy < 1) return {status: "rejected", state, result: reject(requestId, "insufficient_energy")};
  if (command.type !== "message" && command.type !== "research" && Object.keys(argumentsValue).length > 0) return {status: "rejected", state, result: reject(requestId, "arguments_invalid")};
  if (command.type === "message" && !validMessage(argumentsValue)) return {status: "rejected", state, result: reject(requestId, "arguments_invalid")};
  if (command.type === "research" && !labsSettlementArguments(argumentsValue)) return {status: "rejected", state, result: reject(requestId, "arguments_invalid")};

  const next = structuredClone(state);
  const agent = next.agents[agentId]!;
  const cost: Inventory = {};
  const received: Inventory = {};
  let economicSettlement: EconomicSettlementReceipt | undefined;
  if (command.type === "wait") agent.energy = Math.min(MAX_ENERGY, agent.energy + 1);
  if (command.type === "move") {
    if (!command.direction) return {status: "rejected", state, result: reject(requestId, "action_not_found")};
    const target = moveTarget(agent, command.direction);
    if (target.x < 0 || target.y < 0 || target.x >= next.width || target.y >= next.height) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    agent.x = target.x; agent.y = target.y; agent.energy -= 1; cost.energy = 1;
  }
  if (command.type === "gather") {
    const resource = command.target ? next.resources[command.target] : undefined;
    if (!resource || resource.labs || resource.remaining < 1 || resource.remaining !== command.observed_target_remaining) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    if (resource.x !== agent.x || resource.y !== agent.y) return {status: "rejected", state, result: reject(requestId, "target_out_of_range")};
    resource.remaining -= 1; agent.energy -= 1; cost.energy = 1;
    agent.inventory[resource.kind] = (agent.inventory[resource.kind] ?? 0) + 1; received[resource.kind] = 1;
  }
  if (command.type === "research") {
    if (!next.supply || next.supply.protocol !== "sai-world-supply-state/3" || command.observed_unit_index === undefined) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    const resource = worldResourceAt(agent.x, agent.y, command.observed_unit_index);
    const nextUnitIndex = resource ? worldSupplyNextUnitIndex(next.supply, resource.branch_ordinal) : undefined;
    const remaining = resource ? resource.amount - claimedUnitsForBranch(worldSupplyClaimedUnits(next.supply), resource.branch_ordinal, resource.amount) : 0;
    if (!resource || resource.resource_id !== command.target || remaining !== command.observed_target_remaining || nextUnitIndex !== command.observed_unit_index) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    const branch = resource.labs_branch;
    if (branch.branch_id !== command.observed_branch_id || branch.branch_id !== argumentsValue.branch_id || argumentsValue.economic_network_id !== ECONOMIC_NETWORK_ID || argumentsValue.economic_network_id !== branch.economic_network_id) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    const settlement = argumentsValue as LabsSettlementArguments;
    try {
      verifyLabsWorldSubmission(REFERENCE_RULESET, branch, settlement, agentId, worldSupplyActiveTip(next.supply));
      const block = mineWorldSupplyBlock(next.supply, branch, settlement, agentId);
      next.supply = appendWorldSupplyBlock(next.supply, block);
      economicSettlement = {
        protocol: "sai-economic-settlement-receipt/1",
        economic_network_id: block.economic_network_id,
        block_id: worldSupplyBlockId(block),
        parent_id: block.parent_id,
        height: block.height,
        branch_ordinal: block.branch_ordinal,
        unit_index: block.unit_index,
        branch_id: block.branch_id,
        resource_kind: resource.kind,
        reward_units: block.reward_amount,
        agent_id: block.agent_id,
        task_id: block.task_id,
        record_id: block.record_id,
        result_id: block.result_id,
      };
    }
    catch { return {status: "rejected", state, result: reject(requestId, "arguments_invalid")}; }
    agent.energy -= 1;
    cost.energy = 1;
    agent.inventory[resource.kind] = (agent.inventory[resource.kind] ?? 0) + 1;
    received[resource.kind] = 1;
  }
  if (command.type === "message") {
    const target = command.target ? next.agents[command.target] : undefined;
    if (!target) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    if (distance(agent, target) > 1) return {status: "rejected", state, result: reject(requestId, "target_out_of_range")};
    agent.energy -= 1; cost.energy = 1;
  }

  next.event_seq += 1;
  next.logical_tick += 1;
  if (command.type === "message") next.messages.push({id: `message:${next.event_seq}`, from: agentId, to: command.target!, content: argumentsValue.content as string, event_seq: next.event_seq});
  validateState(next);
  const hash = stateHash(next);
  const result: ActResult = {request_id: requestId, status: "applied", event_id: `${next.region_id}:${next.event_seq}`, state_hash: hash};
  if (Object.keys(cost).length) result.cost = cost;
  if (Object.keys(received).length) result.received = received;
  if (economicSettlement) result.economic_settlement = economicSettlement;
  const event = {protocol: PROTOCOL, rules_version: RULES_VERSION, event_id: result.event_id, region_id: next.region_id, event_seq: next.event_seq, agent_id: agentId, request_id: requestId, command: {...command, arguments: structuredClone(argumentsValue)}, result, state_hash: hash};
  return {status: "applied", state: next, event, result};
}

export function replay(initial: RegionState, events: Array<{agent_id: string; request_id: string; command: ActionCommand & {arguments: Record<string, unknown>}; state_hash: string; event_seq: number}>): RegionState {
  let state = structuredClone(initial);
  for (const event of events) {
    if (event.event_seq !== state.event_seq + 1) throw new Error(`event_seq 不连续: ${event.event_seq}`);
    const {arguments: args, ...command} = event.command;
    const outcome = transition(state, event.agent_id, event.request_id, command, args);
    if (outcome.status !== "applied" || outcome.event.state_hash !== event.state_hash) throw new Error(`事件 ${event.event_seq} 无法确定性重放`);
    state = outcome.state;
  }
  return state;
}
