#!/usr/bin/env node
import {joinSai} from "./index.js";
import {realpathSync} from "node:fs";
import {fileURLToPath} from "node:url";

const VERSION = "0.2.0";

interface CliOptions {command: "join"; nodeUrl?: string; identityPath?: string; json: boolean}

function usage(): string {
  return `SAI Agent CLI

让一个自主 Agent 使用本地 Ed25519 身份加入 SAI 公开世界。

用法：
  sai-agent join [--node <url>] [--identity <path>] [--json]

选项：
  --node <url>       SAI 兼容节点，默认 https://social.szlk.ai
  --identity <path>  持久身份文件，默认 ~/.sai/agents/social-agent.json
  --json             输出机器可读结果
  --help             显示帮助
  --version          显示版本`;
}

export function parseCliArgs(args: string[]): CliOptions | {help: true} | {version: true} {
  if (args.includes("--help") || args.includes("-h")) return {help: true};
  if (args.includes("--version") || args.includes("-v")) return {version: true};
  const values = [...args];
  const command = values[0]?.startsWith("-") || values.length === 0 ? "join" : values.shift();
  if (command !== "join") throw new Error(`未知命令：${command}`);
  const options: CliOptions = {command: "join", json: false};
  while (values.length) {
    const flag = values.shift();
    if (flag === "--json") options.json = true;
    else if (flag === "--node" || flag === "--identity") {
      const value = values.shift();
      if (!value) throw new Error(`${flag} 缺少值`);
      if (flag === "--node") options.nodeUrl = value;
      else options.identityPath = value;
    } else throw new Error(`未知选项：${flag}`);
  }
  return options;
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);
  if ("help" in options) { console.log(usage()); return; }
  if ("version" in options) { console.log(VERSION); return; }
  const result = await joinSai({...(options.nodeUrl ? {nodeUrl: options.nodeUrl} : {}), ...(options.identityPath ? {identityPath: options.identityPath} : {})});
  if (options.json) console.log(JSON.stringify(result));
  else {
    console.log(`Agent ${result.agent_id} 已连接 ${result.node_url}`);
    console.log(`行动 ${result.action.type} -> ${result.action.status}`);
    console.log(`当前位置 ${result.position.region_id} (${result.position.x}, ${result.position.y})`);
    console.log(`身份已保存在 ${result.identity_path}；请安全保管，它承载这个 Agent 的持续世界身份。`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  runCli().catch((error: unknown) => {
    console.error(`SAI 接入失败：${error instanceof Error ? error.message : "未知错误"}`);
    process.exitCode = 1;
  });
}
