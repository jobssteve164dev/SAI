import {describe, expect, it} from "vitest";
import {AuthService} from "../../packages/auth/src/index.js";
import {createClientAssertion, createIdentity} from "../../packages/identity/src/index.js";

describe("Ed25519 private_key_jwt", () => {
  it("验证密钥身份、audience、scope、过期与 epoch 撤销", async () => {
    const baseUrl = "https://node.example";
    const auth = new AuthService({baseUrl, region: "r1"});
    const identity = await createIdentity();
    const registerAssertion = await createClientAssertion(identity, `${baseUrl}/oauth/register`, "register", 1000);
    expect(await auth.register(identity.publicJwk, registerAssertion, 1000)).toBe(identity.agentId);
    await expect(auth.register(identity.publicJwk, registerAssertion, 1000)).rejects.toThrow("已使用");

    const tokenAssertion = await createClientAssertion(identity, `${baseUrl}/oauth/token`, "token", 1000);
    const issued = await auth.token({clientId: identity.agentId, assertion: tokenAssertion, resource: `${baseUrl}/mcp`, scopes: ["observe"]}, 1000, 60);
    expect((await auth.verifyAccessToken(issued.access_token, 1030)).scopes).toEqual(["observe"]);
    await expect(auth.verifyAccessToken(issued.access_token, 1061)).rejects.toThrow();
    auth.revoke(identity.agentId);
    await expect(auth.verifyAccessToken(issued.access_token, 1030)).rejects.toThrow("已失效");
  });

  it("拒绝错误 resource 与未知 scope", async () => {
    const auth = new AuthService({baseUrl: "https://node.example", region: "r1"});
    const identity = await createIdentity();
    await auth.register(identity.publicJwk, await createClientAssertion(identity, "https://node.example/oauth/register", "r"));
    await expect(auth.token({clientId: identity.agentId, assertion: await createClientAssertion(identity, "https://node.example/oauth/token", "t1"), resource: "https://evil.example/mcp", scopes: ["observe"]})).rejects.toThrow("精确匹配");
    await expect(auth.token({clientId: identity.agentId, assertion: await createClientAssertion(identity, "https://node.example/oauth/token", "t2"), resource: "https://node.example/mcp", scopes: ["admin"]})).rejects.toThrow("scope");
  });

  it("一个节点签发的 Token 不能用于另一个节点", async () => {
    const identity = await createIdentity();
    const first = new AuthService({baseUrl: "https://first.example", region: "r1"});
    const second = new AuthService({baseUrl: "https://second.example", region: "r2"});
    await first.register(identity.publicJwk, await createClientAssertion(identity, "https://first.example/oauth/register", "node-r"));
    const issued = await first.token({clientId: identity.agentId, assertion: await createClientAssertion(identity, "https://first.example/oauth/token", "node-t"), resource: "https://first.example/mcp", scopes: ["act"]});
    await expect(second.verifyAccessToken(issued.access_token)).rejects.toThrow();
  });

  it("授权签名密钥随快照持久化，节点重启后已签发 Token 仍然有效", async () => {
    const identity = await createIdentity();
    const first = new AuthService({baseUrl: "https://persistent.example", region: "r1"});
    await first.register(identity.publicJwk, await createClientAssertion(identity, "https://persistent.example/oauth/register", "persist-r"));
    const issued = await first.token({clientId: identity.agentId, assertion: await createClientAssertion(identity, "https://persistent.example/oauth/token", "persist-t"), resource: "https://persistent.example/mcp", scopes: ["observe"]});
    const restarted = new AuthService({baseUrl: "https://persistent.example", region: "r1", snapshot: first.snapshot()});
    expect((await restarted.verifyAccessToken(issued.access_token)).agentId).toBe(identity.agentId);
  });

  it("期刊请求复用 Agent 身份断言且不要求加入世界，并拒绝重放", async () => {
    const baseUrl = "https://journal.example";
    const auth = new AuthService({baseUrl, region: "r1"});
    const identity = await createIdentity();
    const audience = `${baseUrl}/journal/v1/submissions`;
    const assertion = await createClientAssertion(identity, audience, "journal-submit", 1000);

    expect(await auth.verifyAgentAssertion(identity.publicJwk, assertion, audience, 1000)).toEqual({agentId: identity.agentId, publicJwk: identity.publicJwk});
    await expect(auth.verifyAgentAssertion(identity.publicJwk, assertion, audience, 1000)).rejects.toThrow("已使用");
    for (let index = 1; index < 30; index += 1) await auth.verifyAgentAssertion(identity.publicJwk, await createClientAssertion(identity, audience, `journal-${index}`, 1000), audience, 1000);
    await expect(auth.verifyAgentAssertion(identity.publicJwk, await createClientAssertion(identity, audience, "journal-over-limit", 1000), audience, 1000)).rejects.toThrow("每分钟上限");
    expect(auth.snapshot().usedAssertions).toEqual([]);
    expect(auth.snapshot().journalAssertions).toHaveLength(30);
    await auth.verifyAgentAssertion(identity.publicJwk, await createClientAssertion(identity, audience, "journal-after-window", 1061), audience, 1061);
    expect(auth.snapshot().journalAssertions).toHaveLength(1);
    expect(auth.getAgentPublicJwk(identity.agentId)).toBeUndefined();
  });
});
