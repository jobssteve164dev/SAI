import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {createIdentity, type AgentIdentity} from "../../packages/identity/src/index.js";
import {
  JournalRepository,
  MemoryJournalPersistence,
  createJournalReview,
  createJournalVersion,
  signJournalDecision,
  signJournalReview,
  signJournalVersion,
  verifyJournalVersionSignature,
  type JournalManuscriptInput,
} from "../../packages/journal/src/index.js";

export function manuscript(authors: AgentIdentity[], marker = "初稿"): JournalManuscriptInput {
  const sections = ["研究问题", "核心主张", "相关工作", "方法与运行环境", "Agent 与人类贡献", "结果", "失败案例与局限", "复现说明", "安全、伦理和利益冲突", "参考文献"];
  return {
    manifest: {
      protocol: "proofwild-journal-manifest/1",
      article_type: "frontier_report",
      locale: "zh-CN",
      title: {"zh-CN": `可复现的 Agent 协作实验：${marker}`, en: `A reproducible Agent collaboration experiment: ${marker}`},
      abstract: {"zh-CN": "这项研究提出一个可验证的多 Agent 协作实验，并公开方法、证据、失败结果与复现边界。".repeat(8), en: "This study presents a verifiable multi-Agent collaboration experiment with methods, evidence, failures, and reproducibility boundaries. ".repeat(10)},
      topics: ["multi-agent", "reproducibility"],
      authors: authors.map((identity) => identity.agentId),
      corresponding_agent_id: authors[0]!.agentId,
      human_contributions: "人类仅提供运行资源与安全复核，没有参与正式署名。",
      models: ["documented-agent-runtime/1"],
      tools: ["proofwild"],
      data_sources: ["content-addressed experiment records"],
      research_date: "2026-09-03",
      compute_budget: "10 deterministic runs",
      conflicts: "无",
      license: "CC-BY-4.0",
      references: [{title: "A stable research source", url: "https://example.org/research"}],
      artifacts: [],
    },
    body_markdown: `${sections.map((section) => `## ${section}\n\n${section}的可核查正文。`).join("\n\n")}\n\n${"研究证据与实验边界。".repeat(320)}`,
  };
}

export async function reviewFor(paperId: string, versionId: string, reviewer: AgentIdentity, recommendation: "accept" | "revise" | "reject" = "accept") {
  const review = createJournalReview({
    paper_id: paperId,
    version_id: versionId,
    reviewer_agent_id: reviewer.agentId,
    recommendation,
    summary: "方法清楚，证据范围与结论相符。",
    strengths: ["提供了完整复现范围"],
    concerns: ["需要持续报告外部复现"],
    evidence_checked: ["正文方法", "结果摘要"],
    conflict_disclosure: "无利益冲突",
    created_at: "2026-09-03T10:00:00.000Z",
  });
  return signJournalReview(review, reviewer);
}

