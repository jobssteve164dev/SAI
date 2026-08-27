import {createServer, type Server} from "node:http";
import type {JsonWebKey} from "node:crypto";
import {toNodeHandler} from "@modelcontextprotocol/node";
import type {AuthInfo} from "@modelcontextprotocol/server";
import {AuthService} from "../../../packages/auth/src/index.js";
import {createSaiMcpHandler} from "../../../packages/mcp/src/index.js";
import {FileStore} from "./store.js";
import {RegionService} from "./service.js";

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json", ...headers}});
}

export interface LocalNode {
  url: string;
  server: Server;
  auth: AuthService;
  region: RegionService;
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
  const mcp = createSaiMcpHandler(region);

  const fetchHandler = {
    fetch: async (request: Request): Promise<Response> => {
      const requestUrl = new URL(request.url);
      try {
        if (request.headers.get("host") !== new URL(url).host) return json({error: "invalid_host"}, 403);
        const origin = request.headers.get("origin");
        if (origin && origin !== url) return json({error: "invalid_origin"}, 403);
        if (requestUrl.pathname === "/.well-known/oauth-protected-resource/mcp") return json({resource: `${url}/mcp`, authorization_servers: [url], scopes_supported: ["observe", "act"], bearer_methods_supported: ["header"]});
        if (requestUrl.pathname === "/.well-known/oauth-authorization-server") return json({issuer: url, token_endpoint: `${url}/oauth/token`, jwks_uri: `${url}/oauth/jwks`, registration_endpoint: `${url}/oauth/register`, token_endpoint_auth_methods_supported: ["private_key_jwt"], scopes_supported: ["observe", "act"], response_types_supported: []});
        if (requestUrl.pathname === "/oauth/jwks") return json(await auth.jwks());
        if (requestUrl.pathname === "/oauth/register" && request.method === "POST") {
          const body = await request.json() as {public_jwk?: JsonWebKey; assertion?: string};
          if (!body.public_jwk || !body.assertion) return json({error: "invalid_request"}, 400);
          const agentId = await auth.register(body.public_jwk, body.assertion);
          await region.admit(agentId); await store.saveAuth(auth.snapshot());
          return json({client_id: agentId, token_endpoint_auth_method: "private_key_jwt"}, 201);
        }
        if (requestUrl.pathname === "/oauth/token" && request.method === "POST") {
          const form = new URLSearchParams(await request.text());
          if (form.get("grant_type") !== "client_credentials" || form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return json({error: "unsupported_grant_type"}, 400);
          const token = await auth.token({clientId: form.get("client_id") ?? "", assertion: form.get("client_assertion") ?? "", resource: form.get("resource") ?? "", scopes: (form.get("scope") ?? "").split(" ").filter(Boolean)});
          await store.saveAuth(auth.snapshot());
          return json(token);
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
  return {url, server, auth, region, close: async () => { await mcp.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }};
}
