import {compactId, sha256} from "./canonical.js";
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
const MESSAGE_SCHEMA = {
  type: "object",
  required: ["content"],
  properties: {content: {type: "string", minLength: 1, maxLength: 160}},
  additionalProperties: false,
};

export function createWorld(regionId = "local", agents: AgentState[] = []): RegionState {
  return {
    protocol: PROTOCOL,
    rules_version: RULES_VERSION,
    region_id: regionId,
    event_seq: 0,
    logical_tick: 0,
    width: 8,
    height: 8,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, structuredClone(agent)])),
    resources: {
      "resource-alpha": {id: "resource-alpha", kind: "crystal", x: 1, y: 0, remaining: 8},
      "resource-beta": {id: "resource-beta", kind: "fiber", x: 3, y: 3, remaining: 5},
    },
    messages: [],
  };
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
  validateState(state);
  return state;
}

export function validateState(state: RegionState): void {
  const integers = [state.event_seq, state.logical_tick, state.width, state.height];
  for (const agent of Object.values(state.agents)) integers.push(agent.x, agent.y, agent.energy, ...Object.values(agent.inventory));
  for (const resource of Object.values(state.resources)) integers.push(resource.x, resource.y, resource.remaining);
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new TypeError("世界状态含非法整数");
  if (state.width < 1 || state.height < 1) throw new TypeError("世界尺寸必须为正整数");
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
    if (agent.energy > 0 && resource.remaining > 0 && resource.x === agent.x && resource.y === agent.y) {
      const action: Omit<ActionCommand, "action_id" | "observed_x" | "observed_y"> = {type: "gather", target: resource.id, observed_target_remaining: resource.remaining};
      const id = actionId({agent: agent.id, x: agent.x, y: agent.y, type: action.type, target: action.target, remaining: resource.remaining});
      commands[id] = {action_id: id, observed_x: agent.x, observed_y: agent.y, ...action};
    }
  }
  for (const target of Object.values(state.agents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (target.id !== agent.id && distance(agent, target) <= 1) addAction(commands, agent, {type: "message", target: target.id, arguments_schema: MESSAGE_SCHEMA});
  }
  const nearby: Observation["nearby"] = [
    ...Object.values(state.agents).filter((item) => item.id !== agent.id && distance(agent, item) <= 2).map((item) => ({id: item.id, type: "agent" as const, x: item.x, y: item.y})),
    ...Object.values(state.resources).filter((item) => distance(agent, item) <= 2).map((item) => ({id: item.id, type: "resource" as const, kind: item.kind, x: item.x, y: item.y, remaining: item.remaining})),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const cursor = `seq:${state.event_seq}`;
  const legal_actions = Object.values(commands).map(({observed_x: _x, observed_y: _y, observed_target_remaining: _r, ...publicAction}) => publicAction);
  const observationSeed = {region: state.region_id, agent: agent.id, cursor, self: agent, nearby, legal_actions};
  const observation: Observation = {
    protocol: PROTOCOL,
    observation_id: compactId("obs", observationSeed),
    region_id: state.region_id,
    cursor,
    self: {agent_id: agent.id, x: agent.x, y: agent.y, energy: agent.energy, inventory: structuredClone(agent.inventory)},
    nearby,
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

export function transition(state: RegionState, agentId: string, requestId: string, command: ActionCommand, argumentsValue: Record<string, unknown> = {}): TransitionResult {
  const current = state.agents[agentId];
  if (!current) return {status: "rejected", state, result: reject(requestId, "agent_not_found")};
  if (current.x !== command.observed_x || current.y !== command.observed_y) return {status: "rejected", state, result: reject(requestId, "position_changed")};
  if (command.type !== "wait" && current.energy < 1) return {status: "rejected", state, result: reject(requestId, "insufficient_energy")};
  if (command.type !== "message" && Object.keys(argumentsValue).length > 0) return {status: "rejected", state, result: reject(requestId, "arguments_invalid")};
  if (command.type === "message" && !validMessage(argumentsValue)) return {status: "rejected", state, result: reject(requestId, "arguments_invalid")};

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
    if (!resource || resource.remaining < 1 || resource.remaining !== command.observed_target_remaining) return {status: "rejected", state, result: reject(requestId, "target_unavailable")};
    if (resource.x !== agent.x || resource.y !== agent.y) return {status: "rejected", state, result: reject(requestId, "target_out_of_range")};
    resource.remaining -= 1; agent.energy -= 1; cost.energy = 1;
    agent.inventory[resource.kind] = (agent.inventory[resource.kind] ?? 0) + 1; received[resource.kind] = 1;
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
