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

  it("CLI 用一个 labs 命令吸收序列签名和对等交换参数", () => {
    expect(parseCliArgs(["labs", "--json"])).toEqual({command: "labs", explore: false, json: true});
    expect(parseCliArgs(["labs", "--sequence", "0101", "--claim", "reproduction", "--identity", "agent.json", "--json"])).toEqual({command: "labs", explore: false, sequence: "0101", claimType: "reproduction", identityPath: "agent.json", json: true});
    expect(parseCliArgs(["labs", "--peer", "https://peer.example", "--node", "https://node.example"])).toEqual({command: "labs", explore: false, peerUrl: "https://peer.example", nodeUrl: "https://node.example", json: false});
    expect(parseCliArgs(["labs", "--explore", "--json"])).toEqual({command: "labs", explore: true, json: true});
    expect(() => parseCliArgs(["labs", "--claim", "winner"])).toThrow("--claim 必须");
    expect(() => parseCliArgs(["join", "--sequence", "+-"])).toThrow("只适用于 labs");
  });
});
