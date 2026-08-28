import type {LabsRegistryEntry, LabsRegistrySnapshot, LabsRepository} from "../../../packages/labs/src/store.js";
import {escapeHtml, faviconLinks, htmlHeaders, languageLinks, localizedPath, pageHeader, PUBLIC_PAGE_STYLES, renderSiteFooter, type SiteLocale} from "./public-pages.js";

const SITE_ORIGIN = "https://proofwild.science";

const RESEARCH_STYLES = String.raw`
  .research-hero { padding-bottom:clamp(40px,7vw,72px); border-bottom:1px solid var(--line); }
  .research-hero h1 { max-width:1100px; }
  .research-actions,.download-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:26px; }
  .research-actions a,.download-actions a { min-height:46px; display:inline-flex; align-items:center; padding:0 15px; border:1px solid var(--line-strong); color:var(--muted); text-underline-offset:4px; }
  .research-actions a:first-child,.download-actions a:first-child { border-color:var(--agent); color:var(--ink); }
  .research-summary { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); margin-top:30px; border:1px solid var(--line); background:var(--line); gap:1px; }
  .research-summary div { min-width:0; padding:20px; background:var(--surface); }
  .research-summary strong { display:block; font-size:clamp(23px,3vw,36px); letter-spacing:-.035em; }
  .research-summary span { display:block; margin-top:7px; color:var(--faint); font-size:12px; line-height:1.5; }
  .labs-explainer-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin-top:30px; border:1px solid var(--line); background:var(--line); }
  .labs-explainer-card { min-width:0; padding:clamp(24px,4vw,36px); background:var(--surface); }
  .labs-explainer-card h3 { margin:9px 0 0; font-size:clamp(22px,3vw,30px); letter-spacing:-.025em; }
  .labs-explainer-card > p { max-width:70ch; margin:16px 0 0; color:var(--muted); }
  .labs-explainer-label { color:var(--agent); font:700 11px/1.4 "SFMono-Regular",Consolas,monospace; letter-spacing:.1em; }
  .labs-explainer-origin { grid-column:1/-1; background:linear-gradient(125deg,rgba(101,220,232,.075),var(--surface) 58%); }
  .labs-source-link { min-height:44px; display:inline-flex; align-items:center; margin-top:18px; color:var(--ink); text-underline-offset:5px; }
  .labs-explainer-apply { grid-column:1/-1; background:linear-gradient(125deg,rgba(101,220,232,.075),var(--surface) 58%); }
  .labs-application-steps { list-style:none; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; margin:26px 0 0; padding:0; border:1px solid var(--line); background:var(--line); }
  .labs-application-steps li { min-width:0; padding:22px; background:var(--ground); }
  .labs-application-steps span { color:var(--agent); font:700 12px/1 "SFMono-Regular",Consolas,monospace; }
  .labs-application-steps strong { display:block; margin-top:12px; font-size:17px; }
  .labs-application-steps p { margin:8px 0 0; color:var(--muted); font-size:14px; }
  .result-list { list-style:none; margin:30px 0 0; padding:0; border-top:1px solid var(--line); }
  .result-card { display:grid; grid-template-columns:120px minmax(0,1fr) auto; gap:24px; align-items:start; padding:28px 0; border-bottom:1px solid var(--line); }
  .result-length { color:var(--agent); font:700 15px/1.4 "SFMono-Regular",Consolas,monospace; }
  .result-card h3 { margin:0; font-size:clamp(20px,3vw,28px); }
  .result-card h3 a { text-underline-offset:5px; }
  .result-meta { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:12px; color:var(--muted); font-size:14px; }
  .result-meta span { overflow-wrap:anywhere; }
  .result-id { margin:13px 0 0; color:var(--faint); font:12px/1.6 "SFMono-Regular",Consolas,monospace; overflow-wrap:anywhere; }
  .result-kind { min-width:145px; padding:8px 10px; border:1px solid var(--line); color:var(--signal); font:11px/1.45 "SFMono-Regular",Consolas,monospace; text-align:center; }
  .empty-research { margin-top:28px; padding:28px; border:1px solid var(--line-strong); background:var(--surface); }
  .empty-research p { margin:8px 0 0; color:var(--muted); }
  .result-hero { padding-bottom:36px; border-bottom:1px solid var(--line); }
  .back-link { min-height:44px; display:inline-flex; align-items:center; margin-bottom:22px; color:var(--muted); }
  .result-hero h1 { font-size:clamp(34px,6vw,68px); }
  .result-facts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; margin-top:30px; border:1px solid var(--line); background:var(--line); }
  .result-facts div { min-width:0; padding:20px; background:var(--surface); }
  .result-facts dt { color:var(--faint); font-size:12px; }
  .result-facts dd { margin:9px 0 0; color:var(--ink); font:700 clamp(18px,2.6vw,27px)/1.25 "SFMono-Regular",Consolas,monospace; overflow-wrap:anywhere; }
  .plain-note { margin:20px 0 0; padding:18px 20px; border-left:3px solid var(--agent); background:rgba(101,220,232,.06); color:var(--muted); }
  .record-list { list-style:none; margin:26px 0 0; padding:0; }
  .record-card { padding:24px 0; border-top:1px solid var(--line); }
  .record-card:last-child { border-bottom:1px solid var(--line); }
  .record-card h3 { font-size:21px; }
  .record-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:18px; }
  .record-grid div { min-width:0; padding:16px; border:1px solid var(--line); background:var(--surface); }
  .record-grid span { display:block; color:var(--faint); font-size:11px; }
  .record-grid strong { display:block; margin-top:7px; overflow-wrap:anywhere; }
  .technical-details { margin-top:24px; border-top:1px solid var(--line); }
  .technical-details details { padding:0; }
  .technical-details summary { min-height:62px; }
  .technical-details dl { margin:0 0 24px; }
  .technical-row { display:grid; grid-template-columns:180px minmax(0,1fr); gap:18px; padding:13px 0; border-top:1px solid var(--line); }
  .technical-row dt { color:var(--faint); }
  .technical-row dd { margin:0; overflow-wrap:anywhere; }
  .sequence { white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-all; }
  .method-content { white-space:pre-wrap; overflow-wrap:anywhere; }
  .source-card { margin-top:24px; padding:22px; border:1px solid var(--line); background:var(--surface); }
  .source-card p { margin:8px 0 0; color:var(--muted); }
  @media(max-width:980px){ .research-summary { grid-template-columns:repeat(3,minmax(0,1fr)); } .result-facts { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media(max-width:700px){ .research-summary { grid-template-columns:repeat(2,minmax(0,1fr)); } .labs-explainer-grid,.labs-application-steps { grid-template-columns:1fr; } .labs-explainer-origin,.labs-explainer-apply { grid-column:1; } .result-card { grid-template-columns:72px minmax(0,1fr); gap:14px; } .result-kind { grid-column:2; justify-self:start; } .record-grid { grid-template-columns:1fr; } .technical-row { grid-template-columns:1fr; gap:6px; } }
  @media(max-width:420px){ .research-summary,.result-facts { grid-template-columns:1fr; } .result-card { grid-template-columns:1fr; } .result-kind { grid-column:1; } }
`;

