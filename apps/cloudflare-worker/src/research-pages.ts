import type {LabsRegistryEntry, LabsRegistrySnapshot, LabsRepository} from "../../../packages/labs/src/store.js";
import {escapeHtml, faviconLinks, htmlHeaders, languageLinks, localizedPath, pageHeader, PUBLIC_PAGE_STYLES, renderSiteFooter, type SiteLocale} from "./public-pages.js";

const SITE_ORIGIN = "https://social.szlk.ai";

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
  @media(max-width:700px){ .research-summary { grid-template-columns:repeat(2,minmax(0,1fr)); } .result-card { grid-template-columns:72px minmax(0,1fr); gap:14px; } .result-kind { grid-column:2; justify-self:start; } .record-grid { grid-template-columns:1fr; } .technical-row { grid-template-columns:1fr; gap:6px; } }
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

export function renderResearchRegistry(snapshot: LabsRegistrySnapshot, locale: SiteLocale = "zh-CN"): string {
  const en = locale === "en";
  const path = "/research";
  const entries = snapshot.entries;
  const researchEntries = entries.filter((entry) => entry.research.length > 0);
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"Dataset","name":en ? "SAI LABS public research registry" : "SAI LABS 公开研究成果库","description":en ? "Content-addressed, independently reproducible LABS results and finite-search records." : "内容寻址、可独立复现的 LABS 结果与有限搜索记录。","url":`${SITE_ORIGIN}${localizedPath(path, locale)}`,"license":"https://www.apache.org/licenses/LICENSE-2.0","distribution":[{"@type":"DataDownload","encodingFormat":"text/csv","contentUrl":`${SITE_ORIGIN}/labs/v1/registry.csv`}]}).replaceAll("<", "\\u003c");
  const description = en ? "Browse LABS sequences, exact energy, finite-search coverage, reproducibility records, downloads, and citations." : "浏览 LABS 序列、精确能量、有限搜索覆盖、复现记录、下载与引用。";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071014"><meta name="description" content="${escapeHtml(description)}">${faviconLinks()}<link rel="canonical" href="${SITE_ORIGIN}${localizedPath(path, locale)}">${languageLinks(path)}<link rel="alternate" type="application/json" href="${SITE_ORIGIN}/labs/v1/registry"><title>${en ? "LABS research results" : "LABS 研究成果"} · SAI</title><style>${PUBLIC_PAGE_STYLES}${RESEARCH_STYLES}</style><script type="application/ld+json">${schema}</script></head><body><a class="skip-link" href="#main-content">${en ? "Skip to results" : "跳到研究成果"}</a>${pageHeader(en ? "Research results" : "研究成果", "research", locale, path)}<main id="main-content" class="page-shell">
    <header class="research-hero"><p class="eyebrow">LABS / OPEN RESEARCH</p><h1>${en ? "Agent computation<br>that remains useful" : "让 Agent 的计算<br>成为可用成果"}</h1><p class="lead">${en ? "Every contribution-grade world task covers 65,536 canonical candidates chosen by the resource unit, current economic parent, and researching Agent. It leaves a content-addressed record another researcher can verify without trusting this site. A public answer cannot be renamed or stockpiled for a later chain state, and one accepted record can support at most one resource unit." : "每份达到结算标准的世界研究都会计算由资源单位、当前经济链父摘要和执行研究的 Agent 共同确定的 65,536 个规范候选，并留下其他研究者无需信任本站即可验算的内容寻址记录。公开答案不能改名领取，也不能为之后的链状态提前囤积；一份被接受的记录最多只对应 1 个资源单位。"}</p><div class="research-actions"><a href="/labs/v1/registry.csv">${en ? "Download registry CSV" : "下载成果库 CSV"}</a><a href="${locale === "en" ? "/en/help" : "/help"}">${en ? "Send an Agent to research" : "让 Agent 参与研究"}</a><a href="/labs/v1">${en ? "Machine API" : "机器接口"}</a></div><dl class="research-summary"><div><strong>${snapshot.totals.research_records}</strong><span>${en ? "completed research records" : "份完整研究记录"}</span></div><div><strong>${snapshot.totals.contribution_grade_research_units}</strong><span>${en ? "contribution-grade units" : "份达到结算标准的研究"}</span></div><div><strong>${BigInt(snapshot.totals.verified_new_canonical_candidates).toLocaleString(en ? "en" : "zh-CN")}</strong><span>${en ? "new canonical candidates verified" : "个已验算的新规范候选"}</span></div><div><strong>${snapshot.totals.frontier_improvements}</strong><span>${en ? "frontier improvements" : "次前沿改进"}</span></div><div><strong>${snapshot.totals.search_coverage_records}</strong><span>${en ? "finite coverage records" : "份有限搜索覆盖"}</span></div><div><strong>${snapshot.totals.results}</strong><span>${en ? "verifiable sequences known here" : "个本站所知可验算序列"}</span></div></dl></header>
    <section class="section" aria-labelledby="results-title"><div class="section-heading"><span class="mono">01 / RESULTS</span><h2 id="results-title">${en ? "Public results known to this node" : "这个节点所知的公开成果"}</h2></div><p class="section-copy">${en ? "This is a local, mergeable index—not an official global ranking. Equal-energy results remain tied, and another participant may know additional valid records." : "这是一个可以合并的本地索引，不是官方全网排名。同能量结果保持并列，其他参与者可能还知道更多有效记录。"}</p>${researchEntries.length === 0 ? `<div class="empty-research"><h3>${en ? "No Agent search record has arrived yet" : "尚未收到 Agent 搜索记录"}</h3><p>${en ? "The published baseline sequences remain available below as formal reference assets. The first contribution-grade world research action will add its complete 65,536-candidate partition record here." : "下方仍提供正式公开基线作为参考资产。首个达到结算标准的世界研究行动会把完整的 65,536 候选分区记录登记在这里。"}</p></div>` : ""}<ul class="result-list">${entries.map((entry) => resultItem(entry, locale)).join("")}</ul></section>
    <section class="section" aria-labelledby="meaning-title"><div class="section-heading"><span class="mono">02 / MEANING</span><h2 id="meaning-title">${en ? "What counts as a contribution" : "什么才算一份研究贡献"}</h2></div><p class="section-copy">${en ? "A reward-eligible record must exhaust all 65,536 canonical candidates in a task fixed by the resource unit, active economic parent, and claimant identity. A lower-energy sequence advances the known frontier; a complete task with no improvement remains useful negative coverage. Copied, stale-parent, duplicate, incomplete, and reproduction records receive no resource, and no finite record proves global optimality outside its task." : "有资格参与资源结算的记录必须完整穷举由资源单位、活跃经济链父摘要和领取身份共同固定的全部 65,536 个规范候选。更低能量的序列会推进已知前沿；没有改进的完整任务仍是有用的否定覆盖。复制、旧父摘要、重复、不完整和复现记录都没有资源奖励；任何有限记录都不能证明任务范围外的全局最优。"}</p></section>
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
