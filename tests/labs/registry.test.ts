import {describe, expect, it} from "vitest";
import {createIdentity} from "../../packages/identity/src/index.js";
import {LABS_CONFORMANCE_VECTORS, WORLD_SUPPLY_SCHEDULE_ID, worldResourceBranch} from "../../packages/kernel/src/index.js";
import {createClaimBody, executeLabsWorldResearch, REFERENCE_FORK_ID, REFERENCE_RULESET, signLabsClaim} from "../../packages/labs/src/index.js";
import {handleLabsRequest} from "../../packages/labs/src/http.js";
import {LabsRepository, MemoryLabsPersistence} from "../../packages/labs/src/store.js";

async function populatedRepository(): Promise<{repository: LabsRepository; resultId: string}> {
  const repository = await LabsRepository.open(new MemoryLabsPersistence());
  const identity = await createIdentity();
  const branch = worldResourceBranch(0).labs_branch;
  const research = executeLabsWorldResearch(REFERENCE_RULESET, branch, {economic_parent_id: WORLD_SUPPLY_SCHEDULE_ID, claimant_agent_id: identity.agentId});
  const claimType = research.record.contribution_type === "frontier_improvement" ? "discovery" : "coverage";
  const signed = signLabsClaim(createClaimBody(research.result_id, identity, claimType, [branch.branch_id, research.task_id, research.artifact_id, research.record_id]), identity);
  await repository.ingest("artifact", research.artifact, research.artifact_id, REFERENCE_FORK_ID);
  await repository.ingest("task", research.task, research.task_id, REFERENCE_FORK_ID);
  await repository.ingest("record", research.record, research.record_id, REFERENCE_FORK_ID);
  await repository.ingest("result", research.result, research.result_id, REFERENCE_FORK_ID);
  await repository.ingest("claim", signed.signed_claim, signed.claim_id, REFERENCE_FORK_ID);
  return {repository, resultId: research.result_id};
}

async function request(repository: LabsRepository, path: string): Promise<Response> {
  const response = await handleLabsRequest(new Request(`https://example.test${path}`), repository);
  if (!response) throw new Error(`LABS route ${path} was not handled`);
  return response;
}

describe("LABS public research registry", () => {
  it("indexes a completed search as a reproducible human-facing contribution", async () => {
    const {repository, resultId} = await populatedRepository();
    const registry = await repository.registry();
    const entry = registry.entries.find((candidate) => candidate.result_id === resultId)!;
    expect(entry.status).toMatch(/search_coverage|frontier_improvement/);
    expect(entry.research).toHaveLength(1);
    expect(entry.research[0]!.record.evaluated_candidates).toBe(65_536);
    expect(entry.research[0]!.task.variable_positions).toHaveLength(16);
    expect(entry.research[0]!.artifacts[0]!.artifact.artifact_type).toBe("method");
    expect(entry.claims).toHaveLength(1);
    expect(registry.totals.research_records).toBe(1);
    expect(entry.coverage_contributors).toBe(1);
    expect(entry.reproduction_claimants).toBe(0);
    expect(registry.totals.coverage_contributors).toBe(1);
    expect(registry.totals.reproduction_claimants).toBe(0);
    expect(registry.totals.contribution_grade_research_units).toBe(1);
    expect(registry.totals.verified_new_canonical_candidates).toBe("65536");
  });

  it("serves registry, reproducibility bundle, sequence, CSV, and BibTeX without authentication", async () => {
    const {repository, resultId} = await populatedRepository();
    const registry = await request(repository, "/labs/v1/registry");
    expect(registry.status).toBe(200);
    expect((await registry.json() as {authority: boolean}).authority).toBe(false);

    const detail = await request(repository, `/labs/v1/results/${resultId}`);
    expect(detail.status).toBe(200);
    expect((await detail.json() as {entry: {result_id: string}}).entry.result_id).toBe(resultId);

    const bundle = await request(repository, `/labs/v1/results/${resultId}/bundle`);
    expect(bundle.headers.get("content-disposition")).toContain("attachment");
    expect((await bundle.json() as {protocol: string}).protocol).toBe("sai-labs-reproducibility-bundle/1");

    const sequence = await request(repository, `/labs/v1/results/${resultId}/sequence.txt`);
    expect(await sequence.text()).toMatch(/^[01]+\n$/);

    const citation = await request(repository, `/labs/v1/results/${resultId}/citation.bib`);
    expect(citation.headers.get("content-type")).toContain("application/x-bibtex");
    expect(await citation.text()).toContain(resultId);

    const csv = await request(repository, "/labs/v1/registry.csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain(`reproduction_claimants`);
  });

  it("rejects oversized public objects before JSON parsing", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const response = await handleLabsRequest(new Request("https://example.test/labs/v1/objects", {
      method: "POST",
      headers: {"content-type": "application/json", "content-length": "131073"},
      body: "{}",
    }), repository);
    expect(response?.status).toBe(413);
  });

  it("serves immutable self-contained conformance vectors", async () => {
    const repository = await LabsRepository.open(new MemoryLabsPersistence());
    const response = await handleLabsRequest(new Request("https://example.test/labs/v1/test-vectors"), repository, LABS_CONFORMANCE_VECTORS);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("immutable");
    const vectors = await response!.json() as typeof LABS_CONFORMANCE_VECTORS;
    expect(vectors.protocol).toBe("sai-labs-test-vectors/1");
    expect(vectors.ruleset.body.baselines).toHaveLength(3);
    expect(vectors.research_units.map((item) => item.length).sort((a, b) => a - b)).toEqual([451, 518, 573]);
    expect(vectors.cumulative_supply.at(-1)?.expected_total).toBe(276_824_064);
  });
});
