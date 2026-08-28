import {describe, expect, it} from "vitest";
import {LABS_CONFORMANCE_AGENT_ID, WORLD_SUPPLY_SCHEDULE_ID, worldResourceBranch} from "../../packages/kernel/src/index.js";
import {LABS_RESEARCH_CANDIDATES_PER_UNIT, REFERENCE_RULESET, canonicalLabsSequence, createLabsResearchTask, labsResearchCandidate} from "../../packages/labs/src/index.js";
import {referenceResearchCandidate, referenceResearchTask} from "../../reference/labs-reference.mjs";

describe("LABS contribution partition exhaustiveness", () => {
  it("checks every reward-bearing candidate byte-for-byte against the independent implementation for all reference lengths", () => {
    for (const ordinal of [1, 3, 0]) {
      const branch = worldResourceBranch(ordinal).labs_branch;
      const challenge = {economic_parent_id: WORLD_SUPPLY_SCHEDULE_ID, claimant_agent_id: LABS_CONFORMANCE_AGENT_ID};
      const {task} = createLabsResearchTask(REFERENCE_RULESET, branch, challenge);
      const {task: independentTask} = referenceResearchTask(REFERENCE_RULESET, branch, challenge);
      const candidates = new Set<string>();
      for (let mask = 0; mask < task.candidate_count; mask += 1) {
        const candidate = labsResearchCandidate(task, mask);
        const independentCandidate = referenceResearchCandidate(independentTask, mask);
        if (candidate !== independentCandidate) throw new Error(`独立实现候选字节不一致：length=${task.length} mask=${mask}`);
        if (canonicalLabsSequence(candidate) !== candidate) throw new Error(`候选未规范化：length=${task.length} mask=${mask}`);
        candidates.add(candidate);
      }
      expect(candidates.size).toBe(LABS_RESEARCH_CANDIDATES_PER_UNIT);
    }
  }, 120_000);
});