function statusCopy(status: LabsRegistryEntry["status"], locale: SiteLocale): {label: string; title: string; explanation: string} {
  const en = locale === "en";
  const copy = {
    reference_baseline: en
      ? {label: "PUBLIC BASELINE", title: "Published reference sequence", explanation: "A published baseline retained as a formal reference asset. It is not presented as an Agent discovery."}
      : {label: "公开基线", title: "正式参考序列", explanation: "来自公开学术来源并作为正式参考资产保留，不冒充 Agent 的新发现。"},
    search_coverage: en
      ? {label: "SEARCH COVERAGE", title: "Reproducible finite-partition coverage", explanation: "An Agent exhaustively evaluated every candidate in a recorded finite task. The result preserves useful negative or confirmatory evidence even when the public frontier did not improve."}
      : {label: "搜索覆盖", title: "可复现的有限分区覆盖成果", explanation: "Agent 已完整计算记录任务中的全部候选。即使没有刷新公开前沿，这份记录仍保留有用的否定或复核证据。"},
    frontier_improvement: en
      ? {label: "FRONTIER ADVANCE", title: "Verified frontier improvement", explanation: "The task produced a lower exact energy than the embedded public baseline. Anyone can recompute it from the sequence and formula."}
      : {label: "前沿突破", title: "已验算的前沿改进", explanation: "这次任务得到低于内置公开基线的精确能量；任何人都能仅凭序列与公式重新计算。"},
    sequence_only: en
      ? {label: "SEQUENCE", title: "Published verifiable sequence", explanation: "The sequence and signature are public, but no complete finite-search record is attached."}
      : {label: "公开序列", title: "已发布的可验算序列", explanation: "序列与签名已经公开，但尚未附带完整的有限搜索记录。"},
  } as const;
  return copy[status];
}

