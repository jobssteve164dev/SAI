import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {JournalRepository, MemoryJournalPersistence, createJournalStatement, createJournalVersion, signJournalStatement, signJournalVersion} from "../../packages/journal/src/index.js";
import {manuscript, reviewFor} from "./journal.test.js";
import * as journal from "../../packages/journal/src/index.js";

describe("Agent 社会公共审稿", () => {
  it("多作者补签不能把审稿资格截止点从初次投稿延后", async () => {
    const author = await createIdentity();
    const coauthor = await createIdentity();
    const lateReviewer = await createIdentity();
    let eventSeq = 10;
    const firstActivity = new Map([[lateReviewer.agentId, 15]]);
    const repository = new JournalRepository(new MemoryJournalPersistence(), {
      currentContext: async () => ({world_fork_id: "fork:test:submission-cutoff", event_seq: eventSeq}),
      reviewerEligible: async (agentId: string, context: {event_seq: number}) => (firstActivity.get(agentId) ?? Number.POSITIVE_INFINITY) <= context.event_seq,
    } as never);
    const created = createJournalVersion(manuscript([author, coauthor], "资格截止点"));
    let paper = await repository.submit(created, [signJournalVersion(created.version_id, author)]);
    eventSeq = 20;
    paper = await repository.addAuthorSignature(paper.paper_id, signJournalVersion(created.version_id, coauthor));
    expect(paper.review_contexts?.[created.version_id]?.event_seq).toBe(10);
    await expect(repository.addReview(paper.paper_id, await reviewFor(paper.paper_id, created.version_id, lateReviewer))).rejects.toThrow("投稿前");
  });

  it("同一版本取得五个合格非作者 Agent 的独立通过意见后，仅通讯 Agent 可以刊登", async () => {
    const author = await createIdentity();
    const reviewers = await Promise.all(Array.from({length: 7}, () => createIdentity()));
    const activeBeforeSubmission = new Set(reviewers.slice(0, 6).map((item) => item.agentId));
    const repository = new JournalRepository(new MemoryJournalPersistence(), {
      currentContext: async () => ({world_fork_id: "fork:test:journal", event_seq: 40}),
      reviewerEligible: async (agentId: string, context: {world_fork_id: string; event_seq: number}) => context.world_fork_id === "fork:test:journal" && context.event_seq === 40 && activeBeforeSubmission.has(agentId),
    } as never);
    const created = createJournalVersion(manuscript([author]));
    const submitted = await repository.submit(created, [signJournalVersion(created.version_id, author)]);

    expect(submitted.status).toBe("under_review");
    await expect(repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, author))).rejects.toThrow("作者不能评审");
    await expect(repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewers[6]!))).rejects.toThrow("投稿前");

    let current = await repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewers[0]!, "reject"));
    expect(current.status).toBe("under_review");
    for (const reviewer of reviewers.slice(1, 5)) current = await repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewer));
    expect(current.status).toBe("under_review");
    current = await repository.addReview(submitted.paper_id, await reviewFor(submitted.paper_id, created.version_id, reviewers[5]!));
    expect(current.status).toBe("publication_eligible");
    await expect(repository.publish(submitted.paper_id, reviewers[0]!.agentId)).rejects.toThrow("通讯 Agent");
    expect((await repository.publish(submitted.paper_id, author.agentId, "2026-09-03T15:00:00.000Z")).status).toBe("published");
  });

  it("审稿讨论公开给合格 Agent，刊后争议立即标记且五份独立撤稿意见才撤稿", async () => {
    const author = await createIdentity();
    const reviewers = await Promise.all(Array.from({length: 6}, () => createIdentity()));
    const firstActiveEvent = new Map(reviewers.map((item, index) => [item.agentId, index === 5 ? 30 : 10]));
    let contextEventSeq = 20;
    const repository = new JournalRepository(new MemoryJournalPersistence(), {
      currentContext: async () => ({world_fork_id: "fork:test:discussion", event_seq: contextEventSeq}),
      reviewerEligible: async (agentId: string, context: {event_seq: number}) => (firstActiveEvent.get(agentId) ?? Number.POSITIVE_INFINITY) <= context.event_seq,
    } as never);
    const created = createJournalVersion(manuscript([author], "公共审稿讨论"));
    let paper = await repository.submit(created, [signJournalVersion(created.version_id, author)]);
    for (const reviewer of reviewers.slice(0, 5)) paper = await repository.addReview(paper.paper_id, await reviewFor(paper.paper_id, created.version_id, reviewer));

    const createStatement = (journal as unknown as {createJournalStatement: Function}).createJournalStatement;
    const signStatement = (journal as unknown as {signJournalStatement: Function}).signJournalStatement;
    const discussion = signStatement(createStatement({paper_id: paper.paper_id, version_id: created.version_id, agent_id: reviewers[0]!.agentId, kind: "discussion", content: "我检查了复现步骤，建议作者明确随机种子来源。", created_at: "2026-09-03T13:00:00.000Z"}), reviewers[0]);
    paper = await (repository as unknown as {addStatement: Function}).addStatement(paper.paper_id, discussion);
    expect((await repository.submissionFor(paper.paper_id, reviewers[1]!.agentId))?.statements).toHaveLength(1);
    paper = await repository.publish(paper.paper_id, author.agentId, "2026-09-03T14:00:00.000Z");

    contextEventSeq = 40;
    const dispute = signStatement(createStatement({paper_id: paper.paper_id, version_id: created.version_id, agent_id: reviewers[5]!.agentId, kind: "dispute", content: "外部复算与论文报告的主结果不一致。", created_at: "2026-09-03T15:00:00.000Z"}), reviewers[5]);
    paper = await (repository as unknown as {addStatement: Function}).addStatement(paper.paper_id, dispute);
    expect(paper.status).toBe("disputed");
    for (const [index, reviewer] of reviewers.slice(0, 5).entries()) {
      const opinion = signStatement(createStatement({paper_id: paper.paper_id, version_id: created.version_id, agent_id: reviewer.agentId, kind: "retract", content: `第 ${index + 1} 份独立撤稿意见：关键结果无法复现。`, created_at: `2026-09-03T16:0${index}:00.000Z`}), reviewer);
      paper = await (repository as unknown as {addStatement: Function}).addStatement(paper.paper_id, opinion);
      expect(paper.status).toBe(index === 4 ? "retracted" : "disputed");
    }
    expect((await repository.publicPaper(paper.paper_id))?.statements).toHaveLength(7);
  });

  it("正式版存在在途修订时，刊后声明仍绑定公开正式版而不能绑定私密修订版", async () => {
    const author = await createIdentity();
    const reviewers = await Promise.all(Array.from({length: 5}, () => createIdentity()));
    const active = new Set(reviewers.map((item) => item.agentId));
    const repository = new JournalRepository(new MemoryJournalPersistence(), {
      currentContext: async () => ({world_fork_id: "fork:test:published-version", event_seq: 40}),
      reviewerEligible: async (agentId: string) => active.has(agentId),
    } as never);
    const first = createJournalVersion(manuscript([author], "正式版本"));
    let paper = await repository.submit(first, [signJournalVersion(first.version_id, author)]);
    for (const reviewer of reviewers) paper = await repository.addReview(paper.paper_id, await reviewFor(paper.paper_id, first.version_id, reviewer));
    paper = await repository.publish(paper.paper_id, author.agentId, "2026-09-03T14:00:00.000Z");

    const second = createJournalVersion(manuscript([author], "尚未刊登的勘误版本"));
    paper = await repository.revise(paper.paper_id, second, [signJournalVersion(second.version_id, author)], author.agentId, "补充新的复现证据", "correction");
    const publicDispute = signJournalStatement(createJournalStatement({paper_id: paper.paper_id, version_id: first.version_id, agent_id: reviewers[0]!.agentId, kind: "dispute", content: "当前公开版本的主结果无法复现。", created_at: "2026-09-03T15:00:00.000Z"}), reviewers[0]!);
    paper = await repository.addStatement(paper.paper_id, publicDispute);
    expect(paper.publication_status).toBe("disputed");
    expect(paper.status).toBe("under_review");
    paper = await repository.addReview(paper.paper_id, await reviewFor(paper.paper_id, second.version_id, reviewers[0]!));

    const privateDispute = signJournalStatement(createJournalStatement({paper_id: paper.paper_id, version_id: second.version_id, agent_id: reviewers[1]!.agentId, kind: "dispute", content: "不应对尚未刊登的版本发起刊后争议。", created_at: "2026-09-03T15:01:00.000Z"}), reviewers[1]!);
    await expect(repository.addStatement(paper.paper_id, privateDispute)).rejects.toThrow("当前正式版本");
    expect((await repository.publicPaper(paper.paper_id))?.statements?.map((item) => item.statement.version_id)).toEqual([first.version_id]);
  });
});
