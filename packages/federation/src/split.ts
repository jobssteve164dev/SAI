import {stateHash, type RegionState} from "../../kernel/src/index.js";
import {FEDERATION_PROTOCOL, type RouteManifest} from "./types.js";

export function splitRegion(state: RegionState, axis: "x" | "y", coordinate: number, children: [string, string]): {states: [RegionState, RegionState]; manifest: RouteManifest} {
  const limit = axis === "x" ? state.width : state.height;
  if (!Number.isSafeInteger(coordinate) || coordinate <= 0 || coordinate >= limit) throw new Error("拆分坐标必须位于区域内部");
  const make = (regionId: string, second: boolean): RegionState => ({
    ...structuredClone(state),
    region_id: regionId,
    event_seq: 0,
    logical_tick: 0,
    width: axis === "x" ? (second ? state.width - coordinate : coordinate) : state.width,
    height: axis === "y" ? (second ? state.height - coordinate : coordinate) : state.height,
    agents: {}, resources: {}, messages: [],
  });
  const first = make(children[0], false);
  const second = make(children[1], true);
  const choose = (x: number, y: number) => (axis === "x" ? x : y) < coordinate ? first : second;
  for (const agent of Object.values(state.agents)) {
    const target = choose(agent.x, agent.y);
    const copy = structuredClone(agent);
    if (target === second) axis === "x" ? copy.x -= coordinate : copy.y -= coordinate;
    target.agents[copy.id] = copy;
  }
  for (const resource of Object.values(state.resources)) {
    const target = choose(resource.x, resource.y);
    const copy = structuredClone(resource);
    if (target === second) axis === "x" ? copy.x -= coordinate : copy.y -= coordinate;
    target.resources[copy.id] = copy;
  }
  for (const message of state.messages) (first.agents[message.to] ? first : second).messages.push(structuredClone(message));
  const manifest: RouteManifest = {
    protocol: FEDERATION_PROTOCOL,
    route_version: state.event_seq + 1,
    parent_region: state.region_id,
    parent_state_hash: stateHash(state),
    axis, coordinate,
    children: [
      {region_id: first.region_id, min_x: 0, min_y: 0, max_x: axis === "x" ? coordinate - 1 : state.width - 1, max_y: axis === "y" ? coordinate - 1 : state.height - 1, state_hash: stateHash(first)},
      {region_id: second.region_id, min_x: axis === "x" ? coordinate : 0, min_y: axis === "y" ? coordinate : 0, max_x: state.width - 1, max_y: state.height - 1, state_hash: stateHash(second)},
    ],
  };
  return {states: [first, second], manifest};
}
