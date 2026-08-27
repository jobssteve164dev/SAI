export const PROTOCOL = "sai/0.1.0" as const;
export const RULES_VERSION = "conformance/0.1.0" as const;

export type Inventory = Record<string, number>;

export interface AgentState {
  id: string;
  x: number;
  y: number;
  energy: number;
  inventory: Inventory;
}

export interface ResourceState {
  id: string;
  kind: string;
  x: number;
  y: number;
  remaining: number;
}

export interface MessageState {
  id: string;
  from: string;
  to: string;
  content: string;
  event_seq: number;
}

export interface RegionState {
  protocol: typeof PROTOCOL;
  rules_version: typeof RULES_VERSION;
  region_id: string;
  event_seq: number;
  logical_tick: number;
  width: number;
  height: number;
  agents: Record<string, AgentState>;
  resources: Record<string, ResourceState>;
  messages: MessageState[];
}

export type ActionType = "wait" | "move" | "gather" | "message";
export type Direction = "north" | "east" | "south" | "west";

export interface LegalAction {
  action_id: string;
  type: ActionType;
  direction?: Direction;
  target?: string;
  arguments_schema?: Record<string, unknown>;
}

export interface ActionCommand extends LegalAction {
  observed_x: number;
  observed_y: number;
  observed_target_remaining?: number;
}

export interface Observation {
  protocol: typeof PROTOCOL;
  observation_id: string;
  region_id: string;
  cursor: string;
  self: Omit<AgentState, "id"> & {agent_id: string};
  nearby: Array<
    | {id: string; type: "agent"; x: number; y: number}
    | {id: string; type: "resource"; kind: string; x: number; y: number; remaining: number}
  >;
  messages: MessageState[];
  legal_actions: LegalAction[];
}

export interface StoredObservation {
  agent_id: string;
  observation: Observation;
  commands: Record<string, ActionCommand>;
}

export interface ActInput {
  observation_id: string;
  action_id: string;
  arguments?: Record<string, unknown>;
  request_id: string;
}

export type RejectReason =
  | "agent_not_found"
  | "action_not_found"
  | "arguments_invalid"
  | "insufficient_energy"
  | "position_changed"
  | "target_unavailable"
  | "target_out_of_range"
  | "observation_unknown";

export interface AppliedResult {
  request_id: string;
  status: "applied";
  event_id: string;
  state_hash: string;
  cost?: Inventory;
  received?: Inventory;
}

export interface RejectedResult {
  request_id: string;
  status: "rejected";
  reason: RejectReason;
  available_correction: "observe_again" | "choose_another_action";
}

export type ActResult = AppliedResult | RejectedResult;

export interface ConformanceEvent {
  protocol: typeof PROTOCOL;
  rules_version: typeof RULES_VERSION;
  event_id: string;
  region_id: string;
  event_seq: number;
  agent_id: string;
  request_id: string;
  command: ActionCommand & {arguments: Record<string, unknown>};
  result: AppliedResult;
  state_hash: string;
}

export interface TransitionApplied {
  status: "applied";
  state: RegionState;
  event: ConformanceEvent;
  result: AppliedResult;
}

export interface TransitionRejected {
  status: "rejected";
  state: RegionState;
  result: RejectedResult;
}

export type TransitionResult = TransitionApplied | TransitionRejected;

export interface Snapshot extends RegionState {
  state_hash: string;
}
