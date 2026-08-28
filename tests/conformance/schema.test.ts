import {readFileSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {Ajv2020} from "ajv/dist/2020.js";
import {describe, expect, it} from "vitest";
import {buildObservation, createWorld, toSnapshot, transition} from "../../packages/kernel/src/index.js";

const specDirectory = resolve("spec/sai/0.1.0");
const load = (name: string) => JSON.parse(readFileSync(resolve(specDirectory, `${name}.schema.json`), "utf8"));
const sharedSchemaPaths = [
  "spec/labs/1.0.0/result.schema.json",
  "spec/labs/1.0.0/claim.schema.json",
  "spec/sai/0.4.0/world-supply-block.schema.json",
  "spec/sai/0.4.0/world-supply-state.schema.json",
  "spec/labs/6.0.0/world-branch.schema.json",
  "spec/labs/6.0.0/research-task.schema.json",
  "spec/labs/6.0.0/research-record.schema.json",
  "spec/sai/0.5.0/world-supply-block.schema.json",
  "spec/sai/0.5.0/world-supply-state.schema.json",
];

function conformanceAjv(): Ajv2020 {
  const ajv = new Ajv2020({strict: true});
  for (const path of sharedSchemaPaths) ajv.addSchema(JSON.parse(readFileSync(resolve(path), "utf8")));
  return ajv;
}

describe("SAI 0.1.0 权威 schema", () => {
  it("全部可由 JSON Schema 2020-12 编译", async () => {
    const ajv = conformanceAjv();
    for (const filename of await readdir(specDirectory)) expect(() => ajv.compile(JSON.parse(readFileSync(resolve(specDirectory, filename), "utf8")))).not.toThrow();
  });

  it("验证内核产生的 observation、result、event 与 snapshot", () => {
    const ajv = conformanceAjv();
    const state = createWorld("schema", [{id: "agent:a", x: 1, y: 0, energy: 5, inventory: {}}]);
    state.resources["resource-plain"] = {id: "resource-plain", kind: "ore", x: 1, y: 0, initial_amount: 1, remaining: 1};
    const stored = buildObservation(state, "agent:a")!;
    expect(ajv.validate(load("observe-output"), stored.observation), ajv.errorsText()).toBe(true);
    const gather = Object.values(stored.commands).find((action) => action.type === "gather")!;
    const outcome = transition(state, "agent:a", "schema-1", gather);
    expect(outcome.status).toBe("applied");
    if (outcome.status === "applied") {
      expect(ajv.validate(load("act-output"), outcome.result), ajv.errorsText()).toBe(true);
      expect(ajv.validate(load("event"), outcome.event), ajv.errorsText()).toBe(true);
      expect(ajv.validate(load("snapshot"), toSnapshot(outcome.state)), ajv.errorsText()).toBe(true);
    }
  });
});
