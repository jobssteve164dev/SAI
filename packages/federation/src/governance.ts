import {createHash} from "node:crypto";
import {canonicalJson, compactId} from "../../kernel/src/index.js";
import {signObject, verifyObject} from "./identity.js";
import {verifyNodeDescriptor} from "./protocol.js";
import {FEDERATION_PROTOCOL, type NodeDescriptor, type NodeKeyPair, type RouteManifest, type TransferCredential} from "./types.js";

export type NodeTrustStatus = "admitted" | "suspended" | "revoked";

export interface NodeTrustEntry {
  node_id: string;
  status: NodeTrustStatus;
  reputation: number;
  since: number;
  incident_ids: string[];
  reason?: string;
}

export interface UnsignedTrustDirectory {
  protocol: typeof FEDERATION_PROTOCOL;
  directory_id: string;
  sequence: number;
  issuer: NodeDescriptor;
  issued_at: number;
  expires_at: number;
  previous_directory_hash: string | null;
  entries: NodeTrustEntry[];
}

export interface TrustDirectory extends UnsignedTrustDirectory {signature: string}

export type NodeIncidentCategory = "equivocation" | "invalid_history" | "invalid_transfer" | "availability";

export interface UnsignedNodeIncident {
  protocol: typeof FEDERATION_PROTOCOL;
  incident_id: string;
  subject_node: string;
  reporter: NodeDescriptor;
  category: NodeIncidentCategory;
  evidence_hash: string;
  observed_at: number;
}

export interface NodeIncident extends UnsignedNodeIncident {signature: string}

export interface TransferAsset {
  asset_type: string;
  quantity: number;
}

export interface UnsignedTransferAssetProof {
  protocol: typeof FEDERATION_PROTOCOL;
  proof_id: string;
  transfer_id: string;
  agent_id: string;
  source_node: NodeDescriptor;
  source_state_hash: string;
  inventory_hash: string;
  assets: TransferAsset[];
  issued_at: number;
}

export interface TransferAssetProof extends UnsignedTransferAssetProof {signature: string}

export interface UnsignedWitnessAttestation {
  protocol: typeof FEDERATION_PROTOCOL;
  proof_hash: string;
  witness: NodeDescriptor;
  observed_at: number;
}

export interface WitnessAttestation extends UnsignedWitnessAttestation {signature: string}

export interface UnsignedRoutePublication {
  protocol: typeof FEDERATION_PROTOCOL;
  publisher: NodeDescriptor;
  manifest: RouteManifest;
  previous_publication_hash: string | null;
  activates_at: number;
  expires_at: number;
  supported_protocols: string[];
}

export interface RoutePublication extends UnsignedRoutePublication {signature: string}

