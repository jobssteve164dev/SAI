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
  if (!Number.isSafeInteger(scope.unit_index) || scope.unit_index < 0 || scope.unit_index >= scope.resource_amount) throw new RangeError("invalid resource unit index");
  const body = {
    protocol: "sai-labs-world-branch/4",
    economic_network_id: scope.economic_network_id,
    schedule_id: scope.schedule_id,
    branch_ordinal: scope.branch_ordinal,
    resource_id: scope.resource_id,
    resource_kind: scope.resource_kind,
    resource_amount: scope.resource_amount,
    reward_amount: 1,
    unit_index: scope.unit_index,
    x: scope.x,
    y: scope.y,
    stratum: scope.stratum,
    ruleset_id: referenceRulesetId(ruleset),
    length: scope.length,
    baseline_energy: baseline.energy,
    candidates_per_unit: 65536,
  };
  return {...body, branch_id: referenceContentId(body)};
}

export const referenceSearchMethodArtifact = {
  protocol: "sai-labs-artifact/1",
  artifact_type: "method",
  title: "SAI LABS parent-and-claimant-bound contribution search v3",
  media_type: "text/markdown",
  content_encoding: "utf-8",
  content: `# Parent-and-claimant-bound contribution search v3

Input is a content-addressed LABS world unit, the current economic parent digest, the claiming Agent ID, and the self-contained reference baseline for its sequence length.

1. Encode the 24-bit world branch ordinal and 5-bit unit index, XOR the 29-bit value with 31, and bind the resulting address bits to 29 fixed symmetry-paired positions.
2. Hash the economic network ID, current parent digest, and claiming Agent ID; bind the first 128 digest bits to a second fixed set of symmetry-paired positions. Changing the parent or claimant therefore changes the search itself, not merely the signature.
3. The address, challenge, and 16 variable positions are disjoint. Toggling a logical position complements both that position and its reverse partner. This preserves the fixed canonical guard for every reference length.
4. Enumerate all 65,536 masks of the 16 variable positions. Implementations may traverse Gray order for speed, but the coverage rows are committed in ascending numeric mask order.
5. Compute complete aperiodic autocorrelation energy with exact integers for every candidate. Each candidate is already the unique canonical representative under the eight LABS energy symmetries.
6. Preserve the exact count and digest of every result ID tied at the lowest energy. Select the lexicographically smallest result ID as the portable representative, then hash the ordered mask, result ID, and energy rows as the coverage digest.

The exact 29-bit unit address keeps different resource units disjoint. The 128-bit parent-and-claimant challenge prevents a public record from being re-signed for another Agent and prevents future units from being stockpiled before their economic parent exists, under the same SHA-256 collision-resistance assumption used by content IDs. A successful record therefore proves 65,536 challenge-bound canonical evaluations, not merely elapsed computation. Losing-fork records remain reproducible research but cannot transfer a unit on a different parent. The method requires no SAI authority, wall-clock time, hidden data, or judging committee and does not prove global optimality outside the recorded partition.`,
  license: "Apache-2.0",
};

export const referenceSearchMethodArtifactId = referenceContentId(referenceSearchMethodArtifact);

export function referenceResearchAddressCode(branchOrdinal, unitIndex) {
  if (!Number.isSafeInteger(branchOrdinal) || branchOrdinal < 0 || branchOrdinal >= 2 ** 24 || !Number.isSafeInteger(unitIndex) || unitIndex < 0 || unitIndex >= 32) throw new RangeError("invalid research partition address");
  return Number((BigInt(branchOrdinal) * 32n + BigInt(unitIndex)) ^ 31n);
}

