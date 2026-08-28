import {createHash} from "node:crypto";

function normalized(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("reference canonical JSON requires safe integers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, normalized(value[key])]));
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}

export function referenceCanonicalJson(value) {
  return JSON.stringify(normalized(value));
}

export function referenceContentId(value) {
  return `sha256:${createHash("sha256").update(referenceCanonicalJson(value)).digest("hex")}`;
}

export function referenceEnergy(sequence) {
  if (!/^[01]+$/.test(sequence)) throw new TypeError("sequence must contain only 0 and 1");
  let energy = 0n;
  for (let shift = 1; shift < sequence.length; shift += 1) {
    let correlation = 0n;
    for (let index = 0; index + shift < sequence.length; index += 1) correlation += sequence[index] === sequence[index + shift] ? 1n : -1n;
    energy += correlation * correlation;
  }
  return energy;
}

export function referenceSymmetries(sequence) {
  const invert = (bit) => bit === "0" ? "1" : "0";
  const output = [];
  for (const reversed of [false, true]) {
    const base = reversed ? [...sequence].reverse().join("") : sequence;
    for (const alternating of [false, true]) {
      const current = [...base].map((bit, index) => alternating && index % 2 ? invert(bit) : bit).join("");
      output.push(current);
      output.push([...current].map(invert).join(""));
    }
  }
  return output.sort();
}

export function referenceCanonicalSequence(sequence) {
  return referenceSymmetries(sequence)[0];
}

export function referenceRulesetId(ruleset) {
  for (const baseline of ruleset.baselines) {
    if (baseline.sequence.length !== baseline.length || referenceCanonicalSequence(baseline.sequence) !== baseline.sequence || referenceEnergy(baseline.sequence).toString() !== baseline.energy) throw new TypeError("invalid reference baseline");
  }
  return referenceContentId(ruleset);
}

export function referenceResult(ruleset, sequence) {
  const canonical = referenceCanonicalSequence(sequence);
  const result = {protocol: "sai-labs-result/1", ruleset_id: referenceRulesetId(ruleset), length: canonical.length, sequence: canonical, energy: referenceEnergy(canonical).toString()};
  return {result, result_id: referenceContentId(result)};
}

export function referenceMergeFrontiers(left, right) {
  if (left.ruleset_id !== right.ruleset_id || left.fork_id !== right.fork_id) throw new TypeError("frontier namespace mismatch");
  const lengths = {};
  for (const length of [...new Set([...Object.keys(left.lengths), ...Object.keys(right.lengths)])].sort((a, b) => Number(a) - Number(b))) {
    const a = left.lengths[length];
    const b = right.lengths[length];
    if (!a) lengths[length] = structuredClone(b);
    else if (!b) lengths[length] = structuredClone(a);
    else if (BigInt(a.best_energy) < BigInt(b.best_energy)) lengths[length] = structuredClone(a);
    else if (BigInt(b.best_energy) < BigInt(a.best_energy)) lengths[length] = structuredClone(b);
    else lengths[length] = {best_energy: a.best_energy, result_ids: [...new Set([...a.result_ids, ...b.result_ids])].sort()};
  }
  return {protocol: "sai-labs-frontier/1", ruleset_id: left.ruleset_id, fork_id: left.fork_id, lengths};
}

export function referenceWorldBranch(ruleset, scope) {
  const baseline = ruleset.baselines.find((item) => item.length === scope.length);
  if (!baseline) throw new RangeError("unknown LABS branch length");
  const variants = referenceSymmetries(baseline.sequence);
  const candidate = variants[scope.research_height % variants.length];
  const prefixLength = Math.min(candidate.length, 64 + Math.floor(scope.research_height / variants.length) * 16);
  const body = {
    protocol: "sai-labs-world-branch/2",
    world_fork_id: scope.world_fork_id,
    region_id: scope.region_id,
    resource_id: scope.resource_id,
    schedule_id: scope.schedule_id,
    research_height: scope.research_height,
    subsidy: scope.subsidy,
    previous_settlement_id: scope.previous_settlement_id,
    ruleset_id: referenceRulesetId(ruleset),
    length: scope.length,
    energy_at_most: scope.energy_at_most ?? baseline.energy,
    sequence_prefix: candidate.slice(0, prefixLength),
  };
  return {...body, branch_id: referenceContentId(body)};
}

export function referenceSupplyScheduleId(schedule) {
  return referenceContentId(schedule);
}

export function referenceSubsidyAtHeight(height, schedule) {
  if (!Number.isSafeInteger(height) || height < 0) throw new RangeError("invalid research height");
  const epoch = Math.floor(height / schedule.halving_interval);
  const terminalEpoch = schedule.terminal_height / schedule.halving_interval;
  return epoch >= terminalEpoch ? 0 : schedule.initial_subsidy / (2 ** epoch);
}

export function referenceSupplyAtHeight(height, schedule) {
  const bounded = Math.min(height, schedule.terminal_height);
  let issued = 0;
  for (let cursor = 0; cursor < bounded;) {
    const epochEnd = Math.min(bounded, (Math.floor(cursor / schedule.halving_interval) + 1) * schedule.halving_interval);
    issued += (epochEnd - cursor) * referenceSubsidyAtHeight(cursor, schedule);
    cursor = epochEnd;
  }
  return issued;
}
