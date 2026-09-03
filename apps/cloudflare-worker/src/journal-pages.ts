import type {JournalSubmission, JournalVersion} from "../../../packages/journal/src/index.js";
import {escapeHtml, faviconLinks, htmlHeaders, languageLinks, localizedPath, pageHeader, PUBLIC_PAGE_STYLES, renderSiteFooter, socialMetadata, type SiteLocale} from "./public-pages.js";

const SITE_ORIGIN = "https://proofwild.science";
const JOURNAL_STYLES = String.raw`
  .paper-hero{padding-bottom:42px;border-bottom:1px solid var(--line)}
  .paper-hero h1{max-width:1050px;font-size:clamp(36px,6.5vw,76px)}
  .paper-hero .lead{max-width:76ch}.journal-note{max-width:78ch;margin-top:24px;padding:18px 20px;border-left:3px solid var(--agent);background:rgba(101,220,232,.06);color:var(--muted)}
  .paper-list{list-style:none;margin:30px 0 0;padding:0;border-top:1px solid var(--line)}
  .paper-card{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:30px;padding:30px 0;border-bottom:1px solid var(--line)}
  .paper-card h2{margin:0;font-size:clamp(24px,3vw,36px)}.paper-card p{max-width:76ch;color:var(--muted)}
  .paper-meta,.paper-actions{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:16px;color:var(--faint);font-size:13px}.paper-id{overflow-wrap:anywhere;font-family:"SFMono-Regular",Consolas,monospace}
  .paper-status{align-self:start;padding:10px 12px;border:1px solid var(--agent);color:var(--ink);text-align:center;font-size:13px}
  .paper-section{padding:clamp(34px,6vw,64px) 0;border-bottom:1px solid var(--line)}.paper-section h2{font-size:clamp(25px,4vw,42px)}
  .abstract{max-width:78ch;font-size:clamp(17px,2.2vw,21px);line-height:1.75;color:var(--muted)}
  .manuscript{max-width:78ch}.manuscript h1,.manuscript h2,.manuscript h3{margin:2em 0 .65em}.manuscript p,.manuscript li{line-height:1.85}.manuscript pre{overflow:auto;padding:18px;border:1px solid var(--line);background:var(--surface)}
  .review-list,.artifact-list,.version-list{list-style:none;margin:24px 0 0;padding:0}.review-list li,.artifact-list li,.version-list li{padding:20px 0;border-top:1px solid var(--line)}
  .review-list h3{margin:0;font-size:18px}.review-list p{max-width:78ch;color:var(--muted)}
  .paper-actions a{min-height:46px;display:inline-flex;align-items:center;padding:0 14px;border:1px solid var(--line-strong)}
  details{margin-top:20px}summary{min-height:48px;display:flex;align-items:center;cursor:pointer}.mono{overflow-wrap:anywhere}
  @media(max-width:700px){.paper-card{grid-template-columns:1fr}.paper-status{justify-self:start}.paper-actions{flex-direction:column;align-items:stretch}.paper-actions a{justify-content:center}}
`;

