import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
  LABS_MAX_OBJECT_BYTES,
  REFERENCE_FORK_ID,
  REFERENCE_RESULTS,
  REFERENCE_SEARCH_METHOD_ARTIFACT,
  REFERENCE_SEARCH_METHOD_ARTIFACT_ID,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  addResultToFrontier,
  createInitialFrontier,
  labsCanonicalJson,
  labsContentId,
  labsObjectBytes,
  mergeLabsFrontiers,
  rulesetId,
  exactMeritFactor,
  verifyLabsArtifact,
  verifyLabsClaim,
  verifyLabsResearchRecord,
  verifyLabsResearchTask,
  verifyLabsResult,
  type LabsFrontier,
  type LabsResearchArtifact,
  type LabsResearchRecord,
  type LabsResearchTask,
  type LabsResult,
  type LabsRuleset,
  type LabsSignedClaim,
} from "./index.js";
import {assertLabsArtifact, assertLabsClaim, assertLabsFrontier, assertLabsResearchRecord, assertLabsResearchTask, assertLabsResult, assertLabsRuleset} from "./validation.js";

export type LabsObjectKind = "ruleset" | "result" | "artifact" | "task" | "record" | "claim";
export type LabsObjectValue = LabsRuleset | LabsResult | LabsResearchArtifact | LabsResearchTask | LabsResearchRecord | LabsSignedClaim;
export interface LabsStoredObject {kind: LabsObjectKind; value: LabsObjectValue}
export interface LabsExchangeBundle {protocol: "sai-labs-exchange/2"; ruleset_id: string; fork_id: string; frontier: LabsFrontier; cursor: string | null; next_cursor: string | null; objects: Array<{id: string; kind: LabsObjectKind; value: LabsObjectValue}>}

export interface LabsRegistryEntry {
  result_id: string;
  result: LabsResult;
  status: "reference_baseline" | "search_coverage" | "frontier_improvement" | "sequence_only";
  merit_factor: ReturnType<typeof exactMeritFactor>;
  baseline_energy: string;
  energy_delta: string;
  source?: LabsRuleset["baselines"][number]["source"];
  claims: Array<{claim_id: string; signed_claim: LabsSignedClaim}>;
  research: Array<{record_id: string; record: LabsResearchRecord; task: LabsResearchTask; artifacts: Array<{artifact_id: string; artifact: LabsResearchArtifact}>}>;
  discovery_claims: number;
  reproduction_claimants: number;
  relay_claims: number;
}

export interface LabsRegistrySnapshot {
  protocol: "sai-labs-registry/1";
  ruleset_id: string;
  role: "derived-local-index";
  authority: false;
  entries: LabsRegistryEntry[];
  totals: {results: number; research_records: number; frontier_improvements: number; search_coverage_records: number; reproduction_claimants: number};
}

export interface LabsPersistence {
  getObject(id: string): Promise<LabsStoredObject | undefined>;
  putObject(id: string, object: LabsStoredObject): Promise<void>;
  listObjects(): Promise<Array<{id: string; object: LabsStoredObject}>>;
  getFrontier(rulesetId: string, forkId: string): Promise<LabsFrontier | undefined>;
  putFrontier(frontier: LabsFrontier): Promise<void>;
}

export class MemoryLabsPersistence implements LabsPersistence {
  private readonly objects = new Map<string, LabsStoredObject>();
  private readonly frontiers = new Map<string, LabsFrontier>();
  async getObject(id: string): Promise<LabsStoredObject | undefined> { const value = this.objects.get(id); return value ? structuredClone(value) : undefined; }
  async putObject(id: string, object: LabsStoredObject): Promise<void> { this.objects.set(id, structuredClone(object)); }
  async listObjects(): Promise<Array<{id: string; object: LabsStoredObject}>> { return [...this.objects.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, object]) => ({id, object: structuredClone(object)})); }
  async getFrontier(rulesetId: string, forkId: string): Promise<LabsFrontier | undefined> { const value = this.frontiers.get(`${rulesetId}\u0000${forkId}`); return value ? structuredClone(value) : undefined; }
  async putFrontier(frontier: LabsFrontier): Promise<void> { this.frontiers.set(`${frontier.ruleset_id}\u0000${frontier.fork_id}`, structuredClone(frontier)); }
}

