// ADR 0013's scripted binding laws over the core's native Node; no vectors or expected
// results. Binding is not a deixis API: this is the scripted harness of ADR 0013 §10
// item 1. A name is bytes, preparation turns it into a request that captures the context
// and the path from the original root, and a binder is a script table that records every
// name it is asked for. Every tree is built and read through compose, decompose and at.
import { Node } from "../../core/ts/dist/index.js";

const fromHex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (k) => Buffer.from(k).toString("hex");
const UNRECOGNIZED = { refused: "unrecognized" };

/** A script table that records every name it is asked to resolve, so selection's
 * noninterference is observed rather than inferred (ADR 0013 §5). */
class Binder {
  constructor(script) {
    this.table = new Map(script.map(([name, outcome]) => [toHex(fromHex(name)), outcome]));
    this.consulted = [];
  }

  resolve(request) {
    const name = toHex(request.name);
    this.consulted.push(name);
    return this.table.has(name) ? this.table.get(name) : UNRECOGNIZED;
  }
}

/** The eager batch met an outcome that is not bound. */
class Failed {
  constructor(outcome) {
    this.outcome = outcome;
  }
}

const read = (s) => Node.compose(fromHex(s.own), s.children.map(([k, n]) => [fromHex(k), read(n)]));

/** P_{γ·at}: each name becomes a request whose cursor is its path from the original root.
 * Pure: it consults nothing. */
function prepare(node, origin, at = []) {
  const { own, children } = node.decompose();
  return Node.compose({ name: own, origin, at }, children.map(([k, c]) => [k, prepare(c, origin, [...at, k])]));
}

/** resolveAllOrFail: depth-first, a node before its children, and children in the core's
 * unsigned-octet key order; the first outcome that is not bound stops it. */
function bindAll(node, binder) {
  const { own, children } = node.decompose();
  const outcome = binder.resolve(own);
  if (Object.keys(outcome).length !== 1 || typeof outcome.bound !== "string") throw new Failed(outcome);
  return Node.compose(outcome.bound, children.map(([k, c]) => [k, bindAll(c, binder)]));
}

function spell(node, own) {
  const { own: value, children } = node.decompose();
  return { own: own(value), children: children.map(([k, c]) => [toHex(k), spell(c, own)]) };
}

const spellRequest = (r) => ({ name: toHex(r.name), origin: r.origin, at: r.at.map(toHex) });
const side = (n) => (n === undefined ? { undefined: {} } : { defined: spell(n, spellRequest) });

export function handleBinding(r) {
  const op = r.op.slice("binding.".length);
  const node = read(r.node);
  if (op === "prepare") return { result: spell(prepare(node, r.context), spellRequest) };
  const path = (r.path ?? []).map(fromHex);
  if (op === "at-after-prepare") {
    const selected = node.at(path);
    return {
      result: {
        "prepare-then-select": side(prepare(node, r.context).at(path)),
        "select-then-prepare": side(selected === undefined ? undefined : prepare(selected, r.context, path)),
      },
    };
  }
  const binder = new Binder(r.binder);
  let outcome;
  if (op === "resolve-at") {
    const found = prepare(node, r.context).at(path);
    // Structural absence is selection's answer; the binder is never asked.
    outcome = found === undefined ? { absent: {} } : binder.resolve(found.own());
  } else if (op === "resolve-all-or-fail") {
    try {
      outcome = { "bound-tree": spell(bindAll(prepare(node, r.context), binder), (id) => id) };
    } catch (e) {
      if (!(e instanceof Failed)) throw e;
      outcome = { failed: e.outcome };
    }
  } else {
    throw new Error("unknown binding operation " + op);
  }
  return { result: { outcome, consulted: binder.consulted } };
}
