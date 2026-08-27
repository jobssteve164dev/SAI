import {describe, expect, it} from "vitest";
import {splitRegion} from "../../packages/federation/src/index.js";
import {createWorld} from "../../packages/kernel/src/index.js";

describe("热区域拆分原型", () => {
  it("按空间边界确定性拆分，主体与资源不复制也不丢失", () => {
    const state = createWorld("parent", [
      {id: "agent:left", x: 1, y: 2, energy: 5, inventory: {crystal: 2}},
      {id: "agent:right", x: 6, y: 2, energy: 4, inventory: {fiber: 1}},
    ]);
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
    for (const coordinate of [0, state.width, 1.5]) expect(() => splitRegion(state, "x", coordinate, ["a", "b"])).toThrow();
  });
});
