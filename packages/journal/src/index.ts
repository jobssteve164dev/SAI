import {createHash, createPrivateKey, createPublicKey, sign, verify, type JsonWebKey} from "node:crypto";
import {agentIdFromJwk, type AgentIdentity} from "../../identity/src/index.js";

export interface JournalManifest {
  protocol: "proofwild-journal-manifest/1";
  article_type: "frontier_report" | "research_article";
  locale: "zh-CN" | "en";
  title: {"zh-CN": string; en: string};
  abstract: {"zh-CN": string; en: string};
  topics: string[];
  authors: string[];
  corresponding_agent_id: string;
  human_contributions: string;
  models: string[];
  tools: string[];
  data_sources: string[];
  research_date: string;
  compute_budget: string;
  conflicts: string;
  license: "CC-BY-4.0";
  references: Array<{title: string; url?: string; doi?: string; arxiv_id?: string}>;
  artifacts: Array<{name: string; media_type: string; sha256: string; license: string}>;
}

export interface JournalManuscriptInput {manifest: JournalManifest; body_markdown: string}
export interface JournalVersion extends JournalManuscriptInput {protocol: "proofwild-journal-version/1"; version_id: string}
export interface JournalAuthorSignature {protocol: "proofwild-journal-author-signature/1"; agent_id: string; public_jwk: JsonWebKey; version_id: string; signature: string}
export interface JournalReviewBody {paper_id: string; version_id: string; reviewer_agent_id: string; recommendation: "accept" | "revise" | "reject"; summary: string; strengths: string[]; concerns: string[]; evidence_checked: string[]; conflict_disclosure: string; created_at: string}
export interface JournalSignedReview {protocol: "proofwild-journal-signed-review/1"; review: JournalReviewBody & {protocol: "proofwild-journal-review/1"}; review_id: string; public_jwk: JsonWebKey; signature: string}
export interface JournalStatementBody {paper_id: string; version_id: string; agent_id: string; kind: "discussion" | "dispute" | "retract"; content: string; created_at: string}
export interface JournalSignedStatement {protocol: "proofwild-journal-signed-statement/1"; statement: JournalStatementBody & {protocol: "proofwild-journal-statement/1"}; statement_id: string; public_jwk: JsonWebKey; signature: string}
export interface JournalDecisionBody {paper_id: string; version_id: string; editor_id: string; editor_role?: "human_method_safety_editor"; editor_display_name?: string; decision: "accept" | "revise" | "reject"; rationale: string; review_ids: string[]; decided_at: string}
export type JournalDecisionRecord = Omit<JournalDecisionBody, "editor_role" | "editor_display_name"> & {editor_role: "human_method_safety_editor"; editor_display_name: string};
export interface JournalSignedDecision {protocol: "proofwild-journal-signed-decision/1"; decision: JournalDecisionRecord & {protocol: "proofwild-journal-decision/1"}; decision_id: string; public_jwk: JsonWebKey; signature: string}
export interface JournalArtifact {name: string; media_type: string; sha256: string; content_base64: string}
export interface JournalAuthorResponse {paper_id: string; version_id: string; agent_id: string; review_ids: string[]; response_markdown: string; created_at: string}
export type JournalStatus = "awaiting_signatures" | "submitted" | "formal_check" | "under_review" | "publication_eligible" | "revision_requested" | "accepted" | "rejected" | "withdrawn" | "published" | "corrected" | "disputed" | "retracted";
export interface JournalCorrection {from_version_id: string; to_version_id: string; reason: string}
export interface JournalDispute {version_id: string; editor_id: string; reason: string; raised_at: string; resolved_by_version_id?: string}
export interface JournalReviewerAssignment {version_id: string; reviewer_agent_ids: string[]}
export interface JournalPublication {version_id: string; published_at: string}
export interface JournalEditorProfile {agent_id: string; role: "human_method_safety_editor"; display_name: string}
export interface JournalReviewContext {world_fork_id: string; event_seq: number}
export interface JournalCommunityReview {
  currentContext(): Promise<JournalReviewContext>;
  reviewerEligible(agentId: string, context: JournalReviewContext): Promise<boolean>;
}
export interface JournalSubmission {paper_id: string; status: JournalStatus; publication_status?: "published" | "corrected" | "disputed" | "retracted"; current_version: JournalVersion; versions: JournalVersion[]; author_signatures: JournalAuthorSignature[]; reviewer_assignments: JournalReviewerAssignment[]; reviews: JournalSignedReview[]; statements?: JournalSignedStatement[]; author_responses: JournalAuthorResponse[]; decisions: JournalSignedDecision[]; publications: JournalPublication[]; corrections: JournalCorrection[]; disputes: JournalDispute[]; review_context?: JournalReviewContext; review_contexts?: Record<string, JournalReviewContext>; accept_review_ids?: string[]; published_version_ids?: string[]; published_version_id?: string; accepted_version_id?: string; revision_of_version_id?: string; revision_reason?: string; revision_kind?: "revision" | "correction"; retraction_reason?: string; retracted_at?: string; retraction_kind?: "author_withdrawal" | "community_retraction"}

export interface JournalPersistence {
  get(paperId: string): Promise<JournalSubmission | undefined>;
  put(submission: JournalSubmission): Promise<void>;
  list(): Promise<JournalSubmission[]>;
  getArtifact(versionId: string, sha256: string): Promise<JournalArtifact | undefined>;
  putWithArtifacts(submission: JournalSubmission, artifacts: JournalArtifact[]): Promise<void>;
}

export class JournalAccessError extends Error {}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("期刊对象包含无效数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("期刊对象包含不能序列化的值");
}

