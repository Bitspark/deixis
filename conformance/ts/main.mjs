// Thin conformance CLI for the TypeScript implementation — tools/conformance/README.md.
// Reads NDJSON requests on stdin, answers each with this implementation's own judgment
// on stdout. Owns no vectors and no expectations. Plain ESM over the built packages:
// build core/ts, pos/ts, and set/ts first.
//
// The node.* operations that are not accessors of the floor — replacement, attachment,
// split and plug, cuts, and the embedding of the previous model — are derived here
// through the core's accessors (compose, decompose, own, get, at), which is what
// docs/PATH.md claims they are: derivable, and no methods of the floor.

import { createInterface } from "node:readline";

import { DuplicateKeyError, Node, some } from "../../core/ts/dist/index.js";
import { isKey as posIsKey, key as posKey } from "../../pos/ts/dist/index.js";
import { contains, isSet, recognize, setOf } from "../../set/ts/dist/index.js";
import { handleCodec } from "./codec.mjs";
import { handleMandatory } from "./mandatory.mjs";

const encoder = new TextEncoder();

function fromHex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

const SORTS = {
  bytes: {
    member: (spelling) => fromHex(spelling),
    spell: (member) => toHex(member),
    e: (member) => member,
    eq: sameBytes,
  },
  class: {
    member: (spelling) => ({
      class: spelling.class,
      representation: spelling.representation,
    }),
    spell: (member) => ({ class: member.class, representation: member.representation }),
    e: (member) => encoder.encode(member.class),
    eq: (a, b) => a.class === b.class,
  },
};

// --- reading spellings ----------------------------------------------------------------

const path = (keys) => keys.map(fromHex);

/**
 * Read an N[T] spelling, {"own": …, "children": […]}. With `holes` given, a
 * {"hole": {}} is admitted at any position: it is read as Node(None, ∅), which the
 * caller replaces, and its path is recorded.
 */
function parse(spelling, member, at = [], holes = undefined) {
  if ("hole" in spelling) {
    if (holes === undefined) throw new Error("a hole where no hole is admitted");
    holes.push(at);
    return Node.compose(undefined, []);
  }
  const ownKeys = Object.keys(spelling.own);
  if (ownKeys.length !== 1 || !["none", "some"].includes(ownKeys[0])) {
    throw new Error("an own value is exactly one of none and some");
  }
  const own = ownKeys[0] === "some" ? some(member(spelling.own.some)) : undefined;
  return Node.compose(
    own,
    spelling.children.map(([key, child]) => [
      fromHex(key),
      parse(child, member, [...at, key], holes),
    ]),
  );
}

/**
 * Read a previous-model spelling, {"leaf": payload} or {"struct": […]}, through the
 * embedding E of ADR 0009 §10.1: E(Leaf(t)) = Node(Some(t), ∅) and
 * E(Struct(m)) = Node(None, k ↦ E(m(k))).
 */
function embed(spelling, member) {
  if ("leaf" in spelling) return Node.compose(some(member(spelling.leaf)), []);
  if ("struct" in spelling) {
    return Node.compose(
      undefined,
      spelling.struct.map(([key, child]) => [fromHex(key), embed(child, member)]),
    );
  }
  throw new Error('a previous-model node is {"leaf": …} or {"struct": …}');
}

/** A node field of a request: through E when the request says embedded, in N otherwise. */
const read = (request, spelling, member) =>
  request.embedded === true ? embed(spelling, member) : parse(spelling, member);

// --- writing spellings ----------------------------------------------------------------

const spellOwn = (own, s) => (own === undefined ? { none: {} } : { some: s.spell(own.value) });

/** Write a node in N, with a hole at every path of `holes` (paths as hex key lists). */
function spell(node, s, at = [], holes = []) {
  if (holes.some((hole) => hole.length === at.length && hole.every((k, i) => k === at[i]))) {
    return { hole: {} };
  }
  const { own, children } = node.decompose();
  return {
    own: spellOwn(own, s),
    children: children.map(([key, child]) => {
      const hexKey = toHex(key);
      return [hexKey, spell(child, s, [...at, hexKey], holes)];
    }),
  };
}

const defined = (value) => ({ defined: value });
const UNDEFINED = { undefined: {} };
const result = (node, s) => (node === undefined ? UNDEFINED : defined(spell(node, s)));