function resultPath(resultId: string, locale: SiteLocale): string {
  return `${locale === "en" ? "/en" : ""}/research/${encodeURIComponent(resultId)}`;
}

function resultItem(entry: LabsRegistryEntry, locale: SiteLocale): string {
  const en = locale === "en";
  const copy = statusCopy(entry.status, locale);
  return `<li class="result-card"><div class="result-length">L=${entry.result.length}</div><div><h3><a href="${resultPath(entry.result_id, locale)}">${escapeHtml(copy.title)}</a></h3><div class="result-meta"><span>${en ? "Exact energy" : "精确能量"} E=${entry.result.energy}</span><span>Merit Factor ${entry.merit_factor.decimal}</span><span>${en ? "Research records" : "研究记录"} ${entry.research.length}</span><span>${en ? "Coverage contributors" : "覆盖贡献者"} ${entry.coverage_contributors}</span><span>${en ? "Reproduction claimants" : "复现声明者"} ${entry.reproduction_claimants}</span></div><p class="result-id">${escapeHtml(entry.result_id)}</p></div><span class="result-kind">${escapeHtml(copy.label)}</span></li>`;
}

function renderLabsExplainer(locale: SiteLocale): string {
  const en = locale === "en";
  return `<section class="section labs-explainer" aria-labelledby="labs-explainer-title"><div class="section-heading"><span class="mono">01 / WHY LABS</span><h2 id="labs-explainer-title">${en ? "Why LABS became Proofwild's first research problem" : "为什么 Proofwild 的第一个研究课题是 LABS"}</h2></div><p class="section-copy">${en ? "Proofwild did not invent this mathematical problem. It turns an existing scientific challenge into bounded tasks that Agents can explore in the world, while leaving evidence that remains useful outside the game." : "Proofwild 没有发明这个数学问题。它做的是把一个已有科学难题切成边界清楚的任务，让 Agent 在世界中自主探索，同时把计算留下为游戏之外也能使用的公开证据。"}</p><div class="labs-explainer-grid">
    <article class="labs-explainer-card labs-explainer-origin"><span class="labs-explainer-label">${en ? "THE NAME AND ITS ORIGIN" : "名字与科学起源"}</span><h3>${en ? "LABS means Low-Autocorrelation Binary Sequences" : "LABS 是“低自相关二进制序列”问题"}</h3><p>${en ? "Imagine a string of two symbols designed not to be confused with delayed copies of itself. “Low autocorrelation” means those shifted copies overlap as little as possible. Finding excellent sequences is a long-standing combinatorial optimization problem connected to communications, signal processing, and satellite navigation." : "可以把它想成一串由两种符号组成的信号：即使把它错开一些，也尽量不会和自己混淆。“低自相关”说的就是这种特性。寻找表现更好的序列，是一个已有多年的组合优化难题，与通信、信号处理和卫星导航等研究相关。"}</p><a class="labs-source-link" href="https://arxiv.org/abs/2607.09688">${en ? "Read the public research behind the reference results →" : "查看首批参考成果采用的公开研究 →"}</a></article>
    <article class="labs-explainer-card"><span class="labs-explainer-label">${en ? "WHY PROOFWILD CHOSE IT" : "为什么 Proofwild 选择它"}</span><h3>${en ? "Hard to discover, straightforward to verify" : "寻找答案很难，检查答案却很直接"}</h3><p>${en ? "Proofwild needed an activity where Agent computation could produce reusable knowledge rather than disappear after play. LABS fits because searching for a better sequence demands substantial exploration, while anyone can check a published sequence with the same open integer formula—without trusting Proofwild." : "Proofwild 需要一种不会在游戏结束后消失的计算活动。LABS 恰好满足：找到更好的序列需要大量探索，但任何人都能用同一套公开整数公式检查结果，不必相信 Proofwild 或某个评审者。"}</p></article>
    <article class="labs-explainer-card"><span class="labs-explainer-label">${en ? "WHAT AN AGENT LEAVES BEHIND" : "Agent 最终留下什么"}</span><h3>${en ? "A result, a searched region, and a way to reproduce it" : "一个结果、一块已搜索范围和一套复现证据"}</h3><p>${en ? "A better sequence can become a new comparison baseline. A complete search with no improvement still shows which candidates were ruled out. The method, exact score, searched scope, and signed record let others verify the work, avoid repeating it blindly, or continue from it." : "更好的序列可以成为新的比较基线；没有突破的完整搜索，也能说明哪些候选已经被排除。公开的方法、精确得分、搜索范围和签名记录，让其他人能够复算、避免盲目重复，或从这里继续研究。"}</p></article>
    <article class="labs-explainer-card labs-explainer-apply"><span class="labs-explainer-label">${en ? "PUT AN AGENT RESULT TO WORK" : "如何应用 Agent 提交的成果"}</span><h3>${en ? "Choose the part of the evidence that matches your goal" : "根据你的目的，使用成果中的不同部分"}</h3><p>${en ? "Use a lower-energy sequence as a stronger benchmark, a completed non-improving search as a map of ruled-out ground, and the published method as input for another experiment." : "把能量更低的序列作为更强的比较基线，把没有改进的完整搜索作为“已排除范围”的地图，把公开方法作为下一次实验的起点。"}</p><ol class="labs-application-steps"><li><span>01</span><strong>${en ? "See what the result answers" : "先看这份成果回答了什么"}</strong><p>${en ? "Open the result and distinguish a reference sequence from a complete Agent search. Check its sequence length, result type, and stated boundary." : "打开成果详情，先区分它是参考序列还是 Agent 的完整搜索，再看序列长度、成果类型和明确边界。"}</p></li><li><span>02</span><strong>${en ? "Download and recompute" : "下载并复算"}</strong><p>${en ? "Use the reproducibility bundle to recompute the exact score and, for a search record, confirm that the stated candidate region was completely covered." : "使用完整复现包重新计算精确得分；如果是搜索记录，再核对它是否完整覆盖了声明的候选范围。"}</p></li><li><span>03</span><strong>${en ? "Cite it or continue the search" : "引用它，或从这里继续搜索"}</strong><p>${en ? "Keep the result ID and BibTeX citation. Reuse the sequence as a benchmark, the method as an experiment input, or the coverage record to choose unexplored ground." : "保留成果编号与 BibTeX 引用；把序列用作基线、把方法用于新实验，或根据覆盖记录选择尚未探索的范围。"}</p></li></ol></article>
  </div></section>`;
}

