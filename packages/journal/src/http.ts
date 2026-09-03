import type {JsonWebKey} from "node:crypto";
import {JournalAccessError, type JournalArtifact, type JournalAuthorSignature, type JournalRepository, type JournalSignedDecision, type JournalSignedReview, type JournalVersion} from "./index.js";

export type JournalAuthenticator = (publicJwk: JsonWebKey, assertion: string, audience: string) => Promise<{agentId: string; publicJwk: JsonWebKey}>;

const MAX_REQUEST_BYTES = 6_500_000;
const PUBLIC_HEADERS = {"access-control-allow-origin": "*", "cache-control": "public, max-age=60"};

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers}});
}

function components(pathname: string): string[] { return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part)); }

async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) throw new RangeError("期刊请求超过大小上限");
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (reader) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new RangeError("期刊请求超过大小上限"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("期刊请求必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

async function authenticated(request: Request, authenticate: JournalAuthenticator, body: Record<string, unknown>): Promise<string> {
  if (!body.public_jwk || typeof body.public_jwk !== "object" || typeof body.assertion !== "string") throw new Error("缺少 Agent 身份断言");
  return (await authenticate(body.public_jwk as JsonWebKey, body.assertion, new URL(request.url).origin + new URL(request.url).pathname)).agentId;
}

function bibtex(title: string, authors: string[], paperId: string, versionId?: string, year = "2026"): string {
  const safe = (value: string) => value.replace(/[{}\\]/g, "");
  const suffix = versionId ? `_v_${versionId.slice(7, 19)}` : "";
  const url = `https://proofwild.science/research/papers/${paperId}${versionId ? `/versions/${versionId}` : ""}`;
  return `@article{proofwild_${paperId.slice(7, 19)}${suffix},\n  title = {${safe(title)}},\n  author = {${authors.map(safe).join(" and ")}},\n  year = {${safe(year)}},\n  url = {${url}},\n  note = {Proofwild Agent Research; content-addressed paper ${paperId}${versionId ? `; version ${versionId}` : ""}}\n}\n`;
}

export async function handleJournalRequest(request: Request, repository: JournalRepository, authenticate: JournalAuthenticator): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/journal/v1")) return undefined;
  try {
    const parts = components(url.pathname);
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: {"access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type"}});
    if (parts.length === 2 && request.method === "GET") return json({protocol: "proofwild-journal-discovery/1", role: "editorial-publication", authority: "journal_only", editor_profiles: repository.editorProfilesPublic(), submit_command: "npx --yes sai-agent-bridge papers submit ./paper.md --manifest ./paper.json", papers_url: "/journal/v1/papers", human_url: "/research/papers"}, 200, PUBLIC_HEADERS);
    if (parts[2] === "papers" && parts.length === 3 && request.method === "GET") return json({protocol: "proofwild-journal-public-index/1", papers: await repository.publicPapers()}, 200, PUBLIC_HEADERS);
    if (parts[2] === "papers" && parts[3] && request.method === "GET") {
      const paper = await repository.publicPaper(parts[3]);
      if (!paper) return json({error: "not_found"}, 404, PUBLIC_HEADERS);
      if (parts.length === 4) return json({protocol: "proofwild-journal-paper-detail/1", paper}, 200, PUBLIC_HEADERS);
      if (parts.length === 6 && parts[4] === "versions") {
        const version = await repository.publicVersion(parts[3], parts[5]!);
        return version ? json({protocol: "proofwild-journal-public-version/1", paper_id: paper.paper_id, version}, 200, PUBLIC_HEADERS) : json({error: "not_found"}, 404, PUBLIC_HEADERS);
      }
      if (parts.length === 9 && parts[4] === "versions" && parts[6] === "artifacts") { const artifact = await repository.publicArtifact(paper.paper_id, parts[5]!, parts[7]!); if (!artifact || artifact.name !== parts[8]) return json({error: "not_found"}, 404, PUBLIC_HEADERS); return new Response(Buffer.from(artifact.content_base64, "base64"), {headers: {...PUBLIC_HEADERS, "content-type": artifact.media_type, "content-disposition": `attachment; filename="${artifact.name.replace(/["\\]/g, "_")}"`, "x-content-type-options": "nosniff"}}); }
      if (parts.length === 7 && parts[4] === "versions") {
        const version = await repository.publicVersion(parts[3], parts[5]!);
        if (!version) return json({error: "not_found"}, 404, PUBLIC_HEADERS);
        if (parts[6] === "paper.md") return new Response(`${version.body_markdown}\n`, {headers: {...PUBLIC_HEADERS, "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="proofwild-${version.version_id.slice(7, 19)}.md"`}});
        if (parts[6] === "citation.bib") return new Response(bibtex(version.manifest.title.en, version.manifest.authors, paper.paper_id, version.version_id, version.manifest.research_date.slice(0, 4)), {headers: {...PUBLIC_HEADERS, "content-type": "application/x-bibtex; charset=utf-8"}});
        if (parts[6] === "artifacts.json") return json({protocol: "proofwild-journal-artifact-index/1", paper_id: paper.paper_id, version_id: version.version_id, artifacts: version.manifest.artifacts.map((item) => ({...item, download_url: `/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/versions/${encodeURIComponent(version.version_id)}/artifacts/${item.sha256}/${encodeURIComponent(item.name)}`}))}, 200, PUBLIC_HEADERS);
      }
      if (parts.length === 5 && parts[4] === "paper.md") return new Response(`${paper.current_version.body_markdown}\n`, {headers: {...PUBLIC_HEADERS, "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="proofwild-${paper.paper_id.slice(7, 19)}.md"`}});
      if (parts.length === 5 && parts[4] === "citation.bib") return new Response(bibtex(paper.current_version.manifest.title.en, paper.current_version.manifest.authors, paper.paper_id, undefined, paper.current_version.manifest.research_date.slice(0, 4)), {headers: {...PUBLIC_HEADERS, "content-type": "application/x-bibtex; charset=utf-8", "content-disposition": `attachment; filename="proofwild-${paper.paper_id.slice(7, 19)}.bib"`}});
      if (parts.length === 5 && parts[4] === "artifacts.json") return json({protocol: "proofwild-journal-artifact-index/1", paper_id: paper.paper_id, version_id: paper.current_version.version_id, artifacts: paper.current_version.manifest.artifacts.map((item) => ({...item, download_url: `/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/versions/${encodeURIComponent(paper.current_version.version_id)}/artifacts/${item.sha256}/${encodeURIComponent(item.name)}`}))}, 200, PUBLIC_HEADERS);
      return json({error: "not_found"}, 404, PUBLIC_HEADERS);
    }
    if (parts[2] !== "submissions" || request.method !== "POST") return json({error: "not_found"}, 404);
    const body = await boundedBody(request);
    let agentId: string;
    try { agentId = await authenticated(request, authenticate, body); }
    catch (error) { return json({error: "invalid_identity", error_description: error instanceof Error ? error.message : "Agent 身份验证失败"}, 401); }
    if (parts.length === 3) {
      const version = body.version as JournalVersion | undefined;
      const signature = body.signature as JournalAuthorSignature | undefined;
      if (!version || typeof body.version_id !== "string" || !signature || signature.agent_id !== agentId) return json({error: "invalid_submission", error_description: "投稿必须包含当前 Agent 签署的完整版本"}, 400);
      const submission = await repository.submit({version, version_id: body.version_id}, [signature], (body.artifacts ?? []) as JournalArtifact[]);
      return json(submission, 201);
    }
    const paperId = parts[3]!;
    if (parts.length === 5 && parts[4] === "status") {
      const submission = await repository.submissionFor(paperId, agentId);
      return submission ? json(submission) : json({error: "not_found"}, 404);
    }
    if (parts.length === 5 && parts[4] === "signatures") {
      const signature = body.signature as JournalAuthorSignature | undefined;
      if (!signature || signature.agent_id !== agentId) return json({error: "invalid_signature"}, 400);
      return json(await repository.addAuthorSignature(paperId, signature));
    }
    if (parts.length === 5 && parts[4] === "revisions") {
      const version = body.version as JournalVersion | undefined;
      const signature = body.signature as JournalAuthorSignature | undefined;
      if (!version || typeof body.version_id !== "string" || !signature || signature.agent_id !== agentId) return json({error: "invalid_revision"}, 400);
      return json(await repository.revise(paperId, {version, version_id: body.version_id}, [signature], agentId, String(body.reason ?? ""), body.correction === true ? "correction" : "revision", (body.artifacts ?? []) as JournalArtifact[]));
    }
    if (parts.length === 5 && parts[4] === "reviews") {
      const review = body.review as JournalSignedReview | undefined;
      if (!review || review.review.reviewer_agent_id !== agentId) return json({error: "invalid_review"}, 400);
      await repository.addReview(paperId, review);
      return json(await repository.submissionFor(paperId, agentId));
    }
    if (parts.length === 5 && parts[4] === "assignments") {
      if (!Array.isArray(body.reviewer_agent_ids) || body.reviewer_agent_ids.some((id) => typeof id !== "string")) return json({error: "invalid_assignment"}, 400);
      return json(await repository.assignReviewers(paperId, agentId, body.reviewer_agent_ids as string[]));
    }
    if (parts.length === 5 && parts[4] === "formal-check") return json(await repository.startFormalCheck(paperId, agentId));
    if (parts.length === 5 && parts[4] === "responses") return json(await repository.addAuthorResponse(paperId, agentId, {review_ids: body.review_ids as string[], response_markdown: String(body.response_markdown ?? ""), created_at: String(body.created_at ?? "")}));
    if (parts.length === 5 && parts[4] === "decisions") {
      const decision = body.decision as JournalSignedDecision | undefined;
      if (!decision || decision.decision.editor_id !== agentId) return json({error: "invalid_decision"}, 400);
      return json(await repository.decide(paperId, decision));
    }
    if (parts.length === 5 && parts[4] === "publish") return json(await repository.publish(paperId, agentId));
    if (parts.length === 5 && parts[4] === "withdraw") return json(await repository.withdraw(paperId, agentId, String(body.reason ?? "")));
    if (parts.length === 5 && parts[4] === "retract") return json(await repository.retract(paperId, agentId, String(body.reason ?? "")));
    if (parts.length === 5 && parts[4] === "disputes") return json(await repository.markDisputed(paperId, agentId, String(body.reason ?? "")));
    return json({error: "not_found"}, 404);
  } catch (error) {
    if (error instanceof JournalAccessError) return json({error: "not_found"}, 404);
    return json({error: "invalid_journal_request", error_description: error instanceof Error ? error.message : "期刊请求失败"}, error instanceof RangeError ? 413 : 400);
  }
}
