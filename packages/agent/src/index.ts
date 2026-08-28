import {constants} from "node:fs";
import {chmod, lstat, mkdir, open, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {SaiBridge} from "../../bridge/src/index.js";
import {agentIdFromJwk, createIdentity, type AgentIdentity} from "../../identity/src/index.js";
import type {ActResult, LegalAction, Observation} from "../../kernel/src/index.js";
import {labsSymmetries as computeLabsSymmetries} from "../../labs/src/index.js";

export {SaiBridge} from "../../bridge/src/index.js";
export {agentIdFromJwk, createClientAssertion, createIdentity, verifyIdentityAssertion, type AgentIdentity} from "../../identity/src/index.js";
export type {ActInput, ActResult, LegalAction, Observation} from "../../kernel/src/index.js";
export {WORLD_MAX_SUPPLY, WORLD_SUPPLY_ALLOCATIONS, WORLD_SUPPLY_SCHEDULE_BODY, WORLD_SUPPLY_SCHEDULE_ID, createWorldSupplySchedule, worldIssuedAtHeight, worldSubsidyAtHeight, worldSupplyScheduleId} from "../../kernel/src/index.js";
export type {WorldSupplyObservation, WorldSupplyState} from "../../kernel/src/index.js";
export {canonicalLabsSequence, createLabsWorldBranch, exactMeritFactor, labsEnergy, labsSymmetries, verifyLabsClaim, verifyLabsResult, verifyLabsWorldSubmission, REFERENCE_FORK_ID, REFERENCE_RULESET_ID} from "../../labs/src/index.js";
export type {LabsClaimType, LabsFrontier, LabsResult, LabsRuleset, LabsSignedClaim, LabsWorldBranch} from "../../labs/src/index.js";

export const DEFAULT_SAI_NODE_URL = "https://social.szlk.ai";
export const DEFAULT_SAI_IDENTITY_PATH = resolve(homedir(), ".sai", "agents", "social-agent.json");

export interface JoinSaiOptions {
  nodeUrl?: string;
  identityPath?: string;
  selectAction?: (observation: Observation) => LegalAction | Promise<LegalAction>;
}

export interface JoinSaiResult {
  agent_id: string;
  node_url: string;
  identity_path: string;
  action: {type: LegalAction["type"]; status: ActResult["status"]};
  position: {region_id: string; x: number; y: number};
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function loadOrCreateIdentity(identityPath = DEFAULT_SAI_IDENTITY_PATH): Promise<AgentIdentity> {
  const absolutePath = resolve(identityPath);
  try {
    const file = await lstat(absolutePath);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("身份路径必须是普通文件，不能是符号链接");
    const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw: string;
    try {
      raw = await handle.readFile({encoding: "utf8"});
    } finally {
      await handle.close();
    }
    const identity = JSON.parse(raw) as AgentIdentity;
    if (agentIdFromJwk(identity.publicJwk) !== identity.agentId || !identity.privateJwk.d) throw new Error("身份文件不是完整、匹配的 Ed25519 身份");
    if (process.platform !== "win32") await chmod(absolutePath, 0o600);
    return identity;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const identity = await createIdentity();
  await mkdir(dirname(absolutePath), {recursive: true, mode: 0o700});
  await writeFile(absolutePath, `${JSON.stringify(identity, null, 2)}\n`, {encoding: "utf8", mode: 0o600, flag: "wx"});
  return identity;
}

function chooseDefaultAction(observation: Observation): LegalAction {
  const chosen = observation.legal_actions.find((action) => action.type === "gather")
    ?? observation.legal_actions.find((action) => action.type === "move")
    ?? observation.legal_actions.find((action) => action.type === "wait")
    ?? observation.legal_actions[0];
  if (!chosen) throw new Error("当前观察没有可执行行动");
  return chosen;
}

export async function joinSai(options: JoinSaiOptions = {}): Promise<JoinSaiResult> {
  const nodeUrl = (options.nodeUrl ?? DEFAULT_SAI_NODE_URL).replace(/\/$/, "");
  const identityPath = resolve(options.identityPath ?? DEFAULT_SAI_IDENTITY_PATH);
  const identity = await loadOrCreateIdentity(identityPath);
  const bridge = new SaiBridge(nodeUrl, identity);
  try {
    await bridge.register();
    await bridge.connect();
    const observation = await bridge.observe();
    const chosen = options.selectAction ? await options.selectAction(observation) : chooseDefaultAction(observation);
    if (!observation.legal_actions.some((action) => action.action_id === chosen.action_id)) throw new Error("策略选择了当前观察中不存在的行动");
    const result = await bridge.act({observation_id: observation.observation_id, action_id: chosen.action_id, request_id: `${identity.agentId}:${randomUUID()}`});
    const current = await bridge.observe();
    return {
      agent_id: identity.agentId,
      node_url: nodeUrl,
      identity_path: identityPath,
      action: {type: chosen.type, status: result.status},
      position: {region_id: current.region_id, x: current.self.x, y: current.self.y},
    };
  } finally {
    await bridge.close();
  }
}

export interface ParticipateLabsOptions {
  nodeUrl?: string;
  identityPath?: string;
  sequence?: string;
  claimType?: import("../../labs/src/index.js").LabsClaimType;
  peerUrl?: string;
  explore?: boolean;
}

function directionTarget(observation: Observation, direction: LegalAction["direction"]): {x: number; y: number} {
  const delta = {north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0]} as const;
  const [dx, dy] = delta[direction!];
  return {x: observation.self.x + dx, y: observation.self.y + dy};
}

async function exploreLabsWorld(bridge: SaiBridge, identity: AgentIdentity): Promise<Record<string, unknown>> {
  await bridge.register();
  await bridge.connect();
  const visited = new Set<string>();
  const parents = new Map<string, string>();
  try {
    for (let step = 0; step < 512; step += 1) {
      const observation = await bridge.observe({max_bytes: 32_768});
      const here = `${observation.self.x}:${observation.self.y}`;
      visited.add(here);
      const research = observation.legal_actions.find((action) => action.type === "research");
      if (research) {
        const resource = observation.nearby.find((item) => item.type === "resource" && item.id === research.target);
        if (resource?.type !== "resource" || !resource.labs_branch) throw new Error("LABS 研究动作缺少当前世界分支");
        const {ruleset} = await bridge.labsRuleset(resource.labs_branch.ruleset_id);
        const baseline = ruleset.baselines.find((item) => item.length === resource.labs_branch!.length);
        const candidate = baseline ? computeLabsSymmetries(baseline.sequence).find((item) => item.startsWith(resource.labs_branch!.sequence_prefix)) : undefined;
        if (!candidate) throw new Error("公开参考序列不能复现当前 LABS 世界分支");
        const result = await bridge.act({observation_id: observation.observation_id, action_id: research.action_id, arguments: {operation: "solve_branch", sequence: candidate, claim_type: "reproduction"}, request_id: `${identity.agentId}:${randomUUID()}`});
        return {operation: "solve_world_branch", agent_id: identity.agentId, world_fork_id: observation.world_fork_id, region_id: observation.region_id, resource_id: resource.id, branch_id: resource.labs_branch.branch_id, schedule_id: resource.labs_branch.schedule_id, research_height: resource.labs_branch.research_height, subsidy: resource.labs_branch.subsidy, result, steps: step};
      }

      const wait = observation.legal_actions.find((action) => action.type === "wait")!;
      const moves = observation.legal_actions.filter((action) => action.type === "move" && action.direction);
      let chosen: LegalAction | undefined;
      const visible = observation.nearby.find((item) => item.type === "resource" && item.remaining > 0 && item.labs_branch);
      if (visible?.type === "resource") {
        if (visible.x === observation.self.x && visible.y === observation.self.y) chosen = wait;
        else {
          const desired = visible.x !== observation.self.x ? (visible.x > observation.self.x ? "east" : "west") : visible.y > observation.self.y ? "south" : "north";
          chosen = moves.find((action) => action.direction === desired);
        }
      }
      if (!chosen) {
        chosen = moves.find((action) => {
          const target = directionTarget(observation, action.direction);
          const key = `${target.x}:${target.y}`;
          if (visited.has(key)) return false;
          parents.set(key, here);
          return true;
        });
      }
      if (!chosen) {
        const parent = parents.get(here);
        chosen = parent ? moves.find((action) => {
          const target = directionTarget(observation, action.direction);
          return `${target.x}:${target.y}` === parent;
        }) : undefined;
      }
      chosen ??= moves[0] ?? wait;
      await bridge.act({observation_id: observation.observation_id, action_id: chosen.action_id, request_id: `${identity.agentId}:${randomUUID()}`});
    }
    return {operation: "explore_world", agent_id: identity.agentId, status: "no_labs_resource_found", steps: 512};
  } finally {
    await bridge.close();
  }
}

export async function participateLabs(options: ParticipateLabsOptions = {}): Promise<Record<string, unknown>> {
  const nodeUrl = (options.nodeUrl ?? DEFAULT_SAI_NODE_URL).replace(/\/$/, "");
  const identityPath = resolve(options.identityPath ?? DEFAULT_SAI_IDENTITY_PATH);
  const identity = await loadOrCreateIdentity(identityPath);
  const bridge = new SaiBridge(nodeUrl, identity);
  if (options.explore) return {node_url: nodeUrl, identity_path: identityPath, ...(await exploreLabsWorld(bridge, identity))};
  if (options.peerUrl) {
    const frontier = await bridge.labsSync(options.peerUrl);
    return {operation: "sync", agent_id: identity.agentId, node_url: nodeUrl, peer_url: options.peerUrl, frontier};
  }
  if (options.sequence) {
    const published = await bridge.labsPublish(options.sequence, options.claimType ?? "discovery");
    return {operation: "publish", agent_id: identity.agentId, node_url: nodeUrl, identity_path: identityPath, ...published};
  }
  const discovery = await bridge.labsDiscover();
  return {operation: "observe", agent_id: identity.agentId, node_url: nodeUrl, ...discovery};
}
