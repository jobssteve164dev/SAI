import {createHash} from "node:crypto";

export const AGENT_MEMORY_LIMIT = 50;
const MAX_CONTENT_LENGTH = 2_000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const MEMORY_ID = /^memo:sha256:[0-9a-f]{64}$/;

export interface AgentMemoryEntry {
  protocol: "proofwild-agent-memory-entry/1";
  memory_id: string;
  agent_id: string;
  world_fork_id: string;
  content: string;
  created_at_tick: number;
  updated_at_tick: number;
  revision: number;
}

export interface AgentMemorySnapshot {
  protocol: "proofwild-agent-memory/1";
  agent_id: string;
  world_fork_id: string;
  entries: AgentMemoryEntry[];
  handled_requests: Record<string, string | {digest: string; response: AgentMemoryMutationResult}>;
  request_order: string[];
  touch_order?: string[];
}

export interface AgentMemoryView {
  protocol: "proofwild-agent-memory-view/1";
  agent_id: string;
  world_fork_id: string;
  entries: AgentMemoryEntry[];
  total: number;
  limit: typeof AGENT_MEMORY_LIMIT;
}

export interface AgentMemoryInput {
  operation: "list" | "remember" | "refresh" | "forget" | "rotate";
  request_id?: string;
  memory_id?: string;
  content?: string;
}

export interface AgentMemoryMutationResult {
  protocol: "proofwild-agent-memory-mutation/1";
  agent_id: string;
  world_fork_id: string;
  operation: Exclude<AgentMemoryInput["operation"], "list">;
  memory_id: string;
  revision: number | null;
  total: number;
  limit: typeof AGENT_MEMORY_LIMIT;
}

export type AgentMemoryResult = AgentMemoryView | AgentMemoryMutationResult;

export interface AgentMemoryPersistence {
  get(agentId: string, worldForkId: string): Promise<AgentMemorySnapshot | undefined>;
  put(snapshot: AgentMemorySnapshot): Promise<void>;
}

export function attachMemorySummary<T extends {memory?: AgentMemorySummary}>(observation: T, summary: AgentMemorySummary, maxBytes: number): T {
  const fitted = clone(summary);
  observation.memory = fitted;
  const size = () => new TextEncoder().encode(JSON.stringify(observation)).byteLength;
  while (size() > maxBytes && fitted.recent.length) {
    const target = fitted.recent.reduce((longest, item) => Array.from(item.content).length > Array.from(longest.content).length ? item : longest);
    const characters = Array.from(target.content);
    if (characters.length <= 1) fitted.recent.splice(fitted.recent.indexOf(target), 1);
    else { target.content = characters.slice(0, Math.max(1, characters.length - 16)).join(""); target.truncated = true; }
  }
  if (size() > maxBytes) throw new Error("observation_exceeds_max_bytes");
  return observation;
}

export interface AgentMemorySummary {protocol: "proofwild-agent-memory-summary/1"; total: number; limit: 50; recent: Array<{memory_id: string; content: string; revision: number; truncated: boolean}>}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function clone<T>(value: T): T { return structuredClone(value); }
function assertTick(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("记忆逻辑时间无效"); }
function assertContent(value: unknown): asserts value is string { if (typeof value !== "string" || !value.trim() || value.length > MAX_CONTENT_LENGTH) throw new RangeError(`记忆内容必须为 1–${MAX_CONTENT_LENGTH} 个字符`); }
function assertRequestId(value: unknown): asserts value is string { if (typeof value !== "string" || !REQUEST_ID.test(value)) throw new TypeError("记忆写入需要有效 request_id"); }
function assertMemoryId(value: unknown): asserts value is string { if (typeof value !== "string" || !MEMORY_ID.test(value)) throw new TypeError("记忆编号无效"); }

function emptySnapshot(agentId: string, worldForkId: string): AgentMemorySnapshot {
  return {protocol: "proofwild-agent-memory/1", agent_id: agentId, world_fork_id: worldForkId, entries: [], handled_requests: {}, request_order: [], touch_order: []};
}

function ordered(snapshot: AgentMemorySnapshot): AgentMemoryEntry[] {
  const rank = new Map((snapshot.touch_order ?? snapshot.entries.map((entry) => entry.memory_id)).map((id, index) => [id, index]));
  return [...snapshot.entries].sort((left, right) => (rank.get(right.memory_id) ?? -1) - (rank.get(left.memory_id) ?? -1));
}

function view(snapshot: AgentMemorySnapshot): AgentMemoryView {
  const entries = ordered(snapshot).map(clone);
  return {protocol: "proofwild-agent-memory-view/1", agent_id: snapshot.agent_id, world_fork_id: snapshot.world_fork_id, entries, total: entries.length, limit: AGENT_MEMORY_LIMIT};
}

function operationDigest(input: AgentMemoryInput): string {
  return digest(JSON.stringify({operation: input.operation, memory_id: input.memory_id ?? null, content: input.content ?? null}));
}

