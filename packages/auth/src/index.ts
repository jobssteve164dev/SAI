import {generateKeyPairSync, type JsonWebKey} from "node:crypto";
import {importJWK, jwtVerify, SignJWT} from "jose";
import {agentIdFromJwk, verifyIdentityAssertion} from "../../identity/src/index.js";

export interface RegisteredAgent {publicJwk: JsonWebKey; epoch: number; enabled: boolean}
export interface AuthSnapshot {agents: Record<string, RegisteredAgent>; usedAssertions: string[]; signingKeys?: {publicJwk: JsonWebKey; privateJwk: JsonWebKey}}
export interface AccessClaims {agentId: string; scopes: string[]; region: string; epoch: number}

export class AuthService {
  readonly issuer: string;
  readonly mcpResource: string;
  readonly region: string;
  private readonly privateJwk: JsonWebKey;
  private readonly publicJwk: JsonWebKey;
  private readonly agents: Record<string, RegisteredAgent>;
  private readonly usedAssertions: Set<string>;

  constructor(options: {baseUrl: string; region: string; snapshot?: AuthSnapshot}) {
    this.issuer = options.baseUrl;
    this.mcpResource = `${options.baseUrl}/mcp`;
    this.region = options.region;
    const persisted = options.snapshot?.signingKeys;
    if (persisted) {
      this.privateJwk = structuredClone(persisted.privateJwk);
      this.publicJwk = structuredClone(persisted.publicJwk);
    } else {
      const pair = generateKeyPairSync("ed25519");
      this.privateJwk = pair.privateKey.export({format: "jwk"});
      this.publicJwk = pair.publicKey.export({format: "jwk"});
    }
    this.agents = structuredClone(options.snapshot?.agents ?? {});
    this.usedAssertions = new Set(options.snapshot?.usedAssertions ?? []);
  }

  snapshot(): AuthSnapshot {
    return {
      agents: structuredClone(this.agents),
      usedAssertions: [...this.usedAssertions].sort(),
      signingKeys: {publicJwk: structuredClone(this.publicJwk), privateJwk: structuredClone(this.privateJwk)},
    };
  }
  getAgentPublicJwk(agentId: string): JsonWebKey | undefined { return this.agents[agentId] ? structuredClone(this.agents[agentId].publicJwk) : undefined; }
  importAgent(publicJwk: JsonWebKey): string {
    const agentId = agentIdFromJwk(publicJwk);
    const existing = this.agents[agentId];
    this.agents[agentId] = {publicJwk: structuredClone(publicJwk), epoch: existing?.epoch ?? 0, enabled: true};
    return agentId;
  }
  async jwks(): Promise<{keys: JsonWebKey[]}> { return {keys: [{...this.publicJwk, use: "sig", alg: "EdDSA", kid: "sai-local-node"}]}; }

  async register(publicJwk: JsonWebKey, assertion: string, now?: number): Promise<string> {
    const {agentId, jti} = await verifyIdentityAssertion(assertion, publicJwk, `${this.issuer}/oauth/register`, now);
    this.consumeAssertion(agentId, jti);
    this.agents[agentId] = {publicJwk: structuredClone(publicJwk), epoch: this.agents[agentId]?.epoch ?? 0, enabled: true};
    return agentId;
  }

  async token(input: {clientId: string; assertion: string; resource: string; scopes: string[]}, now = Math.floor(Date.now() / 1000), ttl = 300): Promise<{access_token: string; token_type: "Bearer"; expires_in: number; scope: string}> {
    const registered = this.agents[input.clientId];
    if (!registered?.enabled) throw new Error("agent 未注册或已停用");
    if (input.resource !== this.mcpResource) throw new Error("resource 必须精确匹配 MCP endpoint");
    if (input.scopes.some((scope) => scope !== "observe" && scope !== "act") || input.scopes.length === 0) throw new Error("scope 不被支持");
    const verified = await verifyIdentityAssertion(input.assertion, registered.publicJwk, `${this.issuer}/oauth/token`, now);
    if (verified.agentId !== input.clientId) throw new Error("client_id 与密钥身份不匹配");
    this.consumeAssertion(input.clientId, verified.jti);
    const signingKey = await importJWK(this.privateJwk, "EdDSA");
    const access_token = await new SignJWT({scope: input.scopes.join(" "), region: this.region, epoch: registered.epoch})
      .setProtectedHeader({alg: "EdDSA", typ: "at+jwt", kid: "sai-local-node"})
      .setIssuer(this.issuer).setSubject(input.clientId).setAudience(this.mcpResource).setIssuedAt(now).setExpirationTime(now + ttl).setJti(`${input.clientId}:${verified.jti}`).sign(signingKey);
    return {access_token, token_type: "Bearer", expires_in: ttl, scope: input.scopes.join(" ")};
  }

  async verifyAccessToken(token: string, now?: number): Promise<AccessClaims> {
    const verifyingKey = await importJWK(this.publicJwk, "EdDSA");
    const result = await jwtVerify(token, verifyingKey, {algorithms: ["EdDSA"], issuer: this.issuer, audience: this.mcpResource, ...(now === undefined ? {} : {currentDate: new Date(now * 1000)})});
    const agentId = result.payload.sub;
    const scope = result.payload.scope;
    const epoch = result.payload.epoch;
    const region = result.payload.region;
    if (!agentId || typeof scope !== "string" || typeof epoch !== "number" || typeof region !== "string") throw new Error("access token claims 不完整");
    const registered = this.agents[agentId];
    if (!registered?.enabled || registered.epoch !== epoch || region !== this.region) throw new Error("access token 已失效");
    return {agentId, scopes: scope.split(" ").filter(Boolean), region, epoch};
  }

  revoke(agentId: string): void {
    const agent = this.agents[agentId];
    if (!agent) throw new Error("agent 未注册");
    agent.epoch += 1;
  }

  private consumeAssertion(agentId: string, jti: string): void {
    const key = `${agentId}:${jti}`;
    if (this.usedAssertions.has(key)) throw new Error("client assertion 已使用");
    this.usedAssertions.add(key);
  }
}

export async function verifyPublicKeyOwnership(publicJwk: JsonWebKey): Promise<string> {
  await importJWK(publicJwk, "EdDSA");
  return agentIdFromJwk(publicJwk);
}
