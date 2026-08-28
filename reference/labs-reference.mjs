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
  const candidate = variants[scope.branch_ordinal % variants.length];
  const prefixLength = Math.min(candidate.length, 32 + (32 - scope.stratum) * 8);
  const body = {
    protocol: "sai-labs-world-branch/3",
    economic_network_id: scope.economic_network_id,
    schedule_id: scope.schedule_id,
    branch_ordinal: scope.branch_ordinal,
    resource_id: scope.resource_id,
    resource_kind: scope.resource_kind,
    resource_amount: scope.resource_amount,
    x: scope.x,
    y: scope.y,
    stratum: scope.stratum,
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

export function referenceCumulativeSupply(stratum, schedule) {
  if (!Number.isSafeInteger(stratum) || stratum < 0 || stratum > schedule.strata) throw new RangeError("invalid stratum");
  return schedule.branches_per_stratum * stratum * (stratum + 1) / 2;
}

export function referenceWorldResource(ruleset, schedule, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= schedule.rewarded_branch_count) throw new RangeError("invalid branch ordinal");
  const schedule_id = referenceSupplyScheduleId(schedule);
  const economic_network_id = `network:${schedule_id}`;
  const permuted = Number((BigInt(ordinal) * BigInt(schedule.ordinal_permutation.multiplier) + BigInt(schedule.ordinal_permutation.offset)) % (1n << 24n));
  const stratum = Math.floor(permuted / schedule.branches_per_stratum) + 1;
  const resourceClass = schedule.resource_classes[permuted % schedule.resource_classes.length];
  const positionHex = createHash("sha256").update(referenceCanonicalJson({algorithm: "sha256_tile_offset", seed: schedule.position_formula.seed, ordinal})).digest("hex");
  const tileX = ordinal % 4096;
  const tileY = Math.floor(ordinal / 4096);
  const scope = {
    economic_network_id,
    schedule_id,
    branch_ordinal: ordinal,
    resource_id: `resource:world:${ordinal}`,
    resource_kind: resourceClass.kind,
    resource_amount: stratum,
    x: tileX * schedule.resource_tile_axis + (Number.parseInt(positionHex.slice(0, 2), 16) % schedule.resource_tile_axis),
    y: tileY * schedule.resource_tile_axis + (Number.parseInt(positionHex.slice(2, 4), 16) % schedule.resource_tile_axis),
    stratum,
    length: resourceClass.length,
    energy_at_most: resourceClass.energy_at_most,
  };
  return {branch_ordinal: ordinal, resource_id: scope.resource_id, kind: scope.resource_kind, amount: scope.resource_amount, x: scope.x, y: scope.y, stratum, length: scope.length, energy_at_most: scope.energy_at_most, labs_branch: referenceWorldBranch(ruleset, scope)};
}

export function referenceMergeSupplyStates(left, right) {
  if (left.economic_network_id !== right.economic_network_id || left.schedule_id !== right.schedule_id) throw new TypeError("economic network mismatch");
  const tip = (state) => state.active_chain.length ? referenceContentId(state.active_chain[state.active_chain.length - 1]) : state.schedule_id;
  const chosen = left.active_chain.length > right.active_chain.length ? left
    : right.active_chain.length > left.active_chain.length ? right
      : tip(left) <= tip(right) ? left : right;
  return structuredClone(chosen);
}
