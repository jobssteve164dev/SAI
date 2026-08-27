import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("内核依赖边界", () => {
  it("不依赖 MCP、OAuth、Cloudflare、存储、时钟或随机数", async () => {
    const directory = resolve("packages/kernel/src");
    const source = (await Promise.all((await readdir(directory)).map((name) => readFile(resolve(directory, name), "utf8")))).join("\n");
    for (const forbidden of ["@modelcontextprotocol", "oauth", "cloudflare", "sqlite", "Date.now", "Math.random"]) expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});
