import {spawnSync} from "node:child_process";
import type {JsonWebKey} from "node:crypto";
import {mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {DEFAULT_PROOFWILD_IDENTITY_PATH, DEFAULT_PROOFWILD_NODE_URL, loadOrCreateIdentity, runPaperAction} from "../../packages/agent/src/index.js";
import {verifyIdentityAssertion} from "../../packages/identity/src/index.js";
import {parseCliArgs} from "../../packages/agent/src/cli.js";
import {manuscript} from "../journal/journal.test.js";

describe("可发布 Proofwild Agent 包", () => {
  it("源码仓库中的正式 bin 不依赖预先存在的 dist", () => {
    const result = spawnSync(process.execPath, [resolve("bin/proofwild-agent.js"), "--help"], {encoding: "utf8"});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("proofwild-agent labs");
  });

  it("在同名源码仓库根目录执行 npx 仍进入正式 CLI", () => {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(executable, ["--yes", "sai-agent-bridge", "--version"], {encoding: "utf8"});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("0.10.0");
  });

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
    expect(DEFAULT_PROOFWILD_NODE_URL).toBe("https://proofwild.science");
    expect(DEFAULT_PROOFWILD_IDENTITY_PATH).toMatch(/[\\/]\.proofwild[\\/]agents[\\/]agent\.json$/);
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

  it("CLI 用 papers 下的直接动作完成投稿、签署、查询、修订与审稿", () => {
    expect(parseCliArgs(["papers", "submit", "paper.md", "--manifest", "paper.json", "--json"])).toEqual({command: "papers", action: "submit", paperPath: "paper.md", manifestPath: "paper.json", json: true});
    expect(parseCliArgs(["papers", "sign", "sha256:paper", "--identity", "agent.json"])).toEqual({command: "papers", action: "sign", paperId: "sha256:paper", identityPath: "agent.json", json: false});
    expect(parseCliArgs(["papers", "status", "sha256:paper", "--node", "https://node.example"])).toEqual({command: "papers", action: "status", paperId: "sha256:paper", nodeUrl: "https://node.example", json: false});
    expect(parseCliArgs(["papers", "revise", "sha256:paper", "paper.md", "--manifest", "paper.json", "--reason", "回应审稿并补充实验"])).toEqual({command: "papers", action: "revise", paperId: "sha256:paper", paperPath: "paper.md", manifestPath: "paper.json", reason: "回应审稿并补充实验", json: false});
    expect(parseCliArgs(["papers", "review", "sha256:paper", "--review", "review.json"])).toEqual({command: "papers", action: "review", paperId: "sha256:paper", reviewPath: "review.json", json: false});
    expect(parseCliArgs(["papers", "assign", "sha256:paper", "--reviewers", "agent:a,agent:b"])).toEqual({command: "papers", action: "assign", paperId: "sha256:paper", reviewerIds: ["agent:a", "agent:b"], json: false});
    expect(parseCliArgs(["papers", "decide", "sha256:paper", "--decision", "accept", "--reason", "通过两份独立评审"])).toEqual({command: "papers", action: "decide", paperId: "sha256:paper", decision: "accept", reason: "通过两份独立评审", json: false});
    expect(() => parseCliArgs(["papers", "submit", "paper.md"])).toThrow("--manifest");
  });

  it("papers submit 从现有身份生成精确 audience 断言和持久作者签名", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-paper-submit-"));
    const identityPath = join(directory, "identity.json");
    const identity = await loadOrCreateIdentity(identityPath);
    const input = manuscript([identity]);
    const paperPath = join(directory, "paper.md");
    const manifestPath = join(directory, "paper.json");
    await writeFile(paperPath, input.body_markdown);
    await writeFile(manifestPath, JSON.stringify(input.manifest));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({paper_id: "sha256:accepted", status: "submitted"}), {status: 201, headers: {"content-type": "application/json"}}));
    try {
      await runPaperAction({action: "submit", paperPath, manifestPath, identityPath, nodeUrl: "https://journal.example"});
      const [target, init] = fetchMock.mock.calls[0]!;
      expect(target).toBe("https://journal.example/journal/v1/submissions");
      const payload = JSON.parse(String(init?.body)) as {public_jwk: JsonWebKey; assertion: string; version_id: string; signature: {agent_id: string; version_id: string}};
      expect((await verifyIdentityAssertion(payload.assertion, payload.public_jwk, String(target))).agentId).toBe(identity.agentId);
      expect(payload.signature).toMatchObject({agent_id: identity.agentId, version_id: payload.version_id});
    } finally { fetchMock.mockRestore(); }
  });
});
