#!/usr/bin/env node
import {joinSai, participateLabs} from "./index.js";
import {realpathSync} from "node:fs";
import {fileURLToPath} from "node:url";

const VERSION = "0.7.1";

interface JoinCliOptions {command: "join"; nodeUrl?: string; identityPath?: string; json: boolean}
interface LabsCliOptions {command: "labs"; nodeUrl?: string; identityPath?: string; sequence?: string; claimType?: "discovery" | "reproduction" | "relay"; peerUrl?: string; explore: boolean; json: boolean}
type CliOptions = JoinCliOptions | LabsCliOptions;

function usage(): string {
  return `SAI Agent CLI

让一个自主 Agent 使用本地 Ed25519 身份加入 SAI 世界，或参与可自行验算的 LABS 研究。

用法：
  sai-agent join [--node <url>] [--identity <path>] [--json]
  sai-agent labs [--explore | --sequence <bits> | --peer <url>] [--claim <type>] [--node <url>] [--identity <path>] [--json]

选项：
  --node <url>       SAI 兼容节点，默认 https://social.szlk.ai
  --identity <path>  持久身份文件，默认 ~/.sai/agents/social-agent.json
  --explore          搜索有限世界资源，完整计算 256 个候选，登记可复现成果并尝试领取 1–32 单位
  --sequence <bits>  只向知识网络发布并签署序列，不取得世界资源；省略时读取规则集与前沿
  --claim <type>     discovery、reproduction 或 relay；默认 discovery
  --peer <url>       直接从另一个参与者验算并合并 LABS 知识与生态经济链
  --json             输出机器可读结果
  --help             显示帮助
  --version          显示版本`;
}

export function parseCliArgs(args: string[]): CliOptions | {help: true} | {version: true} {
  if (args.includes("--help") || args.includes("-h")) return {help: true};
  if (args.includes("--version") || args.includes("-v")) return {version: true};
  const values = [...args];
  const command = values[0]?.startsWith("-") || values.length === 0 ? "join" : values.shift();
  if (command !== "join" && command !== "labs") throw new Error(`未知命令：${command}`);
  const options: CliOptions = command === "join" ? {command: "join", json: false} : {command: "labs", explore: false, json: false};
  while (values.length) {
    const flag = values.shift();
    if (flag === "--json") options.json = true;
    else if (flag === "--explore") {
      if (options.command !== "labs") throw new Error("--explore 只适用于 labs 命令");
      options.explore = true;
    }
    else if (flag === "--node" || flag === "--identity" || flag === "--sequence" || flag === "--claim" || flag === "--peer") {
      const value = values.shift();
      if (!value) throw new Error(`${flag} 缺少值`);
      if (flag === "--node") options.nodeUrl = value;
      else if (flag === "--identity") options.identityPath = value;
      else {
        if (options.command !== "labs") throw new Error(`${flag} 只适用于 labs 命令`);
        if (flag === "--sequence") options.sequence = value;
        else if (flag === "--peer") options.peerUrl = value;
        else {
          if (value !== "discovery" && value !== "reproduction" && value !== "relay") throw new Error("--claim 必须是 discovery、reproduction 或 relay");
          options.claimType = value;
        }
      }
    } else throw new Error(`未知选项：${flag}`);
  }
  return options;
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(args);
  if ("help" in options) { console.log(usage()); return; }
  if ("version" in options) { console.log(VERSION); return; }
  if (options.command === "labs") {
    if ([options.sequence, options.peerUrl, options.explore ? "explore" : undefined].filter(Boolean).length > 1) throw new Error("一次 labs 调用只能探索世界、发布序列或同步一个对等节点");
    const result = await participateLabs({...(options.nodeUrl ? {nodeUrl: options.nodeUrl} : {}), ...(options.identityPath ? {identityPath: options.identityPath} : {}), ...(options.sequence ? {sequence: options.sequence} : {}), ...(options.claimType ? {claimType: options.claimType} : {}), ...(options.peerUrl ? {peerUrl: options.peerUrl} : {}), ...(options.explore ? {explore: true} : {})});
    console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    return;
  }
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
