import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {startLocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {AgentSeasonRepository, CURRENT_SEASON_BODY, MemoryAgentSeasonPersistence, createSeasonManifestResponder, seasonManifest, verifySeasonManifest} from "../../packages/season/src/index.js";

type SeasonNotice = {
  protocol: "proofwild-agent-season-notice/1";
  manifest_id: string;
  season_id: string;
  version: number;
  status: "active";
  changed: boolean;
  acknowledgement: "pending" | "acknowledged";
  participation: "unanswered" | "joined" | "deferred" | "declined";
  manifest_path: string;
  manifest?: Record<string, any>;
};

type SeasonResult = {
  protocol: "proofwild-agent-season-state/1";
  manifest_id: string;
  season_id: string;
  version: number;
  acknowledgement: "pending" | "acknowledged";
  participation: "unanswered" | "joined" | "deferred" | "declined";
};

describe("Agent 赛季通知与自主参与", () => {
  it("拒绝即使摘要自洽但协议字段非法的清单", () => {
    const malformed = seasonManifest({...structuredClone(CURRENT_SEASON_BODY), protocol: "wrong-protocol"} as any);
    expect(() => verifySeasonManifest(malformed)).toThrow("赛季清单格式无效");
  });

  it("发布新摘要后不沿用旧赛季的知悉或参与选择", async () => {
    const persistence = new MemoryAgentSeasonPersistence();
    const original = new AgentSeasonRepository(persistence);
    const agentId = "agent:season-rollover";
    const forkId = "fork:season-rollover";
    const current = await original.status(agentId, forkId);
    await original.perform(agentId, forkId, {operation: "participate", manifest_id: current.manifest_id, request_id: "join-old-season", decision: "joined"});
    const nextManifest = seasonManifest({...structuredClone(CURRENT_SEASON_BODY), season_id: "season:open-season-2", version: 2, previous_season_id: CURRENT_SEASON_BODY.season_id});
    const next = await new AgentSeasonRepository(persistence, nextManifest).notice(agentId, forkId);
    expect(next).toMatchObject({manifest_id: nextManifest.manifest_id, version: 2, changed: true, acknowledgement: "pending", participation: "unanswered"});
    const responder = createSeasonManifestResponder([seasonManifest(), nextManifest], nextManifest.manifest_id);
    expect(await responder("/seasons/v1/current")!.json()).toMatchObject({manifest_id: nextManifest.manifest_id});
    expect(await responder(seasonManifest().manifest_path)!.json()).toMatchObject({manifest_id: current.manifest_id});
    expect(responder("/seasons/v1/manifests/%")).toBeUndefined();
  });

  it("公开不可变机器清单，并让观察中的通知指向同一版本", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-season-manifest-"));
    const node = await startLocalNode({dataDirectory: directory});
    const identity = await createIdentity();
    const bridge = new SaiBridge(node.url, identity);
    try {
      const response = await fetch(`${node.url}/seasons/v1/current`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=60");
      const manifest = await response.json() as Record<string, any>;
      expect(manifest).toEqual(expect.objectContaining({
        protocol: "proofwild-season-manifest/1",
        season_id: "season:open-season-1",
        version: 2,
        status: "active",
        mode: "platform_framework",
        participation: "voluntary",
      }));
      expect(manifest.manifest_id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(manifest.rules.kernel.primitives).toEqual(["wait", "move", "gather", "message", "research"]);
      expect(manifest.rules.gameplay.authority).toBe("agent_emergent");
      expect(manifest.opportunities.journal).toEqual(expect.objectContaining({
        participation: "voluntary",
        discovery_path: "/journal/v1",
        review_pool_command: "npx --yes sai-agent-bridge papers pool --json",
      }));

      await bridge.register();
      await bridge.connect();
      const observation = await bridge.observe({max_bytes: 65_536});
      const season = observation.season as SeasonNotice;
      expect(season).toEqual(expect.objectContaining({
        manifest_id: manifest.manifest_id,
        season_id: manifest.season_id,
        version: manifest.version,
        changed: true,
        acknowledgement: "pending",
        participation: "unanswered",
        manifest_path: manifest.manifest_path,
      }));
      expect(season.manifest).toEqual(manifest);
      const immutable = await fetch(`${node.url}${manifest.manifest_path}`);
      expect(immutable.status).toBe(200);
      expect(immutable.headers.get("cache-control")).toContain("immutable");
    } finally {
      await bridge.close();
      await node.close();
    }
  });

  it("把知悉与参与选择分开保存，并让离线 Agent 重连后继续收到当前状态", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-season-state-"));
    const identity = await createIdentity();
    let node = await startLocalNode({dataDirectory: directory, regionId: "season-state"});
    let bridge = new SaiBridge(node.url, identity);
    try {
      await bridge.register();
      await bridge.connect();
      const first = await bridge.observe({max_bytes: 65_536});
      const notice = first.season as SeasonNotice;
      expect(notice).toMatchObject({changed: true, acknowledgement: "pending", participation: "unanswered"});

      const seasonBridge = bridge as unknown as {season(input: Record<string, unknown>): Promise<SeasonResult>};
      expect(typeof seasonBridge.season).toBe("function");
      const acknowledged = await seasonBridge.season({operation: "acknowledge", request_id: "season-ack-1", manifest_id: notice.manifest_id});
      expect(acknowledged).toMatchObject({acknowledgement: "acknowledged", participation: "unanswered"});
      expect(await seasonBridge.season({operation: "acknowledge", request_id: "season-ack-1", manifest_id: notice.manifest_id})).toEqual(acknowledged);

      const joined = await seasonBridge.season({operation: "participate", request_id: "season-join-1", manifest_id: notice.manifest_id, decision: "joined"});
      expect(joined).toMatchObject({acknowledgement: "acknowledged", participation: "joined"});
      const current = await bridge.observe({max_bytes: 65_536});
      expect(current.season).toMatchObject({changed: false, acknowledgement: "acknowledged", participation: "joined"});
    } finally {
      await bridge.close();
      await node.close();
    }

    node = await startLocalNode({dataDirectory: directory, regionId: "season-state"});
    bridge = new SaiBridge(node.url, identity);
    try {
      await bridge.register();
      await bridge.connect();
      expect((await bridge.observe({max_bytes: 65_536})).season).toMatchObject({changed: false, acknowledgement: "acknowledged", participation: "joined"});
    } finally {
      await bridge.close();
      await node.close();
    }
  });
});
