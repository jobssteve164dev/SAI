import {createHash, randomUUID, type JsonWebKey} from "node:crypto";
import {describe, expect, it} from "vitest";
import {AuthService} from "../../packages/auth/src/index.js";
import {createClientAssertion, createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {handleJournalRequest} from "../../packages/journal/src/http.js";
import {JournalRepository, MemoryJournalPersistence, createJournalVersion, signJournalDecision, signJournalVersion} from "../../packages/journal/src/index.js";
import {manuscript, reviewFor} from "./journal.test.js";

const ORIGIN = "https://journal.example";

async function envelope(identity: AgentIdentity, path: string): Promise<{public_jwk: JsonWebKey; assertion: string}> {
  return {public_jwk: identity.publicJwk, assertion: await createClientAssertion(identity, `${ORIGIN}${path}`, randomUUID())};
}

describe("Agent 研究期刊 HTTP 闭环", () => {
  it("在无 Content-Length 时也会流式中止超限请求", async () => {
    const repository = new JournalRepository(new MemoryJournalPersistence(), []); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({start(controller) { controller.enqueue(new Uint8Array(6_600_000)); }, cancel() { cancelled = true; }});
    const response = await handleJournalRequest(new Request(`${ORIGIN}/journal/v1/submissions`, {method: "POST", headers: {"content-type": "application/json"}, body: stream, duplex: "half"} as RequestInit & {duplex: string}), repository, async () => { throw new Error("不应执行认证"); });
    expect(response?.status).toBe(413); expect(cancelled).toBe(true);
  });

  it("只有签名 Agent 能提交私密稿件，录用后才从公开接口下载正文与引用", async () => {
    const author = await createIdentity();
    const reviewerA = await createIdentity();
    const reviewerB = await createIdentity();
    const editor = await createIdentity();
    const auth = new AuthService({baseUrl: ORIGIN, region: "journal"});
    const repository = new JournalRepository(new MemoryJournalPersistence(), [editor.agentId]);
    const authenticate = async (publicJwk: JsonWebKey, assertion: string, audience: string) => auth.verifyAgentAssertion(publicJwk, assertion, audience);
    const handle = async (request: Request): Promise<Response> => {
      const response = await handleJournalRequest(request, repository, authenticate);
      if (!response) throw new Error("期刊路由未处理请求");
      return response;
    };

    const discovery = await handle(new Request(`${ORIGIN}/journal/v1`));
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toEqual(expect.objectContaining({protocol: "proofwild-journal-discovery/1", submit_command: "npx --yes sai-agent-bridge papers submit ./paper.md --manifest ./paper.json"}));

    const artifactBytes = Buffer.from("verified reproduction\n"); const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const input = manuscript([author]); input.manifest.artifacts = [{name: "result.txt", media_type: "text/plain", sha256: artifactSha, license: "CC0-1.0"}];
    const created = createJournalVersion(input);
    const path = "/journal/v1/submissions";
    const unauthorized = await handle(new Request(`${ORIGIN}${path}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({version: created.version, version_id: created.version_id, signature: signJournalVersion(created.version_id, author)})}));
    expect(unauthorized.status).toBe(401);

    const submittedResponse = await handle(new Request(`${ORIGIN}${path}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(author, path), version: created.version, version_id: created.version_id, signature: signJournalVersion(created.version_id, author), artifacts: [{name: "result.txt", media_type: "text/plain", sha256: artifactSha, content_base64: artifactBytes.toString("base64")}]})}));
    expect(submittedResponse.status).toBe(201);
    const submitted = await submittedResponse.json() as {paper_id: string; status: string};
    expect(submitted.status).toBe("submitted");
    expect((await handle(new Request(`${ORIGIN}/journal/v1/papers`)).then((response) => response.json()) as {papers: unknown[]}).papers).toHaveLength(0);
    expect((await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}`))).status).toBe(404);

    const formalPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/formal-check`;
    expect((await handle(new Request(`${ORIGIN}${formalPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(editor, formalPath))}))).status).toBe(200);
    const assignmentPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/assignments`;
    const assignmentResponse = await handle(new Request(`${ORIGIN}${assignmentPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(editor, assignmentPath), reviewer_agent_ids: [reviewerA.agentId, reviewerB.agentId]})}));
    expect(assignmentResponse.status).toBe(200);

    const statusPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/status`;
    const assignedStatus = await handle(new Request(`${ORIGIN}${statusPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(reviewerA, statusPath))}));
    expect(assignedStatus.status).toBe(200);
    expect((await assignedStatus.json() as {current_version: {body_markdown: string}; reviews: unknown[]}).current_version.body_markdown).toContain("## 研究问题");
    const stranger = await createIdentity();
    const forbiddenStatus = await handle(new Request(`${ORIGIN}${statusPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(stranger, statusPath))}));
    expect(forbiddenStatus.status).toBe(404);

    for (const reviewer of [reviewerA, reviewerB]) {
      const reviewPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/reviews`;
      const review = await reviewFor(submitted.paper_id, created.version_id, reviewer);
      const response = await handle(new Request(`${ORIGIN}${reviewPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(reviewer, reviewPath), review})}));
      expect(response.status).toBe(200);
      expect((await response.clone().json() as {reviews: Array<{review: {reviewer_agent_id: string}}>}).reviews.every((item) => item.review.reviewer_agent_id === reviewer.agentId)).toBe(true);
    }

    const current = await repository.submission(submitted.paper_id);
    const decisionPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/decisions`;
    const decision = signJournalDecision({paper_id: submitted.paper_id, version_id: created.version_id, editor_id: editor.agentId, decision: "accept", rationale: "两份独立评审均完成证据核查，达到创刊标准。", review_ids: current!.reviews.map((review) => review.review_id), decided_at: "2026-09-03T15:00:00.000Z"}, editor);
    const decisionResponse = await handle(new Request(`${ORIGIN}${decisionPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(editor, decisionPath), decision})}));
    expect(decisionResponse.status).toBe(200);
    expect((await decisionResponse.clone().json() as {status: string}).status).toBe("accepted");
    const publishPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/publish`;
    expect((await handle(new Request(`${ORIGIN}${publishPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(editor, publishPath))}))).status).toBe(200);

    const publicResponse = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}`));
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json() as {paper: {status: string}}).paper.status).toBe("published");
    expect((await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/versions/${encodeURIComponent(created.version_id)}`))).status).toBe(200);
    const versionMarkdown = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/versions/${encodeURIComponent(created.version_id)}/paper.md`));
    expect(await versionMarkdown.text()).toContain("## 研究问题");
    const versionCitation = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/versions/${encodeURIComponent(created.version_id)}/citation.bib`));
    expect(await versionCitation.text()).toContain(`/versions/${created.version_id}`);
    const markdown = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/paper.md`));
    expect(markdown.headers.get("content-type")).toContain("text/markdown");
    expect(await markdown.text()).toContain("## 研究问题");
    const citation = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/citation.bib`));
    expect(await citation.text()).toContain(`https://proofwild.science/research/papers/${submitted.paper_id}`);
    const artifactManifest = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/artifacts.json`));
    expect(await artifactManifest.json()).toEqual(expect.objectContaining({protocol: "proofwild-journal-artifact-index/1", paper_id: submitted.paper_id, version_id: created.version_id, artifacts: [expect.objectContaining({sha256: artifactSha, download_url: expect.stringContaining("/artifacts/")})]}));
    const artifactDownload = await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}/versions/${encodeURIComponent(created.version_id)}/artifacts/${artifactSha}/result.txt`));
    expect(await artifactDownload.text()).toBe("verified reproduction\n"); expect(artifactDownload.headers.get("content-disposition")).toContain("attachment");
    const disputePath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/disputes`;
    const dispute = await handle(new Request(`${ORIGIN}${disputePath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(editor, disputePath), reason: "外部复现者报告关键结果存在未解决差异"})}));
    expect(dispute.status).toBe(200);
    expect((await dispute.json() as {status: string}).status).toBe("disputed");
  });
});
