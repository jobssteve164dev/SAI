import {createServer, type Server} from "node:http";
import type {JsonWebKey} from "node:crypto";
import {toNodeHandler} from "@modelcontextprotocol/node";
import type {AuthInfo} from "@modelcontextprotocol/server";
import {AuthService} from "../../../packages/auth/src/index.js";
import {createSaiMcpHandler} from "../../../packages/mcp/src/index.js";
import {FileStore} from "./store.js";
import {RegionService} from "./service.js";
import {LocalFederationService} from "./federation.js";
import {assertTransferPrepareInput, type TransferCredential, type TransferReceipt} from "../../../packages/federation/src/index.js";
import {handleLabsRequest} from "../../../packages/labs/src/http.js";
import {FileLabsPersistence, LabsRepository} from "../../../packages/labs/src/store.js";
import {createLabsAwareApplication} from "../../../packages/labs/src/application.js";
import {LABS_CONFORMANCE_VECTORS, handleWorldSupplyRequest} from "../../../packages/kernel/src/index.js";

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json", ...headers}});
}

export interface LocalNode {
  url: string;
  server: Server;
  auth: AuthService;
  region: RegionService;
  federation: LocalFederationService;
  labs: LabsRepository;
  close(): Promise<void>;
}

export async function startLocalNode(options: {dataDirectory: string; host?: string; port?: number; regionId?: string}): Promise<LocalNode> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const store = new FileStore(options.dataDirectory);
  await store.initialize();
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法确定本地节点地址");
  const url = `http://${host}:${address.port}`;
  const region = await RegionService.open(store, options.regionId ?? "local");
  const authSnapshot = await store.loadAuth();
  const auth = new AuthService({baseUrl: url, region: options.regionId ?? "local", ...(authSnapshot ? {snapshot: authSnapshot} : {})});
  const federation = await LocalFederationService.open({baseUrl: url, regionId: options.regionId ?? "local", region, auth, store});
  const labs = await LabsRepository.open(await FileLabsPersistence.open(options.dataDirectory));
  const mcp = createSaiMcpHandler(createLabsAwareApplication(region, labs));
  let authQueue: Promise<void> = Promise.resolve();
  const serialAuth = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = authQueue;
    let release!: () => void;
    authQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  };

  const fetchHandler = {
    fetch: async (request: Request): Promise<Response> => {
      const requestUrl = new URL(request.url);
      try {
        if (request.headers.get("host") !== new URL(url).host) return json({error: "invalid_host"}, 403);
        const labsResponse = await handleLabsRequest(request, labs, LABS_CONFORMANCE_VECTORS);
        if (labsResponse) return labsResponse;
        const supplyResponse = await handleWorldSupplyRequest(request, region);
        if (supplyResponse) return supplyResponse;
        const origin = request.headers.get("origin");
        if (origin && origin !== url) return json({error: "invalid_origin"}, 403);
        if (requestUrl.pathname === "/" || requestUrl.pathname === "/health") return json({service: "Proofwild", version: "0.4.0", node_id: federation.keys.nodeId, region_id: options.regionId ?? "local", status: "ok"});
        if (requestUrl.pathname === "/.well-known/sai-node") return json(await federation.descriptor());
        if (requestUrl.pathname === "/.well-known/oauth-protected-resource/mcp") return json({resource: `${url}/mcp`, authorization_servers: [url], scopes_supported: ["observe", "act"], bearer_methods_supported: ["header"]});
        if (requestUrl.pathname === "/.well-known/oauth-authorization-server") return json({issuer: url, token_endpoint: `${url}/oauth/token`, jwks_uri: `${url}/oauth/jwks`, registration_endpoint: `${url}/oauth/register`, token_endpoint_auth_methods_supported: ["private_key_jwt"], scopes_supported: ["observe", "act"], response_types_supported: []});
        if (requestUrl.pathname === "/oauth/jwks") return json(await auth.jwks());
        if (requestUrl.pathname === "/oauth/register" && request.method === "POST") {
          const body = await request.json() as {public_jwk?: JsonWebKey; assertion?: string};
          if (!body.public_jwk || !body.assertion) return json({error: "invalid_request"}, 400);
          return serialAuth(async () => {
            const agentId = await auth.register(body.public_jwk!, body.assertion!);
            await region.admit(agentId); await store.saveAuth(auth.snapshot());
            return json({client_id: agentId, token_endpoint_auth_method: "private_key_jwt"}, 201);
          });
        }
        if (requestUrl.pathname === "/oauth/token" && request.method === "POST") {
          const form = new URLSearchParams(await request.text());
          if (form.get("grant_type") !== "client_credentials" || form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return json({error: "unsupported_grant_type"}, 400);
          return serialAuth(async () => {
            const token = await auth.token({clientId: form.get("client_id") ?? "", assertion: form.get("client_assertion") ?? "", resource: form.get("resource") ?? "", scopes: (form.get("scope") ?? "").split(" ").filter(Boolean)});
            await store.saveAuth(auth.snapshot());
            return json(token);
          });
        }
        if (requestUrl.pathname === "/federation/v1/transfers/accept" && request.method === "POST") {
          return json(await federation.accept(await request.json() as TransferCredential));
        }
        if (requestUrl.pathname === "/federation/v1/transfers/complete" && request.method === "POST") {
          await federation.complete(await request.json() as TransferReceipt);
          return json({status: "completed"});
        }
        if (requestUrl.pathname === "/federation/v1/transfers/cancel" && request.method === "POST") {
          return json(await federation.cancel(await request.json() as TransferCredential));
        }
        if (requestUrl.pathname === "/federation/v1/transfers/prepare" && request.method === "POST") {
          const claims = await authenticated(request, auth, "act");
          const body: unknown = await request.json();
          assertTransferPrepareInput(body);
          return json(await federation.prepare(claims.agentId, body));
        }
        if (requestUrl.pathname === "/federation/v1/transfers/current" && request.method === "GET") {
          const claims = await authenticated(request, auth, "act");
          const credential = federation.current(claims.agentId);
          return credential ? json(credential) : json({error: "not_found"}, 404);
        }
        if (requestUrl.pathname === "/federation/v1/transfers/recover" && request.method === "POST") {
          const claims = await authenticated(request, auth, "act");
          const body = await request.json() as {cancellation: import("../../../packages/federation/src/index.js").TransferCancellation};
          await federation.recover(claims.agentId, body.cancellation);
          return json({status: "recovered"});
        }
        if (requestUrl.pathname === "/mcp") {
          const authorization = request.headers.get("authorization");
          if (!authorization?.startsWith("Bearer ")) return json({error: "invalid_token"}, 401, {"www-authenticate": `Bearer resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"`});
          const rawToken = authorization.slice(7);
          const claims = await auth.verifyAccessToken(rawToken);
          const authInfo: AuthInfo = {token: rawToken, clientId: claims.agentId, scopes: claims.scopes, resource: new URL(`${url}/mcp`), extra: {agentId: claims.agentId, region: claims.region, epoch: claims.epoch}};
          return mcp.fetch(request, {authInfo});
        }
        return json({error: "not_found"}, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : "request_failed";
        const status = requestUrl.pathname === "/mcp" ? 401 : 400;
        return json({error: status === 401 ? "invalid_token" : "invalid_request", error_description: message}, status);
      }
    },
  };
  server.removeAllListeners("request");
  server.on("request", toNodeHandler(fetchHandler));
  return {url, server, auth, region, federation, labs, close: async () => { await mcp.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }};
}

async function authenticated(request: Request, auth: AuthService, requiredScope: "observe" | "act") {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("缺少 bearer token");
  const claims = await auth.verifyAccessToken(authorization.slice(7));
  if (!claims.scopes.includes(requiredScope)) throw new Error(`缺少 ${requiredScope} scope`);
  return claims;
}
