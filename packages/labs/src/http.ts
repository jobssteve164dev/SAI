import {LABS_MAX_OBJECT_BYTES, REFERENCE_FORK_ID, REFERENCE_RULESET_ID} from "./index.js";
import {LabsRepository, type LabsExchangeBundle, type LabsObjectKind, type LabsObjectValue} from "./store.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json; charset=utf-8", ...CORS, ...headers}});
}

async function boundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 请求超过固定大小上限");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 请求超过固定大小上限");
  return JSON.parse(raw) as unknown;
}

function components(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

export async function handleLabsRequest(request: Request, repository: LabsRepository): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/labs/v1")) return undefined;
  try {
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: CORS});
    const parts = components(url.pathname);
    if (parts.length === 2 && request.method === "GET") {
      const frontier = await repository.frontier();
      return json({
        protocol: "sai-labs-discovery/1",
        role: "cache-index-forwarder",
        authority: false,
        reference_ruleset_id: REFERENCE_RULESET_ID,
        world_fork_id: REFERENCE_FORK_ID,
        ruleset_url: `/labs/v1/rulesets/${REFERENCE_RULESET_ID}`,
        frontier_url: `/labs/v1/frontiers/${REFERENCE_RULESET_ID}/${REFERENCE_FORK_ID}`,
        exchange_url: `/labs/v1/exchange/${REFERENCE_RULESET_ID}/${REFERENCE_FORK_ID}`,
        frontier,
      });
    }
    if (parts[2] === "rulesets" && parts[3] && parts.length === 4 && request.method === "GET") return json({ruleset_id: parts[3], ruleset: await repository.ruleset(parts[3])}, 200, {etag: `"${parts[3]}"`, "cache-control": "public, max-age=31536000, immutable"});
    if (parts[2] === "objects" && parts[3] && parts.length === 4 && request.method === "GET") {
      const object = await repository.object(parts[3]);
      return object ? json({id: parts[3], ...object}, 200, {etag: `"${parts[3]}"`, "cache-control": "public, max-age=31536000, immutable"}) : json({error: "not_found"}, 404);
    }
    if (parts[2] === "objects" && parts.length === 3 && request.method === "POST") {
      const body = await boundedJson(request) as {id?: string; kind?: LabsObjectKind; value?: LabsObjectValue; fork_id?: string};
      if (!body.kind || !body.value || !["ruleset", "result", "claim"].includes(body.kind)) return json({error: "invalid_request"}, 400);
      const id = await repository.ingest(body.kind, body.value, body.id, body.fork_id ?? REFERENCE_FORK_ID);
      return json({status: "stored", id}, 201);
    }
    if (parts[2] === "frontiers" && parts[3] && parts[4] && parts.length === 5 && request.method === "GET") return json({frontier: await repository.frontier(parts[3], parts[4])});
    if (parts[2] === "exchange" && parts[3] && parts[4] && parts.length === 5 && request.method === "GET") return json(await repository.bundle(parts[3], parts[4]));
    if (parts[2] === "exchange" && parts.length === 3 && request.method === "POST") {
      const bundle = await boundedJson(request) as LabsExchangeBundle;
      await repository.importBundle(bundle);
      return json({status: "merged", frontier: await repository.frontier(bundle.ruleset_id, bundle.fork_id)});
    }
    return json({error: "not_found"}, 404);
  } catch (error) {
    return json({error: "invalid_labs_object", error_description: error instanceof Error ? error.message : "LABS request failed"}, error instanceof RangeError ? 413 : 400);
  }
}
