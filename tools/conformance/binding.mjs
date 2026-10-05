// Judge the scripted binding family (ADR 0013 §2, §3 and the structural rows of §5).
// This module is only loaded by the harness, never by an implementation CLI. Binding is
// not a deixis API: each CLI answers these operations from a scripted harness over its
// core's native Node, and the expectations stay here.
import { isDeepStrictEqual } from "node:util";

export const BINDING_FILES = ["binding-scripted.json"];
const OPS = ["prepare", "at-after-prepare", "resolve-at", "resolve-all-or-fail"];

const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (x, k) => object(x) && Object.keys(x).length === 1 && Object.hasOwn(x, k);
const strings = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");

/** A node: exactly own and children; children are a finite map, order ignored, a repeated key malformed. */
function tree(a, b, own) {
  const rows = (x) =>
    object(x) && Object.keys(x).length === 2 && Object.hasOwn(x, "own") && Array.isArray(x.children) &&
    x.children.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === "string")
      ? new Map(x.children) : null;
  const x = rows(a), y = rows(b);
  return x !== null && y !== null && x.size === a.children.length && y.size === b.children.length &&
    x.size === y.size && own(a.own, b.own) && [...x].every(([k, v]) => y.has(k) && tree(v, y.get(k), own));
}

/** A request: the exact name bytes, the captured origin, and the path from the original root. */
const request = (a, b) =>
  object(a) && Object.keys(a).length === 3 && typeof a.name === "string" && a.name === b.name &&
  typeof a.origin === "string" && a.origin === b.origin && strings(a.at) && isDeepStrictEqual(a.at, b.at);

/** One side of the law: {"defined": prepared subtree} or {"undefined": {}}. */
const side = (a, b) => only(b, "undefined")
  ? only(a, "undefined") && isDeepStrictEqual(a.undefined, {})
  : only(a, "defined") && tree(a.defined, b.defined, request);

/** An outcome compares exactly, tag and reason; a bound tree compares as a tree of ids. */
const outcome = (a, b) => only(b, "bound-tree")
  ? only(a, "bound-tree") && tree(a["bound-tree"], b["bound-tree"], (x, y) => typeof x === "string" && x === y)
  : isDeepStrictEqual(a, b);

function same(op, a, b) {
  if (op === "prepare") return tree(a, b, request);
  if (op === "at-after-prepare") {
    return object(a) && Object.keys(a).length === 2 &&
      side(a["prepare-then-select"], b) && side(a["select-then-prepare"], b);
  }
  return object(a) && Object.keys(a).length === 2 && outcome(a.outcome, b.outcome) &&
    strings(a.consulted) && isDeepStrictEqual(a.consulted, b.consulted);
}

export function bindingRequests(vectors, send) {
  for (const file of BINDING_FILES) {
    const { description, cases } = vectors(file);
    // The description states its case count, and a moved count refuses the run before
    // anything is sent: a count that only a reader compares drifts silently.
    const stated = /(\d+) cases\.$/.exec(description)?.[1];
    if (Number(stated) !== cases.length) {
      throw new Error(`${file}: the description states ${stated ?? "no"} cases, the file holds ${cases.length}`);
    }
    for (const c of cases) {
      const { name, note, pins, op, result, ...fields } = c;
      if (!OPS.includes(op)) throw new Error(`${name}: unknown binding operation ${op}`);
      send("binding." + op, fields, name, (r) =>
        Object.hasOwn(r, "result") && same(op, r.result, result)
          ? null : `got ${JSON.stringify(r)}, want ${JSON.stringify(result)}`);
    }
  }
}
