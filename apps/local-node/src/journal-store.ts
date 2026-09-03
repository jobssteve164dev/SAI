import {readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {JournalArtifact, JournalPersistence, JournalSubmission} from "../../../packages/journal/src/index.js";

interface JournalFile {
  submissions: Record<string, JournalSubmission>;
  artifacts: Record<string, JournalArtifact>;
}

function clone<T>(value: T): T { return structuredClone(value); }

export class FileJournalPersistence implements JournalPersistence {
  private readonly path: string;
  private state: JournalFile = {submissions: {}, artifacts: {}};
  private queue: Promise<void> = Promise.resolve();

  private constructor(directory: string) { this.path = join(directory, "journal.json"); }

  static async open(directory: string): Promise<FileJournalPersistence> {
    const persistence = new FileJournalPersistence(directory);
    try { persistence.state = JSON.parse(await readFile(persistence.path, "utf8")) as JournalFile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return persistence;
  }

  async get(paperId: string): Promise<JournalSubmission | undefined> { const value = this.state.submissions[paperId]; return value ? clone(value) : undefined; }
  async list(): Promise<JournalSubmission[]> { return Object.values(this.state.submissions).map(clone).sort((left, right) => left.paper_id.localeCompare(right.paper_id)); }
  async getArtifact(versionId: string, sha256: string): Promise<JournalArtifact | undefined> { const value = this.state.artifacts[`${versionId}:${sha256}`]; return value ? clone(value) : undefined; }
  async put(submission: JournalSubmission): Promise<void> { return this.serial(async () => { this.state.submissions[submission.paper_id] = clone(submission); await this.flush(); }); }
  async putWithArtifacts(submission: JournalSubmission, artifacts: JournalArtifact[]): Promise<void> {
    return this.serial(async () => {
      this.state.submissions[submission.paper_id] = clone(submission);
      for (const artifact of artifacts) this.state.artifacts[`${submission.current_version.version_id}:${artifact.sha256}`] = clone(artifact);
      await this.flush();
    });
  }

  private async flush(): Promise<void> {
    const temporary = `${this.path}.next`;
    await writeFile(temporary, `${JSON.stringify(this.state)}\n`, {encoding: "utf8", mode: 0o600});
    await rename(temporary, this.path);
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}
