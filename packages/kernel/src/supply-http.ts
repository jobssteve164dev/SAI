import {ECONOMIC_NETWORK_ID, WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS, WORLD_SUPPLY_MAX_EXCHANGE_BYTES, WORLD_SUPPLY_SCHEDULE_ID, assertWorldSupplyChain, worldSupplyObservation} from "./supply.js";
import type {EcosystemWorldSupplyState, RegionState} from "./types.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json; charset=utf-8", ...CORS}});
}

async function boundedSupplyState(request: Request): Promise<EcosystemWorldSupplyState> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > WORLD_SUPPLY_MAX_EXCHANGE_BYTES) throw new RangeError("世界资源交换对象超过固定大小上限");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > WORLD_SUPPLY_MAX_EXCHANGE_BYTES) throw new RangeError("世界资源交换对象超过固定大小上限");
  const state = JSON.parse(raw) as EcosystemWorldSupplyState;
  if (!Array.isArray(state.active_chain) || state.active_chain.length > WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS) throw new RangeError("单次世界资源交换区块数超过固定上限");
  assertWorldSupplyChain(state);
  return state;
}

export interface WorldSupplyExchangeApplication {
  currentState(): RegionState | Promise<RegionState>;
  mergeSupply(state: EcosystemWorldSupplyState): Promise<EcosystemWorldSupplyState>;
}

export async function handleWorldSupplyRequest(request: Request, application: WorldSupplyExchangeApplication): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/economy/v1")) return undefined;
  try {
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: CORS});
    const current = await application.currentState();
    if (!current.supply || current.supply.protocol !== "sai-world-supply-state/2") return json({error: "economic_network_unavailable"}, 409);
    if (url.pathname === "/economy/v1" && request.method === "GET") return json({
      protocol: "sai-economic-network-discovery/1",
      authority: false,
      role: "full-validator-peer",
      economic_network_id: ECONOMIC_NETWORK_ID,
      schedule_id: WORLD_SUPPLY_SCHEDULE_ID,
      chain_url: "/economy/v1/chain",
      exchange_url: "/economy/v1/exchange",
      supply: worldSupplyObservation(current),
    });
    if (url.pathname === "/economy/v1/chain" && request.method === "GET") {
      if (current.supply.active_chain.length > WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS) return json({error: "incremental_sync_required", max_blocks: WORLD_SUPPLY_MAX_EXCHANGE_BLOCKS}, 413);
      return json({state: current.supply});
    }
    if (url.pathname === "/economy/v1/exchange" && request.method === "POST") {
      const merged = await application.mergeSupply(await boundedSupplyState(request));
      return json({status: "merged", state: merged, supply: worldSupplyObservation(await application.currentState())});
    }
    return json({error: "not_found"}, 404);
  } catch (error) {
    return json({error: "invalid_economic_state", error_description: error instanceof Error ? error.message : "economic exchange failed"}, error instanceof RangeError ? 413 : 400);
  }
}

export async function syncWorldSupplyFromPeer(targetBaseUrl: string, peerBaseUrl: string): Promise<EcosystemWorldSupplyState> {
  const peer = await fetch(`${peerBaseUrl.replace(/\/$/, "")}/economy/v1/chain`, {headers: {accept: "application/json"}});
  const raw = await peer.text();
  if (!peer.ok) throw new Error(`世界资源对等节点返回 HTTP ${peer.status}`);
  if (new TextEncoder().encode(raw).byteLength > WORLD_SUPPLY_MAX_EXCHANGE_BYTES) throw new RangeError("世界资源对等交换响应超过固定大小上限");
  const parsed = JSON.parse(raw) as {state?: EcosystemWorldSupplyState};
  if (!parsed.state) throw new TypeError("世界资源对等节点未返回状态");
  assertWorldSupplyChain(parsed.state);
  const response = await fetch(`${targetBaseUrl.replace(/\/$/, "")}/economy/v1/exchange`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(parsed.state)});
  const output = await response.json() as {state?: EcosystemWorldSupplyState; error_description?: string};
  if (!response.ok || !output.state) throw new Error(output.error_description ?? `世界资源合并返回 HTTP ${response.status}`);
  assertWorldSupplyChain(output.state);
  return output.state;
}
