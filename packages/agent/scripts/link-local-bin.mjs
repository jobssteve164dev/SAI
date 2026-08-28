import {chmod, lstat, mkdir, readFile, realpath, symlink, writeFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = resolve(packageRoot, "bin/proofwild-agent.js");
const binDirectory = resolve(packageRoot, "node_modules/.bin");

await mkdir(binDirectory, {recursive: true});
await chmod(executable, 0o755);
if (process.platform === "win32") {
  const command = resolve(binDirectory, "proofwild-agent.cmd");
  const content = "@node \"%~dp0\\..\\..\\bin\\proofwild-agent.js\" %*\r\n";
  try { await writeFile(command, content, {encoding: "utf8", flag: "wx"}); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    if (await readFile(command, "utf8") !== content) throw new Error("node_modules/.bin/proofwild-agent.cmd 已存在且不指向当前正式入口");
  }
} else {
  const link = resolve(binDirectory, "proofwild-agent");
  try { await symlink(relative(binDirectory, executable), link); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = await lstat(link);
    if (!existing.isSymbolicLink() || await realpath(link) !== await realpath(executable)) throw new Error("node_modules/.bin/proofwild-agent 已存在且不指向当前正式入口");
  }
}
