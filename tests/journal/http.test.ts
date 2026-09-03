import {createHash, randomUUID, type JsonWebKey} from "node:crypto";
import {describe, expect, it} from "vitest";
import {AuthService} from "../../packages/auth/src/index.js";
import {createClientAssertion, createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {handleJournalRequest} from "../../packages/journal/src/http.js";
import {JournalRepository, MemoryJournalPersistence, createJournalStatement, createJournalVersion, signJournalStatement, signJournalVersion} from "../../packages/journal/src/index.js";
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

  it("只有签名 Agent 能投稿，五个投稿前已活跃的 Agent 独立通过后由通讯 Agent 刊登", async () => {
    const author = await createIdentity();
    const reviewers = await Promise.all(Array.from({length: 5}, () => createIdentity()));
    const eligible = new Set(reviewers.map((reviewer) => reviewer.agentId));
    const auth = new AuthService({baseUrl: ORIGIN, region: "journal"});
    const repository = new JournalRepository(new MemoryJournalPersistence(), {
      currentContext: async () => ({world_fork_id: "fork:http:journal", event_seq: 12}),
      reviewerEligible: async (agentId: string) => eligible.has(agentId),
    });
    const authenticate = async (publicJwk: JsonWebKey, assertion: string, audience: string) => auth.verifyAgentAssertion(publicJwk, assertion, audience);
    const handle = async (request: Request): Promise<Response> => {
      const response = await handleJournalRequest(request, repository, authenticate);
      if (!response) throw new Error("期刊路由未处理请求");
      return response;
    };

    const discovery = await handle(new Request(`${ORIGIN}/journal/v1`));
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toEqual(expect.objectContaining({
      protocol: "proofwild-journal-discovery/2",
      authority: "five-independent-agent-reviews",
      human_editor: false,
      rules: expect.objectContaining({public_review: expect.objectContaining({acceptances_required: 5})}),
    }));
    expect((await handle(new Request(`${ORIGIN}/journal/v1/rules`)).then((response) => response.json()) as {commands: {submit: string}}).commands.submit).toContain("papers submit");
    const retiredEditorPath = "/journal/v1/submissions/retired/formal-check";
    expect((await handle(new Request(`${ORIGIN}${retiredEditorPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(author, retiredEditorPath))}))).status).toBe(404);

    const artifactBytes = Buffer.from("verified reproduction\n"); const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
    const input = manuscript([author]); input.manifest.artifacts = [{name: "result.txt", media_type: "text/plain", sha256: artifactSha, license: "CC0-1.0"}];
    const created = createJournalVersion(input);
    const path = "/journal/v1/submissions";
    const unauthorized = await handle(new Request(`${ORIGIN}${path}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({version: created.version, version_id: created.version_id, signature: signJournalVersion(created.version_id, author)})}));
    expect(unauthorized.status).toBe(401);

    const submittedResponse = await handle(new Request(`${ORIGIN}${path}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(author, path), version: created.version, version_id: created.version_id, signature: signJournalVersion(created.version_id, author), artifacts: [{name: "result.txt", media_type: "text/plain", sha256: artifactSha, content_base64: artifactBytes.toString("base64")}]})}));
    expect(submittedResponse.status).toBe(201);
    const submitted = await submittedResponse.json() as {paper_id: string; status: string};
    expect(submitted.status).toBe("under_review");
    expect((await handle(new Request(`${ORIGIN}/journal/v1/papers`)).then((response) => response.json()) as {papers: unknown[]}).papers).toHaveLength(0);
    expect((await handle(new Request(`${ORIGIN}/journal/v1/papers/${encodeURIComponent(submitted.paper_id)}`))).status).toBe(404);

    const statusPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/status`;
    const assignedStatus = await handle(new Request(`${ORIGIN}${statusPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(reviewers[0]!, statusPath))}));
    expect(assignedStatus.status).toBe(200);
    expect((await assignedStatus.json() as {current_version: {body_markdown: string}; reviews: unknown[]}).current_version.body_markdown).toContain("## 研究问题");
    const stranger = await createIdentity();
    const forbiddenStatus = await handle(new Request(`${ORIGIN}${statusPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(stranger, statusPath))}));
    expect(forbiddenStatus.status).toBe(404);

    const poolPath = "/journal/v1/review-pool";
    const pool = await handle(new Request(`${ORIGIN}${poolPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(reviewers[0]!, poolPath))}));
    expect((await pool.json() as {papers: Array<{paper_id: string}>}).papers[0]?.paper_id).toBe(submitted.paper_id);

    for (const [index, reviewer] of reviewers.entries()) {
      const reviewPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/reviews`;
      const review = await reviewFor(submitted.paper_id, created.version_id, reviewer);
      const response = await handle(new Request(`${ORIGIN}${reviewPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(reviewer, reviewPath), review})}));
      expect(response.status).toBe(200);
      expect((await response.clone().json() as {status: string}).status).toBe(index === 4 ? "publication_eligible" : "under_review");
    }

    const publishPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/publish`;
    expect((await handle(new Request(`${ORIGIN}${publishPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(reviewers[0]!, publishPath))}))).status).toBe(400);
    expect((await handle(new Request(`${ORIGIN}${publishPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(await envelope(author, publishPath))}))).status).toBe(200);

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
    const statementPath = `/journal/v1/submissions/${encodeURIComponent(submitted.paper_id)}/statements`;
    const statement = signJournalStatement(createJournalStatement({paper_id: submitted.paper_id, version_id: created.version_id, agent_id: reviewers[0]!.agentId, kind: "dispute", content: "外部复现者报告关键结果存在未解决差异", created_at: "2026-09-03T16:00:00.000Z"}), reviewers[0]!);
    const dispute = await handle(new Request(`${ORIGIN}${statementPath}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({...await envelope(reviewers[0]!, statementPath), statement})}));
    expect(dispute.status).toBe(200);
    expect((await dispute.json() as {status: string}).status).toBe("disputed");
  });
});
