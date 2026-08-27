import type {JsonWebKey} from "node:crypto";
import {agentIdFromJwk} from "../../identity/src/index.js";
import {compactId, stateHash, type AgentState} from "../../kernel/src/index.js";
import {nodeIdFromJwk, signObject, verifyObject} from "./identity.js";
import {assertNodeDescriptor, assertTransferCancellation, assertTransferCredential, assertTransferReceipt} from "./validation.js";
import {FEDERATION_PROTOCOL, type NodeDescriptor, type NodeKeyPair, type TransferCancellation, type TransferCredential, type TransferReceipt} from "./types.js";

export async function createNodeDescriptor(keys: NodeKeyPair, baseUrl: string, regions: string[], now: number, ttl = 300): Promise<NodeDescriptor> {
  const unsigned = {protocol: FEDERATION_PROTOCOL, node_id: keys.nodeId, public_jwk: keys.publicJwk, base_url: baseUrl, regions: [...regions].sort(), issued_at: now, expires_at: now + ttl};
  return {...unsigned, signature: await signObject(unsigned, keys.privateJwk)};
}

export async function verifyNodeDescriptor(descriptor: NodeDescriptor, now: number): Promise<void> {
  assertNodeDescriptor(descriptor);
  const {signature, ...unsigned} = descriptor;
  if (descriptor.protocol !== FEDERATION_PROTOCOL || descriptor.node_id !== nodeIdFromJwk(descriptor.public_jwk)) throw new Error("节点身份不匹配");
  if (descriptor.issued_at > now || descriptor.expires_at < now) throw new Error("节点描述已过期或尚未生效");
  await verifyObject(unsigned, signature, descriptor.public_jwk);
}

export async function createTransferCredential(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; sourceRegion: string; targetNode: string; targetRegion: string; agent: AgentState; agentPublicJwk: JsonWebKey; sourceState: Parameters<typeof stateHash>[0]; now: number; ttl?: number; nonce: string}): Promise<TransferCredential> {
  if (agentIdFromJwk(input.agentPublicJwk) !== input.agent.id) throw new Error("Agent 公钥与迁移主体不匹配");
  const unsigned = {
    protocol: FEDERATION_PROTOCOL,
    transfer_id: compactId("transfer", {source: input.keys.nodeId, region: input.sourceRegion, agent: input.agent.id, target: input.targetNode, nonce: input.nonce}),
    source_node: input.descriptor,
    source_region: input.sourceRegion,
    target_node: input.targetNode,
    target_region: input.targetRegion,
    agent: structuredClone(input.agent),
    agent_public_jwk: structuredClone(input.agentPublicJwk),
    source_state_hash: stateHash(input.sourceState),
    issued_at: input.now,
    expires_at: input.now + (input.ttl ?? 300),
    nonce: input.nonce,
  };
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyTransferCredential(credential: TransferCredential, expectedNode: string, expectedRegion: string, now: number, allowExpired = false): Promise<void> {
  assertTransferCredential(credential);
  const {signature, ...unsigned} = credential;
  if (credential.protocol !== FEDERATION_PROTOCOL || credential.target_node !== expectedNode || credential.target_region !== expectedRegion) throw new Error("转移凭证目标不匹配");
  if (credential.issued_at > now || (!allowExpired && credential.expires_at < now)) throw new Error("转移凭证已过期或尚未生效");
  if (agentIdFromJwk(credential.agent_public_jwk) !== credential.agent.id) throw new Error("转移凭证中的 Agent 身份不匹配");
  await verifyNodeDescriptor(credential.source_node, allowExpired ? credential.issued_at : now);
  await verifyObject(unsigned, signature, credential.source_node.public_jwk);
}

export async function createTransferReceipt(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; credential: TransferCredential; acceptedStateHash: string; now: number}): Promise<TransferReceipt> {
  const unsigned = {protocol: FEDERATION_PROTOCOL, transfer_id: input.credential.transfer_id, status: "accepted" as const, target_node: input.descriptor, target_region: input.credential.target_region, agent_id: input.credential.agent.id, accepted_state_hash: input.acceptedStateHash, accepted_at: input.now};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyTransferReceipt(receipt: TransferReceipt, credential: TransferCredential, now: number): Promise<void> {
  assertTransferReceipt(receipt);
  const {signature, ...unsigned} = receipt;
  if (receipt.transfer_id !== credential.transfer_id || receipt.agent_id !== credential.agent.id || receipt.target_node.node_id !== credential.target_node || receipt.target_region !== credential.target_region) throw new Error("转移回执与凭证不匹配");
  if (receipt.accepted_at > now || receipt.accepted_at < credential.issued_at || receipt.accepted_at > credential.expires_at) throw new Error("转移回执时间不在凭证有效期内");
  await verifyNodeDescriptor(receipt.target_node, receipt.accepted_at);
  await verifyObject(unsigned, signature, receipt.target_node.public_jwk);
}

export async function createTransferCancellation(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; credential: TransferCredential; now: number}): Promise<TransferCancellation> {
  const unsigned = {protocol: FEDERATION_PROTOCOL, transfer_id: input.credential.transfer_id, status: "cancelled" as const, target_node: input.descriptor, target_region: input.credential.target_region, agent_id: input.credential.agent.id, cancelled_at: input.now};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyTransferCancellation(cancellation: TransferCancellation, credential: TransferCredential, now: number): Promise<void> {
  assertTransferCancellation(cancellation);
  const {signature, ...unsigned} = cancellation;
  if (cancellation.transfer_id !== credential.transfer_id || cancellation.agent_id !== credential.agent.id || cancellation.target_node.node_id !== credential.target_node || cancellation.target_region !== credential.target_region) throw new Error("取消证明与转移凭证不匹配");
  if (cancellation.cancelled_at > now || cancellation.cancelled_at <= credential.expires_at) throw new Error("取消证明时间无效");
  await verifyNodeDescriptor(cancellation.target_node, cancellation.cancelled_at);
  await verifyObject(unsigned, signature, cancellation.target_node.public_jwk);
}
