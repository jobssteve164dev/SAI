import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
  LABS_MAX_OBJECT_BYTES,
  REFERENCE_FORK_ID,
  REFERENCE_RESULTS,
  REFERENCE_RULESET,
  REFERENCE_RULESET_ID,
  addResultToFrontier,
  createInitialFrontier,
  labsCanonicalJson,
  labsContentId,
  labsObjectBytes,
  mergeLabsFrontiers,
  rulesetId,
  verifyLabsClaim,
  verifyLabsResult,
  type LabsFrontier,
  type LabsResult,
  type LabsRuleset,
  type LabsSignedClaim,
} from "./index.js";
import {assertLabsClaim, assertLabsFrontier, assertLabsResult, assertLabsRuleset} from "./validation.js";

export type LabsObjectKind = "ruleset" | "result" | "claim";
export type LabsObjectValue = LabsRuleset | LabsResult | LabsSignedClaim;
export interface LabsStoredObject {kind: LabsObjectKind; value: LabsObjectValue}
export interface LabsExchangeBundle {protocol: "sai-labs-exchange/1"; ruleset_id: string; fork_id: string; frontier: LabsFrontier; objects: Array<{id: string; kind: LabsObjectKind; value: LabsObjectValue}>}

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

  async bundle(rulesetIdValue = REFERENCE_RULESET_ID, forkId = REFERENCE_FORK_ID): Promise<LabsExchangeBundle> {
    const frontier = await this.frontier(rulesetIdValue, forkId);
    const all = await this.persistence.listObjects();
    const resultIds = new Set(Object.values(frontier.lengths).flatMap((entry) => entry.result_ids));
    const objects = all.filter(({id, object}) => id === rulesetIdValue || resultIds.has(id) || (object.kind === "claim" && resultIds.has((object.value as LabsSignedClaim).claim.result_id))).map(({id, object}) => ({id, kind: object.kind, value: object.value}));
    return {protocol: "sai-labs-exchange/1", ruleset_id: rulesetIdValue, fork_id: forkId, frontier, objects};
  }

  async importBundle(bundle: LabsExchangeBundle): Promise<void> {
    if (bundle.protocol !== "sai-labs-exchange/1" || bundle.objects.length > 512 || labsObjectBytes(bundle) > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 交换包无效或过大");
    if (Object.keys(bundle).sort().join(",") !== "fork_id,frontier,objects,protocol,ruleset_id" || !/^sha256:[0-9a-f]{64}$/.test(bundle.ruleset_id) || !/^fork:[A-Za-z0-9._:-]{1,120}$/.test(bundle.fork_id)) throw new TypeError("LABS 交换包结构无效");
    assertLabsFrontier(bundle.frontier);
    if (bundle.frontier.ruleset_id !== bundle.ruleset_id || bundle.frontier.fork_id !== bundle.fork_id) throw new TypeError("LABS 交换包与前沿边界不一致");
    for (const object of bundle.objects) {
      if (Object.keys(object).sort().join(",") !== "id,kind,value" || !/^sha256:[0-9a-f]{64}$/.test(object.id)) throw new TypeError("LABS 交换对象结构无效");
      if (object.kind === "ruleset") assertLabsRuleset(object.value);
      else if (object.kind === "result") assertLabsResult(object.value);
      else if (object.kind === "claim") assertLabsClaim(object.value);
      else throw new TypeError("LABS 交换对象类型无效");
      if (labsContentId(object.value) !== object.id) throw new TypeError("LABS 交换对象摘要不匹配");
    }
    const ordered = [...bundle.objects].sort((a, b) => ({ruleset: 0, result: 1, claim: 2}[a.kind] - {ruleset: 0, result: 1, claim: 2}[b.kind]));
    for (const object of ordered) await this.ingest(object.kind, object.value, object.id, bundle.fork_id);
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
  const response = await fetch(`${peerBaseUrl.replace(/\/$/, "")}${path}`, {headers: {accept: "application/json"}});
  if (!response.ok) throw new Error(`LABS 对等节点返回 HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > LABS_MAX_OBJECT_BYTES) throw new RangeError("LABS 对等交换响应超过对象上限");
  await repository.importBundle(JSON.parse(raw) as LabsExchangeBundle);
  return repository.frontier(rulesetIdValue, forkId);
}
