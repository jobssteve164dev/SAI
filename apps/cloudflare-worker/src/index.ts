import {DurableObject} from "cloudflare:workers";
import {randomBytes, randomUUID, type JsonWebKey} from "node:crypto";
import type {AuthInfo} from "@modelcontextprotocol/server";
import {AuthService, type AuthSnapshot} from "../../../packages/auth/src/index.js";
import {assertTransferPrepareInput, createNodeDescriptor, createNodeKeyPair, createTransferCancellation, createTransferCredential, createTransferReceipt, verifyTransferCancellation, verifyTransferCredential, verifyTransferReceipt, type NodeDescriptor, type NodeKeyPair, type TransferCancellation, type TransferCredential, type TransferReceipt} from "../../../packages/federation/src/index.js";
import {LABS_CONFORMANCE_VECTORS, WORLD_MAX_SUPPLY, WORLD_SUPPLY_SCHEDULE_BODY, WORLD_SUPPLY_SCHEDULE_ID, admitAgentAtRandomAddress, assertEcosystemSupplyImportAllowed, buildObservation, createWorld, expandWorldForPopulation, handleWorldSupplyRequest, mergeWorldSupplyStates, reconcileWorldMines, reconcileWorldSupplyInventories, stateHash, transition, upgradeWorldForLabs, validateState, worldSupplyObservation, type ActInput, type ActResult, type AgentState, type ConformanceEvent, type EcosystemWorldSupplyState, type Observation, type RegionState, type StoredObservation} from "../../../packages/kernel/src/index.js";
import {createSaiMcpHandler} from "../../../packages/mcp/src/index.js";
import {createObserverSnapshot, observatoryResponse, type AgentWorldTimes, type ObserverSnapshot} from "./observatory.js";
import {agentGuideResponse, canonicalHttpsRedirect, faviconResponse, legalResponse, llmsResponse, resolveLegalRoute, robotsResponse, seasonResponse, sitemapResponse, socialCardResponse} from "./public-pages.js";
import {handleLabsRequest} from "../../../packages/labs/src/http.js";
import {LabsRepository, type LabsPersistence, type LabsStoredObject} from "../../../packages/labs/src/store.js";
import {LEGACY_REFERENCE_FORK_ID, PREVIOUS_REFERENCE_FORK_ID, REFERENCE_FORK_ID, exactMeritFactor, type LabsFrontier} from "../../../packages/labs/src/index.js";
import {createLabsAwareApplication} from "../../../packages/labs/src/application.js";
import {protocolSchemaResponse} from "./protocol-schemas.js";
import {researchResponse} from "./research-pages.js";
import {handleJournalRequest} from "../../../packages/journal/src/http.js";
import {JournalRepository, type JournalArtifact, type JournalPersistence, type JournalSubmission} from "../../../packages/journal/src/index.js";
import {agentAccessResponse, journalPageResponse} from "./journal-pages.js";
import {AgentMemoryRepository, attachMemorySummary, type AgentMemoryInput, type AgentMemoryPersistence, type AgentMemoryResult, type AgentMemorySnapshot} from "../../../packages/memory/src/index.js";

interface Env {
  REGIONS: DurableObjectNamespace<RegionDurableObject>;
  PUBLIC_BASE_URL: string;
  REGION_ID: string;
}

interface PreparedTransfer {credential: TransferCredential; status: "locked" | "completed" | "recovered"; receipt?: TransferReceipt}

const AGENT_WORLD_TIMES_PREFIX = "agent-world-times:";

class DurableLabsPersistence implements LabsPersistence {
  constructor(private readonly storage: DurableObjectStorage) {}
  async getObject(id: string): Promise<LabsStoredObject | undefined> { return this.storage.get<LabsStoredObject>(`labs-object:${id}`); }
  async putObject(id: string, object: LabsStoredObject): Promise<void> { await this.storage.put(`labs-object:${id}`, object); }
  async listObjects(): Promise<Array<{id: string; object: LabsStoredObject}>> {
    const stored = await this.storage.list<LabsStoredObject>({prefix: "labs-object:"});
    return [...stored.entries()].map(([key, object]) => ({id: key.slice("labs-object:".length), object})).sort((a, b) => a.id.localeCompare(b.id));
  }
  async getFrontier(rulesetId: string, forkId: string): Promise<LabsFrontier | undefined> { return this.storage.get<LabsFrontier>(`labs-frontier:${rulesetId}:${forkId}`); }
  async putFrontier(frontier: LabsFrontier): Promise<void> { await this.storage.put(`labs-frontier:${frontier.ruleset_id}:${frontier.fork_id}`, frontier); }
}

