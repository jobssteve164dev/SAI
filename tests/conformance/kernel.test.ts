import {describe, expect, it} from "vitest";
import {buildObservation, canonicalJson, createWorld, stateHash, transition} from "../../packages/kernel/src/index.js";

describe("确定性 Conformance World", () => {
  it("相同状态生成完全相同的观察与动作 ID", () => {
    const state = createWorld("fixed", [{id: "agent:a", x: 0, y: 0, energy: 5, inventory: {}}]);
    expect(buildObservation(state, "agent:a")).toEqual(buildObservation(structuredClone(state), "agent:a"));
    expect(stateHash(state)).toBe("sha256:9a08445cfcd0bc1582b135bb3c0fb6616f48829be96788e883e9c6c734d629d8");
    expect(buildObservation(state, "agent:a")!.observation.observation_id).toBe("obs_B-fHaoaNjgO3ZmUhJsRw5UAr7HPggLCBTwYlqiHNa9g");
    expect(canonicalJson({b: 2, a: 1})).toBe('{"a":1,"b":2}');
  });

  it("拒绝浮点状态", () => {
    const state = createWorld("integer", []);
    state.logical_tick = 1.5;
    expect(() => stateHash(state)).toThrow("安全整数");
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
    state.resources["resource-alpha"]!.remaining = 1;
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
});
