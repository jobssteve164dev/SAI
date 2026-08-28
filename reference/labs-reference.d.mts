export function referenceCanonicalJson(value: unknown): string;
export function referenceContentId(value: unknown): string;
export function referenceEnergy(sequence: string): bigint;
export function referenceSymmetries(sequence: string): string[];
export function referenceCanonicalSequence(sequence: string): string;
export function referenceRulesetId(ruleset: import("../packages/labs/src/index.js").LabsRuleset): string;
export function referenceResult(ruleset: import("../packages/labs/src/index.js").LabsRuleset, sequence: string): {result: import("../packages/labs/src/index.js").LabsResult; result_id: string};
export function referenceMergeFrontiers(left: import("../packages/labs/src/index.js").LabsFrontier, right: import("../packages/labs/src/index.js").LabsFrontier): import("../packages/labs/src/index.js").LabsFrontier;
export function referenceResources(ruleset: import("../packages/labs/src/index.js").LabsRuleset, frontier: import("../packages/labs/src/index.js").LabsFrontier): {by_length: Record<string, string>; total_unlocked: string};
