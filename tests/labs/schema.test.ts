import {Ajv2020} from "ajv/dist/2020.js";
import {describe, expect, it} from "vitest";
import rulesetSchema from "../../spec/labs/1.0.0/ruleset.schema.json" with {type: "json"};
import resultSchema from "../../spec/labs/1.0.0/result.schema.json" with {type: "json"};
import claimSchema from "../../spec/labs/1.0.0/claim.schema.json" with {type: "json"};
import frontierSchema from "../../spec/labs/1.0.0/frontier.schema.json" with {type: "json"};
import {REFERENCE_FRONTIER, REFERENCE_RESULTS, REFERENCE_RULESET, createClaimBody, signLabsClaim} from "../../packages/labs/src/index.js";
import {createIdentity} from "../../packages/identity/src/index.js";

describe("LABS JSON Schemas", () => {
  const ajv = new Ajv2020({strict: true, formats: {uri: true}});
  it("accepts reference objects and rejects malformed or expanded objects", async () => {
    const validateRuleset = ajv.compile(rulesetSchema);
    const validateResult = ajv.compile(resultSchema);
    const validateClaim = ajv.compile(claimSchema);
    const validateFrontier = ajv.compile(frontierSchema);
    const record = REFERENCE_RESULTS["451"]!;
    const identity = await createIdentity();
    const claim = signLabsClaim(createClaimBody(record.result_id, identity, "reproduction"), identity).signed_claim;
    expect(validateRuleset(REFERENCE_RULESET)).toBe(true);
    expect(validateResult(record.result)).toBe(true);
    expect(validateClaim(claim)).toBe(true);
    expect(validateFrontier(REFERENCE_FRONTIER)).toBe(true);
    expect(validateResult({...record.result, energy: 12625})).toBe(false);
    expect(validateResult({...record.result, server_sequence: 1})).toBe(false);
    expect(validateClaim({...claim, signature: `${claim.signature.slice(1)}!`})).toBe(false);
    expect(validateFrontier({...REFERENCE_FRONTIER, received_at: "now"})).toBe(false);
  });
});
