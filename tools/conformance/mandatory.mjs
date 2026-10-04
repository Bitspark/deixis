// Judge mandatory-node results using the declared slot and complete structural parts.
// This module is only loaded by the harness, never by an implementation CLI.
import { isDeepStrictEqual } from "node:util";

export const MANDATORY_FILES = [
  "mnode-identity.json", "mnode-navigation.json", "mnode-map.json",
  "mnode-parts.json", "mnode-attach.json", "mnode-instantiation.json", "mnode-invalid.json",
];
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (x, k) => object(x) && Object.keys(x).length === 1 && Object.hasOwn(x, k);

function payload(slot, a, b) {
  switch (slot) {
    case "fixture": return object(a) && object(b) && typeof a.class === "string" && typeof a.representation === "string" && a.class === b.class;
    case "unit": return object(a) && Object.keys(a).length === 0 && object(b) && Object.keys(b).length === 0;
    case "option": case "option-sum":
      if (only(a, "none")) return only(b, "none") && payload("unit", a.none, b.none);
      return only(a, "some") && only(b, "some") && payload(slot === "option" ? "fixture" : "sum", a.some, b.some);
    case "sum":
      return (only(a, "left") && only(b, "left") && payload("fixture", a.left, b.left)) ||
        (only(a, "right") && only(b, "right") && payload("json", a.right, b.right));
    case "json": return isDeepStrictEqual(a, b);
    default: throw new Error("unknown slot " + slot);
  }
}

function entries(a, b, equal) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const read = (rows) => {
    if (rows.some((r) => !Array.isArray(r) || r.length !== 2 || typeof r[0] !== "string")) return null;
    const result = new Map(rows);
    return result.size === rows.length ? result : null;
  };
  const aa = read(a), bb = read(b);
  return aa !== null && bb !== null && [...aa].every(([k, v]) => bb.has(k) && equal(v, bb.get(k)));
}

function tree(slot, a, b, holes = false) {
  if (holes && only(a, "hole")) return only(b, "hole") && payload("unit", a.hole, b.hole);
  return object(a) && object(b) && Object.hasOwn(a, "own") && Object.hasOwn(b, "own") &&
    payload(slot, a.own, b.own) && entries(a.children, b.children, (x, y) => tree(slot, x, y, holes));
}

function sameResult(op, slot, a, b) {
  const partial = ["at", "valueAt", "at-after-map", "construct", "assemble", "replace", "split", "cut", "attach", "attach-seq", "attach-then-at", "attach-then-valueAt"];
  if (partial.includes(op)) {
    if (only(b, "undefined")) return only(a, "undefined") && payload("unit", a.undefined, b.undefined);
    if (!only(a, "defined") || !only(b, "defined")) return false;
    a = a.defined; b = b.defined;
  }
  if (["own", "valueAt", "attach-then-valueAt"].includes(op)) return payload(slot, a, b);
  if (op === "decompose") return only(a, "parts") && only(b, "parts") && tree(slot, a.parts, b.parts);
  if (op === "split") return object(a) && object(b) && tree(slot, a.context, b.context, true) && tree(slot, a.subtree, b.subtree);
  if (op === "cut") {
    if (!object(a) || !object(b) || !tree(slot, a.skeleton, b.skeleton, true)) return false;
    const paths = (xs) => Array.isArray(xs) && xs.every((r) => Array.isArray(r) && r.length === 2 && Array.isArray(r[0]))
      ? xs.map(([p, n]) => [JSON.stringify(p), n]) : null;
    return entries(paths(a.subtrees), paths(b.subtrees), (x, y) => tree(slot, x, y));
  }
  return tree(slot, a, b);
}

export function mandatoryRequests(vectors, send) {
  for (const file of MANDATORY_FILES) {
    for (const c of vectors(file).cases) {
      const { name, note, op = "equal", equal, result, error, ...fields } = c;
      if (error !== undefined) {
        const { key, ...inputs } = fields;
        send("mnode." + op, inputs, name, (r) =>
          r.error === error && r.key === key && !Object.hasOwn(r, "result")
            ? null : `got ${JSON.stringify(r)}, want ${error} at ${key}`);
      } else if (op === "equal") {
        const judge = (r) => r.equal === equal ? null : `got ${JSON.stringify(r)}, want equal=${equal}`;
        send("mnode.equal", fields, name, judge);
        send("mnode.equal", { ...fields, left: fields.right, right: fields.left }, name + " (reverse)", judge);
      } else {
        send("mnode." + op, fields, name, (r) =>
          Object.hasOwn(r, "result") && sameResult(op, c.result_slot ?? c.slot, r.result, result)
            ? null : `got ${JSON.stringify(r)}, want ${JSON.stringify(result)}`);
      }
    }
  }
}
