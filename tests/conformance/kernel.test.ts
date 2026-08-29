import {describe, expect, it} from "vitest";
import {ARCHIVED_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_IDS, ECONOMIC_NETWORK_ID, WORLD_SUPPLY_SCHEDULE_ID, admitAgentAtRandomAddress, buildObservation, canonicalJson, createWorld, expandWorldForPopulation, MAX_WORLD_ADDRESSES, stateHash, transition, upgradeWorldForLabs, validateState, visibleWorldResources, worldAddressCapacity} from "../../packages/kernel/src/index.js";

describe("确定性 Conformance World", () => {
  it("相同状态生成完全相同的观察与动作 ID", () => {
    const state = createWorld("fixed", [{id: "agent:a", x: 0, y: 0, energy: 5, inventory: {}}]);
    expect(buildObservation(state, "agent:a")).toEqual(buildObservation(structuredClone(state), "agent:a"));
    expect(stateHash(state)).toBe("sha256:7f4ef88ee8f4dee96aa10412528dd1c0749312a38f94ddda6c1b8f5fed83f4ac");
    expect(buildObservation(state, "agent:a")!.observation.observation_id).toBe("obs_agaxgYrPCm9Bo6205-TNLCB_ZYjocrChuNY4EE0g_6g");
    expect(canonicalJson({b: 2, a: 1})).toBe('{"a":1,"b":2}');
  });

  it("拒绝浮点状态", () => {
    const state = createWorld("integer", []);
    state.logical_tick = 1.5;
    expect(() => stateHash(state)).toThrow("安全整数");
  });

  it("显式归档已知旧贡献网络且不把旧余额导入当前永久生态", () => {
    for (const scheduleId of ARCHIVED_ECOSYSTEM_WORLD_SUPPLY_SCHEDULE_IDS) {
      const state = createWorld("archived-network", [{id: "agent:a", x: 0, y: 0, energy: 5, inventory: {}}]);
      state.agents["agent:a"]!.inventory.crystal = 7;
      state.supply = {protocol: "sai-world-supply-state/3", economic_network_id: `network:${scheduleId}`, schedule_id: scheduleId, active_chain: [{legacy: true} as never]};
      const upgraded = upgradeWorldForLabs(state);
      expect(upgraded.supply).toEqual({protocol: "sai-world-supply-state/3", economic_network_id: ECONOMIC_NETWORK_ID, schedule_id: WORLD_SUPPLY_SCHEDULE_ID, active_chain: []});
      expect(upgraded.agents["agent:a"]!.inventory.crystal).toBeUndefined();
      expect(() => validateState(upgraded)).not.toThrow();
    }
    const unknown = createWorld("unknown-network");
    unknown.supply = {protocol: "sai-world-supply-state/3", economic_network_id: `network:sha256:${"f".repeat(64)}`, schedule_id: `sha256:${"f".repeat(64)}`, active_chain: []};
    expect(() => upgradeWorldForLabs(unknown)).toThrow("世界资源经济网络状态无效");
  });

  it("只重检相关前置条件，不因无关世界变化拒绝动作", () => {
    const state = createWorld("precondition", [
      {id: "agent:a", x: 0, y: 0, energy: 5, inventory: {}},
      {id: "agent:b", x: 7, y: 7, energy: 5, inventory: {}},
    ]);
    const observed = buildObservation(state, "agent:a")!;
    const move = Object.values(observed.commands).find((action) => action.type === "move")!;
    const changed = structuredClone(state);
    changed.agents["agent:b"]!.energy = 4;
    expect(transition(changed, "agent:a", "move-1", move).status).toBe("applied");
  });

  it("竞争最后一个资源时只允许一个 Agent 成功", () => {
    const state = createWorld("race", [
      {id: "agent:a", x: 1, y: 0, energy: 5, inventory: {}},
      {id: "agent:b", x: 1, y: 0, energy: 5, inventory: {}},
    ]);
    state.resources["resource-plain"] = {id: "resource-plain", kind: "ore", x: 1, y: 0, initial_amount: 1, remaining: 1};
    const a = Object.values(buildObservation(state, "agent:a")!.commands).find((action) => action.type === "gather")!;
    const b = Object.values(buildObservation(state, "agent:b")!.commands).find((action) => action.type === "gather")!;
    const first = transition(state, "agent:a", "race-a", a);
    expect(first.status).toBe("applied");
    if (first.status === "applied") {
      const second = transition(first.state, "agent:b", "race-b", b);
      expect(second.status).toBe("rejected");
      if (second.status === "rejected") expect(second.result.reason).toBe("target_unavailable");
    }
  });

  it("Agent 下一次观察能读到与自己相关的公开消息", () => {
    const state = createWorld("conversation", [
      {id: "agent:a", x: 1, y: 1, energy: 5, inventory: {}},
      {id: "agent:b", x: 1, y: 2, energy: 5, inventory: {}},
      {id: "agent:c", x: 7, y: 7, energy: 5, inventory: {}},
    ]);
    const observed = buildObservation(state, "agent:a")!;
    const message = Object.values(observed.commands).find((action) => action.type === "message" && action.target === "agent:b")!;
    const outcome = transition(state, "agent:a", "invite-1", message, {content: "一起制定采集接力规则？"});
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(buildObservation(outcome.state, "agent:b")!.observation.messages).toEqual([expect.objectContaining({from: "agent:a", to: "agent:b", content: "一起制定采集接力规则？"})]);
    expect(buildObservation(outcome.state, "agent:c")!.observation.messages).toEqual([]);
  });

  it("为新 Agent 分配随机空地址，并在常驻密度超过 25% 时自动扩容", () => {
    const first = admitAgentAtRandomAddress(createWorld("admission"), "agent:a", () => 7);
    const second = admitAgentAtRandomAddress(first, "agent:b", () => 7);
    expect(first.agents["agent:a"]).toMatchObject({x: 7, y: 0});
    expect(second.agents["agent:b"]).toMatchObject({x: 8, y: 0});
    expect(new Set(Object.values(second.agents).map((agent) => `${agent.x}:${agent.y}`)).size).toBe(2);

    const full = createWorld("expand", Array.from({length: 64}, (_, address) => ({id: `agent:${address}`, x: address % 8, y: Math.floor(address / 8), energy: 5, inventory: {}})));
    const expanded = admitAgentAtRandomAddress(full, "agent:64", () => 0);
    expect({width: expanded.width, height: expanded.height, capacity: worldAddressCapacity(expanded)}).toEqual({width: 32, height: 32, capacity: 1_024});
    expect(expanded.agents["agent:64"]).toMatchObject({x: 8, y: 0});
    expect(expandWorldForPopulation(createWorld("density-boundary"), 64)).toMatchObject({width: 16, height: 16});
    expect(expandWorldForPopulation(createWorld("density-over"), 65)).toMatchObject({width: 32, height: 32});
    expect(expandWorldForPopulation({...createWorld("density-next"), width: 32, height: 32}, 257)).toMatchObject({width: 64, height: 64});
    expect(visibleWorldResources(expandWorldForPopulation(createWorld("four-mines"), 65)).map((resource) => resource.initial_amount)).toEqual([23, 2, 24, 4]);
    const split = {...createWorld("split"), width: 4, height: 8};
    expect(expandWorldForPopulation(split, 1, {width: 4, height: 8})).toMatchObject({width: 4, height: 8});
  });

  it("世界地址空间永远不超过 2^32", () => {
    const maximum = {...createWorld("maximum"), width: 65_536, height: 65_536};
    expect(worldAddressCapacity(maximum)).toBe(MAX_WORLD_ADDRESSES);
    expect(expandWorldForPopulation(maximum, MAX_WORLD_ADDRESSES)).toMatchObject({width: 65_536, height: 65_536});
    expect(() => expandWorldForPopulation(maximum, MAX_WORLD_ADDRESSES + 1)).toThrow("world_capacity_exhausted");
    expect(() => validateState({...maximum, width: 65_537})).toThrow("2^32");
  });
});
