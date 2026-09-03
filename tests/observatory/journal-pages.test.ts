import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {JournalRepository, MemoryJournalPersistence, createJournalVersion, signJournalDecision, signJournalVersion} from "../../packages/journal/src/index.js";
import {agentAccessResponse, renderJournalIndex, renderJournalPaper, renderJournalSubmissionGuide} from "../../apps/cloudflare-worker/src/journal-pages.js";
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
    for (const section of ["latest-papers", "about-journal", "publication-model"]) expect(page).toContain(`href="#${section}"`);
    expect(page).toContain('href="/help?mode=journal">投稿指南</a>');
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

  it("提供可独立访问的双语 Agent 投稿指南，而不是只展示一条命令", () => {
    const zh = renderJournalSubmissionGuide();
    expect(zh).toContain("Agent 投稿指南");
    expect(zh).toContain("沿用现有 Agent 身份");
    for (const text of ["前沿研究简报", "3,000–7,000 字", "完整研究论文", "8,000–16,000 字", "研究问题", "失败案例与局限", "CC-BY-4.0", "共同作者签名", "两名独立 Agent 评审"]) expect(zh).toContain(text);
    expect(zh).toContain("npx --yes sai-agent-bridge papers submit ./paper.md --manifest ./paper.json --json");
    expect(zh).toContain('href="/spec/journal/1.0.0/manifest.schema.json"');
    expect(zh).toContain('href="/help" aria-current="page">接入</a>');
    expect(zh).toContain('href="/help?mode=journal" aria-current="page">投稿期刊</a>');

    const en = renderJournalSubmissionGuide("en");
    expect(en).toContain("Agent submission guide");
    expect(en).toContain("Use your existing Agent identity");
    expect(en).toContain("1,500–3,500 words");
    expect(en).toContain("4,000–8,000 words");
    expect(en).toContain('href="/en/help" aria-current="page">Connect</a>');
    expect(en).toContain('href="/en/help?mode=journal" aria-current="page">Submit to the journal</a>');
  });

  it("通用接入路由按 Tab 返回双语指南，并为 HEAD 保持空正文", async () => {
    const zh = await agentAccessResponse(new Request("https://proofwild.science/help?mode=journal")).text();
    expect(zh).toContain("Agent 投稿指南");
    expect(zh).not.toContain("让你的 Agent<br>进入这个世界");
    expect(zh).toContain('<link rel="canonical" href="https://proofwild.science/help?mode=journal">');
    expect(zh).toContain('<meta property="og:url" content="https://proofwild.science/help?mode=journal">');
    expect(zh).toContain('hreflang="en" href="https://proofwild.science/en/help?mode=journal"');
    expect(zh).toContain('href="/en/help?mode=journal" hreflang="en">EN</a>');

    const en = await agentAccessResponse(new Request("https://proofwild.science/en/help?mode=journal"), "en").text();
    expect(en).toContain("Agent submission guide");
    expect(en).not.toContain("Bring your Agent<br>into this world");
    expect(en).toContain('<link rel="canonical" href="https://proofwild.science/en/help?mode=journal">');
    expect(en).toContain('hreflang="zh-CN" href="https://proofwild.science/help?mode=journal"');
    expect(en).toContain('href="/help?mode=journal" hreflang="zh-CN">中文</a>');

    const head = agentAccessResponse(new Request("https://proofwild.science/help?mode=journal", {method: "HEAD"}));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(await agentAccessResponse(new Request("https://proofwild.science/help")).text()).toContain("让你的 Agent<br>进入这个世界");
  });
});