interface FileLabsState {objects: Record<string, LabsStoredObject>; frontiers: Record<string, LabsFrontier>}

export class FileLabsPersistence implements LabsPersistence {
  private state: FileLabsState = {objects: {}, frontiers: {}};
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<FileLabsPersistence> {
    const persistence = new FileLabsPersistence(directory);
    await mkdir(directory, {recursive: true});
    try { persistence.state = JSON.parse(await readFile(join(directory, "labs-store.json"), "utf8")) as FileLabsState; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return persistence;
  }

  async getObject(id: string): Promise<LabsStoredObject | undefined> { const value = this.state.objects[id]; return value ? structuredClone(value) : undefined; }
  async putObject(id: string, object: LabsStoredObject): Promise<void> { await this.update(() => { this.state.objects[id] = structuredClone(object); }); }
  async listObjects(): Promise<Array<{id: string; object: LabsStoredObject}>> { return Object.entries(this.state.objects).sort(([a], [b]) => a.localeCompare(b)).map(([id, object]) => ({id, object: structuredClone(object)})); }
  async getFrontier(rulesetId: string, forkId: string): Promise<LabsFrontier | undefined> { const value = this.state.frontiers[`${rulesetId}\u0000${forkId}`]; return value ? structuredClone(value) : undefined; }
  async putFrontier(frontier: LabsFrontier): Promise<void> { await this.update(() => { this.state.frontiers[`${frontier.ruleset_id}\u0000${frontier.fork_id}`] = structuredClone(frontier); }); }

  private async update(change: () => void): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      change();
      const temporary = join(this.directory, "labs-store.json.next");
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
      await rename(temporary, join(this.directory, "labs-store.json"));
    } finally { release(); }
  }
}

export class LabsRepository {
  private ingestionQueue: Promise<void> = Promise.resolve();
  private constructor(readonly persistence: LabsPersistence) {}

  static async open(persistence: LabsPersistence): Promise<LabsRepository> {
    const repository = new LabsRepository(persistence);
    await repository.ingest("ruleset", REFERENCE_RULESET, REFERENCE_RULESET_ID);
    for (const record of Object.values(REFERENCE_RESULTS)) await repository.ingest("result", record.result, record.result_id, REFERENCE_FORK_ID);
    await repository.ingest("artifact", REFERENCE_SEARCH_METHOD_ARTIFACT, REFERENCE_SEARCH_METHOD_ARTIFACT_ID);
    return repository;
  }

