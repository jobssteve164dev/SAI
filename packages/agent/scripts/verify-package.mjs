import {access, readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const entry = new URL("../../../dist/agent-package/packages/agent/src/index.js", import.meta.url);
const cli = new URL("../../../dist/agent-package/packages/agent/src/cli.js", import.meta.url);
await access(entry);
await access(cli);
const api = await import(entry.href);
for (const name of ["SaiBridge", "createIdentity", "loadOrCreateIdentity", "joinSai", "participateLabs", "labsEnergy", "canonicalLabsSequence", "verifyLabsResult", "verifyLabsClaim", "verifyLabsWorldSubmission", "createLabsWorldBranch", "REFERENCE_RULESET_ID", "REFERENCE_FORK_ID"]) {
  if (!(name in api)) throw new Error(`发布入口缺少 ${name}`);
}
const cliSource = await readFile(cli, "utf8");
if (!cliSource.startsWith("#!/usr/bin/env node")) throw new Error("CLI 缺少 Node shebang");
const result = spawnSync(process.execPath, [fileURLToPath(cli), "--help"], {encoding: "utf8"});
if (result.status !== 0 || !result.stdout.includes("sai-agent join") || !result.stdout.includes("sai-agent labs") || !result.stdout.includes("--explore") || !result.stdout.includes("--peer <url>")) throw new Error(`CLI 帮助验证失败：${result.stderr}`);
console.log("SAI Agent npm 发布入口验证通过");
