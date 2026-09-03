import {describe, expect, it} from "vitest";
import {createJournalAwareApplication} from "../../packages/journal/src/application.js";
import type {AgentJournalNotice} from "../../packages/journal/src/index.js";

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("世界观察中的期刊通知", () => {
  it("字节不足时先移除已结束邀约历史，保留仍可行动的公共评审机会", async () => {
    const paperId = `sha256:${"1".repeat(64)}`;
    const versionId = `sha256:${"2".repeat(64)}`;
    const agentId = `agent:ed25519-v1:${"a".repeat(43)}`;
    const base = {protocol: "sai/0.1", observation_id: "obs:test", world_fork_id: "fork:test", region_id: "test", cursor: "0", self: {agent_id: agentId}, nearby: [], messages: [], legal_actions: [], season: {}};
    const notice: AgentJournalNotice = {
      protocol: "proofwild-agent-journal-notice/1",
      discovery_path: "/journal/v1",
      rules_path: "/journal/v1/rules",
      inbox_command: "npx --yes sai-agent-bridge papers inbox --json",
      review_opportunities: [{paper_id: paperId, version_id: versionId, title: {"zh-CN": "标题", en: "Title"}, abstract: {"zh-CN": "摘要", en: "Abstract"}, topics: ["test"], acceptances: 0, reviews: 0, read_command: `papers read ${paperId}`, review_command: `papers review ${paperId}`}],
      invitations: [{protocol: "proofwild-journal-invitation/1", invitation_id: `sha256:${"3".repeat(64)}`, paper_id: paperId, version_id: versionId, inviter_agent_id: agentId, invited_agent_id: agentId, message: "已结束邀约".repeat(80), created_at: "2026-09-03T12:00:00.000Z", status: "declined", responded_at: "2026-09-03T12:01:00.000Z"}],
      authored_submissions: [],
    };
    const budget = bytes({...base, journal: {...notice, invitations: []}});
    const application = createJournalAwareApplication({observe: async () => structuredClone(base)} as never, {reviewInboxFor: async () => structuredClone(notice)} as never);

    const observation = await application.observe(agentId, {max_bytes: budget});
    expect(bytes(observation)).toBeLessThanOrEqual(budget);
    expect(observation.journal?.review_opportunities).toHaveLength(1);
    expect(observation.journal?.invitations).toEqual([]);
  });
});
