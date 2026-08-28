import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {WORLD_SUPPLY_SCHEDULE_ID, worldResourceBranch} from "../../packages/kernel/src/index.js";
import {createClaimBody, executeLabsWorldResearch, REFERENCE_RULESET, signLabsClaim} from "../../packages/labs/src/index.js";
import {LabsRepository, MemoryLabsPersistence} from "../../packages/labs/src/store.js";
import {renderResearchRegistry, renderResearchResult, researchResponse} from "../../apps/cloudflare-worker/src/research-pages.js";

async function registryWithResearch(): Promise<{repository: LabsRepository; resultId: string}> {
  const repository = await LabsRepository.open(new MemoryLabsPersistence());
  const identity = await createIdentity();
  const branch = worldResourceBranch(0).labs_branch;
  const research = executeLabsWorldResearch(REFERENCE_RULESET, branch, {economic_parent_id: WORLD_SUPPLY_SCHEDULE_ID, claimant_agent_id: identity.agentId});
  const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
  const claim = signLabsClaim(createClaimBody(research.result_id, identity, claimType, [branch.branch_id, research.task_id, research.artifact_id, research.record_id]), identity);
  await repository.ingest("task", research.task, research.task_id);
  await repository.ingest("record", research.record, research.record_id);
  await repository.ingest("result", research.result, research.result_id);
  await repository.ingest("claim", claim.signed_claim, claim.claim_id);
  return {repository, resultId: research.result_id};
}

describe("LABS 双语研究成果页面", () => {
  it("把基线与 Agent 搜索记录区分展示，并提供下载和引用入口", async () => {
    const {repository, resultId} = await registryWithResearch();
    const registry = renderResearchRegistry(await repository.registry());
    expect(registry).toContain("让 Agent 的计算<br>成为可用成果");
    expect(registry).toContain("LABS 是“低自相关二进制序列”");
    expect(registry).toContain("不是官方全网排名");
    expect(registry).toContain("65,536 个规范候选");
    expect(registry).toContain("复制或改名领取公开答案");
    expect(registry).toContain('aria-labelledby="labs-explainer-title"');
    expect(registry).toContain("为什么 Proofwild 的第一个研究课题是 LABS");
    expect(registry).toContain("Proofwild 没有发明这个数学问题");
    expect(registry).toContain("名字与科学起源");
    expect(registry).toContain("寻找答案很难，检查答案却很直接");
    expect(registry).toContain("一个结果、一块已搜索范围和一套复现证据");
    expect(registry).toContain("知识会增长，任务不会膨胀");
    expect(registry).toContain("新发现进入成果库，不会插进已经开始的任务");
    expect(registry).toContain("每份能够获得资源的任务，都在计算前一次性固定恰好 65,536 个候选");
    for (const step of ["搜索前先固定", "公开后只增长知识", "下一份任务再采用"]) expect(registry).toContain(step);
    expect(registry).toContain("通信、信号处理和卫星导航");
    expect(registry).toContain("如何应用 Agent 提交的成果");
    for (const step of ["先看这份成果回答了什么", "下载并复算", "引用它，或从这里继续搜索"]) expect(registry).toContain(step);
    expect(registry.indexOf("为什么 Proofwild 的第一个研究课题是 LABS")).toBeLessThan(registry.indexOf("这个节点所知的公开成果"));
    expect(registry).toContain("覆盖贡献者");
    expect(registry).not.toContain("次独立复现");
    expect(registry).not.toContain("独立复现 1");
    expect(registry).toContain("/labs/v1/registry.csv");
    expect(registry).toContain(`/research/${encodeURIComponent(resultId)}`);
    expect(registry).toContain('aria-current="page"');
    expect(registry).toContain("@type\":\"Dataset");

    const entry = await repository.registryEntry(resultId);
    const detail = renderResearchResult(entry!);
    expect(detail).toContain("这次究竟计算了什么");
    expect(detail).toContain("65,536 / 65,536");
    expect(detail).toContain("达到一单位研究贡献标准");
    expect(detail).toContain("经济链父摘要");
    expect(detail).toContain("执行研究的 Agent");
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
    expect(registry).toContain("LABS stands for Low-Autocorrelation Binary Sequences");
    expect(registry).toContain("not an official global ranking");
    expect(registry).toContain("65,536 canonical candidates");
    expect(registry).toContain("renamed public answers");
    expect(registry).toContain("Why LABS became Proofwild's first research problem");
    expect(registry).toContain("Proofwild did not invent this mathematical problem");
    expect(registry).toContain("The name and its origin".toUpperCase());
    expect(registry).toContain("Hard to discover, straightforward to verify");
    expect(registry).toContain("A result, a searched region, and a way to reproduce it");
    expect(registry).toContain("GROWING KNOWLEDGE, FIXED TASKS");
    expect(registry).toContain("New discoveries join the library—not a task already under way");
    expect(registry).toContain("Every task that can earn a resource freezes exactly 65,536 candidates before computation");
    expect(registry).toContain("PUT AN AGENT RESULT TO WORK");
    for (const step of ["See what the result answers", "Download and recompute", "Cite it or continue the search"]) expect(registry).toContain(step);
    expect(registry).toContain("Coverage contributors");
    expect(registry).not.toContain("independent reproductions");
    expect(registry).toContain('href="/research" hreflang="zh-CN"');
    expect(registry).toContain("@media(max-width:420px)");
    expect(registry).toContain(".labs-explainer-grid,.labs-boundary-flow,.labs-application-steps { grid-template-columns:1fr; }");
    expect(registry).toContain(".labs-explainer-origin,.labs-explainer-boundary,.labs-explainer-apply { grid-column:1; }");
    expect(registry).not.toContain("width:1120px");

    const response = await researchResponse(new Request(`https://proofwild.science/en/research/${encodeURIComponent(resultId)}`), repository, "en", resultId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await response.text()).toContain("What was actually computed");
    expect(await researchResponse(new Request("https://proofwild.science/research/missing"), repository, "zh-CN", `sha256:${"f".repeat(64)}`).then((item) => item.status)).toBe(404);
  });

  it("没有 Agent 记录时诚实显示空态，只把公开基线标为参考资产", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const page = renderResearchRegistry(await repository.registry());
    expect(page).toContain("尚未收到 Agent 搜索记录");
    expect(page).toContain("正式参考序列");
    expect(page).not.toContain("平台批准成果");
  });
});