function contentId(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function clone<T>(value: T): T { return structuredClone(value); }

function signaturePayload(kind: "author" | "review" | "decision" | "statement", id: string): Buffer {
  return Buffer.from(canonicalJson({protocol: `proofwild-journal-${kind}-signature-payload/1`, id}));
}

function signId(kind: "author" | "review" | "decision" | "statement", id: string, identity: AgentIdentity): string {
  return sign(null, signaturePayload(kind, id), createPrivateKey({key: identity.privateJwk, format: "jwk"})).toString("base64url");
}

function verifyId(kind: "author" | "review" | "decision" | "statement", id: string, signature: string, publicJwk: JsonWebKey): boolean {
  return verify(null, signaturePayload(kind, id), createPublicKey({key: publicJwk, format: "jwk"}), Buffer.from(signature, "base64url"));
}

const AGENT_ID = /^agent:ed25519-v1:[A-Za-z0-9_-]{43}$/;
const CONTENT_ID = /^sha256:[0-9a-f]{64}$/;
export const REQUIRED_ZH_HEADINGS = ["研究问题", "核心主张", "相关工作", "方法与运行环境", "Agent 与人类贡献", "结果", "失败案例与局限", "复现说明", "安全、伦理和利益冲突", "参考文献"];
export const REQUIRED_EN_HEADINGS = ["Research question", "Core claims", "Related work", "Methods and environment", "Agent and human contributions", "Results", "Failures and limitations", "Reproduction", "Safety, ethics, and conflicts", "References"];
const SAFE_ARTIFACT_MEDIA_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "text/javascript", "text/x-python", "text/x-typescript", "application/json", "application/javascript", "image/png", "image/jpeg", "image/webp"]);

function visibleCharacters(value: string): number { return Array.from(value.replace(/\s/g, "")).length; }
function englishWords(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }

function assertText(value: unknown, label: string, minimum = 1, maximum = 10_000): asserts value is string {
  if (typeof value !== "string" || value.trim().length < minimum || value.length > maximum) throw new RangeError(`${label}长度无效`);
}

function assertExactKeys(value: object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort(); const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) throw new TypeError(`${label}字段无效`);
}
function assertPublicJwk(value: JsonWebKey): void {
  assertExactKeys(value, ["crv", "kty", "x"], "公开签名密钥");
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || typeof value.x !== "string" || !value.x) throw new TypeError("公开签名密钥无效");
}

function isNonEmptyStringList(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0); }
function isSafeReferenceUrl(value: string | undefined): boolean {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}
function isIsoTimestamp(value: string): boolean { try { return new Date(value).toISOString() === value; } catch { return false; } }
function isIsoDate(value: string): boolean { try { return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; } catch { return false; } }

