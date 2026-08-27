import {describe, expect, it} from "vitest";
import {
  applyRoutePublication,
  createNodeDescriptor,
  createNodeIncident,
  createNodeKeyPair,
  createRoutePublication,
  createTransferAssetProof,
  createTransferCredential,
  createTrustDirectory,
  createWitnessAttestation,
  federationObjectHash,
  negotiateFederationProtocol,
  requireTrustedNode,
  splitRegion,
  verifyNodeIncident,
  verifyTransferAssetProof,
  verifyTrustDirectory,
  verifyWitnessAttestations,
  type NodeTrustEntry,
} from "../../packages/federation/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";
import {createWorld} from "../../packages/kernel/src/index.js";

describe("M1 节点信任与恶意历史", () => {
  it("用签名版本链许可节点，并以可验证事件撤销恶意节点", async () => {
    const authority = await createNodeKeyPair();
    const member = await createNodeKeyPair();
    const authorityDescriptor = await createNodeDescriptor(authority, "https://directory.example", ["directory"], 1_000);
    const initialEntry: NodeTrustEntry = {node_id: member.nodeId, status: "admitted", reputation: 40, since: 1_000, incident_ids: []};
    const first = await createTrustDirectory({keys: authority, descriptor: authorityDescriptor, sequence: 1, entries: [initialEntry], now: 1_000});
    await verifyTrustDirectory(first, 1_001);
    expect(requireTrustedNode(first, member.nodeId, 20).reputation).toBe(40);

    const incident = await createNodeIncident({keys: authority, descriptor: authorityDescriptor, subjectNode: member.nodeId, category: "invalid_history", evidenceHash: federationObjectHash({event: "conflicting-history"}), now: 1_002});
    await verifyNodeIncident(incident, 1_002);
    const second = await createTrustDirectory({keys: authority, descriptor: authorityDescriptor, sequence: 2, previous: first, entries: [{node_id: member.nodeId, status: "revoked", reputation: -100, since: 1_002, incident_ids: [incident.incident_id], reason: "signed invalid history evidence"}], now: 1_002});
    await verifyTrustDirectory(second, 1_003, first);
    expect(() => requireTrustedNode(second, member.nodeId)).toThrow("未获当前信任目录许可");

    const tampered = structuredClone(second);
    tampered.entries[0]!.reputation = 100;
    await expect(verifyTrustDirectory(tampered, 1_003, first)).rejects.toThrow();
  });
});

describe("M1 资产证明与第三方见证", () => {
  it("把迁移库存绑定到来源状态，并只计算独立且获许可的见证节点", async () => {
    const source = await createNodeKeyPair();
    const target = await createNodeKeyPair();
    const witnessA = await createNodeKeyPair();
    const witnessB = await createNodeKeyPair();
    const authority = await createNodeKeyPair();
    const sourceDescriptor = await createNodeDescriptor(source, "https://source.example", ["source"], 1_000);
    const witnessADescriptor = await createNodeDescriptor(witnessA, "https://witness-a.example", ["witness-a"], 1_000);
    const witnessBDescriptor = await createNodeDescriptor(witnessB, "https://witness-b.example", ["witness-b"], 1_000);
    const authorityDescriptor = await createNodeDescriptor(authority, "https://directory.example", ["directory"], 1_000);
    const identity = await createIdentity();
    const world = createWorld("source", [{id: identity.agentId, x: 2, y: 2, energy: 5, inventory: {crystal: 2, fiber: 1}}]);
    const credential = await createTransferCredential({keys: source, descriptor: sourceDescriptor, sourceRegion: "source", targetNode: target.nodeId, targetRegion: "target", agent: world.agents[identity.agentId]!, agentPublicJwk: identity.publicJwk, sourceState: world, now: 1_000, nonce: "asset-proof"});
    const proof = await createTransferAssetProof({keys: source, credential});
    await verifyTransferAssetProof(proof, credential);
    expect(proof.assets).toEqual([{asset_type: "crystal", quantity: 2}, {asset_type: "fiber", quantity: 1}]);

    const directory = await createTrustDirectory({keys: authority, descriptor: authorityDescriptor, sequence: 1, entries: [witnessA, witnessB].map((keys) => ({node_id: keys.nodeId, status: "admitted", reputation: 25, since: 1_000, incident_ids: []})), now: 1_000});
    const attestations = [
      await createWitnessAttestation({keys: witnessA, descriptor: witnessADescriptor, proof, now: 1_001}),
      await createWitnessAttestation({keys: witnessB, descriptor: witnessBDescriptor, proof, now: 1_001}),
    ];
    await verifyWitnessAttestations({proof, attestations, now: 1_002, threshold: 2, directory, minimumReputation: 20});
    await expect(verifyWitnessAttestations({proof, attestations: [attestations[0]!, attestations[0]!], now: 1_002, threshold: 2, directory})).rejects.toThrow("独立见证数量不足");

    const tampered = structuredClone(proof);
    tampered.assets[0]!.quantity = 3;
    await expect(verifyTransferAssetProof(tampered, credential)).rejects.toThrow("库存不匹配");
  });
});

describe("M1 并发路由发布与协议升级", () => {
  it("通过签名版本链拒绝从旧版本并发覆盖，并协商共同协议", async () => {
    const publisher = await createNodeKeyPair();
    const descriptor = await createNodeDescriptor(publisher, "https://routes.example", ["parent"], 1_000);
    const world = createWorld("parent", []);
    const manifestV1 = splitRegion(world, "x", 4, ["west", "east"]).manifest;
    const first = await createRoutePublication({keys: publisher, descriptor, manifest: manifestV1, now: 1_000, supportedProtocols: ["sai-federation/0.1.0", "sai-federation/0.2.0"]});
    const allowed = new Set([publisher.nodeId]);
    const acceptedFirst = await applyRoutePublication(undefined, first, 1_001, allowed);

    const branchA = await createRoutePublication({keys: publisher, descriptor, previous: first, manifest: {...manifestV1, route_version: 2, coordinate: 3}, now: 1_001});
    const branchB = await createRoutePublication({keys: publisher, descriptor, previous: first, manifest: {...manifestV1, route_version: 2, coordinate: 5}, now: 1_001});
    const acceptedSecond = await applyRoutePublication(acceptedFirst, branchA, 1_002, allowed);
    await expect(applyRoutePublication(acceptedSecond, branchB, 1_002, allowed)).rejects.toThrow("未基于当前版本");
    expect(negotiateFederationProtocol(["sai-federation/0.3.0", "sai-federation/0.2.0"], first.supported_protocols)).toBe("sai-federation/0.2.0");
    expect(() => negotiateFederationProtocol(["sai-federation/9"], first.supported_protocols)).toThrow("没有共同支持");
  });
});
