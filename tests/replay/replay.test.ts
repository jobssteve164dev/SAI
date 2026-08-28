import {mkdtemp, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {createWorld, replay, stateHash, type ConformanceEvent} from "../../packages/kernel/src/index.js";
import {FileStore} from "../../apps/local-node/src/store.js";
import {RegionService} from "../../apps/local-node/src/service.js";

async function dataDirectory(): Promise<string> { return mkdtemp(join(tmpdir(), "sai-replay-")); }

describe("事件、快照与重放", () => {
  it("重启后保持状态与 request_id 幂等", async () => {
    const directory = await dataDirectory();
    const store = new FileStore(directory);
    const service = await RegionService.open(store, "restart");
    await service.admit("agent:a");
    const observation = await service.observe("agent:a");
    const action = observation.legal_actions.find((item) => item.type === "move")!;
    const input = {observation_id: observation.observation_id, action_id: action.action_id, request_id: "same-request"};
    const first = await service.act("agent:a", input);
    const before = stateHash(service.currentState());
    const restarted = await RegionService.open(new FileStore(directory), "restart");
    const duplicate = await restarted.act("agent:a", input);
    expect(duplicate).toEqual(first);
    expect(stateHash(restarted.currentState())).toBe(before);
    expect(restarted.currentState().event_seq).toBe(1);
  });

  it("完整事件流可从相同初态重放，篡改或乱序会失败", async () => {
    const directory = await dataDirectory();
    const store = new FileStore(directory);
    const initial = createWorld("audit", [{id: "agent:a", x: 0, y: 0, energy: 5, inventory: {}}]);
    await store.saveSnapshot(initial);
    const service = await RegionService.open(store, "audit");
    for (let turn = 0; turn < 2; turn += 1) {
      const observation = await service.observe("agent:a");
      const move = observation.legal_actions.find((item) => item.type === "move")!;
      await service.act("agent:a", {observation_id: observation.observation_id, action_id: move.action_id, request_id: `audit-${turn}`});
    }
    const events = (await readFile(join(directory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as ConformanceEvent);
    expect(stateHash(replay(initial, events))).toBe(stateHash(service.currentState()));
    const afterFirst = replay(initial, [events[0]!]);
    expect(stateHash(replay(afterFirst, [events[1]!]))).toBe(stateHash(service.currentState()));
    expect(stateHash(afterFirst)).not.toBe(stateHash(service.currentState()));
    const tampered = structuredClone(events);
    tampered[0]!.state_hash = "sha256:" + "0".repeat(64);
    expect(() => replay(initial, tampered)).toThrow("无法确定性重放");
    expect(() => replay(initial, [...events].reverse())).toThrow("event_seq 不连续");
  });

  it("应用服务串行结算并发采集，且只追加一个成功事件", async () => {
    const directory = await dataDirectory();
    const store = new FileStore(directory);
    const initial = createWorld("concurrent", [
      {id: "agent:a", x: 1, y: 0, energy: 5, inventory: {}},
      {id: "agent:b", x: 1, y: 0, energy: 5, inventory: {}},
    ]);
    initial.resources["resource-plain"] = {id: "resource-plain", kind: "ore", x: 1, y: 0, initial_amount: 1, remaining: 1};
    await store.saveSnapshot(initial);
    const service = await RegionService.open(store, "concurrent");
    const [a, b] = await Promise.all([service.observe("agent:a"), service.observe("agent:b")]);
    const results = await Promise.all([
      service.act("agent:a", {observation_id: a.observation_id, action_id: a.legal_actions.find((item) => item.type === "gather")!.action_id, request_id: "concurrent-a"}),
      service.act("agent:b", {observation_id: b.observation_id, action_id: b.legal_actions.find((item) => item.type === "gather")!.action_id, request_id: "concurrent-b"}),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["applied", "rejected"]);
    expect(service.currentState().event_seq).toBe(1);
    expect(service.currentState().resources["resource-plain"]!.remaining).toBe(0);
  });
});
