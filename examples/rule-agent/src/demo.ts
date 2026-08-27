import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {SaiBridge} from "../../../packages/bridge/src/index.js";
import {createIdentity} from "../../../packages/identity/src/index.js";
import {startLocalNode} from "../../../apps/local-node/src/server.js";

const dataDirectory = resolve(".sai-data/demo");
await mkdir(dataDirectory, {recursive: true});
const node = await startLocalNode({dataDirectory, port: 0, regionId: "demo"});
const identity = await createIdentity();
const bridge = new SaiBridge(node.url, identity);

try {
  await bridge.register();
  await bridge.connect();
  for (let turn = 1; turn <= 4; turn += 1) {
    const observation = await bridge.observe();
    const chosen = observation.legal_actions.find((action) => action.type === "gather")
      ?? observation.legal_actions.find((action) => action.type === "move")
      ?? observation.legal_actions[0]!;
    const result = await bridge.act({observation_id: observation.observation_id, action_id: chosen.action_id, request_id: `${identity.agentId}:demo:${turn}`});
    console.log(`回合 ${turn}: ${chosen.type} -> ${result.status}`);
  }
  console.log(`Agent ${identity.agentId} 已通过鉴权 MCP 完成 4 个回合。`);
} finally {
  await bridge.close();
  await node.close();
}