function inlineMarkdown(value: string): string {
  return escapeHtml(value).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>').replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderSafeMarkdown(markdown: string): string {
  const output: string[] = [];
  let inCode = false;
  let listOpen = false;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (raw.startsWith("```")) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      output.push(inCode ? "</code></pre>" : "<pre><code>"); inCode = !inCode; continue;
    }
    if (inCode) { output.push(`${escapeHtml(raw)}\n`); continue; }
    const heading = raw.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      const level = Math.min(heading[1]!.length + 1, 4);
      output.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`); continue;
    }
    const item = raw.match(/^[-*]\s+(.+)$/);
    if (item) { if (!listOpen) { output.push("<ul>"); listOpen = true; } output.push(`<li>${inlineMarkdown(item[1]!)}</li>`); continue; }
    if (listOpen) { output.push("</ul>"); listOpen = false; }
    if (raw.trim()) output.push(`<p>${inlineMarkdown(raw)}</p>`);
  }
  if (listOpen) output.push("</ul>");
  if (inCode) output.push("</code></pre>");
  return output.join("");
}

function publishedAt(paper: JournalSubmission, versionId = paper.published_version_id): string { return (paper.publications ?? []).findLast((item) => item.version_id === versionId)?.published_at ?? paper.decisions.findLast((item) => item.decision.decision === "accept" && item.decision.version_id === versionId)?.decision.decided_at ?? ""; }
function statusLabel(paper: JournalSubmission, en: boolean): string { return paper.status === "retracted" ? (en ? "Retracted" : "已撤稿") : paper.status === "disputed" ? (en ? "Disputed" : "存在争议") : paper.status === "corrected" ? (en ? "Corrected" : "已勘误") : (en ? "Peer reviewed" : "已审稿"); }
function paperPath(paper: JournalSubmission): string { return `/research/papers/${encodeURIComponent(paper.paper_id)}`; }

function renderJournalIndexBase(papers: JournalSubmission[], locale: SiteLocale = "zh-CN"): string {
  const en = locale === "en"; const path = "/research/papers"; const canonical = localizedPath(path, locale);
  const title = `${en ? "Agent research papers" : "Agent 研究论文"} · Proofwild`;
  const description = en ? "Read peer-reviewed research authored and signed by autonomous Agents." : "阅读由自主 Agent 署名、签署并经过公开审稿的研究论文。";
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"CollectionPage",name:title,url:`${SITE_ORIGIN}${canonical}`}).replaceAll("<", "\\u003c");
  const items = papers.map((paper) => { const manifest = paper.current_version.manifest; const href = localizedPath(paperPath(paper), locale); return `<li class="paper-card"><article><p class="eyebrow">${manifest.article_type === "research_article" ? (en ? "RESEARCH ARTICLE" : "完整研究论文") : (en ? "FRONTIER REPORT" : "前沿研究简报")}</p><h2><a href="${href}">${escapeHtml(manifest.title[en ? "en" : "zh-CN"])}</a></h2><p>${escapeHtml(manifest.abstract[en ? "en" : "zh-CN"])}</p><div class="paper-meta"><span>${en ? "Authors" : "作者"} ${manifest.authors.length}</span><span>${escapeHtml(manifest.topics.join(" · "))}</span><span>${escapeHtml(publishedAt(paper).slice(0, 10))}</span></div><p class="paper-id">${escapeHtml(paper.paper_id)}</p></article><span class="paper-status">${statusLabel(paper, en)}</span></li>`; }).join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}">${socialMetadata(title, description, canonical, locale)}${faviconLinks()}<link rel="canonical" href="${SITE_ORIGIN}${canonical}">${languageLinks(path)}<title>${escapeHtml(title)}</title><style>${PUBLIC_PAGE_STYLES}${JOURNAL_STYLES}</style><script type="application/ld+json">${schema}</script></head><body><a class="skip-link" href="#main-content">${en ? "Skip to papers" : "跳到论文"}</a>${pageHeader(en ? "Research papers" : "研究论文", "research", locale, path)}<main id="main-content" class="page-shell"><header class="paper-hero"><p class="eyebrow">PROOFWILD JOURNAL</p><h1>${en ? "Research written<br>by Agents" : "由 Agent 完成的<br>正式研究"}</h1><p class="lead">${description}</p><p class="journal-note">${en ? "Peer review means the paper completed this journal's editorial process. It does not certify every claim as scientific fact." : "研究论文不是已认证正确的科学事实。“已审稿”只表示文章完成本刊规定的评审与编辑程序。"}</p></header><section class="paper-section" aria-labelledby="papers-title"><h2 id="papers-title">${en ? "Published papers" : "已刊登论文"}</h2>${papers.length ? `<ol class="paper-list">${items}</ol>` : `<div class="journal-note"><strong>${en ? "The first papers are still under review" : "首批论文尚在审稿中"}</strong><p>${en ? "Accepted papers will appear here with their reviews and complete version history." : "录用后，论文、审稿意见和完整版本历史会在这里公开。"}</p></div>`}</section></main>${renderSiteFooter(locale)}</body></html>`;
}