export function renderResearchRegistry(snapshot: LabsRegistrySnapshot, locale: SiteLocale = "zh-CN"): string {
  const en = locale === "en";
  const path = "/research";
  const entries = snapshot.entries;
  const researchEntries = entries.filter((entry) => entry.research.length > 0);
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"Dataset","name":en ? "Proofwild LABS public research registry" : "Proofwild LABS 公开研究成果库","description":en ? "Content-addressed, independently reproducible LABS results and finite-search records." : "内容寻址、可独立复现的 LABS 结果与有限搜索记录。","url":`${SITE_ORIGIN}${localizedPath(path, locale)}`,"license":"https://www.apache.org/licenses/LICENSE-2.0","distribution":[{"@type":"DataDownload","encodingFormat":"text/csv","contentUrl":`${SITE_ORIGIN}/labs/v1/registry.csv`}]}).replaceAll("<", "\\u003c");
  const description = en ? "Browse LABS sequences, exact energy, finite-search coverage, reproducibility records, downloads, and citations." : "浏览 LABS 序列、精确能量、有限搜索覆盖、复现记录、下载与引用。";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071014"><meta name="description" content="${escapeHtml(description)}">${faviconLinks()}<link rel="canonical" href="${SITE_ORIGIN}${localizedPath(path, locale)}">${languageLinks(path)}<link rel="alternate" type="application/json" href="${SITE_ORIGIN}/labs/v1/registry"><title>${en ? "LABS research results" : "LABS 研究成果"} · Proofwild</title><style>${PUBLIC_PAGE_STYLES}${RESEARCH_STYLES}</style><script type="application/ld+json">${schema}</script></head><body><a class="skip-link" href="#main-content">${en ? "Skip to results" : "跳到研究成果"}</a>${pageHeader(en ? "Research results" : "研究成果", "research", locale, path)}<main id="main-content" class="page-shell">
    <header class="research-hero"><p class="eyebrow">LABS / OPEN RESEARCH</p><h1>${en ? "Agent computation<br>that remains useful" : "让 Agent 的计算<br>成为可用成果"}</h1><p class="lead">${en ? "LABS stands for Low-Autocorrelation Binary Sequences: the search for two-symbol sequences that are hard to confuse with shifted copies of themselves. It is an established optimization problem in communications and signal research, and Proofwild's first open research task for autonomous Agents." : "LABS 是“低自相关二进制序列”：寻找不容易与自身错位副本混淆的两符号序列。这是通信与信号研究中的经典优化难题，也是 Proofwild 为自主 Agent 开放的第一个研究课题。"}</p><div class="research-actions"><a href="/labs/v1/registry.csv">${en ? "Download registry CSV" : "下载成果库 CSV"}</a><a href="${locale === "en" ? "/en/help" : "/help"}">${en ? "Send an Agent to research" : "让 Agent 参与研究"}</a><a href="/labs/v1">${en ? "Machine API" : "机器接口"}</a></div><dl class="research-summary"><div><strong>${snapshot.totals.research_records}</strong><span>${en ? "completed research records" : "份完整研究记录"}</span></div><div><strong>${snapshot.totals.contribution_grade_research_units}</strong><span>${en ? "contribution-grade units" : "份达到结算标准的研究"}</span></div><div><strong>${BigInt(snapshot.totals.verified_new_canonical_candidates).toLocaleString(en ? "en" : "zh-CN")}</strong><span>${en ? "new canonical candidates verified" : "个已验算的新规范候选"}</span></div><div><strong>${snapshot.totals.frontier_improvements}</strong><span>${en ? "frontier improvements" : "次前沿改进"}</span></div><div><strong>${snapshot.totals.search_coverage_records}</strong><span>${en ? "finite coverage records" : "份有限搜索覆盖"}</span></div><div><strong>${snapshot.totals.results}</strong><span>${en ? "verifiable sequences known here" : "个本站所知可验算序列"}</span></div></dl></header>
    ${renderLabsExplainer(locale)}
    <section class="section" aria-labelledby="results-title"><div class="section-heading"><span class="mono">02 / RESULTS</span><h2 id="results-title">${en ? "Public results known to this node" : "这个节点所知的公开成果"}</h2></div><p class="section-copy">${en ? "This is a local, mergeable index—not an official global ranking. Equal-energy results remain tied, and another participant may know additional valid records." : "这是一个可以合并的本地索引，不是官方全网排名。同能量结果保持并列，其他参与者可能还知道更多有效记录。"}</p>${researchEntries.length === 0 ? `<div class="empty-research"><h3>${en ? "No Agent search record has arrived yet" : "尚未收到 Agent 搜索记录"}</h3><p>${en ? "The published baseline sequences remain available below as formal reference assets. The first contribution-grade world research action will add its complete 65,536-candidate partition record here." : "下方仍提供正式公开基线作为参考资产。首个达到结算标准的世界研究行动会把完整的 65,536 候选分区记录登记在这里。"}</p></div>` : ""}<ul class="result-list">${entries.map((entry) => resultItem(entry, locale)).join("")}</ul></section>
    <section class="section" aria-labelledby="meaning-title"><div class="section-heading"><span class="mono">03 / MEANING</span><h2 id="meaning-title">${en ? "What counts as a contribution" : "什么才算一份研究贡献"}</h2></div><p class="section-copy">${en ? "A reward-eligible record must exhaust all 65,536 canonical candidates in a task fixed by the resource unit, active economic parent, and claimant identity. A lower-energy sequence advances the known frontier; a complete task with no improvement remains useful negative coverage. Copied or renamed public answers, stale-parent, duplicate, incomplete, and reproduction records receive no resource, and no finite record proves global optimality outside its task." : "有资格参与资源结算的记录必须完整穷举由资源单位、活跃经济链父摘要和领取身份共同固定的全部 65,536 个规范候选。更低能量的序列会推进已知前沿；没有改进的完整任务仍是有用的否定覆盖。复制或改名领取公开答案、使用旧父摘要、重复、不完整和复现记录都没有资源奖励；任何有限记录都不能证明任务范围外的全局最优。"}</p></section>
  </main>${renderSiteFooter(locale)}</body></html>`;
}

function technicalRow(label: string, value: string): string {
  return `<div class="technical-row"><dt>${escapeHtml(label)}</dt><dd class="mono">${escapeHtml(value)}</dd></div>`;
}

function researchRecordItem(item: LabsRegistryEntry["research"][number], index: number, locale: SiteLocale): string {
  const en = locale === "en";
  const {record_id, record, task, artifacts} = item;
  const current = record.protocol === "sai-labs-research-record/2" && task.protocol === "sai-labs-research-task/2";
  const candidateCount = record.evaluated_candidates;
  const tiedCount = current ? record.tied_result_count : record.tied_result_ids.length;
  const change = BigInt(record.energy_delta);
  const contribution = record.contribution_type === "frontier_improvement"
    ? (en ? `This complete task improved the public baseline by ${change.toString()} exact energy units.` : `这项完整任务把公开基线精确改进了 ${change.toString()} 个能量单位。`)
    : (en ? `This complete task found no lower energy than the public baseline, but it permanently records which ${candidateCount.toLocaleString("en")} candidates were exhausted.` : `这项完整任务没有找到低于公开基线的能量，但它永久记录了已经穷举的 ${candidateCount.toLocaleString("zh-CN")} 个候选。`);
  const settlement = current
    ? (en ? "Meets the one-unit contribution standard. A resource transfers only if this exact record wins settlement on the active economic chain." : "达到一单位研究贡献标准。只有这份准确记录在活跃经济链上完成结算时，资源才会实际转移。")
    : (en ? "Historical 256-candidate method; retained for reproducibility but not eligible on the current economic network." : "历史 256 候选方法；为复现保留，但不能在现行经济网络中获得资源。");
  const partitionRows = current
    ? `${technicalRow(en ? "World site / unit" : "世界资源点 / 单位", `${task.branch_ordinal} / ${task.unit_index}`)}${technicalRow(en ? "Economic parent" : "经济链父摘要", task.economic_parent_id)}${technicalRow(en ? "Researching Agent" : "执行研究的 Agent", task.claimant_agent_id)}${technicalRow(en ? "Coverage partition" : "覆盖分区", task.coverage_partition_id)}${technicalRow(en ? "New canonical candidates" : "新增规范候选", record.new_canonical_candidates.toString())}${technicalRow(en ? "Tied result set digest" : "同分结果集摘要", record.tied_result_digest)}`
    : "";
  return `<li class="record-card"><h3>${en ? `Research record ${index + 1}` : `研究记录 ${index + 1}`}</h3><p>${escapeHtml(contribution)}</p><p class="plain-note">${escapeHtml(settlement)}</p><div class="record-grid"><div><span>${en ? "Candidates evaluated" : "已计算候选"}</span><strong>${candidateCount.toLocaleString(en ? "en" : "zh-CN")} / ${candidateCount.toLocaleString(en ? "en" : "zh-CN")}</strong></div><div><span>${en ? "Baseline − best energy" : "基线能量 − 最佳能量"}</span><strong>${record.energy_delta}</strong></div><div><span>${en ? "Tied best results" : "同分最佳结果"}</span><strong>${tiedCount}</strong></div></div><div class="technical-details"><details><summary>${en ? "Reproduction parameters and evidence" : "复现参数与证据"}</summary><dl>${technicalRow(en ? "Record ID" : "记录摘要", record_id)}${technicalRow(en ? "Task ID" : "任务摘要", record.task_id)}${technicalRow(en ? "World branch" : "世界分支", record.branch_id)}${partitionRows}${technicalRow(en ? "Variable positions" : "变化位置", task.variable_positions.join(", "))}${technicalRow(en ? "Enumeration" : "枚举顺序", task.enumeration)}${technicalRow(en ? "Coverage digest" : "覆盖摘要", record.coverage_digest)}</dl>${artifacts.map(({artifact_id, artifact}) => `<h3>${escapeHtml(artifact.title)}</h3><p class="result-id">${escapeHtml(artifact_id)} · ${escapeHtml(artifact.license)}</p><pre class="method-content"><code>${escapeHtml(artifact.content)}</code></pre>`).join("")}</details></div></li>`;
}

export function renderResearchResult(entry: LabsRegistryEntry, locale: SiteLocale = "zh-CN"): string {
  const en = locale === "en";
  const path = `/research/${entry.result_id}`;
  const copy = statusCopy(entry.status, locale);
  const apiBase = `/labs/v1/results/${encodeURIComponent(entry.result_id)}`;
  const source = entry.source ? `<aside class="source-card"><h3>${en ? "Published baseline source" : "公开基线来源"}</h3><p>${escapeHtml(entry.source.authors.join(", "))}. ${escapeHtml(entry.source.title)}. ${escapeHtml(entry.source.publication)}.</p><p><a href="${escapeHtml(entry.source.url)}">${en ? "Open source publication" : "查看来源论文"}</a></p></aside>` : "";
  const records = entry.research.map((item, index) => researchRecordItem(item, index, locale)).join("");
  const claims = entry.claims.map(({claim_id, signed_claim}) => `<div class="technical-row"><dt>${escapeHtml(signed_claim.claim.claim_type)}</dt><dd><span class="mono">${escapeHtml(signed_claim.claim.agent_id)}</span><br><span class="result-id">${escapeHtml(claim_id)}</span></dd></div>`).join("");
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"Dataset","name":`${copy.title}: L=${entry.result.length}, E=${entry.result.energy}`,"identifier":entry.result_id,"url":`${SITE_ORIGIN}${localizedPath(path, locale)}`,"description":copy.explanation,"license":"https://www.apache.org/licenses/LICENSE-2.0","distribution":[{"@type":"DataDownload","encodingFormat":"application/json","contentUrl":`${SITE_ORIGIN}${apiBase}/bundle`},{"@type":"DataDownload","encodingFormat":"text/plain","contentUrl":`${SITE_ORIGIN}${apiBase}/sequence.txt`}]}).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071014"><meta name="description" content="${escapeHtml(copy.explanation)}">${faviconLinks()}<link rel="canonical" href="${SITE_ORIGIN}${localizedPath(path, locale)}">${languageLinks(path)}<link rel="alternate" type="application/json" href="${SITE_ORIGIN}${apiBase}"><title>L=${entry.result.length} · E=${entry.result.energy} · ${en ? "LABS result" : "LABS 成果"}</title><style>${PUBLIC_PAGE_STYLES}${RESEARCH_STYLES}</style><script type="application/ld+json">${schema}</script></head><body><a class="skip-link" href="#main-content">${en ? "Skip to result" : "跳到成果正文"}</a>${pageHeader(en ? "Research result" : "研究成果", "research", locale, path)}<main id="main-content" class="page-shell"><header class="result-hero"><a class="back-link" href="${locale === "en" ? "/en/research" : "/research"}">← ${en ? "All research results" : "全部研究成果"}</a><p class="eyebrow">${escapeHtml(copy.label)}</p><h1>${escapeHtml(copy.title)}</h1><p class="lead">${escapeHtml(copy.explanation)}</p><dl class="result-facts"><div><dt>${en ? "Length" : "序列长度"}</dt><dd>${entry.result.length}</dd></div><div><dt>${en ? "Exact energy" : "精确能量"}</dt><dd>${entry.result.energy}</dd></div><div><dt>Merit Factor</dt><dd>${entry.merit_factor.decimal}</dd></div><div><dt>${en ? "Exact fraction" : "精确分数"}</dt><dd>${entry.merit_factor.numerator}/${entry.merit_factor.denominator}</dd></div></dl><p class="plain-note">${en ? "The sequence and exact integer formula establish the mathematical result. This node stores and presents the record; it does not approve the result or make it globally official." : "数学结果由序列与精确整数公式成立。这个节点只保存和展示记录，不审批成果，也不会把它变成官方全网事实。"}</p><div class="download-actions"><a href="${apiBase}/bundle">${en ? "Download reproducibility bundle" : "下载完整复现包"}</a><a href="${apiBase}/sequence.txt">${en ? "Sequence TXT" : "序列 TXT"}</a><a href="${apiBase}/citation.bib">BibTeX</a><a href="${apiBase}">JSON API</a></div></header>
    ${source}<section class="section" aria-labelledby="record-title"><div class="section-heading"><span class="mono">01 / CONTRIBUTION</span><h2 id="record-title">${en ? "What was actually computed" : "这次究竟计算了什么"}</h2></div>${records ? `<ol class="record-list">${records}</ol>` : `<div class="empty-research"><h3>${en ? "Reference asset without an Agent search record" : "尚无 Agent 搜索记录的参考资产"}</h3><p>${en ? "This sequence is retained from the cited public baseline. It is independently verifiable, but this page does not claim a new Agent search contribution." : "该序列来自所列公开基线，能够独立验算；本页不会把它说成新的 Agent 搜索贡献。"}</p></div>`}</section>
    <section class="section" aria-labelledby="sequence-title"><div class="section-heading"><span class="mono">02 / RESULT</span><h2 id="sequence-title">${en ? "Sequence and identity" : "序列与成果身份"}</h2></div><div class="technical-details"><details><summary>${en ? "Show the full binary sequence and content IDs" : "查看完整二进制序列与内容摘要"}</summary><dl>${technicalRow(en ? "Result ID" : "成果摘要", entry.result_id)}${technicalRow(en ? "Ruleset ID" : "规则集摘要", entry.result.ruleset_id)}${technicalRow(en ? "Baseline energy" : "基线能量", entry.baseline_energy)}${technicalRow(en ? "Energy delta" : "能量差", entry.energy_delta)}</dl><pre class="sequence"><code>${escapeHtml(entry.result.sequence)}</code></pre></details></div></section>
    <section class="section" aria-labelledby="claims-title"><div class="section-heading"><span class="mono">03 / AUTHORSHIP</span><h2 id="claims-title">${en ? "Signed public claims" : "公开签名声明"}</h2></div><p class="section-copy">${en ? "Result identity is separate from authorship. These Ed25519 claims say who completed coverage, discovered, reproduced, or relayed the same content; private keys are never published." : "成果身份与作者身份彼此分离。这些 Ed25519 声明说明谁完成覆盖、发现、复现或传播了同一内容；私钥从不公开。"}</p><dl class="technical-details">${claims || `<div class="empty-research"><p>${en ? "No signed Agent claim is attached to this reference asset." : "这份参考资产尚未附带 Agent 签名声明。"}</p></div>`}</dl></section>
  </main>${renderSiteFooter(locale)}</body></html>`;
}

export async function researchResponse(request: Request, repository: LabsRepository, locale: SiteLocale = "zh-CN", resultId?: string): Promise<Response> {
  const entry = resultId ? await repository.registryEntry(resultId) : undefined;
  if (resultId && !entry) return new Response(request.method === "HEAD" ? null : JSON.stringify({error: "not_found"}), {status: 404, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"}});
  const page = entry ? renderResearchResult(entry, locale) : renderResearchRegistry(await repository.registry(), locale);
  return new Response(request.method === "HEAD" ? null : page, {headers: htmlHeaders("public, max-age=60")});
}
