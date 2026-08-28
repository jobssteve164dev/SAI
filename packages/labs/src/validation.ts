import {Ajv2020, type ValidateFunction} from "ajv/dist/2020.js";
import rulesetSchema from "../../../spec/labs/1.0.0/ruleset.schema.json" with {type: "json"};
import resultSchema from "../../../spec/labs/1.0.0/result.schema.json" with {type: "json"};
import claimSchema from "../../../spec/labs/1.0.0/claim.schema.json" with {type: "json"};
import frontierSchema from "../../../spec/labs/1.0.0/frontier.schema.json" with {type: "json"};
import type {LabsFrontier, LabsResult, LabsRuleset, LabsSignedClaim} from "./index.js";

const ajv = new Ajv2020({strict: true, formats: {uri: /^(https?):\/\/[^\s]+$/}});
const validators = {
  ruleset: ajv.compile(rulesetSchema),
  result: ajv.compile(resultSchema),
  claim: ajv.compile(claimSchema),
  frontier: ajv.compile(frontierSchema),
};

function assertWith<T>(validator: ValidateFunction, value: unknown, label: string): asserts value is T {
  if (!validator(value)) throw new TypeError(`${label} schema 无效: ${ajv.errorsText(validator.errors)}`);
}

export function assertLabsRuleset(value: unknown): asserts value is LabsRuleset { assertWith<LabsRuleset>(validators.ruleset, value, "LABS ruleset"); }
export function assertLabsResult(value: unknown): asserts value is LabsResult { assertWith<LabsResult>(validators.result, value, "LABS result"); }
export function assertLabsClaim(value: unknown): asserts value is LabsSignedClaim { assertWith<LabsSignedClaim>(validators.claim, value, "LABS claim"); }
export function assertLabsFrontier(value: unknown): asserts value is LabsFrontier { assertWith<LabsFrontier>(validators.frontier, value, "LABS frontier"); }
