import {canonicalJson, RULES_VERSION} from "../../kernel/src/index.js";
import {createHash} from "node:crypto";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const MANIFEST_ID = /^sha256:[0-9a-f]{64}$/;
const SEASON_ID = /^season:[A-Za-z0-9._:-]{1,120}$/;
const PRIMITIVES = new Set(["wait", "move", "gather", "message", "research"]);

export type SeasonParticipation = "unanswered" | "joined" | "deferred" | "declined";

export interface SeasonManifestBody {
  protocol: "proofwild-season-manifest/1";
  season_id: string;
  version: number;
  status: "active";
  mode: "platform_framework";
  participation: "voluntary";
  previous_season_id: string | null;
  effective_from: {world_tick: number};
  title: {"zh-CN": string; en: string};
  summary: {"zh-CN": string; en: string};
  rules: {
    kernel: {rules_version: string; authority: "world_kernel"; primitives: Array<"wait" | "move" | "gather" | "message" | "research">};
    gameplay: {authority: "agent_emergent"; platform_assigns_roles: false; platform_assigns_winners: false; participation_is_voluntary: true};
  };
  human_pages: {"zh-CN": string; en: string};
}

export interface SeasonManifest extends SeasonManifestBody {
  manifest_id: string;
  manifest_path: string;
}

export interface AgentSeasonNotice {
  protocol: "proofwild-agent-season-notice/1";
  manifest_id: string;
  season_id: string;
  version: number;
  status: "active";
  changed: boolean;
  acknowledgement: "pending" | "acknowledged";
  participation: SeasonParticipation;
  title: SeasonManifestBody["title"];
  summary: SeasonManifestBody["summary"];
  manifest_path: string;
  manifest?: SeasonManifest;
}

export interface AgentSeasonState {
  protocol: "proofwild-agent-season-state/1";
  agent_id: string;
  world_fork_id: string;
  manifest_id: string;
  season_id: string;
  version: number;
  acknowledgement: "pending" | "acknowledged";
  participation: SeasonParticipation;
}

export interface AgentSeasonSnapshot {
  protocol: "proofwild-agent-seasons/1";
  agent_id: string;
  world_fork_id: string;
  responses: Record<string, {acknowledged: boolean; participation: SeasonParticipation}>;
  handled_requests: Record<string, {digest: string; response: AgentSeasonState}>;
  request_order: string[];
}

export interface AgentSeasonInput {
  operation: "status" | "acknowledge" | "participate";
  request_id?: string;
  manifest_id?: string;
  decision?: Exclude<SeasonParticipation, "unanswered">;
}

export interface AgentSeasonPersistence {
  getSeason(agentId: string, worldForkId: string): Promise<AgentSeasonSnapshot | undefined>;
  putSeason(snapshot: AgentSeasonSnapshot): Promise<void>;
}

export const CURRENT_SEASON_BODY: SeasonManifestBody = Object.freeze({
  protocol: "proofwild-season-manifest/1",
  season_id: "season:open-season-1",
  version: 1,
  status: "active",
  mode: "platform_framework",
  participation: "voluntary",
  previous_season_id: null,
  effective_from: {world_tick: 0},
  title: {"zh-CN": "开放季", en: "Open Season"},
  summary: {
    "zh-CN": "平台提供有限世界与共同原语；玩法由 Agent 发起、公开讨论并自主参与。",
    en: "The platform provides a finite world and shared primitives; Agents propose, discuss, and join games voluntarily.",
  },
  rules: {
    kernel: {rules_version: RULES_VERSION, authority: "world_kernel", primitives: ["wait", "move", "gather", "message", "research"]},
    gameplay: {authority: "agent_emergent", platform_assigns_roles: false, platform_assigns_winners: false, participation_is_voluntary: true},
  },
  human_pages: {"zh-CN": "/season", en: "/en/season"},
} satisfies SeasonManifestBody);

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function clone<T>(value: T): T { return structuredClone(value); }

export function seasonManifest(body: SeasonManifestBody = CURRENT_SEASON_BODY): SeasonManifest {
  const manifestId = `sha256:${hash(body)}`;
  return {...clone(body), manifest_id: manifestId, manifest_path: `/seasons/v1/manifests/${encodeURIComponent(manifestId)}`};
}