describe("Agent 研究期刊领域闭环", () => {
  it("拒绝伪装成列表的评审字段和无效引用地址", async () => {
    const reviewer = await createIdentity();
    expect(() => createJournalReview({paper_id: `sha256:${"a".repeat(64)}`, version_id: `sha256:${"b".repeat(64)}`, reviewer_agent_id: reviewer.agentId, recommendation: "accept", summary: "评审摘要完整", strengths: "不是数组" as unknown as string[], concerns: ["问题"], evidence_checked: ["证据"], conflict_disclosure: "无", created_at: "2026-09-03T10:00:00.000Z"})).toThrow("评审内容");
    const input = manuscript([reviewer]);
    input.manifest.references = [{title: "伪造地址", url: "javascript:alert(1)"}];
    expect(() => createJournalVersion(input)).toThrow("参考文献");
    const tooMany = manuscript([reviewer]); tooMany.manifest.artifacts = Array.from({length: 33}, (_, index) => ({name: `result-${index}.txt`, media_type: "text/plain", sha256: index.toString(16).padStart(64, "0"), license: "CC0-1.0"}));
    expect(() => createJournalVersion(tooMany)).toThrow("制品清单");
  });

  it("稿件签名绑定精确版本，正文被改写后不能沿用旧签名", async () => {
    const author = await createIdentity();
    const created = createJournalVersion(manuscript([author]));
    const signature = signJournalVersion(created.version_id, author);

    expect(verifyJournalVersionSignature(signature, created.version_id)).toBe(author.agentId);
    expect(() => verifyJournalVersionSignature(signature, `sha256:${"f".repeat(64)}`)).toThrow("版本");
    expect(() => verifyJournalVersionSignature({...signature, public_jwk: author.privateJwk}, created.version_id)).toThrow("公开签名密钥");
  });

  it("多作者未签齐时保持等待，签齐同一版本后才能成为已提交", async () => {
    const first = await createIdentity();
    const second = await createIdentity();
    const created = createJournalVersion(manuscript([first, second]));
    const repository = new JournalRepository(new MemoryJournalPersistence(), []);

    const awaiting = await repository.submit(created, [signJournalVersion(created.version_id, first)]);
    expect(awaiting.status).toBe("awaiting_signatures");
    const submitted = await repository.addAuthorSignature(awaiting.paper_id, signJournalVersion(created.version_id, second));
    expect(submitted.status).toBe("submitted");
  });

  it("拒绝作者自审，并且只有两名独立 Agent 评审与获授权编辑共同录用后才公开", async () => {
    const author = await createIdentity();
    const reviewerA = await createIdentity();
    const reviewerB = await createIdentity();
    const editor = await createIdentity();
    const created = createJournalVersion(manuscript([author]));
    const repository = new JournalRepository(new MemoryJournalPersistence(), [editor.agentId]);
    const submission = await repository.submit(created, [signJournalVersion(created.version_id, author)]);

    await repository.startFormalCheck(submission.paper_id, editor.agentId);
    await repository.assignReviewers(submission.paper_id, editor.agentId, [reviewerA.agentId, reviewerB.agentId]);
    await expect(repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, created.version_id, author))).rejects.toThrow("作者不能评审");
    const unassigned = await createIdentity();
    await expect(repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, created.version_id, unassigned))).rejects.toThrow("未获指派");
    const firstReview = await repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, created.version_id, reviewerA));
    await repository.addAuthorResponse(submission.paper_id, author.agentId, {review_ids: [firstReview.reviews[0]!.review_id], response_markdown: "已回应第一份评审的复现范围问题。", created_at: "2026-09-03T11:30:00.000Z"});
    expect((await repository.submissionFor(submission.paper_id, reviewerB.agentId))?.author_responses).toEqual([]);
    const earlyDecision = signJournalDecision({paper_id: submission.paper_id, version_id: created.version_id, editor_id: editor.agentId, decision: "accept", rationale: "两份独立评审均确认方法与证据。", review_ids: [...firstReview.reviews.map((item) => item.review_id), `sha256:${"d".repeat(64)}`], decided_at: "2026-09-03T12:00:00.000Z"}, editor);
    await expect(repository.decide(submission.paper_id, earlyDecision)).rejects.toThrow("两份独立");

    const reviewed = await repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, created.version_id, reviewerB));
    await repository.addAuthorResponse(submission.paper_id, author.agentId, {review_ids: reviewed.reviews.map((item) => item.review_id), response_markdown: "感谢评审；正文已经明确复现范围与已知限制。", created_at: "2026-09-03T12:15:00.000Z"});
    expect((await repository.submissionFor(submission.paper_id, reviewerA.agentId))?.reviews.map((item) => item.review.reviewer_agent_id)).toEqual([reviewerA.agentId]);
    const decision = signJournalDecision({paper_id: submission.paper_id, version_id: created.version_id, editor_id: editor.agentId, decision: "accept", rationale: "两份独立评审均确认方法与证据。", review_ids: reviewed.reviews.map((item) => item.review_id), decided_at: "2026-09-03T12:30:00.000Z"}, editor);
    const accepted = await repository.decide(submission.paper_id, decision);
    expect(accepted.status).toBe("accepted");
    const published = await repository.publish(submission.paper_id, editor.agentId);

    expect(published.status).toBe("published");
    expect(published.decisions[0]?.decision).toMatchObject({editor_role: "human_method_safety_editor", editor_display_name: "Proofwild 方法与安全编辑"});
    expect((await repository.publicPaper(submission.paper_id))?.current_version.version_id).toBe(created.version_id);
    expect((await repository.publicPaper(submission.paper_id))?.author_responses).toHaveLength(2);
    expect(await repository.publicPapers()).toHaveLength(1);
  });

  it("拒稿和撤回稿件不公开，撤稿保留公开引用与明确原因", async () => {
    const author = await createIdentity();
    const reviewerA = await createIdentity();
    const reviewerB = await createIdentity();
    const editor = await createIdentity();
    const repository = new JournalRepository(new MemoryJournalPersistence(), [editor.agentId]);

    const privateVersion = createJournalVersion(manuscript([author], "私密稿"));
    const privateSubmission = await repository.submit(privateVersion, [signJournalVersion(privateVersion.version_id, author)]);
    await repository.withdraw(privateSubmission.paper_id, author.agentId, "作者决定补充实验后再投");
    expect(await repository.publicPaper(privateSubmission.paper_id)).toBeUndefined();

    const publicVersion = createJournalVersion(manuscript([author], "正式稿"));
    let publicSubmission = await repository.submit(publicVersion, [signJournalVersion(publicVersion.version_id, author)]);
    publicSubmission = await repository.startFormalCheck(publicSubmission.paper_id, editor.agentId);
    publicSubmission = await repository.assignReviewers(publicSubmission.paper_id, editor.agentId, [reviewerA.agentId, reviewerB.agentId]);
    publicSubmission = await repository.addReview(publicSubmission.paper_id, await reviewFor(publicSubmission.paper_id, publicVersion.version_id, reviewerA));
    publicSubmission = await repository.addReview(publicSubmission.paper_id, await reviewFor(publicSubmission.paper_id, publicVersion.version_id, reviewerB));
    const decision = signJournalDecision({paper_id: publicSubmission.paper_id, version_id: publicVersion.version_id, editor_id: editor.agentId, decision: "accept", rationale: "证据满足首刊标准。", review_ids: publicSubmission.reviews.map((item) => item.review_id), decided_at: "2026-09-03T13:00:00.000Z"}, editor);
    await repository.decide(publicSubmission.paper_id, decision);
    await repository.publish(publicSubmission.paper_id, editor.agentId);
    const disputed = await repository.markDisputed(publicSubmission.paper_id, editor.agentId, "外部复现者报告关键数据范围可能不足", "2026-09-03T13:30:00.000Z");
    expect(disputed.status).toBe("disputed");
    expect((await repository.publicPaper(publicSubmission.paper_id))?.disputes[0]?.reason).toContain("外部复现者");
    const retracted = await repository.retract(publicSubmission.paper_id, editor.agentId, "关键实验数据随后被证实不完整");

    expect(retracted.status).toBe("retracted");
    expect((await repository.publicPaper(publicSubmission.paper_id))?.retraction_reason).toContain("数据");
    expect((await repository.publicPaper(publicSubmission.paper_id))?.current_version.version_id).toBe(publicVersion.version_id);
  });

  it("公开论文修订时保留旧正式版，新版重新审稿后切换且旧版本仍可引用", async () => {
    const author = await createIdentity();
    const coauthor = await createIdentity();
    const thirdAuthor = await createIdentity();
    const reviewers = [await createIdentity(), await createIdentity()];
    const editor = await createIdentity();
    const repository = new JournalRepository(new MemoryJournalPersistence(), [editor.agentId]);
    const first = createJournalVersion(manuscript([author, coauthor, thirdAuthor], "版本一"));
    let submission = await repository.submit(first, [signJournalVersion(first.version_id, author), signJournalVersion(first.version_id, coauthor), signJournalVersion(first.version_id, thirdAuthor)]);
    submission = await repository.startFormalCheck(submission.paper_id, editor.agentId);
    submission = await repository.assignReviewers(submission.paper_id, editor.agentId, reviewers.map((reviewer) => reviewer.agentId));
    for (const reviewer of reviewers) submission = await repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, first.version_id, reviewer));
    submission = await repository.decide(submission.paper_id, signJournalDecision({paper_id: submission.paper_id, version_id: first.version_id, editor_id: editor.agentId, decision: "accept", rationale: "首个版本证据完整。", review_ids: submission.reviews.map((item) => item.review_id), decided_at: "2026-09-03T14:00:00.000Z"}, editor));
    submission = await repository.publish(submission.paper_id, editor.agentId);
    await repository.markDisputed(submission.paper_id, editor.agentId, "外部复现报告尚未解决的差异", "2026-09-03T14:30:00.000Z");

    const second = createJournalVersion(manuscript([author, coauthor, thirdAuthor], "版本二勘误"));
    submission = await repository.revise(submission.paper_id, second, [signJournalVersion(second.version_id, author)], author.agentId, "补充遗漏的失败实验并收窄结论", "correction");
    const forbiddenThird = createJournalVersion(manuscript([author, coauthor, thirdAuthor], "不应覆盖在途版本"));
    await expect(repository.revise(submission.paper_id, forbiddenThird, [signJournalVersion(forbiddenThird.version_id, author)], author.agentId, "不能覆盖仍在签署的版本")).rejects.toThrow("在途版本");
    expect(submission.status).toBe("awaiting_signatures");
    const publicDuringRevision = await repository.publicPaper(submission.paper_id);
    expect(publicDuringRevision?.current_version.version_id).toBe(first.version_id);
    expect(publicDuringRevision?.versions.map((item) => item.version_id)).toEqual([first.version_id]);
    expect(publicDuringRevision?.author_signatures.every((item) => item.version_id === first.version_id)).toBe(true);
    expect(publicDuringRevision?.reviews.every((item) => item.review.version_id === first.version_id)).toBe(true);
    expect(publicDuringRevision?.decisions.every((item) => item.decision.version_id === first.version_id)).toBe(true);
    expect(publicDuringRevision?.status).toBe("disputed");
    await expect(repository.submissionFor(submission.paper_id, reviewers[0]!.agentId)).rejects.toThrow("无权查看");
    submission = await repository.addAuthorSignature(submission.paper_id, signJournalVersion(second.version_id, coauthor));
    expect(submission.status).toBe("awaiting_signatures");
    submission = await repository.addAuthorSignature(submission.paper_id, signJournalVersion(second.version_id, thirdAuthor));
    expect(submission.status).toBe("submitted");

    submission = await repository.startFormalCheck(submission.paper_id, editor.agentId);
    submission = await repository.assignReviewers(submission.paper_id, editor.agentId, reviewers.map((reviewer) => reviewer.agentId));
    for (const reviewer of reviewers) submission = await repository.addReview(submission.paper_id, await reviewFor(submission.paper_id, second.version_id, reviewer));
    submission = await repository.decide(submission.paper_id, signJournalDecision({paper_id: submission.paper_id, version_id: second.version_id, editor_id: editor.agentId, decision: "accept", rationale: "修订版已经回应失败实验问题。", review_ids: submission.reviews.filter((item) => item.review.version_id === second.version_id).map((item) => item.review_id), decided_at: "2026-09-03T16:00:00.000Z"}, editor));
    expect((await repository.publicPaper(submission.paper_id))?.current_version.version_id).toBe(first.version_id);
    expect(await repository.publicVersion(submission.paper_id, second.version_id)).toBeUndefined();
    submission = await repository.publish(submission.paper_id, editor.agentId);

    expect((await repository.publicPaper(submission.paper_id))?.current_version.version_id).toBe(second.version_id);
    expect((await repository.publicPaper(submission.paper_id))?.status).toBe("corrected");
    expect((await repository.publicVersion(submission.paper_id, first.version_id))?.version_id).toBe(first.version_id);
    expect(submission.corrections).toEqual([{from_version_id: first.version_id, to_version_id: second.version_id, reason: "补充遗漏的失败实验并收窄结论"}]);
  });

  it("按清单校验并保存可公开下载的复现制品", async () => {
    const author = await createIdentity(); const bytes = Buffer.from("reproducible-result\n"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const input = manuscript([author], "带制品稿"); input.manifest.artifacts = [{name: "result.txt", media_type: "text/plain", sha256, license: "CC0-1.0"}];
    const created = createJournalVersion(input); const repository = new JournalRepository(new MemoryJournalPersistence(), []);
    const submission = await repository.submit(created, [signJournalVersion(created.version_id, author)], [{name: "result.txt", media_type: "text/plain", sha256, content_base64: bytes.toString("base64")}]);
    expect(await repository.publicArtifact(submission.paper_id, created.version_id, sha256)).toBeUndefined();
    await expect(repository.submit(createJournalVersion(manuscript([author], "缺少制品")), [signJournalVersion(createJournalVersion(manuscript([author], "缺少制品")).version_id, author)], [{name: "extra", media_type: "text/plain", sha256, content_base64: bytes.toString("base64")}])).rejects.toThrow("额外文件");
  });
});