export function federationObjectHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负安全整数`);
}

function assertHash(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error(`${label} 不是 SHA-256 base64url 摘要`);
}

function sortedTrustEntries(entries: NodeTrustEntry[]): NodeTrustEntry[] {
  return entries.map((entry) => ({...entry, incident_ids: [...new Set(entry.incident_ids)].sort()})).sort((a, b) => a.node_id.localeCompare(b.node_id));
}

function assertTrustEntry(entry: NodeTrustEntry): void {
  if (!(["admitted", "suspended", "revoked"] as string[]).includes(entry.status)) throw new Error("节点信任状态无效");
  if (!Number.isSafeInteger(entry.reputation) || entry.reputation < -100 || entry.reputation > 100) throw new Error("节点信誉必须是 -100 到 100 的整数");
  assertTimestamp(entry.since, "信任状态时间");
  if (new Set(entry.incident_ids).size !== entry.incident_ids.length) throw new Error("节点事件引用不能重复");
}

export async function createTrustDirectory(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; sequence: number; entries: NodeTrustEntry[]; now: number; ttl?: number; previous?: TrustDirectory}): Promise<TrustDirectory> {
  if (input.descriptor.node_id !== input.keys.nodeId) throw new Error("目录签发者与节点密钥不匹配");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error("信任目录序号无效");
  if (input.previous && input.sequence !== input.previous.sequence + 1) throw new Error("信任目录必须逐版递增");
  const entries = sortedTrustEntries(input.entries);
  if (new Set(entries.map((entry) => entry.node_id)).size !== entries.length) throw new Error("信任目录包含重复节点");
  for (const entry of entries) assertTrustEntry(entry);
  if (input.previous && input.previous.directory_id !== input.keys.nodeId) throw new Error("信任目录签发者不能在版本链中变更");
  const unsigned: UnsignedTrustDirectory = {
    protocol: FEDERATION_PROTOCOL,
    directory_id: input.keys.nodeId,
    sequence: input.sequence,
    issuer: input.descriptor,
    issued_at: input.now,
    expires_at: input.now + (input.ttl ?? 86_400),
    previous_directory_hash: input.previous ? federationObjectHash(input.previous) : null,
    entries,
  };
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyTrustDirectory(directory: TrustDirectory, now: number, previous?: TrustDirectory): Promise<void> {
  assertTimestamp(directory.issued_at, "目录签发时间");
  if (directory.protocol !== FEDERATION_PROTOCOL || directory.directory_id !== directory.issuer.node_id) throw new Error("信任目录身份不匹配");
  if (!Number.isSafeInteger(directory.sequence) || directory.sequence < 1 || directory.expires_at <= directory.issued_at) throw new Error("信任目录版本或有效期无效");
  if (directory.issued_at > now || directory.expires_at < now) throw new Error("信任目录已过期或尚未生效");
  await verifyNodeDescriptor(directory.issuer, directory.issued_at);
  const {signature, ...unsigned} = directory;
  await verifyObject(unsigned, signature, directory.issuer.public_jwk);
  const normalized = sortedTrustEntries(directory.entries);
  for (const entry of directory.entries) assertTrustEntry(entry);
  if (canonicalJson(normalized) !== canonicalJson(directory.entries) || new Set(normalized.map((entry) => entry.node_id)).size !== normalized.length) throw new Error("信任目录条目必须唯一且有序");
  if (previous) {
    if (directory.sequence !== previous.sequence + 1 || directory.previous_directory_hash !== federationObjectHash(previous)) throw new Error("信任目录版本链不连续");
  } else if (directory.sequence === 1 && directory.previous_directory_hash !== null) throw new Error("首版信任目录不能引用前序版本");
}

export function requireTrustedNode(directory: TrustDirectory, nodeId: string, minimumReputation = 0): NodeTrustEntry {
  const entry = directory.entries.find((candidate) => candidate.node_id === nodeId);
  if (!entry || entry.status !== "admitted" || entry.reputation < minimumReputation) throw new Error("节点未获当前信任目录许可");
  return entry;
}

export async function createNodeIncident(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; subjectNode: string; category: NodeIncidentCategory; evidenceHash: string; now: number}): Promise<NodeIncident> {
  assertHash(input.evidenceHash, "事件证据");
  if (input.descriptor.node_id !== input.keys.nodeId) throw new Error("报告者与节点密钥不匹配");
  const incidentId = compactId("incident", {reporter: input.keys.nodeId, subject: input.subjectNode, category: input.category, evidence: input.evidenceHash, observed_at: input.now});
  const unsigned: UnsignedNodeIncident = {protocol: FEDERATION_PROTOCOL, incident_id: incidentId, subject_node: input.subjectNode, reporter: input.descriptor, category: input.category, evidence_hash: input.evidenceHash, observed_at: input.now};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyNodeIncident(incident: NodeIncident, now: number): Promise<void> {
  if (incident.protocol !== FEDERATION_PROTOCOL || incident.observed_at > now) throw new Error("节点事件时间或协议无效");
  if (!(["equivocation", "invalid_history", "invalid_transfer", "availability"] as string[]).includes(incident.category)) throw new Error("节点事件分类无效");
  assertHash(incident.evidence_hash, "事件证据");
  await verifyNodeDescriptor(incident.reporter, incident.observed_at);
  const expectedId = compactId("incident", {reporter: incident.reporter.node_id, subject: incident.subject_node, category: incident.category, evidence: incident.evidence_hash, observed_at: incident.observed_at});
  if (incident.incident_id !== expectedId) throw new Error("节点事件 ID 不匹配");
  const {signature, ...unsigned} = incident;
  await verifyObject(unsigned, signature, incident.reporter.public_jwk);
}

function inventoryAssets(inventory: Record<string, number>): TransferAsset[] {
  return Object.entries(inventory).map(([asset_type, quantity]) => ({asset_type, quantity})).sort((a, b) => a.asset_type.localeCompare(b.asset_type));
}

export async function createTransferAssetProof(input: {keys: NodeKeyPair; credential: TransferCredential}): Promise<TransferAssetProof> {
  if (input.credential.source_node.node_id !== input.keys.nodeId) throw new Error("资产证明签发者不是迁移来源节点");
  const assets = inventoryAssets(input.credential.agent.inventory);
  for (const asset of assets) if (!Number.isSafeInteger(asset.quantity) || asset.quantity < 0) throw new Error("资产数量必须是非负安全整数");
  const inventoryHash = federationObjectHash(assets);
  const proofId = compactId("asset-proof", {transfer: input.credential.transfer_id, inventory: inventoryHash});
  const unsigned: UnsignedTransferAssetProof = {protocol: FEDERATION_PROTOCOL, proof_id: proofId, transfer_id: input.credential.transfer_id, agent_id: input.credential.agent.id, source_node: input.credential.source_node, source_state_hash: input.credential.source_state_hash, inventory_hash: inventoryHash, assets, issued_at: input.credential.issued_at};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyTransferAssetProof(proof: TransferAssetProof, credential: TransferCredential): Promise<void> {
  if (proof.protocol !== FEDERATION_PROTOCOL || proof.transfer_id !== credential.transfer_id || proof.agent_id !== credential.agent.id || proof.source_node.node_id !== credential.source_node.node_id || proof.source_state_hash !== credential.source_state_hash || proof.issued_at !== credential.issued_at) throw new Error("资产证明与迁移凭证不匹配");
  const assets = inventoryAssets(credential.agent.inventory);
  if (canonicalJson(proof.assets) !== canonicalJson(assets) || proof.inventory_hash !== federationObjectHash(assets)) throw new Error("资产证明与迁移库存不匹配");
  if (proof.proof_id !== compactId("asset-proof", {transfer: credential.transfer_id, inventory: proof.inventory_hash})) throw new Error("资产证明 ID 不匹配");
  const {signature, ...unsigned} = proof;
  await verifyObject(unsigned, signature, credential.source_node.public_jwk);
}

export async function createWitnessAttestation(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; proof: TransferAssetProof; now: number}): Promise<WitnessAttestation> {
  if (input.descriptor.node_id !== input.keys.nodeId || input.keys.nodeId === input.proof.source_node.node_id) throw new Error("见证者必须是独立节点");
  const unsigned: UnsignedWitnessAttestation = {protocol: FEDERATION_PROTOCOL, proof_hash: federationObjectHash(input.proof), witness: input.descriptor, observed_at: input.now};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyWitnessAttestations(input: {proof: TransferAssetProof; attestations: WitnessAttestation[]; now: number; threshold: number; directory?: TrustDirectory; minimumReputation?: number}): Promise<void> {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 0) throw new Error("见证阈值无效");
  const expectedHash = federationObjectHash(input.proof);
  const witnesses = new Set<string>();
  for (const attestation of input.attestations) {
    if (attestation.protocol !== FEDERATION_PROTOCOL || attestation.proof_hash !== expectedHash || attestation.observed_at < input.proof.issued_at || attestation.observed_at > input.now) throw new Error("见证声明与资产证明不匹配");
    if (attestation.witness.node_id === input.proof.source_node.node_id) throw new Error("来源节点不能见证自己的资产证明");
    await verifyNodeDescriptor(attestation.witness, attestation.observed_at);
    const {signature, ...unsigned} = attestation;
    await verifyObject(unsigned, signature, attestation.witness.public_jwk);
    if (input.directory) requireTrustedNode(input.directory, attestation.witness.node_id, input.minimumReputation ?? 0);
    witnesses.add(attestation.witness.node_id);
  }
  if (witnesses.size < input.threshold) throw new Error("独立见证数量不足");
}

export async function createRoutePublication(input: {keys: NodeKeyPair; descriptor: NodeDescriptor; manifest: RouteManifest; previous?: RoutePublication; now: number; ttl?: number; supportedProtocols?: string[]}): Promise<RoutePublication> {
  if (input.descriptor.node_id !== input.keys.nodeId) throw new Error("路由发布者与节点密钥不匹配");
  if (input.manifest.protocol !== FEDERATION_PROTOCOL) throw new Error("路由清单协议版本不匹配");
  if (input.previous && input.manifest.route_version !== input.previous.manifest.route_version + 1) throw new Error("路由版本必须逐版递增");
  const supported = [...new Set(input.supportedProtocols ?? [FEDERATION_PROTOCOL])].sort();
  if (!supported.length) throw new Error("路由发布必须声明至少一个协议版本");
  const unsigned: UnsignedRoutePublication = {protocol: FEDERATION_PROTOCOL, publisher: input.descriptor, manifest: structuredClone(input.manifest), previous_publication_hash: input.previous ? federationObjectHash(input.previous) : null, activates_at: input.now, expires_at: input.now + (input.ttl ?? 86_400), supported_protocols: supported};
  return {...unsigned, signature: await signObject(unsigned, input.keys.privateJwk)};
}

export async function verifyRoutePublication(publication: RoutePublication, now: number): Promise<void> {
  if (publication.protocol !== FEDERATION_PROTOCOL || publication.activates_at > now || publication.expires_at < now) throw new Error("路由发布已过期或尚未生效");
  if (publication.manifest.protocol !== FEDERATION_PROTOCOL || publication.expires_at <= publication.activates_at) throw new Error("路由清单协议或有效期无效");
  if (!Number.isSafeInteger(publication.manifest.route_version) || publication.manifest.route_version < 1) throw new Error("路由版本无效");
  if (canonicalJson([...new Set(publication.supported_protocols)].sort()) !== canonicalJson(publication.supported_protocols) || !publication.supported_protocols.includes(FEDERATION_PROTOCOL)) throw new Error("路由协议版本声明无效");
  await verifyNodeDescriptor(publication.publisher, publication.activates_at);
  const {signature, ...unsigned} = publication;
  await verifyObject(unsigned, signature, publication.publisher.public_jwk);
}

export async function applyRoutePublication(current: RoutePublication | undefined, next: RoutePublication, now: number, allowedPublishers?: ReadonlySet<string>): Promise<RoutePublication> {
  await verifyRoutePublication(next, now);
  if (allowedPublishers && !allowedPublishers.has(next.publisher.node_id)) throw new Error("路由发布者未获许可");
  if (!current) {
    if (next.previous_publication_hash !== null) throw new Error("首版路由不能引用未知前序版本");
    return next;
  }
  if (federationObjectHash(current) === federationObjectHash(next)) return current;
  if (next.manifest.parent_region !== current.manifest.parent_region || next.manifest.route_version !== current.manifest.route_version + 1 || next.previous_publication_hash !== federationObjectHash(current)) throw new Error("并发路由发布未基于当前版本");
  return next;
}

export function negotiateFederationProtocol(local: string[], remote: string[]): string {
  const compatible = local.find((version) => remote.includes(version));
  if (!compatible) throw new Error("没有共同支持的联邦协议版本");
  return compatible;
}
