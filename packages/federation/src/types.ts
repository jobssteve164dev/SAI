import type {JsonWebKey} from "node:crypto";
import type {AgentState} from "../../kernel/src/index.js";

export const FEDERATION_PROTOCOL = "sai-federation/0.2.0" as const;

export interface NodeKeyPair {nodeId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey}
export interface UnsignedNodeDescriptor {
  protocol: typeof FEDERATION_PROTOCOL;
  node_id: string;
  public_jwk: JsonWebKey;
  base_url: string;
  regions: string[];
  issued_at: number;
  expires_at: number;
}
export interface NodeDescriptor extends UnsignedNodeDescriptor {signature: string}

export interface UnsignedTransferCredential {
  protocol: typeof FEDERATION_PROTOCOL;
  transfer_id: string;
  source_node: NodeDescriptor;
  source_region: string;
  target_node: string;
  target_region: string;
  agent: AgentState;
  agent_public_jwk: JsonWebKey;
  source_state_hash: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}
export interface TransferCredential extends UnsignedTransferCredential {signature: string}

export interface UnsignedTransferReceipt {
  protocol: typeof FEDERATION_PROTOCOL;
  transfer_id: string;
  status: "accepted";
  target_node: NodeDescriptor;
  target_region: string;
  agent_id: string;
  accepted_state_hash: string;
  accepted_at: number;
}
export interface TransferReceipt extends UnsignedTransferReceipt {signature: string}

export interface UnsignedTransferCancellation {
  protocol: typeof FEDERATION_PROTOCOL;
  transfer_id: string;
  status: "cancelled";
  target_node: NodeDescriptor;
  target_region: string;
  agent_id: string;
  cancelled_at: number;
}
export interface TransferCancellation extends UnsignedTransferCancellation {signature: string}

export interface RouteChild {region_id: string; min_x: number; min_y: number; max_x: number; max_y: number; state_hash: string}
export interface RouteManifest {
  protocol: typeof FEDERATION_PROTOCOL;
  route_version: number;
  parent_region: string;
  parent_state_hash: string;
  axis: "x" | "y";
  coordinate: number;
  children: [RouteChild, RouteChild];
}
