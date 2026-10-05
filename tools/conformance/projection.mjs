// Judge the scripted projection family (IDENTITY.md ID9 and ID10, with the key row of ID2
// and the reconstruction row of ID4). This module is only loaded by the harness, never by
// an implementation CLI. Projection is not a deixis API (ID8): each CLI answers these
// operations from a scripted harness over its core's native Node, and the expectations
// stay here.
import { isDeepStrictEqual } from "node:util";

export const PROJECTION_FILES = ["projection-scripted.json"];
const OPS = ["lift", "lift-cut", "lift-sequence", "keys-after-mutation"];
const TAGS = ["ok", "refused", "fault"];

const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exactly = (x, keys) =>
  object(x) && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));

/** An outcome: {"missing-path": {}}, or one of ok, refused or fault carrying a string. */
const outcome = (x) =>
  object(x) && Object.keys(x).length === 1 &&
  (isDeepStrictEqual(x, { "missing-path": {} }) || TAGS.some((t) => typeof x[t] === "string"));

/** The fixture's log: [[hex id, hex args], …], compared exactly and in order. */
const log = (x) =>
  Array.isArray(x) && x.every((e) => Array.isArray(e) && e.length === 2 && e.every((s) => typeof s === "string"));

/** One lift's observation under O: its outcome and the fixture's log. */
const lifted = (a, b) =>
  exactly(a, ["outcome", "invocations"]) && outcome(a.outcome) && log(a.invocations) &&
  isDeepStrictEqual(a.outcome, b.outcome) && isDeepStrictEqual(a.invocations, b.invocations);

function same(op, a, b) {
  if (op === "lift") return lifted(a, b);
  // Both sides of ID10 are judged against the one expected observation, so a CLI that
  // computes only one side, or computes both on one fixture, fails.
  if (op === "lift-cut") {
    return exactly(a, ["select-then-lift", "lift-concat"]) &&
      lifted(a["select-then-lift"], b) && lifted(a["lift-concat"], b);
  }
  if (op === "lift-sequence") {
    return exactly(a, ["outcomes", "invocations"]) && Array.isArray(a.outcomes) && a.outcomes.every(outcome) &&
      log(a.invocations) && isDeepStrictEqual(a.outcomes, b.outcomes) && isDeepStrictEqual(a.invocations, b.invocations);
  }
  return exactly(a, ["found"]) && Array.isArray(a.found) && a.found.every((f) => typeof f === "boolean") &&
    isDeepStrictEqual(a.found, b.found);
}

export function projectionRequests(vectors, send) {
  for (const file of PROJECTION_FILES) {
    const { description, cases } = vectors(file);
    // The description states its case count, and a moved count refuses the run before
    // anything is sent: a count that only a reader compares drifts silently.
    const stated = /(\d+) cases\.$/.exec(description)?.[1];
    if (Number(stated) !== cases.length) {
      throw new Error(`${file}: the description states ${stated ?? "no"} cases, the file holds ${cases.length}`);
    }
    for (const c of cases) {
      const { name, note, pins, op, result, ...fields } = c;
      if (!OPS.includes(op)) throw new Error(`${name}: unknown projection operation ${op}`);
      send("projection." + op, fields, name, (r) =>
        Object.hasOwn(r, "result") && same(op, r.result, result)
          ? null : `got ${JSON.stringify(r)}, want ${JSON.stringify(result)}`);
    }
  }
}