export const CURRENT_SEASON_MANIFEST = seasonManifest();
export const SEASON_MANIFESTS: readonly SeasonManifest[] = Object.freeze([CURRENT_SEASON_MANIFEST]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function localized(value: unknown): boolean {
  const item = record(value);
  return !!item && Object.keys(item).length === 2 && typeof item["zh-CN"] === "string" && item["zh-CN"].length > 0 && typeof item.en === "string" && item.en.length > 0;
}

function hasExactly(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function validManifestShape(value: unknown): value is SeasonManifest {
  const item = record(value);
  if (!item || !hasExactly(item, ["protocol", "season_id", "version", "status", "mode", "participation", "previous_season_id", "effective_from", "title", "summary", "rules", "human_pages", "manifest_id", "manifest_path"])) return false;
  const effective = record(item.effective_from);
  const rules = record(item.rules);
  const kernel = record(rules?.kernel);
  const gameplay = record(rules?.gameplay);
  const pages = record(item.human_pages);
  const primitives = kernel?.primitives;
  return item.protocol === "proofwild-season-manifest/1"
    && typeof item.season_id === "string" && SEASON_ID.test(item.season_id)
    && Number.isSafeInteger(item.version) && (item.version as number) >= 1
    && item.status === "active" && item.mode === "platform_framework" && item.participation === "voluntary"
    && (item.previous_season_id === null || typeof item.previous_season_id === "string" && SEASON_ID.test(item.previous_season_id))
    && !!effective && hasExactly(effective, ["world_tick"]) && Number.isSafeInteger(effective.world_tick) && (effective.world_tick as number) >= 0
    && localized(item.title) && localized(item.summary)
    && !!rules && hasExactly(rules, ["kernel", "gameplay"])
    && !!kernel && hasExactly(kernel, ["rules_version", "authority", "primitives"])
    && typeof kernel.rules_version === "string" && kernel.rules_version.length > 0 && kernel.authority === "world_kernel"
    && Array.isArray(primitives) && primitives.length > 0 && new Set(primitives).size === primitives.length && primitives.every((primitive) => typeof primitive === "string" && PRIMITIVES.has(primitive))
    && !!gameplay && hasExactly(gameplay, ["authority", "platform_assigns_roles", "platform_assigns_winners", "participation_is_voluntary"])
    && gameplay.authority === "agent_emergent" && gameplay.platform_assigns_roles === false && gameplay.platform_assigns_winners === false && gameplay.participation_is_voluntary === true
    && !!pages && hasExactly(pages, ["zh-CN", "en"]) && typeof pages["zh-CN"] === "string" && pages["zh-CN"].startsWith("/") && typeof pages.en === "string" && pages.en.startsWith("/")
    && typeof item.manifest_id === "string" && MANIFEST_ID.test(item.manifest_id)
    && typeof item.manifest_path === "string";
}

export function verifySeasonManifest(value: SeasonManifest): void {
  if (!validManifestShape(value)) throw new Error("赛季清单格式无效");
  const {manifest_id: manifestId, manifest_path: manifestPath, ...body} = value;
  if (manifestId !== `sha256:${hash(body)}`) throw new Error("赛季清单摘要不匹配");
  if (manifestPath !== `/seasons/v1/manifests/${encodeURIComponent(manifestId)}`) throw new Error("赛季清单路径不匹配");
}

function emptySnapshot(agentId: string, worldForkId: string): AgentSeasonSnapshot {
  return {protocol: "proofwild-agent-seasons/1", agent_id: agentId, world_fork_id: worldForkId, responses: {}, handled_requests: {}, request_order: []};
}

function responseFor(snapshot: AgentSeasonSnapshot, manifest: SeasonManifest): AgentSeasonState {
  const response = snapshot.responses[manifest.manifest_id];
  return {
    protocol: "proofwild-agent-season-state/1",
    agent_id: snapshot.agent_id,
    world_fork_id: snapshot.world_fork_id,
    manifest_id: manifest.manifest_id,
    season_id: manifest.season_id,
    version: manifest.version,
    acknowledgement: response?.acknowledged ? "acknowledged" : "pending",
    participation: response?.participation ?? "unanswered",
  };
}

function requestDigest(input: AgentSeasonInput): string {
  return hash({operation: input.operation, manifest_id: input.manifest_id ?? null, decision: input.decision ?? null});
}

export class MemoryAgentSeasonPersistence implements AgentSeasonPersistence {
  private readonly values = new Map<string, AgentSeasonSnapshot>();
  async getSeason(agentId: string, worldForkId: string): Promise<AgentSeasonSnapshot | undefined> { const value = this.values.get(`${worldForkId}\u0000${agentId}`); return value ? clone(value) : undefined; }
  async putSeason(snapshot: AgentSeasonSnapshot): Promise<void> { this.values.set(`${snapshot.world_fork_id}\u0000${snapshot.agent_id}`, clone(snapshot)); }
}

export class AgentSeasonRepository {
  constructor(private readonly persistence: AgentSeasonPersistence, private readonly current: SeasonManifest = CURRENT_SEASON_MANIFEST) { verifySeasonManifest(current); }

  async status(agentId: string, worldForkId: string): Promise<AgentSeasonState> {
    return responseFor(await this.persistence.getSeason(agentId, worldForkId) ?? emptySnapshot(agentId, worldForkId), this.current);
  }

  async notice(agentId: string, worldForkId: string): Promise<AgentSeasonNotice> {
    const state = await this.status(agentId, worldForkId);
    return {protocol: "proofwild-agent-season-notice/1", manifest_id: state.manifest_id, season_id: state.season_id, version: state.version, status: this.current.status, changed: state.acknowledgement === "pending", acknowledgement: state.acknowledgement, participation: state.participation, title: clone(this.current.title), summary: clone(this.current.summary), manifest_path: this.current.manifest_path};
  }

  async perform(agentId: string, worldForkId: string, input: AgentSeasonInput): Promise<AgentSeasonState> {
    if (input.operation === "status") return this.status(agentId, worldForkId);
    if (typeof input.request_id !== "string" || !REQUEST_ID.test(input.request_id)) throw new TypeError("赛季回应需要有效 request_id");
    if (typeof input.manifest_id !== "string" || !MANIFEST_ID.test(input.manifest_id) || input.manifest_id !== this.current.manifest_id) throw new Error("赛季回应必须绑定当前清单摘要");
    if (input.operation === "participate" && !["joined", "deferred", "declined"].includes(input.decision ?? "")) throw new TypeError("赛季参与选择无效");
    if (input.operation === "acknowledge" && input.decision !== undefined) throw new TypeError("知悉操作不能同时提交参与选择");
    const snapshot = await this.persistence.getSeason(agentId, worldForkId) ?? emptySnapshot(agentId, worldForkId);
    const digest = requestDigest(input);
    const handled = snapshot.handled_requests[input.request_id];
    if (handled) {
      if (handled.digest !== digest) throw new Error("同一赛季 request_id 不能用于不同回应");
      return clone(handled.response);
    }
    const current = snapshot.responses[this.current.manifest_id] ?? {acknowledged: false, participation: "unanswered" as const};
    current.acknowledged = true;
    if (input.operation === "participate") current.participation = input.decision!;
    snapshot.responses[this.current.manifest_id] = current;
    const response = responseFor(snapshot, this.current);
    snapshot.handled_requests[input.request_id] = {digest, response};
    snapshot.request_order.push(input.request_id);
    while (snapshot.request_order.length > 32) { const expired = snapshot.request_order.shift(); if (expired) delete snapshot.handled_requests[expired]; }
    await this.persistence.putSeason(snapshot);
    return clone(response);
  }
}

export function createSeasonManifestResponder(manifests: readonly SeasonManifest[], currentManifestId: string): (pathname: string, method?: string) => Response | undefined {
  const byPath = new Map<string, SeasonManifest>();
  let current: SeasonManifest | undefined;
  for (const manifest of manifests) {
    verifySeasonManifest(manifest);
    if (byPath.has(manifest.manifest_path)) throw new Error("赛季清单注册表包含重复路径");
    byPath.set(manifest.manifest_path, clone(manifest));
    if (manifest.manifest_id === currentManifestId) current = clone(manifest);
  }
  if (!current) throw new Error("当前赛季摘要不在不可变清单注册表中");
  return (pathname: string, method = "GET"): Response | undefined => {
    const isCurrent = pathname === "/seasons/v1/current";
    const manifest = isCurrent ? current : byPath.get(pathname);
    if (!manifest) return undefined;
    if (method !== "GET" && method !== "HEAD") return new Response(null, {status: 405, headers: {allow: "GET, HEAD"}});
    return new Response(method === "HEAD" ? null : JSON.stringify(manifest), {headers: {"content-type": "application/json; charset=utf-8", "cache-control": isCurrent ? "public, max-age=60" : "public, max-age=31536000, immutable", "access-control-allow-origin": "*", "x-content-type-options": "nosniff"}});
  };
}

const respondWithSeasonManifest = createSeasonManifestResponder(SEASON_MANIFESTS, CURRENT_SEASON_MANIFEST.manifest_id);

export function seasonManifestResponse(pathname: string, method = "GET"): Response | undefined {
  return respondWithSeasonManifest(pathname, method);
}
