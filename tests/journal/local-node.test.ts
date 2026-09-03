import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {startLocalNode} from "../../apps/local-node/src/server.js";
import {FileJournalPersistence} from "../../apps/local-node/src/journal-store.js";
import {loadOrCreateIdentity, runPaperAction} from "../../packages/agent/src/index.js";
import {SaiBridge} from "../../packages/bridge/src/index.js";
import {JournalRepository, createJournalVersion, signJournalVersion} from "../../packages/journal/src/index.js";
import {manuscript} from "./journal.test.js";

describe("本地参考节点期刊", () => {
  it("并发提交不同稿件后原子保留两份持久记录", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-local-journal-concurrent-"));
    const authors = await Promise.all([loadOrCreateIdentity(join(directory, "a.json")), loadOrCreateIdentity(join(directory, "b.json"))]);
    const persistence = await FileJournalPersistence.open(directory);
    const repository = new JournalRepository(persistence, {currentContext: async () => ({world_fork_id: "fork:local", event_seq: 0}), reviewerEligible: async () => false});
    const versions = authors.map((author, index) => createJournalVersion(manuscript([author], `并发稿件 ${index}`)));
    await Promise.all(versions.map((version, index) => repository.submit(version, [signJournalVersion(version.version_id, authors[index]!)])));
    expect(await (await FileJournalPersistence.open(directory)).list()).toHaveLength(2);
  });

  it("提供同一机器规则与投稿接口，并在节点重启后保留投稿", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-local-journal-"));
    const identityPath = join(directory, "author.json");
    const identity = await loadOrCreateIdentity(identityPath);
    const input = manuscript([identity], "本地持久化");
    const paperPath = join(directory, "paper.md");
    const manifestPath = join(directory, "paper.json");
    await writeFile(paperPath, input.body_markdown);
    await writeFile(manifestPath, JSON.stringify(input.manifest));

    let node = await startLocalNode({dataDirectory: directory, regionId: "local-journal"});
    const rules = await runPaperAction({action: "rules", nodeUrl: node.url}) as {protocol: string};
    expect(rules.protocol).toBe("proofwild-journal-discovery/2");
    const submitted = await runPaperAction({action: "submit", paperPath, manifestPath, identityPath, nodeUrl: node.url}) as {paper_id: string};
    await node.close();

    node = await startLocalNode({dataDirectory: directory, regionId: "local-journal"});
    try {
      const restored = await runPaperAction({action: "status", paperId: submitted.paper_id, identityPath, nodeUrl: node.url}) as {paper_id: string};
      expect(restored.paper_id).toBe(submitted.paper_id);
    } finally { await node.close(); }
  });

  it("把公共审稿机会和点对点邀约送入受邀 Agent 的正常世界观察", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-local-journal-inbox-"));
    const authorPath = join(directory, "author.json");
    const reviewerPath = join(directory, "reviewer.json");
    const author = await loadOrCreateIdentity(authorPath);
    const reviewer = await loadOrCreateIdentity(reviewerPath);
    const input = manuscript([author], "观察中的评审机会");
    input.manifest.topics = ["超长主题".repeat(2_000)];
    const paperPath = join(directory, "paper.md");
    const manifestPath = join(directory, "paper.json");
    await writeFile(paperPath, input.body_markdown);
    await writeFile(manifestPath, JSON.stringify(input.manifest));
    const node = await startLocalNode({dataDirectory: directory, regionId: "journal-inbox"});
    const bridge = new SaiBridge(node.url, reviewer);
    try {
      await bridge.register();
      await bridge.connect();
      const first = await bridge.observe();
      const action = first.legal_actions[0]!;
      await bridge.act({observation_id: first.observation_id, action_id: action.action_id, request_id: "reviewer-world-activity"});
      const submitted = await runPaperAction({action: "submit", paperPath, manifestPath, identityPath: authorPath, nodeUrl: node.url}) as {paper_id: string};
      const candidates = await runPaperAction({action: "reviewers", paperId: submitted.paper_id, identityPath: authorPath, nodeUrl: node.url}) as {reviewers: Array<{agent_id: string}>};
      expect(candidates.reviewers).toEqual([{agent_id: reviewer.agentId, invited: false, reviewed: false}]);
      const invited = await runPaperAction({action: "invite", paperId: submitted.paper_id, reviewerAgentId: reviewer.agentId, message: "请独立复核这篇研究", identityPath: authorPath, nodeUrl: node.url}) as {invitation_id: string};

      const observation = await bridge.observe({max_bytes: 4_096});
      expect(new TextEncoder().encode(JSON.stringify(observation)).byteLength).toBeLessThanOrEqual(4_096);
      expect(observation.journal).toMatchObject({
        protocol: "proofwild-agent-journal-notice/1",
        discovery_path: "/journal/v1",
        invitations: [expect.objectContaining({invitation_id: invited.invitation_id, status: "pending"})],
      });
      const paper = await runPaperAction({action: "read", paperId: submitted.paper_id, identityPath: reviewerPath, nodeUrl: node.url}) as {current_version: {body_markdown: string}};
      expect(paper.current_version.body_markdown).toContain("## 研究问题");
      await runPaperAction({action: "accept-invite", invitationId: invited.invitation_id, identityPath: reviewerPath, nodeUrl: node.url});
      expect((await runPaperAction({action: "inbox", identityPath: reviewerPath, nodeUrl: node.url}) as {invitations: Array<{status: string}>}).invitations[0]?.status).toBe("accepted");
    } finally {
      await bridge.close();
      await node.close();
    }
  });
});
