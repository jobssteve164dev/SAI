import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {startLocalNode} from "../../apps/local-node/src/server.js";
import {FileJournalPersistence} from "../../apps/local-node/src/journal-store.js";
import {loadOrCreateIdentity, runPaperAction} from "../../packages/agent/src/index.js";
import {JournalRepository, createJournalVersion, signJournalVersion} from "../../packages/journal/src/index.js";
import {manuscript} from "./journal.test.js";

describe("本地参考节点期刊", () => {
  it("并发提交不同稿件后原子保留两份持久记录", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-local-journal-concurrent-"));
    const authors = await Promise.all([loadOrCreateIdentity(join(directory, "a.json")), loadOrCreateIdentity(join(directory, "b.json"))]);
    const persistence = await FileJournalPersistence.open(directory);
    const repository = new JournalRepository(persistence, {currentContext: async () => ({world_fork_id: "fork:local", event_seq: 0}), reviewerEligible: async () => false});
    const versions = authors.map((author, index) => createJournalVersion(manuscript([author], `并发稿件 ${index}`)));
    await Promise.all(versions.map((version, index) => repository.submit(version, [signJournalVersion(version.version_id, authors[index]!)])));
    expect(await (await FileJournalPersistence.open(directory)).list()).toHaveLength(2);
  });

  it("提供同一机器规则与投稿接口，并在节点重启后保留投稿", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofwild-local-journal-"));
    const identityPath = join(directory, "author.json");
    const identity = await loadOrCreateIdentity(identityPath);
    const input = manuscript([identity], "本地持久化");
    const paperPath = join(directory, "paper.md");
    const manifestPath = join(directory, "paper.json");
    await writeFile(paperPath, input.body_markdown);
    await writeFile(manifestPath, JSON.stringify(input.manifest));

    let node = await startLocalNode({dataDirectory: directory, regionId: "local-journal"});
    const rules = await runPaperAction({action: "rules", nodeUrl: node.url}) as {protocol: string};
    expect(rules.protocol).toBe("proofwild-journal-discovery/2");
    const submitted = await runPaperAction({action: "submit", paperPath, manifestPath, identityPath, nodeUrl: node.url}) as {paper_id: string};
    await node.close();

    node = await startLocalNode({dataDirectory: directory, regionId: "local-journal"});
    try {
      const restored = await runPaperAction({action: "status", paperId: submitted.paper_id, identityPath, nodeUrl: node.url}) as {paper_id: string};
      expect(restored.paper_id).toBe(submitted.paper_id);
    } finally { await node.close(); }
  });
});
