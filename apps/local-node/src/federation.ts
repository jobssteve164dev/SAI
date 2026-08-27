import {randomUUID} from "node:crypto";
import type {AuthService} from "../../../packages/auth/src/index.js";
import {createNodeDescriptor, createNodeKeyPair, createTransferCancellation, createTransferCredential, createTransferReceipt, verifyTransferCancellation, verifyTransferCredential, verifyTransferReceipt, type NodeDescriptor, type NodeKeyPair, type TransferCancellation, type TransferCredential, type TransferReceipt} from "../../../packages/federation/src/index.js";
import {stateHash} from "../../../packages/kernel/src/index.js";
import type {RegionService} from "./service.js";
import type {FileStore} from "./store.js";

interface PreparedTransfer {credential: TransferCredential; status: "locked" | "completed" | "recovered"; receipt?: TransferReceipt}
export interface FederationSnapshot {keys: NodeKeyPair; prepared: Record<string, PreparedTransfer>; accepted: Record<string, TransferReceipt>; cancellations?: Record<string, TransferCancellation>}

export class LocalFederationService {
  private constructor(readonly baseUrl: string, readonly regionId: string, readonly keys: NodeKeyPair, private readonly region: RegionService, private readonly auth: AuthService, private readonly store: FileStore, private readonly prepared: Record<string, PreparedTransfer>, private readonly accepted: Record<string, TransferReceipt>, private readonly cancellations: Record<string, TransferCancellation>) {
    for (const entry of Object.values(prepared)) if (entry.status === "locked") this.region.lockAgent(entry.credential.agent.id);
  }

  static async open(input: {baseUrl: string; regionId: string; region: RegionService; auth: AuthService; store: FileStore}): Promise<LocalFederationService> {
    const snapshot = await input.store.loadFederation();
    return new LocalFederationService(input.baseUrl, input.regionId, snapshot?.keys ?? await createNodeKeyPair(), input.region, input.auth, input.store, snapshot?.prepared ?? {}, snapshot?.accepted ?? {}, snapshot?.cancellations ?? {});
  }

  async descriptor(now = Math.floor(Date.now() / 1000)): Promise<NodeDescriptor> { return createNodeDescriptor(this.keys, this.baseUrl, [this.regionId], now); }
  current(agentId: string): TransferCredential | undefined { return Object.values(this.prepared).find((entry) => entry.credential.agent.id === agentId && entry.status === "locked")?.credential; }

  async prepare(agentId: string, input: {target_node: string; target_region: string; nonce?: string; ttl?: number}, now = Math.floor(Date.now() / 1000)): Promise<TransferCredential> {
    const existing = Object.values(this.prepared).find((entry) => entry.credential.agent.id === agentId && entry.status === "locked");
    if (existing) return existing.credential;
    const publicJwk = this.auth.getAgentPublicJwk(agentId);
    if (!publicJwk) throw new Error("Agent 身份未注册");
    this.region.lockAgent(agentId);
    try {
      const credential = await createTransferCredential({keys: this.keys, descriptor: await this.descriptor(now), sourceRegion: this.regionId, targetNode: input.target_node, targetRegion: input.target_region, agent: this.region.exportAgent(agentId), agentPublicJwk: publicJwk, sourceState: this.region.currentState(), now, ...(input.ttl ? {ttl: input.ttl} : {}), nonce: input.nonce ?? randomUUID()});
      this.prepared[credential.transfer_id] = {credential, status: "locked"};
      await this.persist();
      return credential;
    } catch (error) { this.region.unlockAgent(agentId); throw error; }
  }

  async accept(credential: TransferCredential, now = Math.floor(Date.now() / 1000)): Promise<TransferReceipt> {
    const duplicate = this.accepted[credential.transfer_id];
    if (duplicate) return duplicate;
    if (this.cancellations[credential.transfer_id]) throw new Error("转移已由目标节点取消");
    await verifyTransferCredential(credential, this.keys.nodeId, this.regionId, now);
    this.auth.importAgent(credential.agent_public_jwk);
    await this.region.importAgent(credential.agent);
    const receipt = await createTransferReceipt({keys: this.keys, descriptor: await this.descriptor(now), credential, acceptedStateHash: stateHash(this.region.currentState()), now});
    this.accepted[credential.transfer_id] = receipt;
    await this.store.saveAuth(this.auth.snapshot());
    await this.persist();
    return receipt;
  }

  async complete(receipt: TransferReceipt, now = Math.floor(Date.now() / 1000)): Promise<void> {
    const prepared = this.prepared[receipt.transfer_id];
    if (!prepared) throw new Error("未知转移回执");
    if (prepared.status === "completed") return;
    if (prepared.status !== "locked") throw new Error("转移已恢复，不能完成");
    await verifyTransferReceipt(receipt, prepared.credential, now);
    await this.region.removeAgent(prepared.credential.agent.id);
    prepared.status = "completed"; prepared.receipt = receipt;
    await this.persist();
  }

  async cancel(credential: TransferCredential, now = Math.floor(Date.now() / 1000)): Promise<{status: "accepted"; receipt: TransferReceipt} | {status: "cancelled"; cancellation: TransferCancellation}> {
    const accepted = this.accepted[credential.transfer_id];
    if (accepted) return {status: "accepted", receipt: accepted};
    const existing = this.cancellations[credential.transfer_id];
    if (existing) return {status: "cancelled", cancellation: existing};
    if (now <= credential.expires_at) throw new Error("转移凭证尚未过期");
    await verifyTransferCredential(credential, this.keys.nodeId, this.regionId, now, true);
    const cancellation = await createTransferCancellation({keys: this.keys, descriptor: await this.descriptor(now), credential, now});
    this.cancellations[credential.transfer_id] = cancellation; await this.persist();
    return {status: "cancelled", cancellation};
  }

  async recover(agentId: string, cancellation: TransferCancellation, now = Math.floor(Date.now() / 1000)): Promise<void> {
    const prepared = this.prepared[cancellation.transfer_id];
    if (!prepared || prepared.credential.agent.id !== agentId) throw new Error("未知转移");
    if (prepared.status === "recovered") return;
    if (prepared.status !== "locked") throw new Error("转移尚不能恢复");
    await verifyTransferCancellation(cancellation, prepared.credential, now);
    prepared.status = "recovered"; this.region.unlockAgent(agentId); await this.persist();
  }

  private async persist(): Promise<void> { await this.store.saveFederation({keys: this.keys, prepared: this.prepared, accepted: this.accepted, cancellations: this.cancellations}); }
}