  async ingest(kind: LabsObjectKind, value: LabsObjectValue, expectedId?: string, forkId = REFERENCE_FORK_ID): Promise<string> {
    const previous = this.ingestionQueue;
    let release!: () => void;
    this.ingestionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.ingestUnlocked(kind, value, expectedId, forkId);
    } finally {
      release();
    }
  }

  private async ingestUnlocked(kind: LabsObjectKind, value: LabsObjectValue, expectedId?: string, forkId = REFERENCE_FORK_ID): Promise<string> {
    if (labsObjectBytes({kind, value}) > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 对象超过固定大小上限");
    let id: string;
    if (kind === "ruleset") id = rulesetId(value as LabsRuleset);
    else if (kind === "result") {
      const result = value as LabsResult;
      const storedRuleset = await this.persistence.getObject(result.ruleset_id);
      if (!storedRuleset || storedRuleset.kind !== "ruleset") throw new TypeError("LABS 结果引用了未知规则集");
      id = verifyLabsResult(storedRuleset.value as LabsRuleset, result);
      const baseline = (storedRuleset.value as LabsRuleset).baselines.find((item) => item.length === result.length);
      if (!baseline || BigInt(result.energy) > BigInt(baseline.energy)) throw new RangeError("该缓存节点只接受达到规则集公开基线的 LABS 结果");
    } else if (kind === "artifact") id = verifyLabsArtifact(value as LabsResearchArtifact);
    else if (kind === "task") {
      const task = value as LabsResearchTask;
      const storedRuleset = await this.persistence.getObject(task.ruleset_id);
      if (!storedRuleset || storedRuleset.kind !== "ruleset") throw new TypeError("LABS 研究任务引用了未知规则集");
      id = verifyLabsResearchTask(storedRuleset.value as LabsRuleset, task);
    } else if (kind === "record") {
      const record = value as LabsResearchRecord;
      const storedRuleset = await this.persistence.getObject(record.ruleset_id);
      const storedTask = await this.persistence.getObject(record.task_id);
      const storedResult = await this.persistence.getObject(record.result_id);
      if (!storedRuleset || storedRuleset.kind !== "ruleset" || !storedTask || storedTask.kind !== "task" || !storedResult || storedResult.kind !== "result") throw new TypeError("LABS 研究记录引用了缺失的规则集、任务或结果");
      for (const artifactId of record.artifact_ids) {
        const artifact = await this.persistence.getObject(artifactId);
        if (!artifact || artifact.kind !== "artifact") throw new TypeError("LABS 研究记录引用了缺失的方法制品");
      }
      id = verifyLabsResearchRecord(storedRuleset.value as LabsRuleset, storedTask.value as LabsResearchTask, record);
    } else {
      const claim = value as LabsSignedClaim;
      const result = await this.persistence.getObject(claim.claim.result_id);
      if (!result || result.kind !== "result") throw new TypeError("LABS 声明引用了未知结果");
      id = verifyLabsClaim(claim);
    }
    if (expectedId && id !== expectedId) throw new TypeError("LABS 内容摘要与对象不匹配");
    const known = await this.persistence.getObject(id);
    if (!known) await this.persistence.putObject(id, {kind, value: structuredClone(value)});
    else if (labsCanonicalJson(known) !== labsCanonicalJson({kind, value})) throw new TypeError("LABS 内容摘要碰撞");

    if (kind === "ruleset") {
      const current = await this.persistence.getFrontier(id, forkId);
      if (!current) await this.persistence.putFrontier(createInitialFrontier(value as LabsRuleset, forkId));
    } else if (kind === "result") {
      const result = value as LabsResult;
      const rulesetObject = await this.persistence.getObject(result.ruleset_id) as LabsStoredObject;
      const ruleset = rulesetObject.value as LabsRuleset;
      const baseline = ruleset.baselines.find((item) => item.length === result.length);
      if (!baseline) throw new RangeError("LABS 结果长度不在规则集内");
      if (BigInt(result.energy) <= BigInt(baseline.energy)) {
        const current = await this.frontier(result.ruleset_id, forkId);
        await this.persistence.putFrontier(addResultToFrontier(current, result, id));
      }
    }
    return id;
  }

  async object(id: string): Promise<LabsStoredObject | undefined> { return this.persistence.getObject(id); }

  async ruleset(id: string): Promise<LabsRuleset> {
    const object = await this.persistence.getObject(id);
    if (!object || object.kind !== "ruleset") throw new Error("LABS 规则集不存在");
    return object.value as LabsRuleset;
  }

  async frontier(rulesetIdValue = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<LabsFrontier> {
    const existing = await this.persistence.getFrontier(rulesetIdValue, forkId);
    if (existing) return existing;
    const ruleset = await this.ruleset(rulesetIdValue);
    const initial = createInitialFrontier(ruleset, forkId);
    await this.persistence.putFrontier(initial);
    return initial;
  }

  async registry(rulesetIdValue = REFERENCE_RULESET_ID): Promise<LabsRegistrySnapshot> {
    const ruleset = await this.ruleset(rulesetIdValue);
    const all = await this.persistence.listObjects();
    const results = all.filter(({object}) => object.kind === "result" && (object.value as LabsResult).ruleset_id === rulesetIdValue);
    const records = all.filter(({object}) => object.kind === "record" && (object.value as LabsResearchRecord).ruleset_id === rulesetIdValue);
    const tasks = new Map(all.filter(({object}) => object.kind === "task").map(({id, object}) => [id, object.value as LabsResearchTask]));
    const artifacts = new Map(all.filter(({object}) => object.kind === "artifact").map(({id, object}) => [id, object.value as LabsResearchArtifact]));
    const claims = all.filter(({object}) => object.kind === "claim");
    const entries: LabsRegistryEntry[] = [];
    for (const {id: resultId, object} of results) {
      const result = object.value as LabsResult;
      const baseline = ruleset.baselines.find((item) => item.length === result.length)!;
      const resultRecords = records.filter(({object: candidate}) => (candidate.value as LabsResearchRecord).result_id === resultId).map(({id, object: candidate}) => {
        const record = candidate.value as LabsResearchRecord;
        const task = tasks.get(record.task_id);
        if (!task) throw new Error("LABS 注册表研究记录缺少任务");
        const recordArtifacts = record.artifact_ids.map((artifactId) => {
          const artifact = artifacts.get(artifactId);
          if (!artifact) throw new Error("LABS 注册表研究记录缺少制品");
          return {artifact_id: artifactId, artifact};
        });
        return {record_id: id, record, task, artifacts: recordArtifacts};
      }).sort((left, right) => left.record_id < right.record_id ? -1 : left.record_id > right.record_id ? 1 : 0);
      const resultClaims = claims.filter(({object: candidate}) => (candidate.value as LabsSignedClaim).claim.result_id === resultId).map(({id, object: candidate}) => ({claim_id: id, signed_claim: candidate.value as LabsSignedClaim})).sort((left, right) => left.claim_id < right.claim_id ? -1 : left.claim_id > right.claim_id ? 1 : 0);
      const reproductionAgents = new Set(resultClaims.filter(({signed_claim}) => signed_claim.claim.claim_type === "reproduction").map(({signed_claim}) => signed_claim.claim.agent_id));
      const reference = REFERENCE_RESULTS[String(result.length)]?.result_id === resultId;
      const status: LabsRegistryEntry["status"] = resultRecords.some(({record}) => record.contribution_type === "frontier_improvement") ? "frontier_improvement" : resultRecords.length ? "search_coverage" : reference ? "reference_baseline" : "sequence_only";
      entries.push({
        result_id: resultId,
        result,
        status,
        merit_factor: exactMeritFactor(result.length, BigInt(result.energy)),
        baseline_energy: baseline.energy,
        energy_delta: (BigInt(baseline.energy) - BigInt(result.energy)).toString(),
        ...(reference ? {source: baseline.source} : {}),
        claims: resultClaims,
        research: resultRecords,
        discovery_claims: resultClaims.filter(({signed_claim}) => signed_claim.claim.claim_type === "discovery").length,
        reproduction_claimants: reproductionAgents.size,
        relay_claims: resultClaims.filter(({signed_claim}) => signed_claim.claim.claim_type === "relay").length,
      });
    }
    entries.sort((left, right) => {
      if (left.result.length !== right.result.length) return left.result.length - right.result.length;
      const leftEnergy = BigInt(left.result.energy);
      const rightEnergy = BigInt(right.result.energy);
      if (leftEnergy !== rightEnergy) return leftEnergy < rightEnergy ? -1 : 1;
      return left.result_id < right.result_id ? -1 : left.result_id > right.result_id ? 1 : 0;
    });
    const researchRecords = entries.flatMap((entry) => entry.research.map(({record}) => record));
    return {
      protocol: "sai-labs-registry/1",
      ruleset_id: rulesetIdValue,
      role: "derived-local-index",
      authority: false,
      entries,
      totals: {
        results: entries.length,
        research_records: researchRecords.length,
        frontier_improvements: researchRecords.filter((record) => record.contribution_type === "frontier_improvement").length,
        search_coverage_records: researchRecords.filter((record) => record.contribution_type === "search_coverage").length,
        reproduction_claimants: entries.reduce((sum, entry) => sum + entry.reproduction_claimants, 0),
      },
    };
  }

  async registryEntry(resultId: string, rulesetIdValue = REFERENCE_RULESET_ID): Promise<LabsRegistryEntry | undefined> {
    return (await this.registry(rulesetIdValue)).entries.find((entry) => entry.result_id === resultId);
  }

  async bundle(rulesetIdValue = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID, cursor: string | null = null): Promise<LabsExchangeBundle> {
    const frontier = await this.frontier(rulesetIdValue, forkId);
    const all = await this.persistence.listObjects();
    const resultIds = new Set(all.filter(({object}) => object.kind === "result" && (object.value as LabsResult).ruleset_id === rulesetIdValue).map(({id}) => id));
    const recordArtifacts = new Set(all.filter(({object}) => object.kind === "record" && (object.value as LabsResearchRecord).ruleset_id === rulesetIdValue).flatMap(({object}) => (object.value as LabsResearchRecord).artifact_ids));
    const relevant = all.filter(({id, object}) => id === rulesetIdValue
      || (object.kind === "result" && resultIds.has(id))
      || (object.kind === "task" && (object.value as LabsResearchTask).ruleset_id === rulesetIdValue)
      || (object.kind === "record" && (object.value as LabsResearchRecord).ruleset_id === rulesetIdValue)
      || (object.kind === "artifact" && recordArtifacts.has(id))
      || (object.kind === "claim" && resultIds.has((object.value as LabsSignedClaim).claim.result_id)));
    const order: Record<LabsObjectKind, number> = {ruleset: 0, result: 1, artifact: 2, task: 3, record: 4, claim: 5};
    const sorted = relevant.map(({id, object}) => ({id, kind: object.kind, value: object.value, key: `${order[object.kind]}:${id}`})).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    if (cursor && !/^[0-5]:sha256:[0-9a-f]{64}$/.test(cursor)) throw new TypeError("LABS 交换游标无效");
    const remaining = sorted.filter((item) => !cursor || item.key > cursor);
    const objects: LabsExchangeBundle["objects"] = [];
    for (const candidate of remaining.slice(0, 64)) {
      const next = [...objects, {id: candidate.id, kind: candidate.kind, value: candidate.value}];
      const trial: LabsExchangeBundle = {protocol: "sai-labs-exchange/2", ruleset_id: rulesetIdValue, fork_id: forkId, frontier, cursor, next_cursor: candidate.key, objects: next};
      if (labsObjectBytes(trial) > LABS_MAX_OBJECT_BYTES) break;
      objects.push({id: candidate.id, kind: candidate.kind, value: candidate.value});
    }
    if (remaining.length && objects.length === 0) throw new RangeError("LABS 单个交换对象无法装入固定交换上限");
    const last = objects.length ? `${order[objects.at(-1)!.kind]}:${objects.at(-1)!.id}` : cursor;
    const hasMore = last ? sorted.some((item) => item.key > last) : false;
    return {protocol: "sai-labs-exchange/2", ruleset_id: rulesetIdValue, fork_id: forkId, frontier, cursor, next_cursor: hasMore ? last : null, objects};
  }

  async importBundle(bundle: LabsExchangeBundle): Promise<void> {
    if (bundle.protocol !== "sai-labs-exchange/2" || bundle.objects.length > 64 || labsObjectBytes(bundle) > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 交换包无效或过大");
    if (Object.keys(bundle).sort().join(",") !== "cursor,fork_id,frontier,next_cursor,objects,protocol,ruleset_id" || !/^sha256:[0-9a-f]{64}$/.test(bundle.ruleset_id) || !/^fork:[A-Za-z0-9._:-]{1,120}$/.test(bundle.fork_id)) throw new TypeError("LABS 交换包结构无效");
    if ((bundle.cursor !== null && !/^[0-5]:sha256:[0-9a-f]{64}$/.test(bundle.cursor)) || (bundle.next_cursor !== null && !/^[0-5]:sha256:[0-9a-f]{64}$/.test(bundle.next_cursor))) throw new TypeError("LABS 交换包游标无效");
    assertLabsFrontier(bundle.frontier);
    if (bundle.frontier.ruleset_id !== bundle.ruleset_id || bundle.frontier.fork_id !== bundle.fork_id) throw new TypeError("LABS 交换包与前沿边界不一致");
    for (const object of bundle.objects) {
      if (Object.keys(object).sort().join(",") !== "id,kind,value" || !/^sha256:[0-9a-f]{64}$/.test(object.id)) throw new TypeError("LABS 交换对象结构无效");
      if (object.kind === "ruleset") assertLabsRuleset(object.value);
      else if (object.kind === "result") assertLabsResult(object.value);
      else if (object.kind === "artifact") assertLabsArtifact(object.value);
      else if (object.kind === "task") assertLabsResearchTask(object.value);
      else if (object.kind === "record") assertLabsResearchRecord(object.value);
      else if (object.kind === "claim") assertLabsClaim(object.value);
      else throw new TypeError("LABS 交换对象类型无效");
      if (labsContentId(object.value) !== object.id) throw new TypeError("LABS 交换对象摘要不匹配");
    }
    const order: Record<LabsObjectKind, number> = {ruleset: 0, result: 1, artifact: 2, task: 3, record: 4, claim: 5};
    const ordered = [...bundle.objects].sort((a, b) => order[a.kind] - order[b.kind]);
    for (const object of ordered) await this.ingest(object.kind, object.value, object.id, bundle.fork_id);
    if (bundle.next_cursor !== null) return;
    const ruleset = await this.ruleset(bundle.ruleset_id);
    const expectedLengths = new Set(ruleset.baselines.map((item) => String(item.length)));
    if (Object.keys(bundle.frontier.lengths).some((length) => !expectedLengths.has(length)) || [...expectedLengths].some((length) => !bundle.frontier.lengths[length])) throw new TypeError("LABS 交换前沿长度与规则集不一致");
    for (const [length, entry] of Object.entries(bundle.frontier.lengths)) {
      for (const id of entry.result_ids) {
        const object = await this.persistence.getObject(id);
        if (!object || object.kind !== "result") throw new TypeError("LABS 交换前沿引用了缺失结果");
        const result = object.value as LabsResult;
        if (String(result.length) !== length || result.energy !== entry.best_energy || result.ruleset_id !== bundle.ruleset_id) throw new TypeError("LABS 交换前沿与结果正文不一致");
      }
    }
    const local = await this.frontier(bundle.ruleset_id, bundle.fork_id);
    const merged = mergeLabsFrontiers(local, bundle.frontier);
    await this.persistence.putFrontier(merged);
  }
}

export async function syncLabsFromPeer(repository: LabsRepository, peerBaseUrl: string, rulesetIdValue = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<LabsFrontier> {
  const path = `/labs/v1/exchange/${encodeURIComponent(rulesetIdValue)}/${encodeURIComponent(forkId)}`;
  let cursor: string | null = null;
  for (let page = 0; page < 4_096; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await fetch(`${peerBaseUrl.replace(/\/$/, "")}${path}${query}`, {headers: {accept: "application/json"}});
    if (!response.ok) throw new Error(`LABS 对等节点返回 HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 对等交换响应超过对象上限");
    const bundle = JSON.parse(raw) as LabsExchangeBundle;
    await repository.importBundle(bundle);
    if (!bundle.next_cursor) return repository.frontier(rulesetIdValue, forkId);
    if (bundle.next_cursor === cursor) throw new Error("LABS 对等交换游标没有前进");
    cursor = bundle.next_cursor;
  }
  throw new Error("LABS 对等交换分页超过固定上限");
}