export function referenceResearchTask(ruleset, branch, challenge) {
  const baseline = ruleset.baselines.find((item) => item.length === branch.length);
  if (!baseline) throw new RangeError("branch lacks deterministic research space");
  const addressBits = referenceResearchAddressCode(branch.branch_ordinal, branch.unit_index).toString(2).padStart(29, "0");
  const addressPositions = Array.from({length: 29}, (_, index) => 32 + index);
  const challengePositions = Array.from({length: 128}, (_, index) => 61 + index);
  const variablePositions = Array.from({length: 16}, (_, index) => 189 + index);
  const challengeHex = referenceContentId({protocol: "sai-labs-settlement-challenge/1", economic_network_id: branch.economic_network_id, economic_parent_id: challenge.economic_parent_id, claimant_agent_id: challenge.claimant_agent_id}).slice("sha256:".length);
  const challengeBits = [...challengeHex].map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, "0")).join("").slice(0, 128);
  const partitionBody = {protocol: "sai-labs-coverage-partition/2", ruleset_id: referenceRulesetId(ruleset), branch_id: branch.branch_id, economic_network_id: branch.economic_network_id, economic_parent_id: challenge.economic_parent_id, claimant_agent_id: challenge.claimant_agent_id, length: branch.length, address_encoding: "xor31_of_branch_ordinal_24bit_and_unit_index_5bit", address_bits: addressBits, address_positions: addressPositions, challenge_encoding: "sha256_128_of_network_parent_and_claimant", challenge_bits: challengeBits, challenge_positions: challengePositions, variable_positions: variablePositions, flip_semantics: "position_and_reverse_pair"};
  const task = {
    protocol: "sai-labs-research-task/2",
    ruleset_id: referenceRulesetId(ruleset),
    branch_id: branch.branch_id,
    branch_ordinal: branch.branch_ordinal,
    unit_index: branch.unit_index,
    economic_network_id: branch.economic_network_id,
    economic_parent_id: challenge.economic_parent_id,
    claimant_agent_id: challenge.claimant_agent_id,
    length: branch.length,
    objective: "exhaustive_parent_and_claimant_bound_symmetry_partition",
    base_sequence: baseline.sequence,
    address_encoding: "xor31_of_branch_ordinal_24bit_and_unit_index_5bit",
    address_bits: addressBits,
    address_positions: addressPositions,
    challenge_encoding: "sha256_128_of_network_parent_and_claimant",
    challenge_bits: challengeBits,
    challenge_positions: challengePositions,
    variable_positions: variablePositions,
    flip_semantics: "position_and_reverse_pair",
    candidate_count: 65536,
    enumeration: "ascending_16_bit_mask_with_gray_execution",
    coverage_partition_id: referenceContentId(partitionBody),
    energy_formula: ruleset.energy_formula,
  };
  return {task, task_id: referenceContentId(task)};
}

function toggleReferencePair(bits, position) {
  const mirror = bits.length - 1 - position;
  bits[position] = bits[position] === "0" ? "1" : "0";
  if (mirror !== position) bits[mirror] = bits[mirror] === "0" ? "1" : "0";
}

export function referenceResearchCandidate(task, mask) {
  if (!Number.isSafeInteger(mask) || mask < 0 || mask >= task.candidate_count) throw new RangeError("invalid research mask");
  const bits = [...task.base_sequence];
  for (let index = 0; index < task.address_positions.length; index += 1) if (task.address_bits[index] === "1") toggleReferencePair(bits, task.address_positions[index]);
  for (let index = 0; index < task.challenge_positions.length; index += 1) if (task.challenge_bits[index] === "1") toggleReferencePair(bits, task.challenge_positions[index]);
  for (let index = 0; index < task.variable_positions.length; index += 1) if ((mask & (1 << index)) !== 0) toggleReferencePair(bits, task.variable_positions[index]);
  return bits.join("");
}

function referenceSearchState(sequence) {
  const bits = [...sequence];
  const values = bits.map((bit) => bit === "1" ? 1 : -1);
  const correlations = Array(sequence.length).fill(0);
  let energy = 0n;
  for (let shift = 1; shift < sequence.length; shift += 1) {
    let correlation = 0;
    for (let index = 0; index + shift < sequence.length; index += 1) correlation += values[index] * values[index + shift];
    correlations[shift] = correlation;
    energy += BigInt(correlation) * BigInt(correlation);
  }
  return {bits, values, correlations, energy};
}

function referenceFlipPosition(state, position) {
  for (let shift = 1; shift < state.values.length; shift += 1) {
    let delta = 0;
    if (position + shift < state.values.length) delta -= 2 * state.values[position] * state.values[position + shift];
    if (position - shift >= 0) delta -= 2 * state.values[position - shift] * state.values[position];
    if (delta !== 0) {
      const previous = state.correlations[shift];
      state.energy += BigInt(2 * previous * delta + delta * delta);
      state.correlations[shift] = previous + delta;
    }
  }
  state.values[position] *= -1;
  state.bits[position] = state.bits[position] === "0" ? "1" : "0";
}

function referenceFlipPair(state, position) {
  referenceFlipPosition(state, position);
  const mirror = state.bits.length - 1 - position;
  if (mirror !== position) referenceFlipPosition(state, mirror);
}

