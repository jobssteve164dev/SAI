import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {startLocalNode} from "../../apps/local-node/src/server.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";

const directory = (prefix: string) => mkdtemp(join(tmpdir(), prefix));

describe("M1 双节点迁移", () => {
  it("Agent 经签名凭证从一个独立本地节点迁移到另一个，重试不会复制", async () => {
    const source = await startLocalNode({dataDirectory: await directory("sai-source-"), port: 0, regionId: "source"});
    const target = await startLocalNode({dataDirectory: await directory("sai-target-"), port: 0, regionId: "target"});
    const identity = await createIdentity();
    const bridge = new SaiBridge(source.url, identity);
    let targetBridge: SaiBridge | undefined;
    try {
      await bridge.register(); await bridge.connect();
      const before = source.region.exportAgent(identity.agentId);
      const targetDescriptor = await target.federation.descriptor();
      const credential = await source.federation.prepare(identity.agentId, {target_node: targetDescriptor.node_id, target_region: "target", nonce: "migration-fixed-nonce"});
      const firstReceipt = await target.federation.accept(credential);
      expect(await target.federation.accept(credential)).toEqual(firstReceipt);
      expect(await target.federation.cancel(credential, credential.expires_at + 1)).toEqual({status: "accepted", receipt: firstReceipt});
      await source.federation.complete(firstReceipt);
      await source.federation.complete(firstReceipt);
      expect(source.region.currentState().agents[identity.agentId]).toBeUndefined();
      expect(target.region.currentState().agents[identity.agentId]).toEqual(before);
      targetBridge = new SaiBridge(target.url, identity); await targetBridge.connect();
      expect((await targetBridge.observe()).self.agent_id).toBe(identity.agentId);
    } finally {
      if (targetBridge) await targetBridge.close();
      await bridge.close(); await source.close(); await target.close();
    }
  });

  it("来源节点离线后不影响目标区域继续结算", async () => {
    const source = await startLocalNode({dataDirectory: await directory("sai-offline-source-"), port: 0, regionId: "source"});
    const target = await startLocalNode({dataDirectory: await directory("sai-offline-target-"), port: 0, regionId: "target"});
    const bridge = new SaiBridge(source.url, await createIdentity());
    let migrated: SaiBridge | undefined;
    try {
      await bridge.register(); await bridge.connect();
      ({target: migrated} = await bridge.migrateTo(target.url, "target"));
      await source.close();
      const observation = await migrated.observe();
      const result = await migrated.act({observation_id: observation.observation_id, action_id: observation.legal_actions[0]!.action_id, request_id: "source-offline"});
      expect(result.status).toBe("applied");
    } finally {
      if (migrated) await migrated.close();
      await bridge.close(); await target.close();
    }
  });

  it("桥接器吸收完整迁移协议，Agent 只切换目标节点", async () => {
    const source = await startLocalNode({dataDirectory: await directory("sai-bridge-source-"), port: 0, regionId: "source"});
    const target = await startLocalNode({dataDirectory: await directory("sai-bridge-target-"), port: 0, regionId: "target"});
    const bridge = new SaiBridge(source.url, await createIdentity());
    let migrated: SaiBridge | undefined;
    try {
      await bridge.register(); await bridge.connect();
      ({target: migrated} = await bridge.migrateTo(target.url, "target"));
      expect((await migrated.observe()).region_id).toBe("target");
      expect(source.region.currentState().agents[bridge.identity.agentId]).toBeUndefined();
      expect(target.region.currentState().agents[bridge.identity.agentId]).toBeDefined();
    } finally {
      if (migrated) await migrated.close();
      await bridge.close(); await source.close(); await target.close();
    }
  });

  it("过期但未被目标接收的迁移可恢复，篡改凭证不能被接收", async () => {
    const source = await startLocalNode({dataDirectory: await directory("sai-recover-source-"), port: 0, regionId: "source"});
    const target = await startLocalNode({dataDirectory: await directory("sai-recover-target-"), port: 0, regionId: "target"});
    const identity = await createIdentity();
    try {
      source.auth.importAgent(identity.publicJwk); await source.region.admit(identity.agentId);
      const descriptor = await target.federation.descriptor(1000);
      const credential = await source.federation.prepare(identity.agentId, {target_node: descriptor.node_id, target_region: "target", nonce: "recovery-fixed-nonce", ttl: 1}, 1000);
      const tampered = structuredClone(credential); tampered.agent.energy += 1;
      await expect(target.federation.accept(tampered, 1000)).rejects.toThrow();
      const cancelled = await target.federation.cancel(credential, 1002);
      expect(cancelled.status).toBe("cancelled");
      if (cancelled.status !== "cancelled") throw new Error("expected cancellation");
      await source.federation.recover(identity.agentId, cancelled.cancellation, 1002);
      expect(source.region.isLocked(identity.agentId)).toBe(false);
      expect((await source.region.observe(identity.agentId)).self.agent_id).toBe(identity.agentId);
      await expect(target.federation.accept(credential, 1002)).rejects.toThrow("取消");
    } finally { await source.close(); await target.close(); }
  });
});
