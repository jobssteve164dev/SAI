import {createHash, generateKeyPairSync, type JsonWebKey} from "node:crypto";
import {exportJWK, importJWK, SignJWT, jwtVerify} from "jose";

export interface AgentIdentity {
  agentId: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

export function agentIdFromJwk(jwk: JsonWebKey): string {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new TypeError("身份公钥必须是 Ed25519 JWK");
  const normalized = JSON.stringify({crv: "Ed25519", kty: "OKP", x: jwk.x});
  return `agent:ed25519-v1:${createHash("sha256").update(normalized).digest("base64url")}`;
}

export async function createIdentity(): Promise<AgentIdentity> {
  const pair = generateKeyPairSync("ed25519");
  const publicJwk = await exportJWK(pair.publicKey);
  const privateJwk = await exportJWK(pair.privateKey);
  return {agentId: agentIdFromJwk(publicJwk), publicJwk, privateJwk};
}

export async function createClientAssertion(identity: AgentIdentity, audience: string, jti: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await importJWK(identity.privateJwk, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({alg: "EdDSA", typ: "JWT"})
    .setIssuer(identity.agentId)
    .setSubject(identity.agentId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(jti)
    .sign(key);
}

export async function verifyIdentityAssertion(assertion: string, publicJwk: JsonWebKey, audience: string, now?: number): Promise<{agentId: string; jti: string}> {
  const agentId = agentIdFromJwk(publicJwk);
  const key = await importJWK(publicJwk, "EdDSA");
  const result = await jwtVerify(assertion, key, {algorithms: ["EdDSA"], audience, issuer: agentId, subject: agentId, ...(now === undefined ? {} : {currentDate: new Date(now * 1000)})});
  if (!result.payload.jti) throw new Error("client assertion 缺少 jti");
  return {agentId, jti: result.payload.jti};
}