class DurableJournalPersistence implements JournalPersistence {
  constructor(private readonly storage: DurableObjectStorage) {}
  async get(paperId: string): Promise<JournalSubmission | undefined> { return this.storage.get<JournalSubmission>(`journal-submission:${paperId}`); }
  async put(submission: JournalSubmission): Promise<void> { await this.storage.put(`journal-submission:${submission.paper_id}`, submission); }
  async list(): Promise<JournalSubmission[]> { return [...(await this.storage.list<JournalSubmission>({prefix: "journal-submission:"})).values()]; }
  async getArtifact(versionId: string, sha256: string): Promise<JournalArtifact | undefined> { return this.storage.get<JournalArtifact>(`journal-artifact:${versionId}:${sha256}`); }
  async putWithArtifacts(submission: JournalSubmission, artifacts: JournalArtifact[]): Promise<void> { const entries: Record<string, JournalSubmission | JournalArtifact> = {[`journal-submission:${submission.paper_id}`]: submission}; for (const artifact of artifacts) entries[`journal-artifact:${submission.current_version.version_id}:${artifact.sha256}`] = artifact; await this.storage.put(entries); }
}

class DurableAgentMemoryPersistence implements AgentMemoryPersistence {
  constructor(private readonly storage: DurableObjectStorage) {}
  private key(agentId: string, worldForkId: string): string { return `agent-memory:${worldForkId}:${agentId}`; }
  async get(agentId: string, worldForkId: string): Promise<AgentMemorySnapshot | undefined> { return this.storage.get<AgentMemorySnapshot>(this.key(agentId, worldForkId)); }
  async put(snapshot: AgentMemorySnapshot): Promise<void> { await this.storage.put(this.key(snapshot.agent_id, snapshot.world_fork_id), snapshot); }
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers}});
}

class DurableRegionApplication {
  private queue: Promise<void> = Promise.resolve();
  private readonly memories: AgentMemoryRepository;
  constructor(private readonly storage: DurableObjectStorage, readonly regionId: string) { this.memories = new AgentMemoryRepository(new DurableAgentMemoryPersistence(storage)); }
  async state(): Promise<RegionState> { return upgradeWorldForLabs(await this.storage.get<RegionState>("world") ?? createWorld(this.regionId)); }

  async admit(agentId: string): Promise<void> {
    const state = await this.state();
    if (state.agents[agentId]) { await this.touchAgent(agentId, state.logical_tick); return; }
    const next = admitAgentAtRandomAddress(state, agentId, () => randomBytes(4).readUInt32BE(0));
    const now = new Date().toISOString();
    const worldTimes: AgentWorldTimes = {joined_at: now, joined_at_tick: state.logical_tick, last_active_at: now, last_active_at_tick: state.logical_tick};
    await this.storage.put({world: next, [this.agentWorldTimesKey(agentId)]: worldTimes});
  }

  async observe(agentId: string, input: {cursor?: string; max_bytes?: number} = {}): Promise<Observation> {
    if (await this.storage.get(`agent-lock:${agentId}`)) throw new Error("agent_in_transit");
    const state = await this.state();
    const stored = buildObservation(state, agentId);
    if (!stored) throw new Error("agent_not_found");
    attachMemorySummary(stored.observation, await this.memories.summary(agentId, state.world_fork_id), input.max_bytes ?? 4096);
    await this.storage.put(`observation:${stored.observation.observation_id}`, stored);
    await this.touchAgent(agentId, state.logical_tick);
    return stored.observation;
  }

  async memory(agentId: string, input: AgentMemoryInput): Promise<AgentMemoryResult> {
    return this.serial(async () => {
      const state = await this.state();
      if (!state.agents[agentId]) throw new Error("agent_not_found");
      return this.memories.perform(agentId, state.world_fork_id, state.logical_tick, input);
    });
  }

  async activity(agentId: string, input: {cursor?: string; limit?: number} = {}): Promise<{protocol: "proofwild-agent-activity/1"; world_fork_id: string; events: ConformanceEvent[]; next_cursor: string | null}> {
    const state = await this.state();
    if (!state.agents[agentId]) throw new Error("agent_not_found");
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const before = input.cursor ? Number(input.cursor.replace(/^before:/, "")) : Number.POSITIVE_INFINITY;
    if (input.cursor && (!input.cursor.startsWith("before:") || !Number.isSafeInteger(before) || before < 1)) throw new TypeError("活动历史游标无效");
    const stored = await this.storage.list<ConformanceEvent>({prefix: "event:"});
    const matching = [...stored.values()].filter((event) => event.agent_id === agentId && event.event_seq < before).sort((left, right) => right.event_seq - left.event_seq);
    const events = matching.slice(0, limit);
    return {protocol: "proofwild-agent-activity/1", world_fork_id: state.world_fork_id, events, next_cursor: matching.length > limit ? `before:${events.at(-1)!.event_seq}` : null};
  }

