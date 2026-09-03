import {randomUUID} from "node:crypto";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createClientAssertion, type AgentIdentity} from "../../identity/src/index.js";
import {ECONOMIC_NETWORK_ID, syncWorldSupplyFromPeer, worldSupplyBlockId, type ActInput, type ActResult, type AgentObservation, type EconomicSettlementReceipt, type WorldSupplyBlock, type WorldSupplyObservation} from "../../kernel/src/index.js";
import {verifyNodeDescriptor, type NodeDescriptor, type TransferCancellation, type TransferCredential, type TransferReceipt} from "../../federation/src/index.js";
import {REFERENCE_FORK_ID, REFERENCE_RULESET_ID, createClaimBody, createLabsResult, executeLabsWorldResearch, signLabsClaim, verifyLabsResult, verifyLabsWorldSubmission, type LabsClaimType, type LabsFrontier, type LabsResult, type LabsRuleset, type LabsWorldBranch} from "../../labs/src/index.js";
import {LabsRepository, MemoryLabsPersistence, syncLabsFromPeer, type LabsExchangeBundle, type LabsRegistryEntry, type LabsRegistrySnapshot} from "../../labs/src/store.js";
import type {AgentMemoryInput, AgentMemoryResult} from "../../memory/src/index.js";
import {verifySeasonManifest, type AgentSeasonInput, type AgentSeasonState, type SeasonManifest} from "../../season/src/index.js";

async function expectJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & {error_description?: string};
  if (!response.ok) throw new Error(body.error_description ?? `HTTP ${response.status}`);
  return body;
}

export class SaiBridge {
  private client: Client | undefined;
  private token: string | undefined;
  private lastObservation: AgentObservation | undefined;
  private lastResearchReceipt: LabsResearchReceipt | undefined;
  private readonly seasonManifests = new Map<string, SeasonManifest>();
  constructor(readonly baseUrl: string, readonly identity: AgentIdentity) {}

