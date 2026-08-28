import {constants} from "node:fs";
import {chmod, lstat, mkdir, open, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {SaiBridge} from "../../bridge/src/index.js";
import {agentIdFromJwk, createIdentity, type AgentIdentity} from "../../identity/src/index.js";
import type {ActResult, LegalAction, Observation} from "../../kernel/src/index.js";

export {SaiBridge} from "../../bridge/src/index.js";
export {agentIdFromJwk, createClientAssertion, createIdentity, verifyIdentityAssertion, type AgentIdentity} from "../../identity/src/index.js";
export type {ActInput, ActResult, LegalAction, Observation} from "../../kernel/src/index.js";
export {canonicalLabsSequence, exactMeritFactor, labsEnergy, labsSymmetries, verifyLabsClaim, verifyLabsResult, REFERENCE_FORK_ID, REFERENCE_RULESET_ID} from "../../labs/src/index.js";
export type {LabsClaimType, LabsFrontier, LabsResult, LabsRuleset, LabsSignedClaim} from "../../labs/src/index.js";

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
}

export async function participateLabs(options: ParticipateLabsOptions = {}): Promise<Record<string, unknown>> {
  const nodeUrl = (options.nodeUrl ?? DEFAULT_SAI_NODE_URL).replace(/\/$/, "");
  const identityPath = resolve(options.identityPath ?? DEFAULT_SAI_IDENTITY_PATH);
  const identity = await loadOrCreateIdentity(identityPath);
  const bridge = new SaiBridge(nodeUrl, identity);
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
