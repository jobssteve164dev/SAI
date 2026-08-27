import {randomUUID} from "node:crypto";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createClientAssertion, type AgentIdentity} from "../../identity/src/index.js";
import type {ActInput, ActResult, Observation} from "../../kernel/src/index.js";

async function expectJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & {error_description?: string};
  if (!response.ok) throw new Error(body.error_description ?? `HTTP ${response.status}`);
  return body;
}

export class SaiBridge {
  private client: Client | undefined;
  private token: string | undefined;
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
    return result.structuredContent as unknown as Observation;
  }

  async act(input: ActInput): Promise<ActResult> {
    const result = await this.requiredClient().callTool({name: "sai_act", arguments: {...input}});
    if (result.isError || !result.structuredContent) throw new Error("sai_act 未返回结构化结果");
    return result.structuredContent as unknown as ActResult;
  }

  async close(): Promise<void> { if (this.client) await this.client.close(); this.client = undefined; this.token = undefined; }
  private requiredClient(): Client { if (!this.client) throw new Error("bridge 尚未连接"); return this.client; }
}