  async journalContext(): Promise<{world_fork_id: string; event_seq: number}> { const state = await this.state(); return {world_fork_id: state.world_fork_id, event_seq: state.event_seq}; }
  async reviewerEligible(agentId: string, context: {world_fork_id: string; event_seq: number}): Promise<boolean> {
    const state = await this.state();
    if (state.world_fork_id !== context.world_fork_id) return false;
    const events = await this.storage.list<ConformanceEvent>({prefix: "event:"});
    return [...events.values()].some((event) => event.agent_id === agentId && event.event_seq <= context.event_seq);
  }

  async act(agentId: string, input: ActInput): Promise<ActResult> {
    return this.serial(async () => {
      const requestKey = `request:${agentId}:${this.regionId}:${input.request_id}`;
      const known = await this.storage.get<ActResult>(requestKey);
      if (known) {
        const state = await this.state();
        if (state.agents[agentId]) await this.touchAgent(agentId, state.logical_tick);
        return known;
      }
      let activityState = await this.state();
      let result: ActResult;
      if (await this.storage.get(`agent-lock:${agentId}`)) result = {request_id: input.request_id, status: "rejected", reason: "target_unavailable", available_correction: "observe_again"};
      else {
        const stored = await this.storage.get<StoredObservation>(`observation:${input.observation_id}`);
        if (!stored || stored.agent_id !== agentId) result = {request_id: input.request_id, status: "rejected", reason: "observation_unknown", available_correction: "observe_again"};
        else {
          const command = stored.commands[input.action_id];
          if (!command) result = {request_id: input.request_id, status: "rejected", reason: "action_not_found", available_correction: "choose_another_action"};
          else {
            const outcome = transition(activityState, agentId, input.request_id, command, input.arguments ?? {});
            result = outcome.result;
            if (outcome.status === "applied") {
              activityState = outcome.state;
              await this.storage.put({world: outcome.state, [`event:${outcome.event.event_seq}`]: outcome.event});
            }
          }
        }
      }
      await this.storage.put(requestKey, result);
      if (activityState.agents[agentId]) await this.touchAgent(agentId, activityState.logical_tick);
      return result;
    });
  }

  async exportAgent(agentId: string): Promise<AgentState> { const agent = (await this.state()).agents[agentId]; if (!agent) throw new Error("agent_not_found"); return structuredClone(agent); }
  async lock(agentId: string): Promise<void> { await this.exportAgent(agentId); await this.storage.put(`agent-lock:${agentId}`, true); }
  async unlock(agentId: string): Promise<void> { await this.storage.delete(`agent-lock:${agentId}`); }
  async importAgent(agent: AgentState): Promise<void> {
    const state = await this.state();
    assertEcosystemSupplyImportAllowed(state, agent);
    const existing = state.agents[agent.id];
    if (existing && JSON.stringify(existing) !== JSON.stringify(agent)) throw new Error("目标区域已存在不同状态的 Agent");
    if (existing) { await this.touchAgent(agent.id, state.logical_tick); return; }
    const expanded = expandWorldForPopulation(state, Object.keys(state.agents).length + 1, {width: agent.x + 1, height: agent.y + 1});
    expanded.agents[agent.id] = structuredClone(agent);
    const now = new Date().toISOString();
    const worldTimes: AgentWorldTimes = {joined_at: now, joined_at_tick: state.logical_tick, last_active_at: now, last_active_at_tick: state.logical_tick};
    await this.storage.put({world: expanded, [this.agentWorldTimesKey(agent.id)]: worldTimes});
  }
  async removeAgent(agentId: string): Promise<void> { const state = await this.state(); delete state.agents[agentId]; await this.storage.put("world", state); await this.storage.delete(this.agentWorldTimesKey(agentId)); await this.unlock(agentId); }

  async mergeSupply(incoming: EcosystemWorldSupplyState): Promise<EcosystemWorldSupplyState> {
    return this.serial(async () => {
      const state = await this.state();
      if (!state.supply || state.supply.protocol !== "sai-world-supply-state/3") throw new Error("economic_network_unavailable");
      const merged = mergeWorldSupplyStates(state.supply, incoming);
      const next = reconcileWorldMines(reconcileWorldSupplyInventories({...state, supply: merged}));
      validateState(next);
      await this.storage.put("world", next);
      return structuredClone(merged);
    });
  }

  async observerSnapshot(): Promise<ObserverSnapshot> {
    const state = await this.state();
    const first = Math.max(1, state.event_seq - 59);
    const keys = Array.from({length: Math.max(0, state.event_seq - first + 1)}, (_, index) => `event:${first + index}`);
    const stored = keys.length ? await this.storage.get<ConformanceEvent>(keys) : new Map<string, ConformanceEvent>();
    const events = keys.map((key) => stored.get(key)).filter((event): event is ConformanceEvent => event !== undefined);
    return createObserverSnapshot(state, stateHash(state), events, new Date().toISOString(), await this.agentWorldTimes(state));
  }