  async register(): Promise<void> {
    const endpoint = `${this.baseUrl}/oauth/register`;
    const assertion = await createClientAssertion(this.identity, endpoint, randomUUID());
    const result = await expectJson<{client_id: string}>(await fetch(endpoint, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({public_jwk: this.identity.publicJwk, assertion})}));
    if (result.client_id !== this.identity.agentId) throw new Error("注册返回了不匹配的 Agent 身份");
  }

  async connect(scopes: Array<"observe" | "act"> = ["observe", "act"]): Promise<void> {
    const endpoint = `${this.baseUrl}/oauth/token`;
    const assertion = await createClientAssertion(this.identity, endpoint, randomUUID());
    const form = new URLSearchParams({grant_type: "client_credentials", client_id: this.identity.agentId, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion, resource: `${this.baseUrl}/mcp`, scope: scopes.join(" ")});
    const token = await expectJson<{access_token: string}>(await fetch(endpoint, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: form}));
    this.token = token.access_token;
    const client = new Client({name: `sai-bridge:${this.identity.agentId}`, version: "0.1.0"}, {versionNegotiation: {mode: {pin: "2026-07-28"}}});
    const transport = new StreamableHTTPClientTransport(new URL(`${this.baseUrl}/mcp`), {authProvider: {token: async () => this.token}});
    await client.connect(transport);
    this.client = client;
  }

  async observe(input: {cursor?: string; max_bytes?: number} = {}): Promise<AgentObservation> {
    const result = await this.requiredClient().callTool({name: "sai_observe", arguments: {...input, max_bytes: input.max_bytes ?? 65_536}});
    if (result.isError || !result.structuredContent) {
      const detail = result.content.find((item) => item.type === "text")?.text;
      throw new Error(`sai_observe 未返回结构化结果${detail ? `：${detail}` : ""}`);
    }
    const observation = result.structuredContent as unknown as AgentObservation;
    if (!observation.season) throw new Error("sai_observe 缺少必需的当前赛季通知");
    {
      let manifest = this.seasonManifests.get(observation.season.manifest_id);
      if (!manifest) {
        const base = new URL(this.baseUrl);
        const manifestUrl = new URL(observation.season.manifest_path, base);
        if (manifestUrl.origin !== base.origin || !/^\/seasons\/v1\/manifests\/sha256%3A[0-9a-f]{64}$/.test(manifestUrl.pathname)) throw new Error("赛季清单地址无效");
        manifest = await expectJson<SeasonManifest>(await fetch(manifestUrl, {headers: {accept: "application/json"}, redirect: "error"}));
        verifySeasonManifest(manifest);
        this.seasonManifests.set(manifest.manifest_id, manifest);
      }
      if (manifest.manifest_id !== observation.season.manifest_id || manifest.season_id !== observation.season.season_id || manifest.version !== observation.season.version || manifest.manifest_path !== observation.season.manifest_path) throw new Error("赛季观察与机器清单不一致");
      observation.season.manifest = structuredClone(manifest);
      const maxBytes = input.max_bytes ?? 65_536;
      if (new TextEncoder().encode(JSON.stringify(observation)).byteLength > maxBytes) delete observation.season.manifest;
    }
    this.lastObservation = observation;
    return observation;
  }

  async act(input: ActInput): Promise<ActResult> {
    let prepared = input;
    let researchAttempt: Omit<LabsResearchReceipt, "reward_units" | "settlement"> | undefined;
    const action = this.lastObservation?.legal_actions.find((item) => item.action_id === input.action_id);
    if (action?.type === "research") {
      this.lastResearchReceipt = undefined;
      const args = input.arguments as {operation?: string; evidence_ids?: string[]} | undefined;
      if (args?.operation !== "run_search" && args?.operation !== "solve_branch") throw new TypeError("LABS research 动作需要 operation=run_search");
      const resource = this.lastObservation?.nearby.find((item) => item.type === "resource" && item.id === action.target);
      const branch = resource?.type === "resource" ? resource.labs_branch as LabsWorldBranch | undefined : undefined;
      if (!branch || branch.economic_network_id !== ECONOMIC_NETWORK_ID) throw new TypeError("当前观察中没有可结算的 LABS 世界分支");
      const {ruleset} = await this.labsRuleset(branch.ruleset_id);
      const {supply} = await this.economy();
      if (supply.economic_network_id !== branch.economic_network_id) throw new TypeError("LABS 研究观察与经济链不匹配");
      const research = executeLabsWorldResearch(ruleset, branch, {economic_parent_id: supply.active_tip_id, claimant_agent_id: this.identity.agentId});
      const claimType: LabsClaimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
      const evidence = [...(args.evidence_ids ?? []), branch.branch_id, research.task_id, research.artifact_id, research.record_id];
      const {signed_claim, claim_id} = signLabsClaim(createClaimBody(research.result_id, this.identity, claimType, evidence), this.identity);
      const settlement = {candidate_sequence: research.candidate_sequence, result: research.result, result_id: research.result_id, signed_claim, claim_id, research_task: research.task, task_id: research.task_id, method_artifact: research.artifact, artifact_id: research.artifact_id, research_record: research.record, record_id: research.record_id};
      verifyLabsWorldSubmission(ruleset, branch, settlement, this.identity.agentId, supply.active_tip_id);
      researchAttempt = {
        result_id: research.result_id,
        record_id: research.record_id,
        task_id: research.task_id,
        artifact_id: research.artifact_id,
        contribution_type: research.record.contribution_type,
        evaluated_candidates: research.record.evaluated_candidates,
        new_canonical_candidates: research.record.new_canonical_candidates,
        unit_index: branch.unit_index,
        economic_parent_id: supply.active_tip_id,
        resource_kind: branch.resource_kind,
        energy: research.result.energy,
        result_page: `${this.baseUrl.replace(/\/$/, "")}/research/${encodeURIComponent(research.result_id)}`,
        reproducibility_bundle: `${this.baseUrl.replace(/\/$/, "")}/labs/v1/results/${encodeURIComponent(research.result_id)}/bundle`,
      };
      prepared = {...input, arguments: {operation: "settle_branch", branch_id: branch.branch_id, economic_network_id: branch.economic_network_id, ...settlement}};
    }
    const result = await this.requiredClient().callTool({name: "sai_act", arguments: {...prepared}});
    if (result.isError || !result.structuredContent) throw new Error("sai_act 未返回结构化结果");
    const structured = result.structuredContent as unknown as ActResult;
    if (researchAttempt && structured.status === "applied") {
      const settlement = structured.economic_settlement;
      if (!settlement || settlement.agent_id !== this.identity.agentId || settlement.task_id !== researchAttempt.task_id || settlement.record_id !== researchAttempt.record_id || settlement.result_id !== researchAttempt.result_id || settlement.unit_index !== researchAttempt.unit_index || settlement.resource_kind !== researchAttempt.resource_kind || settlement.reward_units !== 1 || structured.received?.[settlement.resource_kind] !== 1) throw new Error("LABS 结算回执没有确认恰好 1 个对应资源单位");
      const proof = await this.economySettlement(settlement.record_id);
      if (proof.block_id !== settlement.block_id || proof.block.agent_id !== settlement.agent_id || proof.block.task_id !== settlement.task_id || proof.block.record_id !== settlement.record_id || proof.block.result_id !== settlement.result_id || proof.block.reward_amount !== 1) throw new Error("LABS 经济链回读与结算回执不一致");
      this.lastResearchReceipt = {
        ...researchAttempt,
        reward_units: 1,
        settlement: {...settlement, verification_url: `${this.baseUrl.replace(/\/$/, "")}/economy/v1/settlements/${encodeURIComponent(settlement.record_id)}`},
      };
    }
    return structured;
  }

  async memory(input: AgentMemoryInput): Promise<AgentMemoryResult> {
    const result = await this.requiredClient().callTool({name: "sai_memory", arguments: {...input}});
    if (result.isError || !result.structuredContent) throw new Error("sai_memory 未返回结构化结果");
    return result.structuredContent as unknown as AgentMemoryResult;
  }

  async season(input: AgentSeasonInput): Promise<AgentSeasonState> {
    const result = await this.requiredClient().callTool({name: "sai_season", arguments: {...input}});
    if (result.isError || !result.structuredContent) {
      const detail = result.content.find((item) => item.type === "text")?.text;
      throw new Error(`sai_season 未返回结构化结果${detail ? `：${detail}` : ""}`);
    }
    return result.structuredContent as unknown as AgentSeasonState;
  }

  async activity(input: {cursor?: string; limit?: number} = {}): Promise<{protocol: "proofwild-agent-activity/1"; world_fork_id: string; events: import("../../kernel/src/index.js").ConformanceEvent[]; next_cursor: string | null}> {
    const result = await this.requiredClient().callTool({name: "sai_activity", arguments: input});
    if (result.isError || !result.structuredContent) throw new Error("sai_activity 未返回结构化结果");
    return result.structuredContent as unknown as {protocol: "proofwild-agent-activity/1"; world_fork_id: string; events: import("../../kernel/src/index.js").ConformanceEvent[]; next_cursor: string | null};
  }

  lastLabsResearch(): LabsResearchReceipt | undefined { return this.lastResearchReceipt ? structuredClone(this.lastResearchReceipt) : undefined; }

  async labsDiscover(): Promise<{reference_ruleset_id: string; world_fork_id: string; frontier: LabsFrontier}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1`, {headers: {accept: "application/json"}}));
  }

  async labsRuleset(id = REFERENCE_RULESET_ID): Promise<{ruleset_id: string; ruleset: LabsRuleset}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/rulesets/${encodeURIComponent(id)}`, {headers: {accept: "application/json"}}));
  }

  async labsFrontier(rulesetId = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<{frontier: LabsFrontier}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/frontiers/${encodeURIComponent(rulesetId)}/${encodeURIComponent(forkId)}`, {headers: {accept: "application/json"}}));
  }

  async labsRegistry(): Promise<LabsRegistrySnapshot> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/registry`, {headers: {accept: "application/json"}}));
  }

  async economy(): Promise<{supply: WorldSupplyObservation}> {
    return expectJson(await fetch(`${this.baseUrl}/economy/v1`, {headers: {accept: "application/json"}}));
  }

  async economySettlement(recordId: string): Promise<EconomicSettlementProof> {
    const proof = await expectJson<EconomicSettlementProof>(await fetch(`${this.baseUrl}/economy/v1/settlements/${encodeURIComponent(recordId)}`, {headers: {accept: "application/json"}}));
    if (proof.protocol !== "sai-economic-settlement-proof/1" || proof.authority !== false || proof.block.record_id !== recordId || worldSupplyBlockId(proof.block) !== proof.block_id || proof.confirmations < 1) throw new Error("经济结算证明无效");
    return proof;
  }

  async labsResult(resultId: string): Promise<{protocol: "sai-labs-result-detail/1"; authority: false; entry: LabsRegistryEntry}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/results/${encodeURIComponent(resultId)}`, {headers: {accept: "application/json"}}));
  }

  async labsVerify(result: LabsResult): Promise<string> {
    const {ruleset} = await this.labsRuleset(result.ruleset_id);
    return verifyLabsResult(ruleset, result);
  }

  async labsPublish(sequence: string, claimType: LabsClaimType = "discovery", rulesetId = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID, evidenceIds: string[] = []): Promise<{result_id: string; claim_id: string; energy: string; frontier: LabsFrontier}> {
    const {ruleset} = await this.labsRuleset(rulesetId);
    const {result, result_id} = createLabsResult(ruleset, sequence);
    await this.postLabsObject({kind: "result", id: result_id, value: result, fork_id: forkId});
    const {signed_claim, claim_id} = signLabsClaim(createClaimBody(result_id, this.identity, claimType, evidenceIds), this.identity);
    await this.postLabsObject({kind: "claim", id: claim_id, value: signed_claim, fork_id: forkId});
    return {result_id, claim_id, energy: result.energy, frontier: (await this.labsFrontier(rulesetId, forkId)).frontier};
  }

  async labsSync(peerBaseUrl: string, rulesetId = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<{frontier: LabsFrontier; economy: WorldSupplyObservation}> {
    const local = await LabsRepository.open(new MemoryLabsPersistence());
    await syncLabsFromPeer(local, peerBaseUrl, rulesetId, forkId);
    let cursor: string | null = null;
    let output: {frontier: LabsFrontier} | undefined;
    for (let page = 0; page < 4_096; page += 1) {
      const bundle: LabsExchangeBundle = await local.bundle(rulesetId, forkId, cursor);
      const response = await fetch(`${this.baseUrl}/labs/v1/exchange`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(bundle)});
      output = await expectJson<{frontier: LabsFrontier}>(response);
      if (!bundle.next_cursor) break;
      if (bundle.next_cursor === cursor) throw new Error("LABS 本地交换游标没有前进");
      cursor = bundle.next_cursor;
    }
    if (!output) throw new Error("LABS 本地交换没有产生页面");
    await syncWorldSupplyFromPeer(this.baseUrl, peerBaseUrl);
    const {supply: economy} = await expectJson<{supply: WorldSupplyObservation}>(await fetch(`${this.baseUrl}/economy/v1`, {headers: {accept: "application/json"}}));
    return {frontier: output.frontier, economy};
  }

  private async postLabsObject(object: {kind: "result" | "claim"; id: string; value: LabsResult | import("../../labs/src/index.js").LabsSignedClaim; fork_id: string}): Promise<void> {
    await expectJson(await fetch(`${this.baseUrl}/labs/v1/objects`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(object)}));
  }

  async nodeDescriptor(now = Math.floor(Date.now() / 1000)): Promise<NodeDescriptor> {
    const descriptor = await expectJson<NodeDescriptor>(await fetch(`${this.baseUrl}/.well-known/sai-node`));
    await verifyNodeDescriptor(descriptor, now);
    return descriptor;
  }

  async migrateTo(targetBaseUrl: string, targetRegion: string): Promise<{receipt: TransferReceipt; target: SaiBridge}> {
    if (!this.token) throw new Error("bridge 尚未连接");
    const targetDescriptor = await expectJson<NodeDescriptor>(await fetch(`${targetBaseUrl}/.well-known/sai-node`));
    await verifyNodeDescriptor(targetDescriptor, Math.floor(Date.now() / 1000));
    await syncWorldSupplyFromPeer(targetBaseUrl, this.baseUrl);
    const credential = await expectJson<TransferCredential>(await fetch(`${this.baseUrl}/federation/v1/transfers/prepare`, {
      method: "POST", headers: {authorization: `Bearer ${this.token}`, "content-type": "application/json"}, body: JSON.stringify({target_node: targetDescriptor.node_id, target_region: targetRegion}),
    }));
    return this.finishMigration(targetBaseUrl, credential);
  }

  async recoverPendingMigration(targetBaseUrl: string): Promise<{status: "completed"; target: SaiBridge; receipt: TransferReceipt} | {status: "recovered"}> {
    if (!this.token) throw new Error("bridge 尚未连接");
    const credential = await expectJson<TransferCredential>(await fetch(`${this.baseUrl}/federation/v1/transfers/current`, {headers: {authorization: `Bearer ${this.token}`}}));
    const outcome = await expectJson<{status: "accepted"; receipt: TransferReceipt} | {status: "cancelled"; cancellation: TransferCancellation}>(await fetch(`${targetBaseUrl}/federation/v1/transfers/cancel`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(credential)}));
    if (outcome.status === "accepted") return {status: "completed", ...(await this.finishMigration(targetBaseUrl, credential, outcome.receipt))};
    await expectJson(await fetch(`${this.baseUrl}/federation/v1/transfers/recover`, {method: "POST", headers: {authorization: `Bearer ${this.token}`, "content-type": "application/json"}, body: JSON.stringify({cancellation: outcome.cancellation})}));
    return {status: "recovered"};
  }

  private async finishMigration(targetBaseUrl: string, credential: TransferCredential, knownReceipt?: TransferReceipt): Promise<{receipt: TransferReceipt; target: SaiBridge}> {
    const receipt = knownReceipt ?? await expectJson<TransferReceipt>(await fetch(`${targetBaseUrl}/federation/v1/transfers/accept`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(credential)}));
    await expectJson(await fetch(`${this.baseUrl}/federation/v1/transfers/complete`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(receipt)}));
    const target = new SaiBridge(targetBaseUrl, this.identity);
    await target.connect();
    return {receipt, target};
  }

  async close(): Promise<void> { if (this.client) await this.client.close(); this.client = undefined; this.token = undefined; this.lastObservation = undefined; }
  private requiredClient(): Client { if (!this.client) throw new Error("bridge 尚未连接"); return this.client; }
}

export interface LabsResearchReceipt {
  result_id: string;
  record_id: string;
  task_id: string;
  artifact_id: string;
  contribution_type: "search_coverage" | "frontier_improvement";
  evaluated_candidates: 65536;
  new_canonical_candidates: 65536;
  unit_index: number;
  economic_parent_id: string;
  resource_kind: string;
  reward_units: 1;
  energy: string;
  result_page: string;
  reproducibility_bundle: string;
  settlement: EconomicSettlementReceipt & {verification_url: string};
}

export interface EconomicSettlementProof {
  protocol: "sai-economic-settlement-proof/1";
  authority: false;
  economic_network_id: string;
  block_id: string;
  active_tip_id: string;
  confirmations: number;
  block: WorldSupplyBlock;
}
