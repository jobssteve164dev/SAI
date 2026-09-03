import {Ajv2020} from "ajv/dist/2020.js";
import {describe, expect, it} from "vitest";
import manifestSchema from "../../spec/journal/1.0.0/manifest.schema.json" with {type: "json"};
import versionSchema from "../../spec/journal/1.0.0/version.schema.json" with {type: "json"};
import reviewSchema from "../../spec/journal/1.0.0/signed-review.schema.json" with {type: "json"};
import statementSchema from "../../spec/journal/1.0.0/signed-statement.schema.json" with {type: "json"};
import {createIdentity} from "../../packages/identity/src/index.js";
import {createJournalReview, createJournalStatement, createJournalVersion, signJournalReview, signJournalStatement} from "../../packages/journal/src/index.js";
import {manuscript} from "./journal.test.js";

describe("期刊出版协议 Schema", () => {
  it("公开 Schema 接受正式 npm 包生成的清单与版本", async () => {
    const created = createJournalVersion(manuscript([await createIdentity()]));
    const ajv = new Ajv2020({strict: true, strictRequired: false, validateFormats: false});
    ajv.addSchema(manifestSchema);
    expect(ajv.validate(manifestSchema, created.version.manifest), ajv.errorsText()).toBe(true);
    expect(ajv.validate(versionSchema, created.version), ajv.errorsText()).toBe(true);
  });
  it("严格校验签名评审与公共审稿声明", async () => {
    const reviewer = await createIdentity(); const paperId = `sha256:${"a".repeat(64)}`; const versionId = `sha256:${"b".repeat(64)}`;
    const review = signJournalReview(createJournalReview({paper_id: paperId, version_id: versionId, reviewer_agent_id: reviewer.agentId, recommendation: "accept", summary: "证据充分", strengths: ["可复现"], concerns: ["范围有限"], evidence_checked: ["结果"], conflict_disclosure: "无", created_at: "2026-09-03T10:00:00.000Z"}), reviewer);
    const statement = signJournalStatement(createJournalStatement({paper_id: paperId, version_id: versionId, agent_id: reviewer.agentId, kind: "discussion", content: "已逐项核查复现证据。", created_at: "2026-09-03T11:00:00.000Z"}), reviewer);
    const ajv = new Ajv2020({strict: true, strictRequired: false, validateFormats: false});
    expect(ajv.validate(reviewSchema, review), ajv.errorsText()).toBe(true); expect(ajv.validate(statementSchema, statement), ajv.errorsText()).toBe(true);
    expect(ajv.validate(reviewSchema, {...review, review: {...review.review, unexpected: true}})).toBe(false);
  });
});
