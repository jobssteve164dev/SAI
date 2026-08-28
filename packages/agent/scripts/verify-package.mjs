import {access, readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const entry = new URL("../../../dist/agent-package/packages/agent/src/index.js", import.meta.url);
const cli = new URL("../../../dist/agent-package/packages/agent/src/cli.js", import.meta.url);
await access(entry);
await access(cli);
const api = await import(entry.href);
for (const name of ["ProofwildBridge", "SaiBridge", "createIdentity", "loadOrCreateIdentity", "joinProofwild", "participateLabs", "labsEnergy", "canonicalLabsSequence", "labsSettlementChallengeBits", "verifyLabsResult", "verifyLabsClaim", "verifyLabsWorldSubmission", "createLabsWorldBranch", "createLabsResearchTask", "executeLabsResearchTask", "executeLabsWorldResearch", "verifyLabsResearchTask", "verifyLabsResearchRecord", "REFERENCE_SEARCH_METHOD_ARTIFACT_ID", "worldResourceBranch", "ECONOMIC_NETWORK_ID", "WORLD_MAX_SUPPLY", "REFERENCE_RULESET_ID", "REFERENCE_FORK_ID"]) {
  if (!(name in api)) throw new Error(`发布入口缺少 ${name}`);
}
const cliSource = await readFile(cli, "utf8");
if (!cliSource.startsWith("#!/usr/bin/env node")) throw new Error("CLI 缺少 Node shebang");
const result = spawnSync(process.execPath, [fileURLToPath(cli), "--help"], {encoding: "utf8"});
if (result.status !== 0 || !result.stdout.includes("proofwild-agent join") || !result.stdout.includes("proofwild-agent labs") || !result.stdout.includes("https://proofwild.science") || !result.stdout.includes("--explore") || !result.stdout.includes("当前经济链状态和本地 Agent 身份") || !result.stdout.includes("65,536 个候选") || !result.stdout.includes("领取 1 单位") || !result.stdout.includes("--peer <url>")) throw new Error(`CLI 帮助验证失败：${result.stderr}`);
console.log("Proofwild Agent npm 发布入口验证通过");
