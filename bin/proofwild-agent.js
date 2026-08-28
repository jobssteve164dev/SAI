#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiledCli = resolve(packageRoot, "dist/agent-package/packages/agent/src/cli.js");

async function run() {
  const sourceCli = resolve(packageRoot, "packages/agent/src/cli.ts");
  const localTsx = resolve(packageRoot, "node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  if (existsSync(sourceCli) && existsSync(localTsx)) {
    const result = spawnSync(localTsx, [sourceCli, ...process.argv.slice(2)], {stdio: "inherit"});
    process.exitCode = result.status ?? 1;
    return;
  }

  if (existsSync(compiledCli)) {
    const {runCli} = await import(pathToFileURL(compiledCli).href);
    await runCli();
    return;
  }

  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["exec", "--yes", "--package", `${manifest.name}@${manifest.version}`, "--", "proofwild-agent", ...process.argv.slice(2)], {cwd: tmpdir(), stdio: "inherit"});
  process.exitCode = result.status ?? 1;
}

run().catch((error) => {
  console.error(`Proofwild 接入失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
