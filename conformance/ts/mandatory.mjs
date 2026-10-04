// ADR 0010 protocol over direct JSON payloads. No vectors or expected results.
import { isDeepStrictEqual } from "node:util";
import { DuplicateKeyError, Node } from "../../core/ts/dist/index.js";

const fromHex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (k) => Buffer.from(k).toString("hex");
const path = (p) => p.map(fromHex);
const missing = { undefined: {} };
const samePath = (a, b) => isDeepStrictEqual(a, b);

function equal(slot, a, b) {
  if (slot === "fixture") return a.class === b.class;
  if (slot === "unit") return true;
  if (slot === "option" || slot === "option-sum") {
    if ("none" in a || "none" in b) return "none" in a && "none" in b;
    return equal(slot === "option" ? "fixture" : "sum", a.some, b.some);
  }
  if (slot === "sum") {
    const tag = "left" in a ? "left" : "right";
    return tag in b && equal(tag === "left" ? "fixture" : "json", a[tag], b[tag]);
  }
  return isDeepStrictEqual(a, b);
}

function parse(s, at = [], holes) {
  if (holes && "hole" in s) {
    holes.push(at);
    return Node.compose(null, []); // Private placeholder, replaced before returning a tree.
  }
  if (!Object.hasOwn(s, "own")) throw new TypeError("missing own");
  return Node.compose(s.own, s.children.map(([k, n]) => [fromHex(k), parse(n, [...at, k], holes)]));
}

function spell(n, at = [], holes = []) {
  if (holes.some((p) => samePath(p, at))) return { hole: {} };
  const { own, children } = n.decompose();
  return { own, children: children.map(([k, c]) => [toHex(k), spell(c, [...at, toHex(k)], holes)]) };
}

function map(n, f) {
  const { own, children } = n.decompose();
  return Node.compose(f(own), children.map(([k, c]) => [k, map(c, f)]));
}

function apply(name, v) {
  switch (name) {
    case "id": return v;
    case "class-suffix-x": return { ...v, class: v.class + "x" };
    case "representation-upper": return { ...v, representation: v.representation.toUpperCase() };
    case "none-to-z": return "none" in v ? { some: { class: "z", representation: "z" } } : v;
    case "option-map-class-suffix-x": return "none" in v ? v : { some: apply("class-suffix-x", v.some) };
    case "wrap-in-array": return [v];
    default: throw new Error("unknown map " + name);
  }
}

const selected = (n, value = false) => n === undefined ? missing : { defined: value ? n.own() : spell(n) };

export function handleMandatory(r, replace, attach) {
  const op = r.op.slice("mnode.".length);
  if (op === "equal") return { equal: parse(r.left).equalBy(parse(r.right), (a, b) => equal(r.slot, a, b)) };
  let result;
  if (op === "construct") {
    try { result = selected(parse(r.node)); }
    catch (e) {
      if (e instanceof DuplicateKeyError) return { error: e.code, key: toHex(e.key) };
      if (!(e instanceof TypeError && e.message === "missing own")) throw e;
      result = missing;
    }
  } else if (op === "compose") {
    result = spell(parse(r));
  } else if (op === "assemble") {
    const children = r.children.map(([key, tag, raw]) => [fromHex(key), map(parse(raw), (v) => {
      const injected = { [tag]: v };
      return r.slot === "option-sum" ? { some: injected } : injected;
    })]);
    try { result = selected(Node.compose(r.parent, children)); }
    catch (e) { if (!(e instanceof DuplicateKeyError)) throw e; return { error: e.code, key: toHex(e.key) }; }
  } else if (op === "plug" || op === "rebuild") {
    const holes = [];
    let n = parse(op === "plug" ? r.context : r.skeleton, [], holes);
    if (op === "plug" && holes.length !== 1) throw new Error("one hole required");
    const supplied = op === "plug" ? [[holes[0], r.subtree]] : r.subtrees;
    if (supplied.length !== holes.length || new Set(supplied.map(([p]) => JSON.stringify(p))).size !== holes.length ||
        supplied.some(([p]) => !holes.some((h) => samePath(h, p)))) throw new Error("subtrees must exactly fill holes");
    for (const [p, raw] of supplied) n = replace(n, path(p), parse(raw));
    result = spell(n);
  } else if (op.startsWith("attach")) {
    let n = parse(r.A);
    for (const step of op === "attach-seq" ? r.steps : [r]) {
      if (n !== undefined) n = attach(n, path(step.parent), fromHex(step.key), parse(step.B));
    }
    if (n !== undefined && (op === "attach-then-at" || op === "attach-then-valueAt")) n = n.at(path(r.at));
    result = selected(n, op === "attach-then-valueAt");
  } else {
    let n = parse(r.node);
    switch (op) {
      case "own": result = n.own(); break;
      case "at": case "valueAt": result = selected(n.at(path(r.path)), op === "valueAt"); break;
      case "decompose": result = { parts: spell(n) }; break;
      case "map": case "at-after-map": case "embed-some":
        if (op === "embed-some") n = map(n, (v) => ({ some: v }));
        else for (const f of Array.isArray(r.f) ? r.f : [r.f]) n = map(n, (v) => apply(f, v));
        result = op === "at-after-map" ? selected(n.at(path(r.path))) : spell(n);
        break;
      case "replace":
        n = replace(n, path(r.path), parse(r.subtree));
        if (n !== undefined && Object.hasOwn(r, "then")) n = replace(n, path(r.path), parse(r.then));
        result = selected(n); break;
      case "split": {
        const found = n.at(path(r.path));
        result = found === undefined ? missing : { defined: { context: spell(n, [], [r.path]), subtree: spell(found) } };
        break;
      }
      case "cut": {
        const found = r.paths.map((p) => n.at(path(p)));
        const prefix = r.paths.some((p, i) => r.paths.some((q, j) => i !== j && p.length <= q.length && p.every((k, x) => k === q[x])));
        result = prefix || found.includes(undefined) ? missing : { defined: {
          skeleton: spell(n, [], r.paths), subtrees: r.paths.map((p, i) => [p, spell(found[i])]),
        } };
        break;
      }
      default: throw new Error("unknown operation " + op);
    }
  }
  return { result };
}
