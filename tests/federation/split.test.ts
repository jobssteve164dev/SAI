import {describe, expect, it} from "vitest";
import {activateSplitCutover, markSplitChildReady, planSplitCutover, retireSplitParent, routeDuringSplit, settlePreCutoverRequest, shouldSplitRegion, splitRegion} from "../../packages/federation/src/index.js";
import {createWorld} from "../../packages/kernel/src/index.js";

describe("热区域拆分原型", () => {
  it("按空间边界确定性拆分，主体与资源不复制也不丢失", () => {
    const state = createWorld("parent", [
      {id: "agent:left", x: 1, y: 2, energy: 5, inventory: {ore: 2}},
      {id: "agent:right", x: 6, y: 2, energy: 4, inventory: {wood: 1}},
    ]);
    delete state.supply;
    const first = splitRegion(state, "x", 4, ["west", "east"]);
    const second = splitRegion(structuredClone(state), "x", 4, ["west", "east"]);
    expect(first).toEqual(second);
    expect(Object.keys(first.states[0].agents)).toEqual(["agent:left"]);
    expect(Object.keys(first.states[1].agents)).toEqual(["agent:right"]);
    expect(first.states[1].agents["agent:right"]!.x).toBe(2);
    expect(Object.keys(first.states[0].agents).length + Object.keys(first.states[1].agents).length).toBe(2);
    expect(Object.keys(first.states[0].resources).length + Object.keys(first.states[1].resources).length).toBe(Object.keys(state.resources).length);
    expect(first.manifest.children).toHaveLength(2);
  });

  it("拒绝区域外和边界上的无效拆分坐标", () => {
    const state = createWorld("parent", []);
    delete state.supply;
    for (const coordinate of [0, state.width, 1.5]) expect(() => splitRegion(state, "x", coordinate, ["a", "b"])).toThrow();
  });

  it("按持续结算压力触发拆分，并在子区域就绪后无停机切流和退役父区域", () => {
    const policy = {consecutive_samples: 3, conflict_rate: 0.25, queue_depth: 20, p95_settlement_ms: 200};
    const samples = [
      {measured_at: 1, conflict_rate: 0.3, queue_depth: 5, p95_settlement_ms: 80},
      {measured_at: 2, conflict_rate: 0.28, queue_depth: 4, p95_settlement_ms: 70},
      {measured_at: 3, conflict_rate: 0.27, queue_depth: 3, p95_settlement_ms: 65},
    ];
    expect(shouldSplitRegion(samples.slice(0, 2), policy)).toBe(false);
    expect(shouldSplitRegion(samples, policy)).toBe(true);

    const state = createWorld("parent", []);
    delete state.supply;
    const manifest = splitRegion(state, "x", 4, ["west", "east"]).manifest;
    let cutover = planSplitCutover(manifest, 100, 1, 30);
    expect(routeDuringSplit(cutover, 6, 2)).toEqual({status: "serve_parent", region_id: "parent", route_version: 0});
    cutover = markSplitChildReady(cutover, manifest.children[0].region_id, manifest.children[0].state_hash);
    cutover = markSplitChildReady(cutover, manifest.children[1].region_id, manifest.children[1].state_hash);
    cutover = activateSplitCutover(cutover, 101);
    expect(routeDuringSplit(cutover, 6, 2)).toEqual({status: "redirect", region_id: "east", local_x: 2, local_y: 2, route_version: 1});
    expect(() => retireSplitParent(cutover, 131)).toThrow("保护期");
    cutover = settlePreCutoverRequest(cutover);
    cutover = retireSplitParent(cutover, 131);
    expect(cutover.status).toBe("retired");
    expect(routeDuringSplit(cutover, 1, 2).status).toBe("redirect");
  });

  it("拒绝用旧局部坐标拆分器破坏全生态资源坐标", () => {
    expect(() => splitRegion(createWorld("finite-supply"), "x", 4, ["west", "east"])).toThrow("ecosystem_supply_split_requires_global_coordinate_routing");
  });
});
