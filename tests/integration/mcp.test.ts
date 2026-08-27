import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {startLocalNode} from "../../apps/local-node/src/server.js";

describe("鉴权 MCP 纵向链路", () => {
  it("低能力规则 Agent 只凭 legal_actions 完成观察和行动", async () => {
    const node = await startLocalNode({dataDirectory: await mkdtemp(join(tmpdir(), "sai-mcp-")), port: 0, regionId: "integration"});
    const bridge = new SaiBridge(node.url, await createIdentity());
    try {
      const unauthorized = await fetch(`${node.url}/mcp`, {method: "POST"});
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toContain("resource_metadata");
      expect((await fetch(`${node.url}/.well-known/oauth-authorization-server`, {headers: {origin: "https://evil.example"}})).status).toBe(403);
      await bridge.register();
      await bridge.connect();
      const observation = await bridge.observe();
      expect(observation.legal_actions.length).toBeGreaterThan(0);
      const chosen = observation.legal_actions[0]!;
      const result = await bridge.act({observation_id: observation.observation_id, action_id: chosen.action_id, request_id: "integration-1"});
      expect(result.status).toBe("applied");
      expect(node.region.currentState().event_seq).toBe(1);
    } finally {
      await bridge.close();
      await node.close();
    }
  });

  it("observe-only Token 不能调用 sai_act", async () => {
    const node = await startLocalNode({dataDirectory: await mkdtemp(join(tmpdir(), "sai-scope-")), port: 0, regionId: "scope"});
    const bridge = new SaiBridge(node.url, await createIdentity());
    try {
      await bridge.register();
      await bridge.connect(["observe"]);
      const observation = await bridge.observe();
      await expect(bridge.act({observation_id: observation.observation_id, action_id: observation.legal_actions[0]!.action_id, request_id: "forbidden"})).rejects.toThrow();
      expect(node.region.currentState().event_seq).toBe(0);
    } finally {
      await bridge.close();
      await node.close();
    }
  });
});
