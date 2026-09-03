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
  initial_amount: number;
  remaining: number;
  labs?: {
    ruleset_id: string;
    length: number;
    energy_at_most: string;
  };
  rotation?: {
    protocol: "sai-world-mine-rotation/1";
    sector_ordinal: number;
    activation_parent_id: string;
    previous_resource_id: string | null;
    source: "genesis_sector" | "reserve_rotation";
    status: "active" | "exhausted";
    replaced_by_resource_id?: string;
  };
}

export interface LegacyWorldSupplyState {
  protocol: "sai-world-supply-state/1";
  schedule_id: string;
  research_height: number;
  previous_settlement_id: string;
}

export interface PreviousEcosystemWorldSupplyState {
  protocol: "sai-world-supply-state/2";
  economic_network_id: string;
  schedule_id: string;
  active_chain: Array<Record<string, unknown>>;
}

export interface WorldSupplyBlock {
  protocol: "sai-world-supply-block/2";
  economic_network_id: string;
  schedule_id: string;
  height: number;
  parent_id: string;
  branch_ordinal: number;
  unit_index: number;
  branch_id: string;
  task_id: string;
  record_id: string;
  coverage_partition_id: string;
  coverage_digest: string;
  evaluated_candidates: 65536;
  reward_amount: 1;
  agent_id: string;
  candidate_sequence: string;
  result: import("../../labs/src/index.js").LabsResult;
  result_id: string;
  signed_claim: import("../../labs/src/index.js").LabsSignedClaim;
  claim_id: string;
  proof_bits: number;
  nonce: number;
}

export interface EcosystemWorldSupplyState {
  protocol: "sai-world-supply-state/3";
  economic_network_id: string;
  schedule_id: string;
  active_chain: WorldSupplyBlock[];
}

export type WorldSupplyState = LegacyWorldSupplyState | PreviousEcosystemWorldSupplyState | EcosystemWorldSupplyState;

export interface WorldSupplyObservation {
  protocol: "sai-world-supply-observation/3";
  economic_network_id: string;
  schedule_id: string;
  max_supply: number;
  reserve_supply: number;
  issued_supply: number;
  locally_held_supply: number;
  external_or_in_transit_supply: number;
  burned_supply: 0;
  rewarded_branch_count: number;
  rewarded_research_unit_count: number;
  settled_branch_count: number;
  remaining_branch_count: number;
  settled_research_unit_count: number;
  remaining_research_unit_count: number;
  candidates_per_research_unit: 65536;
  verified_new_canonical_candidates: string;
  strata: number;
  branches_per_stratum: number;
  active_height: number;
  active_tip_id: string;
  cumulative_work: string;
  season_reset: false;
}

export interface LabsWorldBranchObservation {
  protocol: "sai-labs-world-branch/4";
  branch_id: string;
  economic_network_id: string;
  schedule_id: string;
  branch_ordinal: number;
  resource_id: string;
  resource_kind: string;
  resource_amount: number;
  reward_amount: 1;
  unit_index: number;
  x: number;
  y: number;
  stratum: number;
  ruleset_id: string;
  length: number;
  baseline_energy: string;
  candidates_per_unit: 65536;
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
  world_fork_id: string;
  region_id: string;
  event_seq: number;
  logical_tick: number;
  width: number;
  height: number;
  agents: Record<string, AgentState>;
  resources: Record<string, ResourceState>;
  supply?: WorldSupplyState;
  messages: MessageState[];
}

export type ActionType = "wait" | "move" | "gather" | "message" | "research";
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
  observed_branch_id?: string;
  observed_unit_index?: number;
}

export interface Observation {
  protocol: typeof PROTOCOL;
  observation_id: string;
  world_fork_id: string;
  region_id: string;
  cursor: string;
  self: Omit<AgentState, "id"> & {agent_id: string};
  nearby: Array<
    | {id: string; type: "agent"; x: number; y: number}
    | {id: string; type: "resource"; kind: string; x: number; y: number; initial_amount: number; remaining: number; labs_branch?: LabsWorldBranchObservation}
  >;
  messages: MessageState[];
  legal_actions: LegalAction[];
  memory?: {
    protocol: "proofwild-agent-memory-summary/1";
    total: number;
    limit: 50;
    recent: Array<{memory_id: string; content: string; revision: number; truncated: boolean}>;
  };
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

export interface EconomicSettlementReceipt {
  protocol: "sai-economic-settlement-receipt/1";
  economic_network_id: string;
  block_id: string;
  parent_id: string;
  height: number;
  branch_ordinal: number;
  unit_index: number;
  branch_id: string;
  resource_kind: string;
  reward_units: 1;
  agent_id: string;
  task_id: string;
  record_id: string;
  result_id: string;
}

export interface AppliedResult {
  request_id: string;
  status: "applied";
  event_id: string;
  state_hash: string;
  cost?: Inventory;
  received?: Inventory;
  economic_settlement?: EconomicSettlementReceipt;
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