export function referenceExecuteResearch(ruleset, branch, challenge) {
  const {task, task_id} = referenceResearchTask(ruleset, branch, challenge);
  const baseline = ruleset.baselines.find((item) => item.length === task.length);
  if (!baseline) throw new RangeError("unknown task length");
  const evaluations = Array(task.candidate_count);
  const state = referenceSearchState(referenceResearchCandidate(task, 0));
  const bestResultIds = new Set();
  let bestEnergy;
  let selectedCandidate = "";
  let selectedResultId = "";
  let previousGrayMask = 0;
  for (let step = 0; step < task.candidate_count; step += 1) {
    const mask = step ^ (step >>> 1);
    if (step > 0) {
      const changed = mask ^ previousGrayMask;
      referenceFlipPair(state, task.variable_positions[31 - Math.clz32(changed)]);
    }
    previousGrayMask = mask;
    const candidate = state.bits.join("");
    const result = {protocol: "sai-labs-result/1", ruleset_id: task.ruleset_id, length: task.length, sequence: candidate, energy: state.energy.toString()};
    const resultId = referenceContentId(result);
    evaluations[mask] = {mask, result_id: resultId, energy: result.energy};
    if (bestEnergy === undefined || state.energy < bestEnergy) {
      bestEnergy = state.energy;
      bestResultIds.clear();
      bestResultIds.add(resultId);
      selectedCandidate = candidate;
      selectedResultId = resultId;
    } else if (state.energy === bestEnergy) {
      bestResultIds.add(resultId);
      if (resultId < selectedResultId) { selectedCandidate = candidate; selectedResultId = resultId; }
    }
  }
  const tiedResultIds = [...bestResultIds].sort();
  const baselineEnergy = BigInt(baseline.energy);
  const coverageDigest = referenceContentId({protocol: "sai-labs-search-coverage/1", task_id, evaluations});
  const tiedResultDigest = referenceContentId({protocol: "sai-labs-tied-result-set/1", task_id, result_ids: tiedResultIds});
  if (bestEnergy === undefined) throw new TypeError("research task has no candidates");
  const result = {protocol: "sai-labs-result/1", ruleset_id: task.ruleset_id, length: task.length, sequence: selectedCandidate, energy: bestEnergy.toString()};
  const record = {
    protocol: "sai-labs-research-record/2",
    ruleset_id: task.ruleset_id,
    task_id,
    branch_id: task.branch_id,
    contribution_type: bestEnergy < baselineEnergy ? "frontier_improvement" : "search_coverage",
    result_id: selectedResultId,
    baseline_energy: baseline.energy,
    best_energy: bestEnergy.toString(),
    energy_delta: (baselineEnergy - bestEnergy).toString(),
    tied_result_ids: tiedResultIds.slice(0, 128),
    tied_result_count: tiedResultIds.length,
    tied_result_ids_complete: tiedResultIds.length <= 128,
    tied_result_digest: tiedResultDigest,
    evaluated_candidates: 65536,
    new_canonical_candidates: 65536,
    coverage_partition_id: task.coverage_partition_id,
    coverage_digest: coverageDigest,
    reward_units: 1,
    artifact_ids: [referenceSearchMethodArtifactId],
  };
  return {
    task,
    task_id,
    artifact: structuredClone(referenceSearchMethodArtifact),
    artifact_id: referenceSearchMethodArtifactId,
    record,
    record_id: referenceContentId(record),
    candidate_sequence: selectedCandidate,
    result,
    result_id: selectedResultId,
  };
}

export function referenceSupplyScheduleId(schedule) {
  return referenceContentId(schedule);
}

export function referenceCumulativeSupply(stratum, schedule) {
  if (!Number.isSafeInteger(stratum) || stratum < 0 || stratum > schedule.strata) throw new RangeError("invalid stratum");
  return schedule.branches_per_stratum * stratum * (stratum + 1) / 2;
}

export function referenceWorldResource(ruleset, schedule, ordinal, unitIndex = 0) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= schedule.rewarded_branch_count) throw new RangeError("invalid branch ordinal");
  const schedule_id = referenceSupplyScheduleId(schedule);
  const economic_network_id = `network:${schedule_id}`;
  const permuted = Number((BigInt(ordinal) * BigInt(schedule.ordinal_permutation.multiplier) + BigInt(schedule.ordinal_permutation.offset)) % (1n << 24n));
  const stratum = Math.floor(permuted / schedule.branches_per_stratum) + 1;
  if (!Number.isSafeInteger(unitIndex) || unitIndex < 0 || unitIndex >= stratum) throw new RangeError("invalid resource unit index");
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
    unit_index: unitIndex,
    x: tileX * schedule.resource_tile_axis + (Number.parseInt(positionHex.slice(0, 2), 16) % schedule.resource_tile_axis),
    y: tileY * schedule.resource_tile_axis + (Number.parseInt(positionHex.slice(2, 4), 16) % schedule.resource_tile_axis),
    stratum,
    length: resourceClass.length,
  };
  return {branch_ordinal: ordinal, resource_id: scope.resource_id, kind: scope.resource_kind, amount: scope.resource_amount, x: scope.x, y: scope.y, stratum, length: scope.length, baseline_energy: resourceClass.baseline_energy, labs_branch: referenceWorldBranch(ruleset, scope)};
}

export function referenceMergeSupplyStates(left, right) {
  if (left.economic_network_id !== right.economic_network_id || left.schedule_id !== right.schedule_id) throw new TypeError("economic network mismatch");
  const tip = (state) => state.active_chain.length ? referenceContentId(state.active_chain[state.active_chain.length - 1]) : state.schedule_id;
  const chosen = left.active_chain.length > right.active_chain.length ? left
    : right.active_chain.length > left.active_chain.length ? right
      : tip(left) <= tip(right) ? left : right;
  return structuredClone(chosen);
}
