import {resolve} from "node:path";
import {startLocalNode} from "./server.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const node = await startLocalNode({dataDirectory: resolve(argument("data", ".sai-data")), host: argument("host", "127.0.0.1"), port: Number(argument("port", "8787")), regionId: argument("region", "local")});
console.log(`SAI M0 节点已启动：${node.url}/mcp`);
console.log(`OAuth 元数据：${node.url}/.well-known/oauth-authorization-server`);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void node.close().then(() => process.exit(0)));
