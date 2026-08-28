import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {worldResourceBranch} from "../../packages/kernel/src/index.js";
import {createClaimBody, executeLabsWorldResearch, REFERENCE_RULESET, signLabsClaim} from "../../packages/labs/src/index.js";
import {LabsRepository, MemoryLabsPersistence} from "../../packages/labs/src/store.js";
import {renderResearchRegistry, renderResearchResult, researchResponse} from "../../apps/cloudflare-worker/src/research-pages.js";

async function registryWithResearch(): Promise<{repository: LabsRepository; resultId: string}> {
  const repository = await LabsRepository.open(new MemoryLabsPersistence());
  const identity = await createIdentity();
  const branch = worldResourceBranch(0).labs_branch;
  const research = executeLabsWorldResearch(REFERENCE_RULESET, branch);
  const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "reproduction";
  const claim = signLabsClaim(createClaimBody(research.result_id, identity, claimType, [branch.branch_id, research.task_id, research.artifact_id, research.record_id]), identity);
  await repository.ingest("task", research.task, research.task_id);
  await repository.ingest("result", research.result, research.result_id);
  await repository.ingest("record", research.record, research.record_id);
  await repository.ingest("claim", claim.signed_claim, claim.claim_id);
  return {repository, resultId: research.result_id};
}

describe("LABS 双语研究成果页面", () => {
  it("把基线与 Agent 搜索记录区分展示，并提供下载和引用入口", async () => {
    const {repository, resultId} = await registryWithResearch();
    const registry = renderResearchRegistry(await repository.registry());
    expect(registry).toContain("让 Agent 的计算<br>成为可用成果");
    expect(registry).toContain("不是官方全网排名");
    expect(registry).toContain("256 个候选");
    expect(registry).toContain("/labs/v1/registry.csv");
    expect(registry).toContain(`/research/${encodeURIComponent(resultId)}`);
    expect(registry).toContain('aria-current="page"');
    expect(registry).toContain("@type\":\"Dataset");

    const entry = await repository.registryEntry(resultId);
    const detail = renderResearchResult(entry!);
    expect(detail).toContain("这次究竟计算了什么");
    expect(detail).toContain("256 / 256");
    expect(detail).toContain("完整复现包");
    expect(detail).toContain("BibTeX");
    expect(detail).toContain("数学结果由序列与精确整数公式成立");
    expect(detail).toContain("私钥从不公开");
    expect(detail).toContain('class="sequence"');
    expect(detail).toContain("overflow-wrap:anywhere");
  });

  it("英文页面提供等价成果语义、分叉边界和移动端布局断点", async () => {
    const {repository, resultId} = await registryWithResearch();
    const registry = renderResearchRegistry(await repository.registry(), "en");
    expect(registry).toContain("Agent computation<br>that remains useful");
    expect(registry).toContain("not an official global ranking");
    expect(registry).toContain("256-candidate");
    expect(registry).toContain('href="/research" hreflang="zh-CN"');
    expect(registry).toContain("@media(max-width:420px)");
    expect(registry).not.toContain("width:1120px");

    const response = await researchResponse(new Request(`https://social.szlk.ai/en/research/${encodeURIComponent(resultId)}`), repository, "en", resultId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await response.text()).toContain("What was actually computed");
    expect(await researchResponse(new Request("https://social.szlk.ai/research/missing"), repository, "zh-CN", `sha256:${"f".repeat(64)}`).then((item) => item.status)).toBe(404);
  });

  it("没有 Agent 记录时诚实显示空态，只把公开基线标为参考资产", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const page = renderResearchRegistry(await repository.registry());
    expect(page).toContain("尚未收到 Agent 搜索记录");
    expect(page).toContain("正式参考序列");
    expect(page).not.toContain("平台批准成果");
  });
});
