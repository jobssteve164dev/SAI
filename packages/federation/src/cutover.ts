import {federationObjectHash} from "./governance.js";
import type {RouteManifest} from "./types.js";

export interface SplitLoadSample {
  measured_at: number;
  conflict_rate: number;
  queue_depth: number;
  p95_settlement_ms: number;
}

export interface SplitThresholdPolicy {
  consecutive_samples: number;
  conflict_rate: number;
  queue_depth: number;
  p95_settlement_ms: number;
}

export type SplitCutoverStatus = "planned" | "prepared" | "active" | "retired";

export interface SplitCutover {
  status: SplitCutoverStatus;
  manifest: RouteManifest;
  manifest_hash: string;
  planned_at: number;
  ready_children: string[];
  outstanding_pre_cutover_requests: number;
  grace_seconds: number;
  activated_at?: number;
  retire_after?: number;
}

function thresholdExceeded(sample: SplitLoadSample, policy: SplitThresholdPolicy): boolean {
  return sample.conflict_rate >= policy.conflict_rate || sample.queue_depth >= policy.queue_depth || sample.p95_settlement_ms >= policy.p95_settlement_ms;
}

export function shouldSplitRegion(samples: SplitLoadSample[], policy: SplitThresholdPolicy): boolean {
  if (!Number.isSafeInteger(policy.consecutive_samples) || policy.consecutive_samples < 1) throw new Error("连续采样阈值无效");
  for (const value of [policy.conflict_rate, policy.queue_depth, policy.p95_settlement_ms]) if (!Number.isFinite(value) || value < 0) throw new Error("拆分负载阈值无效");
  if (samples.length < policy.consecutive_samples) return false;
  return samples.slice(-policy.consecutive_samples).every((sample) => thresholdExceeded(sample, policy));
}

export function planSplitCutover(manifest: RouteManifest, now: number, outstandingPreCutoverRequests = 0, graceSeconds = 30): SplitCutover {
  if (!Number.isSafeInteger(outstandingPreCutoverRequests) || outstandingPreCutoverRequests < 0 || !Number.isSafeInteger(graceSeconds) || graceSeconds < 0) throw new Error("切流参数无效");
  return {status: "planned", manifest: structuredClone(manifest), manifest_hash: federationObjectHash(manifest), planned_at: now, ready_children: [], outstanding_pre_cutover_requests: outstandingPreCutoverRequests, grace_seconds: graceSeconds};
}

export function markSplitChildReady(cutover: SplitCutover, regionId: string, stateHash: string): SplitCutover {
  if (cutover.status !== "planned" && cutover.status !== "prepared") throw new Error("当前阶段不能登记子区域就绪");
  const child = cutover.manifest.children.find((candidate) => candidate.region_id === regionId);
  if (!child || child.state_hash !== stateHash) throw new Error("子区域状态摘要与拆分清单不匹配");
  const ready = [...new Set([...cutover.ready_children, regionId])].sort();
  return {...cutover, status: ready.length === cutover.manifest.children.length ? "prepared" : "planned", ready_children: ready};
}

export function activateSplitCutover(cutover: SplitCutover, now: number): SplitCutover {
  if (cutover.status === "active" || cutover.status === "retired") return cutover;
  if (cutover.status !== "prepared") throw new Error("两个子区域尚未全部就绪");
  return {...cutover, status: "active", activated_at: now, retire_after: now + cutover.grace_seconds};
}

export function settlePreCutoverRequest(cutover: SplitCutover): SplitCutover {
  if (cutover.outstanding_pre_cutover_requests < 1) return cutover;
  return {...cutover, outstanding_pre_cutover_requests: cutover.outstanding_pre_cutover_requests - 1};
}

export function retireSplitParent(cutover: SplitCutover, now: number): SplitCutover {
  if (cutover.status === "retired") return cutover;
  if (cutover.status !== "active" || cutover.retire_after === undefined || now < cutover.retire_after || cutover.outstanding_pre_cutover_requests > 0) throw new Error("父区域仍在无停机切流保护期内");
  return {...cutover, status: "retired"};
}

export type SplitRouteDecision =
  | {status: "serve_parent"; region_id: string; route_version: number}
  | {status: "redirect"; region_id: string; local_x: number; local_y: number; route_version: number};

export function routeDuringSplit(cutover: SplitCutover, x: number, y: number): SplitRouteDecision {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error("路由坐标无效");
  if (cutover.status === "planned" || cutover.status === "prepared") return {status: "serve_parent", region_id: cutover.manifest.parent_region, route_version: cutover.manifest.route_version - 1};
  const child = cutover.manifest.children.find((candidate) => x >= candidate.min_x && x <= candidate.max_x && y >= candidate.min_y && y <= candidate.max_y);
  if (!child) throw new Error("坐标不在拆分后的任何子区域");
  const localX = cutover.manifest.axis === "x" && x >= cutover.manifest.coordinate ? x - cutover.manifest.coordinate : x;
  const localY = cutover.manifest.axis === "y" && y >= cutover.manifest.coordinate ? y - cutover.manifest.coordinate : y;
  return {status: "redirect", region_id: child.region_id, local_x: localX, local_y: localY, route_version: cutover.manifest.route_version};
}
