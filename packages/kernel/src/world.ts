import {compactId, sha256} from "./canonical.js";
import {
  REFERENCE_FORK_ID,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  createLabsWorldBranch,
  verifyLabsWorldSubmission,
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
  type Inventory,
  type LegalAction,
  type Observation,
  type RegionState,
  type RejectedResult,
  type Snapshot,
  type StoredObservation,
  type TransitionResult,
} from "./types.js";

const MAX_ENERGY = 10;
export const MAX_WORLD_ADDRESSES = 2 ** 32;
export const MAX_WORLD_AXIS = 2 ** 16;
const INITIAL_WORLD_AXIS = 8;
const MESSAGE_SCHEMA = {
  type: "object",
  required: ["content"],
  properties: {content: {type: "string", minLength: 1, maxLength: 160}},
  additionalProperties: false,
};
const RESEARCH_SCHEMA = {
  type: "object",
  required: ["operation", "sequence"],
  properties: {
    operation: {const: "solve_branch"},
    sequence: {type: "string", pattern: "^[01]+$", maxLength: 4096},
    claim_type: {enum: ["discovery", "reproduction"]},
    evidence_ids: {type: "array", maxItems: 128, uniqueItems: true, items: {type: "string", pattern: "^sha256:[0-9a-f]{64}$"}},
  },
  additionalProperties: false,
};

export function createWorld(regionId = "local", agents: AgentState[] = []): RegionState {
  return {
    protocol: PROTOCOL,
    rules_version: RULES_VERSION,
    world_fork_id: REFERENCE_FORK_ID,
    region_id: regionId,
    event_seq: 0,
    logical_tick: 0,
    width: INITIAL_WORLD_AXIS,
    height: INITIAL_WORLD_AXIS,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, structuredClone(agent)])),
    resources: {
      "resource-alpha": {id: "resource-alpha", kind: "crystal", x: 1, y: 0, initial_amount: 8, remaining: 8, labs: {ruleset_id: REFERENCE_RULESET_ID, length: 451, energy_at_most: "12625"}},
      "resource-beta": {id: "resource-beta", kind: "fiber", x: 3, y: 3, initial_amount: 5, remaining: 5, labs: {ruleset_id: REFERENCE_RULESET_ID, length: 518, energy_at_most: "18463"}},
    },
    messages: [],
  };
}

export function upgradeWorldForLabs(state: RegionState): RegionState {
  const next = structuredClone(state);
  next.world_fork_id ||= REFERENCE_FORK_ID;
  const bindings = {
    "resource-alpha": {initial_amount: 8, length: 451, energy_at_most: "12625"},
    "resource-beta": {initial_amount: 5, length: 518, energy_at_most: "18463"},
  } as const;
  for (const resource of Object.values(next.resources)) {
    const known = bindings[resource.id as keyof typeof bindings];
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
  const agent: AgentState = {id: agentId, x: address % next.width, y: Math.floor(address / next.width), energy: 5, inventory: {}};
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

function labsBranch(state: RegionState, resource: RegionState["resources"][string]) {
  if (!resource.labs || resource.remaining < 1) return undefined;
  return createLabsWorldBranch(REFERENCE_RULESET, {
    world_fork_id: state.world_fork_id,
    region_id: state.region_id,
    resource_id: resource.id,
    unit_ordinal: resource.initial_amount - resource.remaining,
    length: resource.labs.length,
    energy_at_most: resource.labs.energy_at_most,
  });
}

export function buildObservation(state: RegionState, agentId: string): StoredObservation | undefined {
  const agent = state.agents[agentId];
  if (!agent) return undefined;
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
    const branch = labsBranch(state, resource);
    if (branch && agent.energy > 0 && resource.x === agent.x && resource.y === agent.y) {
      const action = {type: "research" as const, target: resource.id, observed_target_remaining: resource.remaining, observed_branch_id: branch.branch_id, arguments_schema: RESEARCH_SCHEMA};
      const id = actionId({agent: agent.id, x: agent.x, y: agent.y, type: action.type, target: action.target, branch_id: branch.branch_id});
      commands[id] = {action_id: id, observed_x: agent.x, observed_y: agent.y, ...action};
    }
  }
  for (const target of Object.values(state.agents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (target.id !== agent.id && distance(agent, target) <= 1) addAction(commands, agent, {type: "message", target: target.id, arguments_schema: MESSAGE_SCHEMA});
  }
  const nearby: Observation["nearby"] = [
    ...Object.values(state.agents).filter((item) => item.id !== agent.id && distance(agent, item) <= 2).map((item) => ({id: item.id, type: "agent" as const, x: item.x, y: item.y})),
    ...Object.values(state.resources).filter((item) => distance(agent, item) <= 2).map((item) => {
      const branch = labsBranch(state, item);
      return {id: item.id, type: "resource" as const, kind: item.kind, x: item.x, y: item.y, initial_amount: item.initial_amount, remaining: item.remaining, ...(branch ? {labs_branch: branch} : {})};
    }),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const messages = state.messages
    .filter((message) => message.from === agent.id || message.to === agent.id)
    .slice(-24)
    .map((message) => structuredClone(message));
  const cursor = `seq:${state.event_seq}`;
  const legal_actions = Object.values(commands).map(({observed_x: _x, observed_y: _y, observed_target_remaining: _r, observed_branch_id: _b, ...publicAction}) => publicAction);
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
  candidate_sequence: string;
  result: LabsResult;
  result_id: string;
  signed_claim: LabsSignedClaim;
  claim_id: string;
};

function labsSettlementArguments(value: Record<string, unknown>): value is LabsSettlementArguments {
  return value.operation === "settle_branch" && typeof value.branch_id === "string" && typeof value.candidate_sequence === "string" && typeof value.result === "object" && value.result !== null && typeof value.result_id === "string" && typeof value.signed_claim === "object" && value.signed_claim !== null && typeof value.claim_id === "string";
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
    const resource = command.target ? next.resources[command.target] : undefined;
    if (!resource || resource.remaining < 1 || resource.remaining !== command.observed_target_remaining) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    if (resource.x !== agent.x || resource.y !== agent.y) return {status: "rejected", state, result: reject(requestId, "target_out_of_range")};
    const branch = labsBranch(next, resource);
    if (!branch || branch.branch_id !== command.observed_branch_id || branch.branch_id !== argumentsValue.branch_id) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    const settlement = argumentsValue as LabsSettlementArguments;
    try { verifyLabsWorldSubmission(REFERENCE_RULESET, branch, settlement, agentId); }
    catch { return {status: "rejected", state, result: reject(requestId, "arguments_invalid")}; }
    resource.remaining -= 1;
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
  const hash = stateHash(next);
  const result: ActResult = {request_id: requestId, status: "applied", event_id: `${next.region_id}:${next.event_seq}`, state_hash: hash};
  if (Object.keys(cost).length) result.cost = cost;
  if (Object.keys(received).length) result.received = received;
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
