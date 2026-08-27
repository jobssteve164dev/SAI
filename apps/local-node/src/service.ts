import {createHash} from "node:crypto";
import {buildObservation, createWorld, transition, type ActInput, type ActResult, type AgentState, type ConformanceEvent, type Observation, type RegionState, type StoredObservation} from "../../../packages/kernel/src/index.js";
import {FileStore} from "./store.js";

export class RegionService {
  private state: RegionState;
  private readonly observations = new Map<string, StoredObservation>();
  private readonly requests = new Map<string, ActResult>();
  private queue: Promise<void> = Promise.resolve();

  private constructor(readonly store: FileStore, state: RegionState) { this.state = state; }

  static async open(store: FileStore, regionId = "local"): Promise<RegionService> {
    const loaded = await store.loadState(createWorld(regionId));
    const service = new RegionService(store, loaded.state);
    for (const stored of await store.loadObservations()) service.observations.set(stored.observation.observation_id, stored);
    for (const event of loaded.events) service.requests.set(service.requestKey(event.agent_id, event.request_id), event.result);
    for (const entry of await store.loadRejections()) service.requests.set(service.requestKey(entry.agent_id, entry.result.request_id), entry.result);
    return service;
  }

  currentState(): RegionState { return structuredClone(this.state); }

  async admit(agentId: string): Promise<void> {
    await this.serial(async () => {
      if (this.state.agents[agentId]) return;
      const digest = createHash("sha256").update(agentId).digest();
      const agent: AgentState = {id: agentId, x: digest[0]! % this.state.width, y: digest[1]! % this.state.height, energy: 5, inventory: {}};
      this.state = {...this.state, agents: {...this.state.agents, [agentId]: agent}};
      await this.store.saveSnapshot(this.state);
    });
  }

  async observe(agentId: string, _input: {cursor?: string; max_bytes?: number} = {}): Promise<Observation> {
    const stored = buildObservation(this.state, agentId);
    if (!stored) throw new Error("agent_not_found");
    const maxBytes = _input.max_bytes ?? 4096;
    if (Buffer.byteLength(JSON.stringify(stored.observation)) > maxBytes) throw new Error("observation_exceeds_max_bytes");
    this.observations.set(stored.observation.observation_id, stored);
    await this.store.appendObservation(stored);
    return stored.observation;
  }

  async act(agentId: string, input: ActInput): Promise<ActResult> {
    return this.serial(async () => {
      const key = this.requestKey(agentId, input.request_id);
      const known = this.requests.get(key);
      if (known) return structuredClone(known);
      const stored = this.observations.get(input.observation_id);
      let result: ActResult;
      if (!stored || stored.agent_id !== agentId) result = {request_id: input.request_id, status: "rejected", reason: "observation_unknown", available_correction: "observe_again"};
      else {
        const command = stored.commands[input.action_id];
        if (!command) result = {request_id: input.request_id, status: "rejected", reason: "action_not_found", available_correction: "choose_another_action"};
        else {
          const outcome = transition(this.state, agentId, input.request_id, command, input.arguments ?? {});
          result = outcome.result;
          if (outcome.status === "applied") {
            await this.store.appendEvent(outcome.event);
            this.state = outcome.state;
            await this.store.saveSnapshot(this.state);
          }
        }
      }
      if (result.status === "rejected") await this.store.appendRejection(agentId, result);
      this.requests.set(key, structuredClone(result));
      return result;
    });
  }

  private requestKey(agentId: string, requestId: string): string { return `${agentId}\u0000${this.state.region_id}\u0000${requestId}`; }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

export type {ConformanceEvent};