// --- the derived operations -----------------------------------------------------------

/**
 * n[p := s]: defined exactly when p ∈ paths(n). Every untouched own value and sibling on
 * the way is retained, because each step recomposes the node's own parts.
 */
function replace(node, keys, subtree) {
  if (keys.length === 0) return subtree;
  const [first, ...rest] = keys;
  const child = node.get(first);
  if (child === undefined) return undefined;
  const replaced = replace(child, rest, subtree);
  if (replaced === undefined) return undefined;
  const { own, children } = node.decompose();
  return Node.compose(
    own,
    children.map(([key, c]) => [key, sameBytes(key, first) ? replaced : c]),
  );
}

/**
 * attach(A, p, k, B) of ADR 0009 §8: A[p := compose((o, m ∪ {k ↦ B}))] with
 * (o, m) = decompose(at(A, p)), defined exactly when p ∈ paths(A) and p ‖ k ∉ paths(A).
 */
function attach(tree, parent, key, subtree) {
  const at = tree.at(parent);
  if (at === undefined || at.get(key) !== undefined) return undefined;
  const { own, children } = at.decompose();
  return replace(tree, parent, Node.compose(own, [...children, [key, subtree]]));
}

/** E's inverse, defined exactly on trees whose valued positions have no children. */
function unembed(node, s) {
  const { own, children } = node.decompose();
  if (own !== undefined) return children.length === 0 ? { leaf: s.spell(own.value) } : undefined;
  const struct = [];
  for (const [key, child] of children) {
    const old = unembed(child, s);
    if (old === undefined) return undefined;
    struct.push([toHex(key), old]);
  }
  return { struct };
}

const samePath = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
const isPrefix = (p, q) => p.length <= q.length && p.every((k, i) => k === q[i]);

function handleNode(request) {
  const s = SORTS.class;
  const tree = () => parse(request.tree, s.member);

  switch (request.op) {
    case "node.at":
      return result(tree().at(path(request.path)), s);
    case "node.valueAt": {
      const found = tree().at(path(request.path));
      return found === undefined ? UNDEFINED : defined(spellOwn(found.own(), s));
    }
    case "node.atCompose":
      return result(tree().at(path(request.first))?.at(path(request.then)), s);
    case "node.attach":
      return result(
        attach(tree(), path(request.parent), fromHex(request.key), parse(request.subtree, s.member)),
        s,
      );
    case "node.attachCommute": {
      const steps = [request.first, request.second];
      const grow = (order) =>
        order.reduce(
          (n, i) =>
            n === undefined
              ? undefined
              : attach(n, path(request.parent), fromHex(steps[i].key), parse(steps[i].subtree, s.member)),
          tree(),
        );
      return { forward: result(grow([0, 1]), s), reverse: result(grow([1, 0]), s) };
    }
    case "node.decompose": {
      const { own, children } = tree().decompose();
      return defined({
        parts: {
          own: spellOwn(own, s),
          children: children.map(([key, child]) => [toHex(key), spell(child, s)]),
        },
      });
    }
    case "node.compose":
      return defined(spell(parse(request.parts, s.member), s));
    case "node.split": {
      const n = tree();
      const found = n.at(path(request.path));
      if (found === undefined) return UNDEFINED;
      return defined({ context: spell(n, s, [], [request.path]), subtree: spell(found, s) });
    }
    case "node.plug": {
      const holes = [];
      const context = parse(request.context, s.member, [], holes);
      if (holes.length !== 1) throw new Error(`a context has exactly one hole, not ${holes.length}`);
      return result(replace(context, path(holes[0]), parse(request.subtree, s.member)), s);
    }
    case "node.cut": {
      const n = tree();
      const subtrees = [];
      for (const p of request.paths) {
        const found = n.at(path(p));
        if (found === undefined) return UNDEFINED;
        subtrees.push([p, spell(found, s)]);
      }
      // cut_F is defined for a prefix-free F: no path of F is a prefix of another.
      for (const [i, p] of request.paths.entries()) {
        for (const [j, q] of request.paths.entries()) {
          if (i !== j && isPrefix(p, q)) return UNDEFINED;
        }
      }
      return defined({ skeleton: spell(n, s, [], request.paths), subtrees });
    }
    case "node.rebuild": {
      const holes = [];
      let rebuilt = parse(request.skeleton, s.member, [], holes);
      // The supplied subtrees have exactly the skeleton's holes as their domain.
      if (
        request.subtrees.length !== holes.length ||
        request.subtrees.some(([p]) => !holes.some((hole) => samePath(hole, p)))
      ) {
        return UNDEFINED;
      }
      for (const [p, subtree] of request.subtrees) {
        rebuilt = rebuilt === undefined ? undefined : replace(rebuilt, path(p), parse(subtree, s.member));
      }
      return result(rebuilt, s);
    }
    case "node.embed":
      return defined(spell(embed(request.old, s.member), s));
    case "node.unembed": {
      const old = unembed(tree(), s);
      return old === undefined ? UNDEFINED : defined(old);
    }
  }
  return { error: "unsupported" };
}

