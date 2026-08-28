import {randomUUID} from "node:crypto";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createClientAssertion, type AgentIdentity} from "../../identity/src/index.js";
import type {ActInput, ActResult, Observation} from "../../kernel/src/index.js";
import {verifyNodeDescriptor, type NodeDescriptor, type TransferCancellation, type TransferCredential, type TransferReceipt} from "../../federation/src/index.js";
import {REFERENCE_FORK_ID, REFERENCE_RULESET_ID, createClaimBody, createLabsResult, signLabsClaim, verifyLabsResult, type LabsClaimType, type LabsFrontier, type LabsResult, type LabsRuleset} from "../../labs/src/index.js";
import {LabsRepository, MemoryLabsPersistence, syncLabsFromPeer, type LabsExchangeBundle} from "../../labs/src/store.js";

async function expectJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & {error_description?: string};
  if (!response.ok) throw new Error(body.error_description ?? `HTTP ${response.status}`);
  return body;
}

export class SaiBridge {
  private client: Client | undefined;
  private token: string | undefined;
  private lastObservation: Observation | undefined;
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

  async observe(input: {cursor?: string; max_bytes?: number} = {}): Promise<Observation> {
    const result = await this.requiredClient().callTool({name: "sai_observe", arguments: input});
    if (result.isError || !result.structuredContent) throw new Error("sai_observe 未返回结构化结果");
    const observation = result.structuredContent as unknown as Observation;
    this.lastObservation = observation;
    return observation;
  }

  async act(input: ActInput): Promise<ActResult> {
    let prepared = input;
    const action = this.lastObservation?.legal_actions.find((item) => item.action_id === input.action_id);
    if (action?.type === "research") {
      const args = input.arguments as {operation?: string; sequence?: string; claim_type?: LabsClaimType; evidence_ids?: string[]} | undefined;
      if (args?.operation !== "publish" || typeof args.sequence !== "string") throw new TypeError("LABS research 动作需要 operation=publish 和 sequence");
      const rulesetId = this.lastObservation?.research?.ruleset_id ?? REFERENCE_RULESET_ID;
      const forkId = this.lastObservation?.research?.fork_id ?? REFERENCE_FORK_ID;
      const {ruleset} = await this.labsRuleset(rulesetId);
      const {result: labsResult, result_id} = createLabsResult(ruleset, args.sequence);
      const {signed_claim, claim_id} = signLabsClaim(createClaimBody(result_id, this.identity, args.claim_type ?? "discovery", args.evidence_ids ?? []), this.identity);
      prepared = {...input, arguments: {operation: "publish", result: labsResult, result_id, signed_claim, claim_id, fork_id: forkId}};
    }
    const result = await this.requiredClient().callTool({name: "sai_act", arguments: {...prepared}});
    if (result.isError || !result.structuredContent) throw new Error("sai_act 未返回结构化结果");
    return result.structuredContent as unknown as ActResult;
  }

  async labsDiscover(): Promise<{reference_ruleset_id: string; fork_id: string; frontier: LabsFrontier; resources: unknown}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1`, {headers: {accept: "application/json"}}));
  }

  async labsRuleset(id = REFERENCE_RULESET_ID): Promise<{ruleset_id: string; ruleset: LabsRuleset}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/rulesets/${encodeURIComponent(id)}`, {headers: {accept: "application/json"}}));
  }

  async labsFrontier(rulesetId = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<{frontier: LabsFrontier; resources: unknown}> {
    return expectJson(await fetch(`${this.baseUrl}/labs/v1/frontiers/${encodeURIComponent(rulesetId)}/${encodeURIComponent(forkId)}`, {headers: {accept: "application/json"}}));
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

  async labsSync(peerBaseUrl: string, rulesetId = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<LabsFrontier> {
    const local = await LabsRepository.open(new MemoryLabsPersistence());
    await syncLabsFromPeer(local, peerBaseUrl, rulesetId, forkId);
    const bundle = await local.bundle(rulesetId, forkId);
    const response = await fetch(`${this.baseUrl}/labs/v1/exchange`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(bundle)});
    const output = await expectJson<{frontier: LabsFrontier}>(response);
    return output.frontier;
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