function validateManifest(manifest: JournalManifest, body: string): void {
  assertExactKeys(manifest, ["protocol", "article_type", "locale", "title", "abstract", "topics", "authors", "corresponding_agent_id", "human_contributions", "models", "tools", "data_sources", "research_date", "compute_budget", "conflicts", "license", "references", "artifacts"], "稿件清单");
  assertExactKeys(manifest.title, ["zh-CN", "en"], "标题"); assertExactKeys(manifest.abstract, ["zh-CN", "en"], "摘要");
  if (manifest.protocol !== "proofwild-journal-manifest/1" || !["frontier_report", "research_article"].includes(manifest.article_type)) throw new TypeError("稿件清单协议或类型无效");
  if (manifest.locale !== "zh-CN" && manifest.locale !== "en") throw new TypeError("稿件正文语言无效");
  assertText(manifest.title["zh-CN"], "中文标题", 4, 180);
  assertText(manifest.title.en, "英文标题", 4, 240);
  const zhAbstractLength = visibleCharacters(manifest.abstract["zh-CN"]);
  const enAbstractLength = englishWords(manifest.abstract.en);
  if (zhAbstractLength < 300 || zhAbstractLength > 500 || enAbstractLength < 150 || enAbstractLength > 250) throw new RangeError("双语摘要不符合篇幅要求");
  if (!Array.isArray(manifest.authors) || manifest.authors.length === 0 || new Set(manifest.authors).size !== manifest.authors.length || manifest.authors.some((id) => !AGENT_ID.test(id))) throw new TypeError("作者列表必须包含互不重复的有效 Agent 身份");
  if (!manifest.authors.includes(manifest.corresponding_agent_id)) throw new TypeError("通讯 Agent 必须位于作者列表");
  for (const [label, values] of [["主题", manifest.topics], ["模型", manifest.models], ["工具", manifest.tools], ["数据来源", manifest.data_sources]] as const) {
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string" || !value.trim())) throw new TypeError(`${label}披露不能为空`);
  }
  assertText(manifest.human_contributions, "人类贡献披露", 2, 2_000);
  assertText(manifest.compute_budget, "计算预算", 1, 1_000);
  assertText(manifest.conflicts, "利益冲突披露", 1, 1_000);
  if (manifest.license !== "CC-BY-4.0") throw new TypeError("正文许可必须是 CC-BY-4.0");
  if (!isIsoDate(manifest.research_date)) throw new TypeError("研究日期必须是有效的 YYYY-MM-DD");
  if (!Array.isArray(manifest.references) || manifest.references.length === 0 || manifest.references.some((reference) => { const keys = Object.keys(reference); return keys.some((key) => !["title", "url", "doi", "arxiv_id"].includes(key)) || !reference.title?.trim() || !reference.url && !reference.doi && !reference.arxiv_id || !isSafeReferenceUrl(reference.url); })) throw new TypeError("每条参考文献必须提供标题和安全的稳定标识");
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length > 32 || new Set(manifest.artifacts.map((item) => item.name)).size !== manifest.artifacts.length || new Set(manifest.artifacts.map((item) => item.sha256)).size !== manifest.artifacts.length || manifest.artifacts.some((artifact) => Object.keys(artifact).some((key) => !["name", "media_type", "sha256", "license"].includes(key)) || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(artifact.name) || artifact.name.includes("//") || !SAFE_ARTIFACT_MEDIA_TYPES.has(artifact.media_type) || !/^[0-9a-f]{64}$/.test(artifact.sha256) || !artifact.license?.trim())) throw new TypeError("制品清单无效");
  assertText(body, "Markdown 正文", 1, 250_000);
  const bodySize = manifest.locale === "zh-CN" ? visibleCharacters(body) : englishWords(body);
  const [minimum, maximum] = manifest.article_type === "frontier_report" ? (manifest.locale === "zh-CN" ? [3_000, 7_000] : [1_500, 3_500]) : (manifest.locale === "zh-CN" ? [8_000, 16_000] : [4_000, 8_000]);
  if (bodySize < minimum || bodySize > maximum) throw new RangeError(`正文篇幅必须在 ${minimum}–${maximum} 之间`);
  const headings = manifest.locale === "zh-CN" ? REQUIRED_ZH_HEADINGS : REQUIRED_EN_HEADINGS;
  if (headings.some((heading) => !new RegExp(`^#{1,3}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "mi").test(body))) throw new TypeError("正文缺少必需章节");
}

function validateArtifacts(version: JournalVersion, artifacts: JournalArtifact[]): void {
  if (artifacts.length !== version.manifest.artifacts.length) throw new TypeError("必须上传清单中的全部制品且不能包含额外文件");
  let total = 0;
  for (const expected of version.manifest.artifacts) {
    const artifact = artifacts.find((item) => item.sha256 === expected.sha256 && item.name === expected.name);
    if (!artifact || artifact.media_type !== expected.media_type || !/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.content_base64)) throw new TypeError("上传制品与清单不匹配");
    const bytes = Buffer.from(artifact.content_base64, "base64");
    if (bytes.toString("base64") !== artifact.content_base64) throw new TypeError("上传制品不是规范 Base64");
    total += bytes.byteLength;
    if (bytes.byteLength > 1_048_576 || total > 4_194_304 || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new RangeError("制品大小或摘要无效");
  }
}

export class MemoryJournalPersistence implements JournalPersistence {
  private readonly submissions = new Map<string, JournalSubmission>();
  private readonly artifacts = new Map<string, JournalArtifact>();
  async get(paperId: string): Promise<JournalSubmission | undefined> { const value = this.submissions.get(paperId); return value ? clone(value) : undefined; }
  async put(submission: JournalSubmission): Promise<void> { this.submissions.set(submission.paper_id, clone(submission)); }
  async list(): Promise<JournalSubmission[]> { return [...this.submissions.values()].map(clone).sort((left, right) => left.paper_id.localeCompare(right.paper_id)); }
  async getArtifact(versionId: string, sha256: string): Promise<JournalArtifact | undefined> { const value = this.artifacts.get(`${versionId}:${sha256}`); return value ? clone(value) : undefined; }
  async putWithArtifacts(submission: JournalSubmission, artifacts: JournalArtifact[]): Promise<void> { for (const artifact of artifacts) this.artifacts.set(`${submission.current_version.version_id}:${artifact.sha256}`, clone(artifact)); this.submissions.set(submission.paper_id, clone(submission)); }
}

export class JournalRepository {
  private queue: Promise<void> = Promise.resolve();
  private readonly editorIds: Set<string>;
  private readonly editorProfiles = new Map<string, JournalEditorProfile>();
  private readonly community?: JournalCommunityReview;
  constructor(private readonly persistence: JournalPersistence, editorsOrCommunity: Array<string | JournalEditorProfile> | JournalCommunityReview = []) {
    if (!Array.isArray(editorsOrCommunity)) { this.community = editorsOrCommunity; this.editorIds = new Set(); return; }
    const editors = editorsOrCommunity;
    for (const editor of editors) {
      const profile: JournalEditorProfile = typeof editor === "string" ? {agent_id: editor, role: "human_method_safety_editor", display_name: "Proofwild 方法与安全编辑"} : clone(editor);
      if (!AGENT_ID.test(profile.agent_id) || profile.role !== "human_method_safety_editor") throw new TypeError("编辑身份配置无效");
      assertText(profile.display_name, "编辑公开名称", 2, 120);
      this.editorProfiles.set(profile.agent_id, profile);
    }
    this.editorIds = new Set(this.editorProfiles.keys());
  }
  editorProfilesPublic(): JournalEditorProfile[] { return [...this.editorProfiles.values()].map(clone); }

  private reviewContext(submission: JournalSubmission, versionId = submission.current_version.version_id): JournalReviewContext | undefined {
    return submission.review_contexts?.[versionId] ?? (versionId === submission.current_version.version_id ? submission.review_context : undefined);
  }

  private async update(paperId: string, change: (submission: JournalSubmission) => void | Promise<void>): Promise<JournalSubmission> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const submission = await this.persistence.get(paperId);
      if (!submission) throw new Error("稿件不存在");
      submission.author_responses ??= [];
      submission.publications ??= [];
      submission.statements ??= [];
      submission.accept_review_ids ??= [];
      await change(submission);
      await this.persistence.put(submission);
      return clone(submission);
    } finally { release(); }
  }

  async submit(created: {version: JournalVersion; version_id: string}, signatures: JournalAuthorSignature[], artifacts: JournalArtifact[] = []): Promise<JournalSubmission> {
    if (created.version.version_id !== created.version_id || createJournalVersion({manifest: created.version.manifest, body_markdown: created.version.body_markdown}).version_id !== created.version_id) throw new TypeError("稿件版本摘要不匹配");
    const paperId = contentId({protocol: "proofwild-journal-paper/1", initial_version_id: created.version_id});
    if (await this.persistence.get(paperId)) throw new Error("稿件已经提交");
    const unique = new Map<string, JournalAuthorSignature>();
    for (const signature of signatures) {
      const agentId = verifyJournalVersionSignature(signature, created.version_id);
      if (!created.version.manifest.authors.includes(agentId)) throw new Error("非作者不能签署稿件");
      unique.set(agentId, clone(signature));
    }
    const fullySigned = created.version.manifest.authors.every((id) => unique.has(id));
    const status: JournalStatus = fullySigned ? (this.community ? "under_review" : "submitted") : "awaiting_signatures";
    const reviewContext = this.community ? await this.community.currentContext() : undefined;
    validateArtifacts(created.version, artifacts);
    const submission: JournalSubmission = {paper_id: paperId, status, current_version: clone(created.version), versions: [clone(created.version)], author_signatures: [...unique.values()], reviewer_assignments: [], reviews: [], author_responses: [], decisions: [], publications: [], corrections: [], disputes: [], accept_review_ids: [], published_version_ids: [], ...(reviewContext ? {review_context: reviewContext, review_contexts: {[created.version_id]: reviewContext}} : {})};
    await this.persistence.putWithArtifacts(submission, artifacts);
    return clone(submission);
  }

  async addAuthorSignature(paperId: string, signature: JournalAuthorSignature): Promise<JournalSubmission> {
    return this.update(paperId, async (submission) => {
      if (submission.status !== "awaiting_signatures") throw new Error("当前状态不能增加作者签名");
      const agentId = verifyJournalVersionSignature(signature, submission.current_version.version_id);
      if (!submission.current_version.manifest.authors.includes(agentId)) throw new Error("非作者不能签署稿件");
      if (!submission.author_signatures.some((item) => item.agent_id === agentId && item.version_id === submission.current_version.version_id)) submission.author_signatures.push(clone(signature));
      if (submission.current_version.manifest.authors.every((id) => submission.author_signatures.some((item) => item.agent_id === id && item.version_id === submission.current_version.version_id))) {
        submission.status = this.community ? "under_review" : "submitted";
        if (this.community && !this.reviewContext(submission)) throw new Error("稿件缺少投稿时冻结的审稿资格上下文");
      }
    });
  }

  async addReview(paperId: string, signedReview: JournalSignedReview): Promise<JournalSubmission> {
    return this.update(paperId, async (submission) => {
      if (submission.status !== "under_review" && submission.status !== "publication_eligible") throw new Error("当前稿件不能进入审稿");
      const reviewerId = verifyJournalReview(signedReview);
      if (signedReview.review.paper_id !== paperId || signedReview.review.version_id !== submission.current_version.version_id) throw new Error("评审没有绑定当前稿件版本");
      if (submission.current_version.manifest.authors.includes(reviewerId)) throw new Error("作者不能评审自己的稿件");
      if (this.community) {
        const context = this.reviewContext(submission);
        if (!context || !await this.community.reviewerEligible(reviewerId, context)) throw new Error("审稿 Agent 必须在投稿前已加入该世界分叉并留下真实行动");
      } else {
        const assignment = submission.reviewer_assignments.find((item) => item.version_id === submission.current_version.version_id);
        if (!assignment?.reviewer_agent_ids.includes(reviewerId)) throw new Error("该 Agent 未获指派评审当前稿件");
      }
      if (submission.reviews.some((item) => item.review.version_id === signedReview.review.version_id && item.review.reviewer_agent_id === reviewerId)) throw new Error("同一 Agent 不能重复评审同一版本");
      submission.reviews.push(clone(signedReview));
      if (this.community) {
        const accepts = submission.reviews.filter((item) => item.review.version_id === submission.current_version.version_id && item.review.recommendation === "accept");
        submission.accept_review_ids = accepts.map((item) => item.review_id);
        if (new Set(accepts.map((item) => item.review.reviewer_agent_id)).size >= 5) submission.status = "publication_eligible";
      }
    });
  }

  async addStatement(paperId: string, signedStatement: JournalSignedStatement): Promise<JournalSubmission> {
    return this.update(paperId, async (submission) => {
      const agentId = verifyJournalStatement(signedStatement);
      const statement = signedStatement.statement;
      if (statement.paper_id !== paperId) throw new Error("声明没有绑定当前稿件");
      if (submission.statements!.some((item) => item.statement_id === signedStatement.statement_id)) return;
      const isAuthor = submission.current_version.manifest.authors.includes(agentId);
      const context = this.reviewContext(submission);
      const reviewEligible = Boolean(this.community && context && await this.community.reviewerEligible(agentId, context));
      if (statement.kind === "discussion") {
        if (statement.version_id !== submission.current_version.version_id) throw new Error("审稿讨论没有绑定当前稿件版本");
        if (submission.status !== "under_review" && submission.status !== "publication_eligible") throw new Error("当前稿件不接受审稿讨论");
        if (!isAuthor && !reviewEligible) throw new Error("只有作者或投稿前已活跃的世界 Agent 可以参与审稿讨论");
      } else {
        if (!submission.published_version_id || submission.publication_status === "retracted") throw new Error("只有当前有效的正式论文可以进入刊后治理");
        if (statement.version_id !== submission.published_version_id) throw new Error("刊后声明必须绑定当前正式版本");
        const publishedVersion = submission.versions.find((version) => version.version_id === submission.published_version_id);
        if (!publishedVersion) throw new Error("当前正式版本不存在");
        const currentContext = this.community ? await this.community.currentContext() : undefined;
        const currentlyEligible = Boolean(this.community && currentContext && await this.community.reviewerEligible(agentId, currentContext));
        if (!currentlyEligible && !(statement.kind === "retract" && publishedVersion.manifest.corresponding_agent_id === agentId)) throw new Error("只有已在当前世界分叉留下行动的 Agent 可以提出刊后意见");
        if (statement.kind === "retract" && submission.statements!.some((item) => item.statement.version_id === statement.version_id && item.statement.kind === "retract" && item.statement.agent_id === agentId)) throw new Error("同一 Agent 不能重复提交撤稿意见");
      }
      submission.statements!.push(clone(signedStatement));
      if (statement.kind === "dispute") {
        if (submission.status === "published" || submission.status === "corrected" || submission.status === "disputed") submission.status = "disputed";
        submission.publication_status = "disputed";
      }
      if (statement.kind === "retract") {
        const publishedVersion = submission.versions.find((version) => version.version_id === submission.published_version_id);
        const authorWithdrawal = publishedVersion?.manifest.corresponding_agent_id === agentId;
        const retractors = new Set(submission.statements!.filter((item) => item.statement.version_id === statement.version_id && item.statement.kind === "retract").map((item) => item.statement.agent_id));
        if (authorWithdrawal || retractors.size >= 5) {
          submission.status = "retracted";
          submission.publication_status = "retracted";
          submission.retraction_kind = authorWithdrawal ? "author_withdrawal" : "community_retraction";
          submission.retraction_reason = statement.content.trim();
          submission.retracted_at = statement.created_at;
        }
      }
    });
  }

  async reviewPoolFor(agentId: string): Promise<Array<{paper_id: string; version_id: string; status: "under_review" | "publication_eligible"; title: JournalManifest["title"]; abstract: JournalManifest["abstract"]; topics: string[]; authors: string[]; acceptances: number; reviews: number}>> {
    const output: Array<{paper_id: string; version_id: string; status: "under_review" | "publication_eligible"; title: JournalManifest["title"]; abstract: JournalManifest["abstract"]; topics: string[]; authors: string[]; acceptances: number; reviews: number}> = [];
    for (const submission of await this.persistence.list()) {
      if (submission.status !== "under_review" && submission.status !== "publication_eligible") continue;
      const isAuthor = submission.current_version.manifest.authors.includes(agentId);
      const context = this.reviewContext(submission);
      if (!isAuthor && (!this.community || !context || !await this.community.reviewerEligible(agentId, context))) continue;
      const currentReviews = submission.reviews.filter((item) => item.review.version_id === submission.current_version.version_id);
      output.push({paper_id: submission.paper_id, version_id: submission.current_version.version_id, status: submission.status, title: clone(submission.current_version.manifest.title), abstract: clone(submission.current_version.manifest.abstract), topics: clone(submission.current_version.manifest.topics), authors: clone(submission.current_version.manifest.authors), acceptances: new Set(currentReviews.filter((item) => item.review.recommendation === "accept").map((item) => item.review.reviewer_agent_id)).size, reviews: currentReviews.length});
    }
    return output.sort((left, right) => left.paper_id.localeCompare(right.paper_id));
  }

  async assignReviewers(paperId: string, editorId: string, reviewerAgentIds: string[]): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
      if (submission.status !== "formal_check" && submission.status !== "under_review") throw new Error("当前稿件不能指派审稿人");
      const unique = [...new Set(reviewerAgentIds)];
      if (unique.length < 2 || unique.some((id) => !AGENT_ID.test(id) || submission.current_version.manifest.authors.includes(id))) throw new TypeError("必须指派至少两名非作者 Agent 评审");
      const existing = submission.reviewer_assignments.find((item) => item.version_id === submission.current_version.version_id);
      if (existing) existing.reviewer_agent_ids = unique;
      else submission.reviewer_assignments.push({version_id: submission.current_version.version_id, reviewer_agent_ids: unique});
      submission.status = "under_review";
    });
  }

  async startFormalCheck(paperId: string, editorId: string): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
      if (submission.status !== "submitted") throw new Error("当前稿件不能进入形式检查");
      submission.status = "formal_check";
    });
  }

  async addAuthorResponse(paperId: string, agentId: string, response: Omit<JournalAuthorResponse, "paper_id" | "version_id" | "agent_id">): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (!submission.current_version.manifest.authors.includes(agentId)) throw new Error("只有作者可以回复审稿");
      if (submission.status !== "under_review") throw new Error("当前稿件不能回复审稿");
      assertText(response.response_markdown, "作者回复", 4, 50_000);
      if (!isIsoTimestamp(response.created_at)) throw new TypeError("作者回复时间无效");
      const currentIds = new Set(submission.reviews.filter((item) => item.review.version_id === submission.current_version.version_id).map((item) => item.review_id));
      if (!isNonEmptyStringList(response.review_ids) || response.review_ids.some((id) => !currentIds.has(id))) throw new TypeError("作者回复必须引用当前版本的评审");
      submission.author_responses.push({paper_id: paperId, version_id: submission.current_version.version_id, agent_id: agentId, ...clone(response)});
    });
  }

  async decide(paperId: string, signedDecision: JournalSignedDecision): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (submission.status !== "under_review") throw new Error("当前稿件不能作出编辑决定");
      const editorId = verifyJournalDecision(signedDecision);
      if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
      const decision = signedDecision.decision;
      const editorProfile = this.editorProfiles.get(editorId)!;
      if (decision.editor_role !== editorProfile.role || decision.editor_display_name !== editorProfile.display_name) throw new Error("编辑决定与公开责任身份不匹配");
      if (decision.paper_id !== paperId || decision.version_id !== submission.current_version.version_id) throw new Error("编辑决定没有绑定当前稿件版本");
      const currentReviews = submission.reviews.filter((item) => item.review.version_id === decision.version_id && decision.review_ids.includes(item.review_id));
      if (new Set(currentReviews.map((item) => item.review.reviewer_agent_id)).size < 2) throw new Error("编辑决定必须引用两份独立 Agent 评审");
      if (decision.decision === "accept") {
        submission.accepted_version_id = submission.current_version.version_id;
        submission.status = "accepted";
      }
      else if (decision.decision === "revise") submission.status = "revision_requested";
      else submission.status = "rejected";
      submission.decisions.push(clone(signedDecision));
    });
  }

  async publish(paperId: string, editorId: string, publishedAt = new Date().toISOString()): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (this.community) {
        if (submission.current_version.manifest.corresponding_agent_id !== editorId) throw new Error("只有通讯 Agent 可以确认刊登");
        if (submission.status !== "publication_eligible") throw new Error("当前版本尚未取得五份独立通过意见");
      } else {
        if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
        if (submission.status !== "accepted" || submission.accepted_version_id !== submission.current_version.version_id) throw new Error("只有已录用版本可以刊登");
      }
      if (!isIsoTimestamp(publishedAt)) throw new TypeError("刊登时间无效");
      const corrected = submission.revision_kind === "correction";
      if (corrected && submission.revision_of_version_id && submission.revision_reason) submission.corrections.push({from_version_id: submission.revision_of_version_id, to_version_id: submission.current_version.version_id, reason: submission.revision_reason});
      for (const dispute of submission.disputes) if (!dispute.resolved_by_version_id) dispute.resolved_by_version_id = submission.current_version.version_id;
      submission.published_version_id = submission.current_version.version_id;
      submission.published_version_ids ??= [];
      if (!submission.published_version_ids.includes(submission.current_version.version_id)) submission.published_version_ids.push(submission.current_version.version_id);
      submission.publications.push({version_id: submission.current_version.version_id, published_at: publishedAt});
      submission.publication_status = corrected ? "corrected" : "published";
      submission.status = corrected ? "corrected" : "published";
      delete submission.accepted_version_id; delete submission.revision_of_version_id; delete submission.revision_reason; delete submission.revision_kind;
    });
  }

  async withdraw(paperId: string, agentId: string, reason: string): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (submission.current_version.manifest.corresponding_agent_id !== agentId) throw new Error("只有通讯 Agent 可以撤回稿件");
      if (submission.published_version_id || submission.status === "retracted") throw new Error("已公开稿件不能撤回");
      assertText(reason, "撤回原因", 4, 2_000);
      submission.status = "withdrawn";
    });
  }

  async retract(paperId: string, editorId: string, reason: string, retractedAt = new Date().toISOString()): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
      if (!submission.published_version_id || submission.publication_status === "retracted") throw new Error("只有已刊登稿件可以撤稿");
      assertText(reason, "撤稿原因", 4, 2_000);
      if (!isIsoTimestamp(retractedAt)) throw new TypeError("撤稿时间无效");
      submission.status = "retracted";
      submission.publication_status = "retracted";
      submission.retraction_reason = reason.trim();
      submission.retracted_at = retractedAt;
    });
  }

  async markDisputed(paperId: string, editorId: string, reason: string, raisedAt = new Date().toISOString()): Promise<JournalSubmission> {
    return this.update(paperId, (submission) => {
      if (!this.editorIds.has(editorId)) throw new Error("该身份没有编辑权限");
      if (!submission.published_version_id || submission.publication_status === "retracted") throw new Error("只有当前有效的正式论文可以标记争议");
      assertText(reason, "争议说明", 4, 2_000);
      if (!isIsoTimestamp(raisedAt)) throw new TypeError("争议时间无效");
      submission.disputes.push({version_id: submission.published_version_id!, editor_id: editorId, reason: reason.trim(), raised_at: raisedAt});
      submission.publication_status = "disputed";
      if (submission.status === "published" || submission.status === "corrected") submission.status = "disputed";
    });
  }

  async revise(paperId: string, created: {version: JournalVersion; version_id: string}, signatures: JournalAuthorSignature[], agentId: string, reason: string, kind: "revision" | "correction" = "revision", artifacts: JournalArtifact[] = []): Promise<JournalSubmission> {
    validateArtifacts(created.version, artifacts);
    const previous = this.queue; let release!: () => void; this.queue = new Promise<void>((resolve) => { release = resolve; }); await previous;
    try {
      const submission = await this.persistence.get(paperId); if (!submission) throw new Error("稿件不存在"); submission.author_responses ??= []; submission.publications ??= [];
      const canRevise = submission.status === "revision_requested" || submission.status === "rejected" || submission.status === "published" || submission.status === "corrected" || submission.status === "disputed" || Boolean(this.community && (submission.status === "under_review" || submission.status === "publication_eligible"));
      if (!canRevise) throw new Error("当前稿件已有在途版本或不能提交修订");
      if (submission.publication_status === "retracted") throw new Error("已撤稿论文不能提交修订");
      if (submission.current_version.manifest.corresponding_agent_id !== agentId) throw new Error("只有通讯 Agent 可以提交修订");
      if (created.version.version_id !== created.version_id || createJournalVersion({manifest: created.version.manifest, body_markdown: created.version.body_markdown}).version_id !== created.version_id) throw new TypeError("修订版本摘要不匹配");
      if (submission.versions.some((version) => version.version_id === created.version_id)) throw new Error("修订版本已经存在");
      assertText(reason, "修订原因", 4, 2_000);
      const unique = new Map<string, JournalAuthorSignature>();
      for (const signature of signatures) {
        const signer = verifyJournalVersionSignature(signature, created.version_id);
        if (!created.version.manifest.authors.includes(signer)) throw new Error("非作者不能签署修订稿");
        unique.set(signer, clone(signature));
      }
      submission.revision_of_version_id = submission.published_version_id ?? submission.current_version.version_id;
      submission.revision_reason = reason.trim();
      submission.revision_kind = kind;
      submission.current_version = clone(created.version);
      submission.versions.push(clone(created.version));
      submission.author_signatures.push(...unique.values());
      const fullySigned = created.version.manifest.authors.every((id) => unique.has(id));
      submission.status = fullySigned ? (this.community ? "under_review" : "submitted") : "awaiting_signatures";
      submission.accept_review_ids = [];
      if (this.community) {
        const context = await this.community.currentContext();
        submission.review_context = context;
        submission.review_contexts ??= {};
        submission.review_contexts[created.version_id] = context;
      }
      await this.persistence.putWithArtifacts(submission, artifacts);
      return clone(submission);
    } finally { release(); }
  }

  async publicPaper(paperId: string): Promise<JournalSubmission | undefined> {
    const submission = await this.persistence.get(paperId);
    if (!submission?.published_version_id) return undefined;
    const publishedVersion = submission.versions.find((version) => version.version_id === submission.published_version_id);
    if (!publishedVersion) throw new Error("公开稿件缺少已刊登版本");
    const acceptedVersionIds = new Set(submission.published_version_ids ?? submission.decisions.filter((item) => item.decision.decision === "accept").map((item) => item.decision.version_id));
    const visible = clone(submission);
    visible.current_version = clone(publishedVersion);
    visible.versions = visible.versions.filter((version) => acceptedVersionIds.has(version.version_id));
    visible.author_signatures = visible.author_signatures.filter((signature) => acceptedVersionIds.has(signature.version_id));
    visible.reviewer_assignments = [];
    visible.reviews = visible.reviews.filter((review) => acceptedVersionIds.has(review.review.version_id));
    visible.statements = (visible.statements ?? []).filter((statement) => acceptedVersionIds.has(statement.statement.version_id));
    visible.author_responses = (visible.author_responses ?? []).filter((response) => acceptedVersionIds.has(response.version_id));
    visible.decisions = visible.decisions.filter((decision) => decision.decision.decision === "accept" && acceptedVersionIds.has(decision.decision.version_id));
    visible.disputes = visible.disputes.filter((dispute) => acceptedVersionIds.has(dispute.version_id));
    visible.review_contexts = Object.fromEntries(Object.entries(visible.review_contexts ?? {}).filter(([versionId]) => acceptedVersionIds.has(versionId)));
    const publicReviewContext = visible.review_contexts[publishedVersion.version_id];
    if (publicReviewContext) visible.review_context = publicReviewContext;
    else delete visible.review_context;
    visible.accept_review_ids = visible.reviews.filter((review) => review.review.version_id === publishedVersion.version_id && review.review.recommendation === "accept").map((review) => review.review_id);
    delete visible.revision_of_version_id;
    delete visible.revision_reason;
    delete visible.revision_kind;
    const hasOpenDispute = visible.disputes.some((dispute) => !dispute.resolved_by_version_id);
    visible.status = submission.publication_status === "retracted" ? "retracted" : hasOpenDispute || submission.publication_status === "disputed" ? "disputed" : submission.publication_status === "corrected" ? "corrected" : "published";
    return visible;
  }
  async publicArtifact(paperId: string, versionId: string, sha256: string): Promise<JournalArtifact | undefined> {
    const version = await this.publicVersion(paperId, versionId);
    if (!version || !version.manifest.artifacts.some((item) => item.sha256 === sha256)) return undefined;
    return this.persistence.getArtifact(versionId, sha256);
  }
  async publicVersion(paperId: string, versionId: string): Promise<JournalVersion | undefined> {
    const submission = await this.persistence.get(paperId);
    const publishedIds = submission?.published_version_ids ?? submission?.decisions.filter((item) => item.decision.decision === "accept").map((item) => item.decision.version_id) ?? [];
    if (!submission || !publishedIds.includes(versionId)) return undefined;
    const version = submission.versions.find((item) => item.version_id === versionId);
    return version ? clone(version) : undefined;
  }
  async submissionFor(paperId: string, agentId: string): Promise<JournalSubmission | undefined> {
    const submission = await this.persistence.get(paperId);
    if (!submission) return undefined;
    const isEditor = this.editorIds.has(agentId);
    const isAuthor = submission.current_version.manifest.authors.includes(agentId);
    const isReviewer = submission.reviewer_assignments.some((assignment) => assignment.version_id === submission.current_version.version_id && assignment.reviewer_agent_ids.includes(agentId));
    const context = this.reviewContext(submission);
    const isCommunityReviewer = Boolean(this.community && context && await this.community.reviewerEligible(agentId, context));
    if (!isEditor && !isAuthor && !isReviewer && !isCommunityReviewer) throw new JournalAccessError("该身份无权查看稿件");
    const visible = clone(submission);
    if (isReviewer && !this.community && !isEditor && !isAuthor) {
      visible.versions = [clone(visible.current_version)];
      visible.author_signatures = visible.author_signatures.filter((signature) => signature.version_id === visible.current_version.version_id);
      visible.reviewer_assignments = [];
      visible.reviews = visible.reviews.filter((review) => review.review.version_id === visible.current_version.version_id && review.review.reviewer_agent_id === agentId);
      const ownReviewIds = new Set(visible.reviews.map((review) => review.review_id));
      visible.author_responses = (visible.author_responses ?? []).filter((response) => response.review_ids.some((id) => ownReviewIds.has(id)));
      visible.decisions = [];
      visible.corrections = [];
      visible.disputes = [];
      delete visible.published_version_id;
      delete visible.revision_of_version_id;
      delete visible.revision_reason;
      delete visible.retraction_reason;
    }
    return visible;
  }
  async submission(paperId: string): Promise<JournalSubmission | undefined> { const value = await this.persistence.get(paperId); return value ? clone(value) : undefined; }
  async publicPapers(): Promise<JournalSubmission[]> {
    const output: JournalSubmission[] = [];
    for (const item of await this.persistence.list()) {
      const paper = await this.publicPaper(item.paper_id);
      if (paper) output.push(paper);
    }
    return output;
  }
}

export function createJournalVersion(input: JournalManuscriptInput): {version: JournalVersion; version_id: string} {
  validateManifest(input.manifest, input.body_markdown);
  const body = {protocol: "proofwild-journal-version/1" as const, manifest: clone(input.manifest), body_markdown: input.body_markdown.replace(/\r\n?/g, "\n").trimEnd()};
  const versionId = contentId(body);
  return {version: {...body, version_id: versionId}, version_id: versionId};
}

export function signJournalVersion(versionId: string, identity: AgentIdentity): JournalAuthorSignature {
  if (!CONTENT_ID.test(versionId) || agentIdFromJwk(identity.publicJwk) !== identity.agentId) throw new TypeError("稿件版本或 Agent 身份无效");
  return {protocol: "proofwild-journal-author-signature/1", agent_id: identity.agentId, public_jwk: clone(identity.publicJwk), version_id: versionId, signature: signId("author", versionId, identity)};
}

export function verifyJournalVersionSignature(signatureValue: JournalAuthorSignature, versionId: string): string {
  if (signatureValue.protocol !== "proofwild-journal-author-signature/1" || signatureValue.version_id !== versionId) throw new TypeError("作者签名没有绑定当前稿件版本");
  assertPublicJwk(signatureValue.public_jwk);
  const agentId = agentIdFromJwk(signatureValue.public_jwk);
  if (agentId !== signatureValue.agent_id || !verifyId("author", versionId, signatureValue.signature, signatureValue.public_jwk)) throw new TypeError("作者签名无效");
  return agentId;
}

export function createJournalReview(input: JournalReviewBody): JournalReviewBody & {protocol: "proofwild-journal-review/1"} {
  assertExactKeys(input, ["paper_id", "version_id", "reviewer_agent_id", "recommendation", "summary", "strengths", "concerns", "evidence_checked", "conflict_disclosure", "created_at"], "评审");
  if (!CONTENT_ID.test(input.paper_id) || !CONTENT_ID.test(input.version_id) || !AGENT_ID.test(input.reviewer_agent_id)) throw new TypeError("评审身份或稿件版本无效");
  assertText(input.summary, "评审摘要", 4, 4_000);
  assertText(input.conflict_disclosure, "利益冲突披露", 1, 1_000);
  if (!["accept", "revise", "reject"].includes(input.recommendation) || !isNonEmptyStringList(input.strengths) || !isNonEmptyStringList(input.concerns) || !isNonEmptyStringList(input.evidence_checked)) throw new TypeError("评审内容不完整");
  if (!isIsoTimestamp(input.created_at)) throw new TypeError("评审时间无效");
  return {protocol: "proofwild-journal-review/1", ...clone(input)};
}

export function signJournalReview(review: JournalReviewBody & {protocol: "proofwild-journal-review/1"}, identity: AgentIdentity): JournalSignedReview {
  assertExactKeys(review, ["protocol", "paper_id", "version_id", "reviewer_agent_id", "recommendation", "summary", "strengths", "concerns", "evidence_checked", "conflict_disclosure", "created_at"], "评审");
  const {protocol: _protocol, ...reviewBody} = review;
  createJournalReview(reviewBody);
  if (review.reviewer_agent_id !== identity.agentId) throw new TypeError("评审身份与签名身份不匹配");
  const reviewId = contentId(review);
  return {protocol: "proofwild-journal-signed-review/1", review: clone(review), review_id: reviewId, public_jwk: clone(identity.publicJwk), signature: signId("review", reviewId, identity)};
}

export function verifyJournalReview(signedReview: JournalSignedReview): string {
  assertExactKeys(signedReview, ["protocol", "review", "review_id", "public_jwk", "signature"], "签名评审");
  assertPublicJwk(signedReview.public_jwk);
  signlessValidateReview(signedReview.review);
  const agentId = agentIdFromJwk(signedReview.public_jwk);
  const expected = contentId(signedReview.review);
  if (signedReview.protocol !== "proofwild-journal-signed-review/1" || signedReview.review_id !== expected || signedReview.review.reviewer_agent_id !== agentId || !verifyId("review", expected, signedReview.signature, signedReview.public_jwk)) throw new TypeError("评审签名无效");
  return agentId;
}

export function createJournalStatement(input: JournalStatementBody): JournalStatementBody & {protocol: "proofwild-journal-statement/1"} {
  assertExactKeys(input, ["paper_id", "version_id", "agent_id", "kind", "content", "created_at"], "期刊声明");
  if (!CONTENT_ID.test(input.paper_id) || !CONTENT_ID.test(input.version_id) || !AGENT_ID.test(input.agent_id) || !["discussion", "dispute", "retract"].includes(input.kind)) throw new TypeError("期刊声明身份、类型或版本无效");
  assertText(input.content, "期刊声明内容", 4, 10_000);
  if (!isIsoTimestamp(input.created_at)) throw new TypeError("期刊声明时间无效");
  return {protocol: "proofwild-journal-statement/1", ...clone(input), content: input.content.trim()};
}

export function signJournalStatement(statement: JournalStatementBody & {protocol: "proofwild-journal-statement/1"}, identity: AgentIdentity): JournalSignedStatement {
  assertExactKeys(statement, ["protocol", "paper_id", "version_id", "agent_id", "kind", "content", "created_at"], "期刊声明");
  const {protocol: _protocol, ...body} = statement;
  createJournalStatement(body);
  if (statement.agent_id !== identity.agentId) throw new TypeError("期刊声明身份与签名身份不匹配");
  const statementId = contentId(statement);
  return {protocol: "proofwild-journal-signed-statement/1", statement: clone(statement), statement_id: statementId, public_jwk: clone(identity.publicJwk), signature: signId("statement", statementId, identity)};
}

export function verifyJournalStatement(signedStatement: JournalSignedStatement): string {
  assertExactKeys(signedStatement, ["protocol", "statement", "statement_id", "public_jwk", "signature"], "签名期刊声明");
  assertPublicJwk(signedStatement.public_jwk);
  if (signedStatement.statement.protocol !== "proofwild-journal-statement/1") throw new TypeError("期刊声明协议无效");
  const {protocol: _protocol, ...body} = signedStatement.statement;
  createJournalStatement(body);
  const agentId = agentIdFromJwk(signedStatement.public_jwk);
  const expected = contentId(signedStatement.statement);
  if (signedStatement.protocol !== "proofwild-journal-signed-statement/1" || signedStatement.statement_id !== expected || signedStatement.statement.agent_id !== agentId || !verifyId("statement", expected, signedStatement.signature, signedStatement.public_jwk)) throw new TypeError("期刊声明签名无效");
  return agentId;
}

export function signJournalDecision(decision: JournalDecisionBody, identity: AgentIdentity): JournalSignedDecision {
  if (decision.editor_id !== identity.agentId || !CONTENT_ID.test(decision.paper_id) || !CONTENT_ID.test(decision.version_id) || !["accept", "revise", "reject"].includes(decision.decision)) throw new TypeError("编辑决定内容无效");
  assertText(decision.rationale, "编辑决定理由", 4, 4_000);
  const body = {protocol: "proofwild-journal-decision/1" as const, ...clone(decision), editor_role: decision.editor_role ?? "human_method_safety_editor" as const, editor_display_name: decision.editor_display_name ?? "Proofwild 方法与安全编辑"};
  validateDecisionRecord(body);
  const decisionId = contentId(body);
  return {protocol: "proofwild-journal-signed-decision/1", decision: body, decision_id: decisionId, public_jwk: clone(identity.publicJwk), signature: signId("decision", decisionId, identity)};
}

export function verifyJournalDecision(signedDecision: JournalSignedDecision): string {
  assertExactKeys(signedDecision, ["protocol", "decision", "decision_id", "public_jwk", "signature"], "签名编辑决定");
  assertPublicJwk(signedDecision.public_jwk);
  validateDecisionRecord(signedDecision.decision);
  const editorId = agentIdFromJwk(signedDecision.public_jwk);
  const expected = contentId(signedDecision.decision);
  if (signedDecision.protocol !== "proofwild-journal-signed-decision/1" || signedDecision.decision_id !== expected || signedDecision.decision.editor_id !== editorId || !verifyId("decision", expected, signedDecision.signature, signedDecision.public_jwk)) throw new TypeError("编辑决定签名无效");
  return editorId;
}

function signlessValidateReview(review: JournalSignedReview["review"]): void {
  if (review.protocol !== "proofwild-journal-review/1") throw new TypeError("评审协议无效");
  assertExactKeys(review, ["protocol", "paper_id", "version_id", "reviewer_agent_id", "recommendation", "summary", "strengths", "concerns", "evidence_checked", "conflict_disclosure", "created_at"], "评审");
  const {protocol: _protocol, ...body} = review;
  createJournalReview(body);
}

function validateDecisionRecord(decision: JournalDecisionRecord & {protocol: "proofwild-journal-decision/1"}): void {
  assertExactKeys(decision, ["protocol", "paper_id", "version_id", "editor_id", "editor_role", "editor_display_name", "decision", "rationale", "review_ids", "decided_at"], "编辑决定");
  if (decision.protocol !== "proofwild-journal-decision/1" || !CONTENT_ID.test(decision.paper_id) || !CONTENT_ID.test(decision.version_id) || !AGENT_ID.test(decision.editor_id) || decision.editor_role !== "human_method_safety_editor" || !["accept", "revise", "reject"].includes(decision.decision)) throw new TypeError("编辑决定内容无效");
  assertText(decision.editor_display_name, "编辑公开名称", 2, 120);
  assertText(decision.rationale, "编辑决定理由", 4, 4_000);
  if (!Array.isArray(decision.review_ids) || decision.review_ids.length < 2 || new Set(decision.review_ids).size !== decision.review_ids.length || decision.review_ids.some((id) => !CONTENT_ID.test(id))) throw new TypeError("编辑决定引用的评审无效");
  if (!isIsoTimestamp(decision.decided_at)) throw new TypeError("编辑决定时间无效");
}
