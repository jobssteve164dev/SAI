import {readFileSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {Ajv2020} from "ajv/dist/2020.js";
import {describe, expect, it} from "vitest";

describe("SAI Federation 0.2.0 schema", () => {
  it("全部可在 JSON Schema 2020-12 严格模式下编译", async () => {
    const directory = resolve("spec/sai/0.2.0");
    const ajv = new Ajv2020({strict: true, formats: {uri: true}});
    for (const filename of await readdir(directory)) expect(() => ajv.compile(JSON.parse(readFileSync(resolve(directory, filename), "utf8")))).not.toThrow();
  });
});