  private agentWorldTimesKey(agentId: string): string { return `${AGENT_WORLD_TIMES_PREFIX}${agentId}`; }

  private async touchAgent(agentId: string, tick: number, now = new Date().toISOString()): Promise<void> {
    const key = this.agentWorldTimesKey(agentId);
    const stored = await this.storage.get<AgentWorldTimes>(key);
    let worldTimes = stored;
    if (!worldTimes) {
      const events = await this.storage.list<ConformanceEvent>({prefix: "event:"});
      let firstEventTick: number | undefined;
      let lastEventTick: number | undefined;
      for (const event of events.values()) {
        if (event.agent_id !== agentId) continue;
        firstEventTick = firstEventTick === undefined ? event.event_seq : Math.min(firstEventTick, event.event_seq);
        lastEventTick = lastEventTick === undefined ? event.event_seq : Math.max(lastEventTick, event.event_seq);
      }
      worldTimes = firstEventTick !== undefined && lastEventTick !== undefined
        ? {joined_at: null, joined_at_tick: Math.max(0, firstEventTick - 1), last_active_at: null, last_active_at_tick: lastEventTick}
        : {joined_at: now, joined_at_tick: tick, last_active_at: now, last_active_at_tick: tick};
    }
    await this.storage.put(key, {...worldTimes, joined_at: worldTimes.joined_at ?? null, last_active_at: now, last_active_at_tick: Math.max(tick, worldTimes.last_active_at_tick)});
  }

