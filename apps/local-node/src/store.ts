import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fromSnapshot, replay, toSnapshot, type ActResult, type ConformanceEvent, type RegionState, type Snapshot, type StoredObservation} from "../../../packages/kernel/src/index.js";
import type {AuthSnapshot} from "../../../packages/auth/src/index.js";

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function readLines<T>(path: string): Promise<T[]> {
  try { return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export class FileStore {
  constructor(readonly directory: string) {}
  private path(name: string): string { return join(this.directory, name); }
  async initialize(): Promise<void> { await mkdir(this.directory, {recursive: true}); }

  async loadState(fallback: RegionState): Promise<{state: RegionState; events: ConformanceEvent[]}> {
    await this.initialize();
    const snapshot = await readJson<Snapshot>(this.path("snapshot.json"));
    const events = await readLines<ConformanceEvent>(this.path("events.jsonl"));
    const base = snapshot ? fromSnapshot(snapshot) : fallback;
    const tail = events.filter((event) => event.event_seq > base.event_seq);
    return {state: replay(base, tail), events};
  }

  async appendEvent(event: ConformanceEvent): Promise<void> { await appendFile(this.path("events.jsonl"), `${JSON.stringify(event)}\n`, {encoding: "utf8"}); }
  async appendRejection(agentId: string, result: ActResult): Promise<void> { await appendFile(this.path("rejections.jsonl"), `${JSON.stringify({agent_id: agentId, result})}\n`, {encoding: "utf8"}); }
  async appendObservation(stored: StoredObservation): Promise<void> { await appendFile(this.path("observations.jsonl"), `${JSON.stringify(stored)}\n`, {encoding: "utf8"}); }
  async loadObservations(): Promise<StoredObservation[]> { return readLines(this.path("observations.jsonl")); }
  async loadRejections(): Promise<Array<{agent_id: string; result: ActResult}>> { return readLines(this.path("rejections.jsonl")); }
  async saveSnapshot(state: RegionState): Promise<void> { await this.atomicJson("snapshot.json", toSnapshot(state)); }
  async loadAuth(): Promise<AuthSnapshot | undefined> { return readJson(this.path("auth.json")); }
  async saveAuth(value: AuthSnapshot): Promise<void> { await this.atomicJson("auth.json", value); }

  private async atomicJson(name: string, value: unknown): Promise<void> {
    const target = this.path(name);
    const temporary = this.path(`${name}.next`);
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
    await rename(temporary, target);
  }
}