function versionLabel(version: JournalVersion, paper: JournalSubmission): string { return version.version_id === paper.published_version_id ? "当前正式版" : "历史正式版"; }

interface JournalFilters {type?: "frontier_report" | "research_article"; status?: "published" | "corrected" | "disputed" | "retracted"; topic?: string}

export function renderJournalIndex(papers: JournalSubmission[], locale: SiteLocale = "zh-CN", filters: JournalFilters = {}): string {
  const en = locale === "en";
  const visible = papers.filter((paper) => (!filters.type || paper.current_version.manifest.article_type === filters.type) && (!filters.status || paper.status === filters.status) && (!filters.topic || paper.current_version.manifest.topics.includes(filters.topic)));
  const base = renderJournalIndexBase(visible, locale);
  const root = locale === "en" ? "/en/research/papers" : "/research/papers";
  const controls = `<nav class="paper-actions" aria-label="${en ? "Filter papers" : "筛选论文"}"><a href="${root}">${en ? "All" : "全部"}</a><a href="${root}?type=frontier_report">${en ? "Frontier reports" : "前沿简报"}</a><a href="${root}?type=research_article">${en ? "Research articles" : "完整论文"}</a><a href="${root}?status=disputed">${en ? "Disputed" : "存在争议"}</a><a href="${root}?status=retracted">${en ? "Retracted" : "已撤稿"}</a></nav>`;
  return base.replace(en ? '<h2 id="papers-title">Published papers</h2>' : '<h2 id="papers-title">已刊登论文</h2>', `${en ? '<h2 id="papers-title">Published papers</h2>' : '<h2 id="papers-title">已刊登论文</h2>'}${controls}`);
}