function refusal(error) {
  if (error instanceof DuplicateKeyError) return { error: error.code, key: toHex(error.key) };
  throw error;
}


function parseRequired(spelling) {
  return Node.compose(
    SORTS.class.member(spelling.own),
    spelling.children.map(([key, child]) => [fromHex(key), parseRequired(child)]),
  );
}

function spellRequired(node) {
  return {
    own: SORTS.class.spell(node.own()),
    children: node.entries().map(([key, child]) => [toHex(key), spellRequired(child)]),
  };
}

function handleRequired(request) {
  if (request.op === "required.equal") {
    return { equal: parseRequired(request.left).equalBy(parseRequired(request.right), SORTS.class.eq) };
  }
  const tree = parseRequired(request.tree);
  if (request.op === "required.roundtrip") {
    const { own, children } = tree.decompose();
    return defined(spellRequired(Node.compose(own, children)));
  }
  if (request.op === "required.at" || request.op === "required.valueAt") {
    const found = tree.at(path(request.path));
    if (found === undefined) return UNDEFINED;
    return defined(request.op === "required.valueAt" ? SORTS.class.spell(found.own()) : spellRequired(found));
  }
  if (request.op === "required.attach") {
    const result = attach(tree, path(request.parent), fromHex(request.key), parseRequired(request.subtree));
    return result === undefined ? UNDEFINED : defined(spellRequired(result));
  }
  return { error: "unsupported" };
}

function handle(request) {
  if (request.op.startsWith("codec.")) return handleCodec(request);
  if (request.op.startsWith("mnode.")) return handleMandatory(request, replace, attach);
  if (request.op.startsWith("required.")) return handleRequired(request);
  const { op } = request;

  if (op === "core.equal") {
    const { member, eq } = SORTS.class;
    const left = read(request, request.left, member);
    const right = read(request, request.right, member);
    return { equal: left.equalBy(right, optionEqual(eq)) };
  }

  if (op === "core.build") {
    try {
      read(request, request.node, SORTS.class.member);
    } catch (error) {
      return refusal(error);
    }
    return { ok: true };
  }

  if (op === "pos.key") return { key: toHex(posKey(BigInt(request.position))) };
  if (op === "pos.isKey") return { isKey: posIsKey(fromHex(request.bytes)) };

  if (["set.form", "set.recognize", "set.membership", "set.identity"].includes(op)) {
    const { member, e, eq } = SORTS[request.member];
    try {
      if (op === "set.form") {
        const built = setOf(request.members.map(member), e);
        const expected = read(request, request.node, member);
        return {
          equal: built.equalBy(expected, optionEqual(eq)) && expected.equalBy(built, optionEqual(eq)),
          recognized: isSet(built, e),
        };
      }
      if (op === "set.recognize") {
        const reason = recognize(read(request, request.node, member), e);
        return reason === undefined ? { isSet: true } : { isSet: false, reason };
      }
      if (op === "set.membership") {
        const built = setOf(request.members.map(member), e);
        return { in: request.queries.map((query) => contains(built, member(query), e)) };
      }
      const left = read(request, request.left, member);
      const right = read(request, request.right, member);
      return { equal: left.equalBy(right, optionEqual(eq)) };
    } catch (error) {
      return refusal(error);
    }
  }

  if (op.startsWith("node.")) {
    try {
      return handleNode(request);
    } catch (error) {
      return refusal(error);
    }
  }

  return { error: "unsupported" };
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  const response = handle(request);
  response.id = request.id;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function optionEqual(equal) {
  return (a, b) => a === undefined || b === undefined ? a === b : equal(a.value, b.value);
}