export class MemoryAgentMemoryPersistence implements AgentMemoryPersistence {
  private readonly values = new Map<string, AgentMemorySnapshot>();
  async get(agentId: string, worldForkId: string): Promise<AgentMemorySnapshot | undefined> { const value = this.values.get(`${worldForkId}\u0000${agentId}`); return value ? clone(value) : undefined; }
  async put(snapshot: AgentMemorySnapshot): Promise<void> { this.values.set(`${snapshot.world_fork_id}\u0000${snapshot.agent_id}`, clone(snapshot)); }
}

export class AgentMemoryRepository {
  constructor(private readonly persistence: AgentMemoryPersistence) {}

  async list(agentId: string, worldForkId: string): Promise<AgentMemoryView> {
    return view(await this.persistence.get(agentId, worldForkId) ?? emptySnapshot(agentId, worldForkId));
  }

  async summary(agentId: string, worldForkId: string): Promise<AgentMemorySummary> {
    const current = await this.list(agentId, worldForkId);
    return {protocol: "proofwild-agent-memory-summary/1", total: current.total, limit: AGENT_MEMORY_LIMIT, recent: current.entries.slice(0, 5).map((entry) => ({memory_id: entry.memory_id, content: entry.content.slice(0, 160), revision: entry.revision, truncated: entry.content.length > 160}))};
  }

  async perform(agentId: string, worldForkId: string, tick: number, input: AgentMemoryInput): Promise<AgentMemoryResult> {
    assertTick(tick);
    if (input.operation === "list") return this.list(agentId, worldForkId);
    assertRequestId(input.request_id);
    const snapshot = await this.persistence.get(agentId, worldForkId) ?? emptySnapshot(agentId, worldForkId);
    snapshot.touch_order ??= snapshot.entries.map((entry) => entry.memory_id);
    const expectedDigest = operationDigest(input);
    const handled = snapshot.handled_requests[input.request_id];
    if (handled) {
      const handledDigest = typeof handled === "string" ? handled : handled.digest;
      if (handledDigest !== expectedDigest) throw new Error("同一记忆 request_id 不能用于不同操作");
      return typeof handled === "string" ? view(snapshot) : clone(handled.response);
    }

    let affectedMemoryId = input.memory_id;
    let affectedRevision: number | null = null;
    if (input.operation === "remember") {
      assertContent(input.content);
      if (snapshot.entries.length >= AGENT_MEMORY_LIMIT) throw new RangeError(`备忘录已达到 ${AGENT_MEMORY_LIMIT} 条；请明确 forget 或 rotate 一条记忆`);
      const entry = {protocol: "proofwild-agent-memory-entry/1" as const, memory_id: `memo:sha256:${digest(`${agentId}\u0000${worldForkId}\u0000${input.request_id}`)}`, agent_id: agentId, world_fork_id: worldForkId, content: input.content.trim(), created_at_tick: tick, updated_at_tick: tick, revision: 1};
      snapshot.entries.push(entry);
      snapshot.touch_order.push(entry.memory_id);
      affectedMemoryId = entry.memory_id;
      affectedRevision = entry.revision;
    } else {
      assertMemoryId(input.memory_id);
      const index = snapshot.entries.findIndex((entry) => entry.memory_id === input.memory_id);
      if (index < 0) throw new Error("记忆不存在于当前 Agent 和世界分叉");
      if (input.operation === "forget") { snapshot.entries.splice(index, 1); snapshot.touch_order = snapshot.touch_order.filter((id) => id !== input.memory_id); }
      else if (input.operation === "refresh") {
        const entry = snapshot.entries[index]!;
        if (input.content !== undefined) { assertContent(input.content); entry.content = input.content.trim(); }
        entry.updated_at_tick = tick;
        entry.revision += 1;
        affectedRevision = entry.revision;
        snapshot.touch_order = snapshot.touch_order.filter((id) => id !== entry.memory_id); snapshot.touch_order.push(entry.memory_id);
      } else {
        assertContent(input.content);
        const entry = {protocol: "proofwild-agent-memory-entry/1" as const, memory_id: `memo:sha256:${digest(`${agentId}\u0000${worldForkId}\u0000${input.request_id}`)}`, agent_id: agentId, world_fork_id: worldForkId, content: input.content.trim(), created_at_tick: tick, updated_at_tick: tick, revision: 1};
        snapshot.entries.splice(index, 1, entry);
        snapshot.touch_order = snapshot.touch_order.filter((id) => id !== input.memory_id); snapshot.touch_order.push(entry.memory_id);
        affectedMemoryId = entry.memory_id;
        affectedRevision = entry.revision;
      }
    }
    const response: AgentMemoryMutationResult = {protocol: "proofwild-agent-memory-mutation/1", agent_id: agentId, world_fork_id: worldForkId, operation: input.operation, memory_id: affectedMemoryId!, revision: affectedRevision, total: snapshot.entries.length, limit: AGENT_MEMORY_LIMIT};
    snapshot.handled_requests[input.request_id] = {digest: expectedDigest, response};
    snapshot.request_order.push(input.request_id);
    while (snapshot.request_order.length > 32) {
      const expired = snapshot.request_order.shift();
      if (expired) delete snapshot.handled_requests[expired];
    }
    await this.persistence.put(snapshot);
    return response;
  }
}
