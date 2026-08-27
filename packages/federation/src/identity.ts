import {createHash, generateKeyPairSync, type JsonWebKey} from "node:crypto";
import {compactVerify, exportJWK, importJWK, CompactSign} from "jose";
import {canonicalJson} from "../../kernel/src/index.js";
import type {NodeKeyPair} from "./types.js";

export function nodeIdFromJwk(jwk: JsonWebKey): string {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new TypeError("节点公钥必须是 Ed25519 JWK");
  const normalized = JSON.stringify({crv: "Ed25519", kty: "OKP", x: jwk.x});
  return `node:ed25519-v1:${createHash("sha256").update(normalized).digest("base64url")}`;
}

export async function createNodeKeyPair(): Promise<NodeKeyPair> {
  const pair = generateKeyPairSync("ed25519");
  const publicJwk = await exportJWK(pair.publicKey);
  const privateJwk = await exportJWK(pair.privateKey);
  return {nodeId: nodeIdFromJwk(publicJwk), publicJwk, privateJwk};
}

export async function signObject<T extends object>(value: T, privateJwk: JsonWebKey): Promise<string> {
  const key = await importJWK(privateJwk, "EdDSA");
  return new CompactSign(new TextEncoder().encode(canonicalJson(value))).setProtectedHeader({alg: "EdDSA", typ: "SAI+JWS"}).sign(key);
}

export async function verifyObject<T extends object>(value: T, signature: string, publicJwk: JsonWebKey): Promise<void> {
  const key = await importJWK(publicJwk, "EdDSA");
  const verified = await compactVerify(signature, key, {algorithms: ["EdDSA"]});
  if (new TextDecoder().decode(verified.payload) !== canonicalJson(value)) throw new Error("签名载荷与对象不一致");
}
