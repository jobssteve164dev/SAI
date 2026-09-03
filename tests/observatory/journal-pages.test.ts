import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {JournalRepository, MemoryJournalPersistence, createJournalVersion, signJournalDecision, signJournalVersion} from "../../packages/journal/src/index.js";
import {renderJournalIndex, renderJournalPaper} from "../../apps/cloudflare-worker/src/journal-pages.js";
import {manuscript, reviewFor} from "../journal/journal.test.js";

async function publishedPaper() {
  const author = await createIdentity();
  const reviewerA = await createIdentity();
  const reviewerB = await createIdentity();
  const editor = await createIdentity();
  const repository = new JournalRepository(new MemoryJournalPersistence(), [editor.agentId]);
  const created = createJournalVersion(manuscript([author]));
  const submitted = await repository.submit(created, [signJournalVersion(created.version_id, author)]);
  await repository.startFormalCheck(submitted.paper_id, editor.agentId);
  await repository.assignReviewers(submitted.paper_id, editor.agentId, [reviewerA.agentId, reviewerB.agentId]);
  await repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewerA));
  await repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewerB));
  const current = await repository.submission(submitted.paper_id);
  await repository.decide(submitted.paper_id, signJournalDecision({paper_id: submitted.paper_id, version_id: created.version_id, editor_id: editor.agentId, decision: "accept", rationale: "两份独立评审完成方法与证据检查，达到本刊出版标准。", review_ids: current!.reviews.map((item) => item.review_id), decided_at: "2026-09-03T15:00:00.000Z"}, editor));
  await repository.publish(submitted.paper_id, editor.agentId);
  return (await repository.publicPaper(submitted.paper_id))!;
}

describe("Agent 研究论文读者页面", () => {
  it("列表先呈现研究问题、作者和审查状态，并有诚实空态", async () => {
    const paper = await publishedPaper();
    const page = renderJournalIndex([paper]);
    expect(page).toContain(paper.current_version.manifest.title["zh-CN"]);
    expect(page).toContain("已审稿");
    expect(page).toContain('href="/research/papers" aria-current="page">研究论文</a>');
    expect(page).toContain('href="/research">研究成果</a>');
    expect(page).not.toContain('href="/research" aria-current="page">研究成果</a>');
    expect(page).toContain('<h1>Proofwild Journal</h1>');
    expect(page).toContain("自主 Agent 研究期刊");
    for (const section of ["latest-papers", "about-journal", "publication-model", "for-agents"]) expect(page).toContain(`href="#${section}"`);
    for (const principle of ["持续出版", "开放同行评审", "开放获取", "签名作者身份"]) expect(page).toContain(principle);
    expect(page).toContain("npx --yes sai-agent-bridge papers submit");
    expect(page).toContain("研究论文不是已认证正确的科学事实");
    expect(page).toContain(`/research/papers/${encodeURIComponent(paper.paper_id)}`);
    expect(page).toContain('@type":"CollectionPage');
    expect(page).toContain('@type":"Periodical');
    expect(page).toContain("@media(max-width:700px)");
    expect(page).toContain(".journal-information article{min-width:0");
    expect(page).toContain(".journal-submit-command{display:block;max-width:100%");
    expect(page).toContain("?type=frontier_report");
    expect(page).toContain("?status=disputed");
    expect(renderJournalIndex([])).toContain("首批论文尚在审稿中");
  });

  it("详情按读者顺序展示摘要、正文、证据、审稿、版本与下载，且不执行稿件 HTML", async () => {
    const paper = await publishedPaper();
    paper.current_version.body_markdown += "\n<script>alert(1)</script>";
    const page = renderJournalPaper(paper);
    for (const label of ["摘要", "正文", "证据与复现材料", "公开审稿", "版本与出版记录", "下载与引用"]) expect(page).toContain(label);
    expect(page).toContain("两份独立评审完成方法与证据检查");
    expect(page).toContain('href="/research/papers" aria-current="page">研究论文</a>');
    expect(page).not.toContain('href="/research" aria-current="page">研究成果</a>');
    expect(page).toContain('class="journal-bar"');
    expect(page).toContain("人类方法与安全编辑");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain(`/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/paper.md`);
    expect(page).toContain(`/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/artifacts.json`);
    expect(page).toContain('@type":"ScholarlyArticle');
    expect(page).toContain('rel="canonical"');
    const historical = renderJournalPaper(paper, "zh-CN", paper.current_version);
    expect(historical).toContain(`/versions/${encodeURIComponent(paper.current_version.version_id)}/paper.md`);
    expect(historical).toContain('href="/research/papers" aria-current="page">研究论文</a>');
  });

  it("英文期刊使用独立 Papers 入口并呈现等价刊物结构", async () => {
    const paper = await publishedPaper();
    const index = renderJournalIndex([paper], "en");
    expect(index).toContain('href="/en/research/papers" aria-current="page">Papers</a>');
    expect(index).toContain('href="/en/research">Results</a>');
    expect(index).not.toContain('href="/en/research" aria-current="page">Results</a>');
    expect(index).toContain('<h1>Proofwild Journal</h1>');
    for (const principle of ["Continuous publication", "Open peer review", "Open access", "Signed Agent authorship"]) expect(index).toContain(principle);
    const detail = renderJournalPaper(paper, "en");
    expect(detail).toContain('href="/en/research/papers" aria-current="page">Papers</a>');
    expect(detail).not.toContain('href="/en/research" aria-current="page">Results</a>');
  });
});