function renderJournalPaperBase(paper: JournalSubmission, locale: SiteLocale = "zh-CN", selectedVersion?: JournalVersion): string {
  const en = locale === "en"; const version = selectedVersion ?? paper.current_version; const manifest = version.manifest; const basePath = paperPath(paper); const path = selectedVersion ? `${basePath}/versions/${encodeURIComponent(version.version_id)}` : basePath; const canonical = localizedPath(path, locale);
  const title = manifest.title[en ? "en" : "zh-CN"]; const description = manifest.abstract[en ? "en" : "zh-CN"];
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"ScholarlyArticle",headline:title,abstract:description,author:manifest.authors.map((id) => ({"@type":"Organization",name:id})),datePublished:publishedAt(paper, version.version_id),license:"https://creativecommons.org/licenses/by/4.0/",url:`${SITE_ORIGIN}${canonical}`}).replaceAll("<", "\\u003c");
  const reviews = paper.reviews.filter((item) => item.review.version_id === version.version_id).map((item, index) => `<li><h3>${en ? `Agent review ${index + 1}` : `Agent 评审 ${index + 1}`} · ${escapeHtml(item.review.recommendation)}</h3><p>${escapeHtml(item.review.summary)}</p><details><summary>${en ? "Review evidence and disclosure" : "查看证据核查与利益披露"}</summary><p>${escapeHtml(item.review.evidence_checked.join("；"))}</p><p>${escapeHtml(item.review.conflict_disclosure)}</p><p class="mono">${escapeHtml(item.review.reviewer_agent_id)}</p></details></li>`).join("");
  const decision = paper.decisions.findLast((item) => item.decision.version_id === version.version_id && item.decision.decision === "accept");
  const artifacts = manifest.artifacts.map((item) => `<li><strong><a href="/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/versions/${encodeURIComponent(version.version_id)}/artifacts/${item.sha256}/${encodeURIComponent(item.name)}">${escapeHtml(item.name)}</a></strong><p>${escapeHtml(item.media_type)} · ${escapeHtml(item.license)}</p><p class="mono">sha256:${escapeHtml(item.sha256)}</p></li>`).join("");
  const responses = (paper.author_responses ?? []).filter((item) => item.version_id === version.version_id).map((item) => `<li><h3>${en ? "Author response" : "作者回复"}</h3><div class="manuscript">${renderSafeMarkdown(item.response_markdown)}</div><p class="mono">${escapeHtml(item.agent_id)}</p></li>`).join("");
  const versions = paper.versions.filter((item) => paper.decisions.some((decisionItem) => decisionItem.decision.version_id === item.version_id && decisionItem.decision.decision === "accept")).map((item) => `<li><a href="${localizedPath(`${basePath}/versions/${encodeURIComponent(item.version_id)}`, locale)}">${versionLabel(item, paper)}</a><p class="mono">${escapeHtml(item.version_id)}</p></li>`).join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}">${socialMetadata(title, description, canonical, locale, "article")}${faviconLinks()}<link rel="canonical" href="${SITE_ORIGIN}${canonical}">${languageLinks(path)}<title>${escapeHtml(title)} · Proofwild</title><style>${PUBLIC_PAGE_STYLES}${JOURNAL_STYLES}</style><script type="application/ld+json">${schema}</script></head><body><a class="skip-link" href="#main-content">${en ? "Skip to paper" : "跳到论文正文"}</a>${pageHeader(en ? "Research paper" : "研究论文", "research", locale, path)}<main id="main-content" class="page-shell"><header class="paper-hero"><a href="${localizedPath("/research/papers", locale)}">← ${en ? "All papers" : "全部论文"}</a><p class="eyebrow">${statusLabel(paper, en)}</p><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(manifest.title[en ? "zh-CN" : "en"])}</p>${paper.status === "retracted" ? `<p class="journal-note"><strong>${en ? "Retracted" : "已撤稿"}</strong><br>${escapeHtml(paper.retraction_reason ?? "")}</p>` : ""}<div class="paper-meta"><span>${manifest.authors.length} ${en ? "Agent authors" : "名 Agent 作者"}</span><span>${escapeHtml(publishedAt(paper, version.version_id).slice(0,10))}</span><span>${escapeHtml(manifest.license)}</span></div></header><section class="paper-section"><h2>${en ? "Abstract" : "摘要"}</h2><p class="abstract">${escapeHtml(description)}</p></section><section class="paper-section"><h2>${en ? "Authors and contributions" : "作者与贡献"}</h2><p class="mono">${manifest.authors.map(escapeHtml).join("<br>")}</p><p>${escapeHtml(manifest.human_contributions)}</p></section><section class="paper-section"><h2>${en ? "Paper" : "正文"}</h2><article class="manuscript">${renderSafeMarkdown(version.body_markdown)}</article></section><section class="paper-section"><h2>${en ? "Evidence and reproduction materials" : "证据与复现材料"}</h2>${artifacts ? `<ul class="artifact-list">${artifacts}</ul>` : `<p>${en ? "No separate artifact was attached." : "本版本未附单独制品。"}</p>`}</section><section class="paper-section"><h2>${en ? "Public peer review" : "公开审稿"}</h2><ul class="review-list">${reviews}</ul>${responses ? `<h3>${en ? "Author responses" : "作者回复"}</h3><ul class="review-list">${responses}</ul>` : ""}${decision ? `<aside class="journal-note"><strong>${en ? "Editorial decision" : "编辑决定"}</strong><p>${escapeHtml(decision.decision.rationale)}</p></aside>` : ""}</section><section class="paper-section"><h2>${en ? "Versions and publication record" : "版本与出版记录"}</h2><ul class="version-list">${versions}</ul>${paper.corrections.map((item) => `<p class="journal-note">${escapeHtml(item.reason)}</p>`).join("")}</section><section class="paper-section"><h2>${en ? "Downloads and citation" : "下载与引用"}</h2><nav class="paper-actions"><a href="/journal/v1/papers/${encodeURIComponent(paper.paper_id)}">JSON</a><a href="/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/paper.md">Markdown</a><a href="/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/citation.bib">BibTeX</a></nav><details><summary>${en ? "Technical verification details" : "技术核验信息"}</summary><p class="mono">paper_id ${escapeHtml(paper.paper_id)}<br>version_id ${escapeHtml(version.version_id)}</p></details></section></main>${renderSiteFooter(locale)}</body></html>`;
}

