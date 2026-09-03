import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {FileStore} from "../../apps/local-node/src/store.js";
import {RegionService} from "../../apps/local-node/src/service.js";
import {startLocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {AgentMemoryRepository, MemoryAgentMemoryPersistence} from "../../packages/memory/src/index.js";

describe("Agent 世界记忆", () => {
  it("相同写请求保持幂等，且不同世界分叉不能看到同一备忘录", async () => {
    const identity = await createIdentity();
    const memories = new AgentMemoryRepository(new MemoryAgentMemoryPersistence());
    const input = {operation: "remember" as const, request_id: "same-request", content: "只应写入一次"};
    const first = await memories.perform(identity.agentId, "fork:one", 0, input);
    await memories.perform(identity.agentId, "fork:one", 0, {operation: "remember", request_id: "later-request", content: "后续状态"});
    expect(await memories.perform(identity.agentId, "fork:one", 0, input)).toEqual(first);
    await expect(memories.perform(identity.agentId, "fork:one", 0, {...input, content: "不能复用请求编号"})).rejects.toThrow("request_id");
    expect((await memories.list(identity.agentId, "fork:two")).total).toBe(0);
  });

  it("Agent 自主管理最多 50 条分叉内备忘录，世界事实历史保持不可修改", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-memory-"));
    const service = await RegionService.open(new FileStore(directory), "memory-test");
    const identity = await createIdentity();
    await service.admit(identity.agentId);
    const memoryService = service as unknown as {
      memory(agentId: string, input: Record<string, unknown>): Promise<{memory_id?: string; revision?: number | null; entries?: Array<{memory_id: string; content: string; revision: number}>; total: number; limit: number}>;
      activity(agentId: string, input?: {limit?: number; cursor?: string}): Promise<{events: Array<{agent_id: string}>; next_cursor: string | null}>;
    };

    const first = await memoryService.memory(identity.agentId, {operation: "remember", request_id: "remember-1", content: "我在这里开始了第一次观察。"});
    expect(first).toMatchObject({total: 1, limit: 50});
    const memoryId = first.memory_id!;
    const refreshed = await memoryService.memory(identity.agentId, {operation: "refresh", request_id: "refresh-1", memory_id: memoryId, content: "我已经完成第一次观察，准备参与研究。"});
    expect(refreshed).toMatchObject({memory_id: memoryId, revision: 2});
    expect((await memoryService.memory(identity.agentId, {operation: "list"})).entries?.[0]).toMatchObject({memory_id: memoryId, revision: 2, content: "我已经完成第一次观察，准备参与研究。"});

    for (let index = 1; index < 50; index += 1) await memoryService.memory(identity.agentId, {operation: "remember", request_id: `remember-${index + 1}`, content: `备忘录 ${index + 1}`});
    await expect(memoryService.memory(identity.agentId, {operation: "remember", request_id: "remember-overflow", content: "不能静默挤掉旧记忆"})).rejects.toThrow("50");
    const rotated = await memoryService.memory(identity.agentId, {operation: "rotate", request_id: "rotate-1", memory_id: memoryId, content: "由 Agent 明确选择替换的记忆"});
    expect(rotated.total).toBe(50);
    expect((await memoryService.memory(identity.agentId, {operation: "list"})).entries?.some((entry) => entry.memory_id === memoryId)).toBe(false);

    const observation = await service.observe(identity.agentId, {max_bytes: 65_536});
    expect((observation as typeof observation & {memory: {total: number; recent: unknown[]}}).memory).toMatchObject({total: 50});
    const wait = observation.legal_actions.find((action) => action.type === "wait")!;
    await service.act(identity.agentId, {observation_id: observation.observation_id, action_id: wait.action_id, request_id: "world-action-1"});
    const nextObservation = await service.observe(identity.agentId, {max_bytes: 65_536});
    const nextWait = nextObservation.legal_actions.find((action) => action.type === "wait")!;
    await service.act(identity.agentId, {observation_id: nextObservation.observation_id, action_id: nextWait.action_id, request_id: "world-action-2"});
    const firstPage = await memoryService.activity(identity.agentId, {limit: 1});
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.next_cursor).toMatch(/^before:/);
    const history = await memoryService.activity(identity.agentId, {limit: 20, cursor: firstPage.next_cursor!});
    expect(history.events).toHaveLength(1);
    expect(history.events[0]!.agent_id).toBe(identity.agentId);
  });

  it("观察只携带最近记忆的短摘要，刷新顺序不依赖世界 tick，且重启后仍保持私有分叉边界", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-memory-persistence-"));
    const store = new FileStore(directory);
    const identity = await createIdentity();
    const stranger = await createIdentity();
    let service = await RegionService.open(store, "memory-persistence");
    await service.admit(identity.agentId);
    await service.admit(stranger.agentId);
    const longContent = "长期目标：" + "保留上下文但不要挤占观察窗口。".repeat(120);
    const first = await service.memory(identity.agentId, {operation: "remember", request_id: "persist-1", content: longContent}) as {memory_id: string};
    const firstId = first.memory_id;
    await service.memory(identity.agentId, {operation: "remember", request_id: "persist-2", content: "第二条"});
    for (let index = 0; index < 3; index += 1) await service.memory(identity.agentId, {operation: "remember", request_id: `cjk-${index}`, content: `中文与表情摘要${index}：${"研究证据需要在默认观察预算内安全呈现。🧭".repeat(20)}`});
    const refreshed = await service.memory(identity.agentId, {operation: "refresh", request_id: "persist-3", memory_id: firstId}) as {memory_id: string};
    expect(refreshed.memory_id).toBe(firstId);

    service = await RegionService.open(new FileStore(directory), "memory-persistence");
    expect((await service.memory(identity.agentId, {operation: "list"})).total).toBe(5);
    expect((await service.memory(stranger.agentId, {operation: "list"})).total).toBe(0);
    const observation = await service.observe(identity.agentId);
    expect(observation.memory?.recent[0]).toMatchObject({memory_id: firstId, truncated: true});
    expect(observation.memory?.recent[0]!.content.length).toBeLessThanOrEqual(160);
    expect(new TextEncoder().encode(JSON.stringify(observation)).byteLength).toBeLessThanOrEqual(4096);
  });

  it("Agent 通过正式 MCP 工具和桥接器读写记忆并分页读取自身活动", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-memory-mcp-"));
    const node = await startLocalNode({dataDirectory: directory});
    const identity = await createIdentity();
    const bridge = new SaiBridge(node.url, identity);
    try {
      await bridge.register();
      await bridge.connect();
      const remembered = await (bridge as unknown as {memory(input: Record<string, unknown>): Promise<{total: number}>}).memory({operation: "remember", request_id: "mcp-memory-1", content: "记住这次世界接入。"});
      expect(remembered.total).toBe(1);
      const observation = await bridge.observe({max_bytes: 65_536});
      expect(observation.memory?.recent[0]?.content).toBe("记住这次世界接入。");
      const wait = observation.legal_actions.find((action) => action.type === "wait")!;
      await bridge.act({observation_id: observation.observation_id, action_id: wait.action_id, request_id: "mcp-activity-1"});
      const history = await (bridge as unknown as {activity(input?: {limit?: number}): Promise<{events: unknown[]}>}).activity({limit: 1});
      expect(history.events).toHaveLength(1);
    } finally {
      await bridge.close();
      await node.close();
    }
  });
});
