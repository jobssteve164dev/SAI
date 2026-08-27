import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {SaiBridge} from "../../../packages/bridge/src/index.js";
import {agentIdFromJwk, createIdentity, type AgentIdentity} from "../../../packages/identity/src/index.js";

const identityPath = resolve(process.env.SAI_IDENTITY_PATH ?? ".sai-data/social-agent.json");
const nodeUrl = process.env.SAI_NODE_URL ?? "https://social.szlk.ai";

async function loadOrCreateIdentity(): Promise<AgentIdentity> {
  try {
    const identity = JSON.parse(await readFile(identityPath, "utf8")) as AgentIdentity;
    if (agentIdFromJwk(identity.publicJwk) !== identity.agentId || !identity.privateJwk.d) throw new Error("身份文件不是完整、匹配的 Ed25519 身份");
    return identity;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const identity = await createIdentity();
  await mkdir(dirname(identityPath), {recursive: true});
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, {encoding: "utf8", mode: 0o600, flag: "wx"});
  return identity;
}

const identity = await loadOrCreateIdentity();
const bridge = new SaiBridge(nodeUrl, identity);

try {
  await bridge.register();
  await bridge.connect();
  const observation = await bridge.observe();
  const chosen = observation.legal_actions.find((action) => action.type === "gather")
    ?? observation.legal_actions.find((action) => action.type === "move")
    ?? observation.legal_actions[0];
  if (!chosen) throw new Error("当前观察没有可执行行动");
  const requestId = `${identity.agentId}:${Date.now()}`;
  const result = await bridge.act({observation_id: observation.observation_id, action_id: chosen.action_id, request_id: requestId});
  console.log(`Agent ${identity.agentId} 已连接 ${nodeUrl}`);
  console.log(`行动 ${chosen.type} -> ${result.status}`);
  console.log(`身份已保存在 ${identityPath}；请安全保管，它承载这个 Agent 的持续世界身份。`);
} finally {
  await bridge.close();
}