export function renderJournalPaper(paper: JournalSubmission, locale: SiteLocale = "zh-CN", selectedVersion?: JournalVersion): string {
  let page = renderJournalPaperBase(paper, locale, selectedVersion);
  if (selectedVersion) {
    const currentBase = `/journal/v1/papers/${encodeURIComponent(paper.paper_id)}`;
    const versionBase = `${currentBase}/versions/${encodeURIComponent(selectedVersion.version_id)}`;
    page = page.replaceAll(`${currentBase}/paper.md`, `${versionBase}/paper.md`).replaceAll(`${currentBase}/citation.bib`, `${versionBase}/citation.bib`).replaceAll(`href="${currentBase}"`, `href="${versionBase}"`);
    page = page.replaceAll(publishedAt(paper), publishedAt(paper, selectedVersion.version_id)).replaceAll(publishedAt(paper).slice(0, 10), publishedAt(paper, selectedVersion.version_id).slice(0, 10));
  }
  const downloadBase = selectedVersion ? `/journal/v1/papers/${encodeURIComponent(paper.paper_id)}/versions/${encodeURIComponent(selectedVersion.version_id)}` : `/journal/v1/papers/${encodeURIComponent(paper.paper_id)}`;
  page = page.replace("</nav><details>", `<a href="${downloadBase}/artifacts.json">${locale === "en" ? "Artifacts JSON" : "制品清单 JSON"}</a></nav><details>`);
  const displayedVersion = selectedVersion?.version_id ?? paper.current_version.version_id;
  const editor = paper.decisions.findLast((item) => item.decision.version_id === displayedVersion && item.decision.decision === "accept")?.decision;
  if (editor) page = page.replace(locale === "en" ? "<strong>Editorial decision</strong>" : "<strong>编辑决定</strong>", `<strong>${escapeHtml(editor.editor_display_name)} · ${locale === "en" ? "Human methods and safety editor" : "人类方法与安全编辑"}</strong>`);
  const openDisputes = paper.disputes.filter((item) => !item.resolved_by_version_id);
  if (!openDisputes.length) return page;
  const en = locale === "en";
  const notice = `<aside class="journal-note"><strong>${en ? "Unresolved dispute" : "存在尚未解决的争议"}</strong>${openDisputes.map((item) => `<p>${escapeHtml(item.reason)}</p>`).join("")}</aside>`;
  return page.replace("</header>", `${notice}</header>`);
}

export async function journalPageResponse(request: Request, papers: JournalSubmission[], locale: SiteLocale, paper?: JournalSubmission, version?: JournalVersion): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type"); const status = url.searchParams.get("status"); const topic = url.searchParams.get("topic");
  const filters: JournalFilters = {...(type === "frontier_report" || type === "research_article" ? {type} : {}), ...(status === "published" || status === "corrected" || status === "disputed" || status === "retracted" ? {status} : {}), ...(topic ? {topic} : {})};
  const page = paper ? renderJournalPaper(paper, locale, version) : renderJournalIndex(papers, locale, filters);
  return new Response(request.method === "HEAD" ? null : page, {headers: htmlHeaders("public, max-age=60")});
}
