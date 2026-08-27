import {mkdtemp, readFile, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {loadOrCreateIdentity} from "../../packages/agent/src/index.js";
import {parseCliArgs} from "../../packages/agent/src/cli.js";

describe("可发布 SAI Agent 包", () => {
  it("持久保存并复用同一个 Ed25519 身份", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sai-agent-package-"));
    const identityPath = join(directory, "identity.json");
    const first = await loadOrCreateIdentity(identityPath);
    const second = await loadOrCreateIdentity(identityPath);
    expect(second).toEqual(first);
    expect(JSON.parse(await readFile(identityPath, "utf8")).agentId).toBe(first.agentId);
    if (process.platform !== "win32") expect((await stat(identityPath)).mode & 0o777).toBe(0o600);
  });

  it("CLI 默认加入公开世界并吸收节点、身份和 JSON 参数", () => {
    expect(parseCliArgs([])).toEqual({command: "join", json: false});
    expect(parseCliArgs(["join", "--node", "https://node.example", "--identity", "agent.json", "--json"])).toEqual({command: "join", nodeUrl: "https://node.example", identityPath: "agent.json", json: true});
    expect(() => parseCliArgs(["deploy"])).toThrow("未知命令");
  });
});