  private async agentWorldTimes(state: RegionState): Promise<Record<string, AgentWorldTimes>> {
    const stored = await this.storage.list<AgentWorldTimes>({prefix: AGENT_WORLD_TIMES_PREFIX});
    const resolved = Object.fromEntries([...stored.entries()].map(([key, value]) => [key.slice(AGENT_WORLD_TIMES_PREFIX.length), {...value, joined_at: value.joined_at ?? null, last_active_at: value.last_active_at ?? null}]));
    const missing = Object.keys(state.agents).filter((agentId) => !resolved[agentId]);
    if (!missing.length) return resolved;
    const events = await this.storage.list<ConformanceEvent>({prefix: "event:"});
    const eventTicks = new Map<string, {first: number; last: number}>();
    for (const event of events.values()) {
      if (!state.agents[event.agent_id]) continue;
      const ticks = eventTicks.get(event.agent_id);
      eventTicks.set(event.agent_id, ticks
        ? {first: Math.min(ticks.first, event.event_seq), last: Math.max(ticks.last, event.event_seq)}
        : {first: event.event_seq, last: event.event_seq});
    }
    const updates: Record<string, AgentWorldTimes> = {};
    for (const agentId of missing) {
      const ticks = eventTicks.get(agentId);
      const worldTimes = ticks
        ? {joined_at: null, joined_at_tick: Math.max(0, ticks.first - 1), last_active_at: null, last_active_at_tick: ticks.last}
        : {joined_at: null, joined_at_tick: state.logical_tick, last_active_at: null, last_active_at_tick: state.logical_tick};
      resolved[agentId] = worldTimes;
      updates[this.agentWorldTimesKey(agentId)] = worldTimes;
    }
    await this.storage.put(updates);
    return resolved;
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

export class RegionDurableObject extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private region!: DurableRegionApplication;
  private auth!: AuthService;
  private nodeKeys!: NodeKeyPair;
  private mcp!: ReturnType<typeof createSaiMcpHandler>;
  private labs!: LabsRepository;
  private journal!: JournalRepository;
  private authQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const world = await ctx.storage.get<RegionState>("world");
      const currentWorld = upgradeWorldForLabs(world ?? createWorld(env.REGION_ID));
      if (!world || stateHash(world) !== stateHash(currentWorld)) await ctx.storage.put("world", currentWorld);
      this.region = new DurableRegionApplication(ctx.storage, env.REGION_ID);
      this.auth = new AuthService({baseUrl: env.PUBLIC_BASE_URL, region: env.REGION_ID, ...((await ctx.storage.get<AuthSnapshot>("auth")) ? {snapshot: await ctx.storage.get<AuthSnapshot>("auth") as AuthSnapshot} : {})});
      this.nodeKeys = await ctx.storage.get<NodeKeyPair>("node-keys") ?? await createNodeKeyPair();
      await ctx.storage.put({auth: this.auth.snapshot(), "node-keys": this.nodeKeys});
      this.labs = await LabsRepository.open(new DurableLabsPersistence(ctx.storage));
      this.journal = new JournalRepository(new DurableJournalPersistence(ctx.storage), {currentContext: () => this.region.journalContext(), reviewerEligible: (agentId, context) => this.region.reviewerEligible(agentId, context)});
      this.mcp = createSaiMcpHandler(createLabsAwareApplication(this.region, this.labs));
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    try {
      const journalResponse = await handleJournalRequest(request, this.journal, (publicJwk, assertion, audience) => this.serialAuth(async () => {
        const verified = await this.auth.verifyAgentAssertion(publicJwk, assertion, audience);
        await this.persistAuth();
        return verified;
      }));
      if (journalResponse) return journalResponse;
      const labsResponse = await handleLabsRequest(request, this.labs, LABS_CONFORMANCE_VECTORS);
      if (labsResponse) return labsResponse;
      const supplyResponse = await handleWorldSupplyRequest(request, {currentState: () => this.region.state(), mergeSupply: (state) => this.region.mergeSupply(state)});
      if (supplyResponse) return supplyResponse;
      if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return observatoryResponse(request.method);
      if (url.pathname === "/en" && (request.method === "GET" || request.method === "HEAD")) return observatoryResponse(request.method, "en");
      if (url.pathname === "/") return json({error: "method_not_allowed"}, 405, {allow: "GET, HEAD"});
      if (url.pathname === "/help" && (request.method === "GET" || request.method === "HEAD")) return agentAccessResponse(request);
      if (url.pathname === "/en/help" && (request.method === "GET" || request.method === "HEAD")) return agentAccessResponse(request, "en");
      if (url.pathname === "/season" && (request.method === "GET" || request.method === "HEAD")) return seasonResponse(request.method);
      if (url.pathname === "/en/season" && (request.method === "GET" || request.method === "HEAD")) return seasonResponse(request.method, "en");
      if ((url.pathname === "/research" || url.pathname === "/en/research") && (request.method === "GET" || request.method === "HEAD")) return researchResponse(request, this.labs, url.pathname.startsWith("/en/") ? "en" : "zh-CN");
      if ((url.pathname === "/research/papers" || url.pathname === "/en/research/papers") && (request.method === "GET" || request.method === "HEAD")) return journalPageResponse(request, await this.journal.publicPapers(), url.pathname.startsWith("/en/") ? "en" : "zh-CN");
      const paperVersionMatch = url.pathname.match(/^\/(en\/)?research\/papers\/(sha256(?::|%3A)[0-9a-f]{64})\/versions\/(sha256(?::|%3A)[0-9a-f]{64})$/i);
      if (paperVersionMatch && (request.method === "GET" || request.method === "HEAD")) {
        const paperId = decodeURIComponent(paperVersionMatch[2]!); const versionId = decodeURIComponent(paperVersionMatch[3]!);
        const paper = await this.journal.publicPaper(paperId); const version = await this.journal.publicVersion(paperId, versionId);
        if (!paper || !version) return json({error: "not_found"}, 404);
        return journalPageResponse(request, [], paperVersionMatch[1] ? "en" : "zh-CN", paper, version);
      }
      const paperMatch = url.pathname.match(/^\/(en\/)?research\/papers\/(sha256(?::|%3A)[0-9a-f]{64})$/i);
      if (paperMatch && (request.method === "GET" || request.method === "HEAD")) {
        const paper = await this.journal.publicPaper(decodeURIComponent(paperMatch[2]!));
        return paper ? journalPageResponse(request, [], paperMatch[1] ? "en" : "zh-CN", paper) : json({error: "not_found"}, 404);
      }
      const researchMatch = url.pathname.match(/^\/(en\/)?research\/(sha256(?::|%3A)[0-9a-f]{64})$/i);
      if (researchMatch && (request.method === "GET" || request.method === "HEAD")) return researchResponse(request, this.labs, researchMatch[1] ? "en" : "zh-CN", decodeURIComponent(researchMatch[2]!));
      if ((url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") && (request.method === "GET" || request.method === "HEAD")) return faviconResponse(request.method, url.pathname.endsWith(".ico") ? "ico" : "svg");
      if (url.pathname === "/social-card.png" && (request.method === "GET" || request.method === "HEAD")) return socialCardResponse(request.method);
      if (url.pathname === "/robots.txt" && request.method === "GET") return robotsResponse();
      if (url.pathname === "/sitemap.xml" && request.method === "GET") return sitemapResponse();
      if (url.pathname === "/llms.txt" && request.method === "GET") return llmsResponse();
      if (url.pathname === "/agent-guide.json" && request.method === "GET") return agentGuideResponse();
      const schemaResponse = protocolSchemaResponse(url.pathname, request.method);
      if (schemaResponse) return schemaResponse;
      const legalRoute = resolveLegalRoute(url.pathname);
      if (legalRoute && (request.method === "GET" || request.method === "HEAD")) return legalResponse(request, legalRoute.route, legalRoute.locale);
      if (url.pathname === "/health") return json({service: "Proofwild", implementation: "cloudflare-durable-object", version: "0.4.0", node_id: this.nodeKeys.nodeId, region_id: this.env.REGION_ID, world_fork_id: (await this.region.state()).world_fork_id, status: "ok"});
      if (url.pathname === "/api/worlds" && request.method === "GET") return json({current: {world_fork_id: REFERENCE_FORK_ID, snapshot_url: `${this.env.PUBLIC_BASE_URL}/api/observer/snapshot`}, archived: [LEGACY_REFERENCE_FORK_ID, PREVIOUS_REFERENCE_FORK_ID].map((world_fork_id) => ({world_fork_id, snapshot_url: `${this.env.PUBLIC_BASE_URL}/api/worlds/${encodeURIComponent(world_fork_id)}/snapshot`, mode: "read_only"}))}, 200, {"access-control-allow-origin": "*"});
      if (url.pathname === "/api/world/supply" && request.method === "GET") {
        const state = await this.region.state();
        return json({schedule_id: WORLD_SUPPLY_SCHEDULE_ID, max_supply: WORLD_MAX_SUPPLY, schedule: WORLD_SUPPLY_SCHEDULE_BODY, state: worldSupplyObservation(state)}, 200, {"access-control-allow-origin": "*"});
      }
      if (url.pathname === "/api/observer/snapshot" && request.method === "GET") {
        const snapshot = await this.region.observerSnapshot();
        const frontier = await this.labs.frontier();
        const ruleset = await this.labs.ruleset(frontier.ruleset_id);
        const registry = await this.labs.registry(frontier.ruleset_id);
        const labs = {
          ruleset_id: frontier.ruleset_id,
          world_fork_id: frontier.fork_id,
          source_title: ruleset.baselines[0]?.source.title ?? ruleset.name,
          source_url: ruleset.baselines[0]?.source.url ?? `${this.env.PUBLIC_BASE_URL}/labs/v1`,
          research_totals: registry.totals,
          frontier: ruleset.baselines.map((baseline) => {
            const entry = frontier.lengths[String(baseline.length)]!;
            return {length: baseline.length, best_energy: entry.best_energy, merit_factor: exactMeritFactor(baseline.length, BigInt(entry.best_energy)).decimal, result_ids: entry.result_ids};
          }),
          finite_resources: snapshot.resources.filter((resource) => resource.labs).map((resource) => ({resource_id: resource.id, kind: resource.kind, initial_amount: resource.initial_amount, remaining: resource.remaining, length: resource.labs!.length})),
          ...(snapshot.supply ? {supply_schedule_id: WORLD_SUPPLY_SCHEDULE_ID} : {}),
        };
        return json({...snapshot, labs}, 200, {"access-control-allow-origin": "*"});
      }
      if (url.pathname === "/api/observer/snapshot" && request.method === "OPTIONS") return new Response(null, {status: 204, headers: {allow: "GET, OPTIONS", "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS"}});
      if (url.pathname === "/api/observer/snapshot") return json({error: "method_not_allowed"}, 405, {allow: "GET, OPTIONS", "access-control-allow-origin": "*"});
      if (url.pathname === "/.well-known/sai-node") return json(await this.descriptor());
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return json({resource: `${this.env.PUBLIC_BASE_URL}/mcp`, authorization_servers: [this.env.PUBLIC_BASE_URL], scopes_supported: ["observe", "act"], bearer_methods_supported: ["header"]});
      if (url.pathname === "/.well-known/oauth-authorization-server") return json({issuer: this.env.PUBLIC_BASE_URL, token_endpoint: `${this.env.PUBLIC_BASE_URL}/oauth/token`, jwks_uri: `${this.env.PUBLIC_BASE_URL}/oauth/jwks`, registration_endpoint: `${this.env.PUBLIC_BASE_URL}/oauth/register`, token_endpoint_auth_methods_supported: ["private_key_jwt"], scopes_supported: ["observe", "act"], response_types_supported: []});
      if (url.pathname === "/oauth/jwks") return json(await this.auth.jwks());
      if (url.pathname === "/oauth/register" && request.method === "POST") {
        const body = await request.json() as {public_jwk?: JsonWebKey; assertion?: string};
        if (!body.public_jwk || !body.assertion) return json({error: "invalid_request"}, 400);
        return this.serialAuth(async () => {
          const agentId = await this.auth.register(body.public_jwk!, body.assertion!);
          await this.region.admit(agentId); await this.persistAuth();
          return json({client_id: agentId, token_endpoint_auth_method: "private_key_jwt"}, 201);
        });
      }
      if (url.pathname === "/oauth/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        if (form.get("grant_type") !== "client_credentials" || form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return json({error: "unsupported_grant_type"}, 400);
        return this.serialAuth(async () => {
          const token = await this.auth.token({clientId: form.get("client_id") ?? "", assertion: form.get("client_assertion") ?? "", resource: form.get("resource") ?? "", scopes: (form.get("scope") ?? "").split(" ").filter(Boolean)});
          await this.persistAuth(); return json(token);
        });
      }
      if (url.pathname === "/federation/v1/transfers/prepare" && request.method === "POST") {
        const agentId = await this.authenticated(request, "act");
        const body: unknown = await request.json(); assertTransferPrepareInput(body);
        return json(await this.prepare(agentId, body));
      }
      if (url.pathname === "/federation/v1/transfers/current" && request.method === "GET") { const agentId = await this.authenticated(request, "act"); const transferId = await this.ctx.storage.get<string>(`agent-transfer:${agentId}`); if (!transferId) return json({error: "not_found"}, 404); const prepared = await this.ctx.storage.get<PreparedTransfer>(`transfer:${transferId}`); return prepared?.status === "locked" ? json(prepared.credential) : json({error: "not_found"}, 404); }
      if (url.pathname === "/federation/v1/transfers/accept" && request.method === "POST") return json(await this.accept(await request.json() as TransferCredential));
      if (url.pathname === "/federation/v1/transfers/complete" && request.method === "POST") { await this.complete(await request.json() as TransferReceipt); return json({status: "completed"}); }
      if (url.pathname === "/federation/v1/transfers/cancel" && request.method === "POST") return json(await this.cancel(await request.json() as TransferCredential));
      if (url.pathname === "/federation/v1/transfers/recover" && request.method === "POST") { const agentId = await this.authenticated(request, "act"); const body = await request.json() as {cancellation: TransferCancellation}; await this.recover(agentId, body.cancellation); return json({status: "recovered"}); }
      if (url.pathname === "/mcp") {
        const authorization = request.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) return json({error: "invalid_token"}, 401, {"www-authenticate": `Bearer resource_metadata="${this.env.PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp"`});
        const rawToken = authorization.slice(7);
        const claims = await this.auth.verifyAccessToken(rawToken);
        const authInfo: AuthInfo = {token: rawToken, clientId: claims.agentId, scopes: claims.scopes, resource: new URL(`${this.env.PUBLIC_BASE_URL}/mcp`), extra: {agentId: claims.agentId, region: claims.region, epoch: claims.epoch}};
        return this.mcp.fetch(request, {authInfo});
      }
      return json({error: "not_found"}, 404);
    } catch (error) {
      const description = error instanceof Error ? error.message : "request_failed";
      return json({error: url.pathname === "/mcp" ? "invalid_token" : "invalid_request", error_description: description}, url.pathname === "/mcp" ? 401 : 400);
    }
  }

  private async descriptor(now = Math.floor(Date.now() / 1000)): Promise<NodeDescriptor> { return createNodeDescriptor(this.nodeKeys, this.env.PUBLIC_BASE_URL, [this.env.REGION_ID], now); }
  private async persistAuth(): Promise<void> { await this.ctx.storage.put("auth", this.auth.snapshot()); }
  private async serialAuth<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.authQueue;
    let release!: () => void;
    this.authQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  private async authenticated(request: Request, scope: "observe" | "act"): Promise<string> { const header = request.headers.get("authorization"); if (!header?.startsWith("Bearer ")) throw new Error("缺少 bearer token"); const claims = await this.auth.verifyAccessToken(header.slice(7)); if (!claims.scopes.includes(scope)) throw new Error(`缺少 ${scope} scope`); return claims.agentId; }

  private async prepare(agentId: string, input: {target_node: string; target_region: string; nonce?: string; ttl?: number}, now = Math.floor(Date.now() / 1000)): Promise<TransferCredential> {
    const existingId = await this.ctx.storage.get<string>(`agent-transfer:${agentId}`);
    if (existingId) { const existing = await this.ctx.storage.get<PreparedTransfer>(`transfer:${existingId}`); if (existing?.status === "locked") return existing.credential; }
    const publicJwk = this.auth.getAgentPublicJwk(agentId); if (!publicJwk) throw new Error("Agent 身份未注册");
    await this.region.lock(agentId);
    try {
      const state = await this.region.state();
      const agent = await this.region.exportAgent(agentId);
      assertEcosystemSupplyImportAllowed(state, agent);
      const credential = await createTransferCredential({keys: this.nodeKeys, descriptor: await this.descriptor(now), sourceRegion: this.env.REGION_ID, targetNode: input.target_node, targetRegion: input.target_region, agent, agentPublicJwk: publicJwk, sourceState: state, now, ...(input.ttl ? {ttl: input.ttl} : {}), nonce: input.nonce ?? randomUUID()});
      await this.ctx.storage.put({[`transfer:${credential.transfer_id}`]: {credential, status: "locked"} satisfies PreparedTransfer, [`agent-transfer:${agentId}`]: credential.transfer_id});
      return credential;
    } catch (error) { await this.region.unlock(agentId); throw error; }
  }

  private async accept(credential: TransferCredential, now = Math.floor(Date.now() / 1000)): Promise<TransferReceipt> {
    const key = `receipt:${credential.transfer_id}`;
    const existing = await this.ctx.storage.get<TransferReceipt>(key); if (existing) return existing;
    if (await this.ctx.storage.get<TransferCancellation>(`cancellation:${credential.transfer_id}`)) throw new Error("转移已由目标节点取消");
    await verifyTransferCredential(credential, this.nodeKeys.nodeId, this.env.REGION_ID, now);
    this.auth.importAgent(credential.agent_public_jwk); await this.region.importAgent(credential.agent); await this.persistAuth();
    const receipt = await createTransferReceipt({keys: this.nodeKeys, descriptor: await this.descriptor(now), credential, acceptedStateHash: stateHash(await this.region.state()), now});
    await this.ctx.storage.put(key, receipt); return receipt;
  }

  private async complete(receipt: TransferReceipt, now = Math.floor(Date.now() / 1000)): Promise<void> {
    const key = `transfer:${receipt.transfer_id}`; const prepared = await this.ctx.storage.get<PreparedTransfer>(key);
    if (!prepared) throw new Error("未知转移回执"); if (prepared.status === "completed") return; if (prepared.status !== "locked") throw new Error("转移已恢复，不能完成");
    await verifyTransferReceipt(receipt, prepared.credential, now); await this.region.removeAgent(prepared.credential.agent.id);
    await this.ctx.storage.put(key, {...prepared, status: "completed", receipt} satisfies PreparedTransfer);
  }

  private async cancel(credential: TransferCredential, now = Math.floor(Date.now() / 1000)): Promise<{status: "accepted"; receipt: TransferReceipt} | {status: "cancelled"; cancellation: TransferCancellation}> {
    const accepted = await this.ctx.storage.get<TransferReceipt>(`receipt:${credential.transfer_id}`); if (accepted) return {status: "accepted", receipt: accepted};
    const key = `cancellation:${credential.transfer_id}`; const existing = await this.ctx.storage.get<TransferCancellation>(key); if (existing) return {status: "cancelled", cancellation: existing};
    if (now <= credential.expires_at) throw new Error("转移凭证尚未过期");
    await verifyTransferCredential(credential, this.nodeKeys.nodeId, this.env.REGION_ID, now, true);
    const cancellation = await createTransferCancellation({keys: this.nodeKeys, descriptor: await this.descriptor(now), credential, now});
    await this.ctx.storage.put(key, cancellation); return {status: "cancelled", cancellation};
  }

  private async recover(agentId: string, cancellation: TransferCancellation, now = Math.floor(Date.now() / 1000)): Promise<void> {
    const key = `transfer:${cancellation.transfer_id}`; const prepared = await this.ctx.storage.get<PreparedTransfer>(key);
    if (!prepared || prepared.credential.agent.id !== agentId) throw new Error("未知转移"); if (prepared.status === "recovered") return;
    if (prepared.status !== "locked") throw new Error("转移尚不能恢复");
    await verifyTransferCancellation(cancellation, prepared.credential, now);
    await this.region.unlock(agentId); await this.ctx.storage.put(key, {...prepared, status: "recovered"} satisfies PreparedTransfer);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const httpsRedirect = canonicalHttpsRedirect(request);
    if (httpsRedirect) return httpsRedirect;
    const url = new URL(request.url);
    const legacyArchivePath = `/api/worlds/${encodeURIComponent(LEGACY_REFERENCE_FORK_ID)}/snapshot`;
    const previousArchivePath = `/api/worlds/${encodeURIComponent(PREVIOUS_REFERENCE_FORK_ID)}/snapshot`;
    if ((url.pathname === legacyArchivePath || url.pathname === previousArchivePath) && request.method === "GET") {
      const isLegacyArchive = url.pathname === legacyArchivePath;
      url.pathname = "/api/observer/snapshot";
      const archiveName = isLegacyArchive ? env.REGION_ID : `${env.REGION_ID}:${PREVIOUS_REFERENCE_FORK_ID}`;
      return env.REGIONS.get(env.REGIONS.idFromName(archiveName)).fetch(new Request(url, request));
    }
    const id = env.REGIONS.idFromName(`${env.REGION_ID}:${REFERENCE_FORK_ID}`);
    return env.REGIONS.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
