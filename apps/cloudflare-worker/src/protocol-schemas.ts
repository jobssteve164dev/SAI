import claimSchema from "../../../spec/labs/1.0.0/claim.schema.json" with {type: "json"};
import frontierSchema from "../../../spec/labs/1.0.0/frontier.schema.json" with {type: "json"};
import resultSchema from "../../../spec/labs/1.0.0/result.schema.json" with {type: "json"};
import rulesetSchema from "../../../spec/labs/2.0.0/ruleset.schema.json" with {type: "json"};
import worldBranchSchema from "../../../spec/labs/4.0.0/world-branch.schema.json" with {type: "json"};
import artifactSchema from "../../../spec/labs/5.0.0/artifact.schema.json" with {type: "json"};
import researchTaskSchema from "../../../spec/labs/5.0.0/research-task.schema.json" with {type: "json"};
import researchRecordSchema from "../../../spec/labs/5.0.0/research-record.schema.json" with {type: "json"};
import supplyBlockSchema from "../../../spec/sai/0.4.0/world-supply-block.schema.json" with {type: "json"};
import supplyScheduleSchema from "../../../spec/sai/0.4.0/world-supply-schedule.schema.json" with {type: "json"};
import supplyStateSchema from "../../../spec/sai/0.4.0/world-supply-state.schema.json" with {type: "json"};

const PROTOCOL_SCHEMAS: Record<string, unknown> = {
  "/spec/labs/1.0.0/result.schema.json": resultSchema,
  "/spec/labs/1.0.0/claim.schema.json": claimSchema,
  "/spec/labs/1.0.0/frontier.schema.json": frontierSchema,
  "/spec/labs/2.0.0/ruleset.schema.json": rulesetSchema,
  "/spec/labs/4.0.0/world-branch.schema.json": worldBranchSchema,
  "/spec/labs/5.0.0/artifact.schema.json": artifactSchema,
  "/spec/labs/5.0.0/research-task.schema.json": researchTaskSchema,
  "/spec/labs/5.0.0/research-record.schema.json": researchRecordSchema,
  "/spec/sai/0.4.0/world-supply-schedule.schema.json": supplyScheduleSchema,
  "/spec/sai/0.4.0/world-supply-block.schema.json": supplyBlockSchema,
  "/spec/sai/0.4.0/world-supply-state.schema.json": supplyStateSchema,
};

export const PROTOCOL_SCHEMA_PATHS = Object.freeze(Object.keys(PROTOCOL_SCHEMAS));

export function protocolSchemaResponse(pathname: string, method = "GET"): Response | undefined {
  const schema = PROTOCOL_SCHEMAS[pathname];
  if (!schema) return undefined;
  if (method !== "GET" && method !== "HEAD") return new Response(JSON.stringify({error: "method_not_allowed"}), {status: 405, headers: {allow: "GET, HEAD", "content-type": "application/json; charset=utf-8"}});
  return new Response(method === "HEAD" ? null : JSON.stringify(schema), {headers: {
    "content-type": "application/schema+json; charset=utf-8",
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  }});
}
