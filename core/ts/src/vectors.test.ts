// Replay of the hand-authored conformance vectors (vectors/ at the repo root), through
// the public API only. See vectors/README.md and vectors/NODE-PLAN.md for the spellings
// and the fixture setoid. The compiled test runs from dist/, so the vector files sit
// three levels up.
//
// identity.json is spelled in the previous model and is read through the embedding E of
// ADR 0009 §10.1, as node-embedding.json's embedded-identity law says, under the counts
// that law pins. invalid.json is not replayed: no fixture states a law over it in N, and
// node-invalid.json pins the duplicate-key refusals of N directly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DuplicateKeyError, Node, type Option, some } from "./index.js";

interface Fixture {
  class: string;
  representation: string;
}

const sameClass = (a: Fixture, b: Fixture) => a.class === b.class;
const sameOwn = (a: Option<Fixture>, b: Option<Fixture>) =>
  a === undefined || b === undefined ? a === b : sameClass(a.value, b.value);

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../vectors/${name}`, import.meta.url), "utf8"));

function fromHex(s: string): Uint8Array {
  assert.equal(s.length % 2, 0, `odd-length hex ${JSON.stringify(s)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
    assert.ok(Number.isInteger(byte), `bad hex ${JSON.stringify(s)}`);
    out[i] = byte;
  }
  return out;
}

type Spelling = Record<string, unknown>;

function object(spelling: unknown, what: string): Spelling {
  assert.ok(spelling !== null && typeof spelling === "object" && !Array.isArray(spelling), what);
  return spelling as Spelling;
}

function payload(spelling: unknown): Fixture {
  const p = object(spelling, "payload spelling");
  assert.equal(typeof p["class"], "string");
  assert.equal(typeof p["representation"], "string");
  return { class: p["class"] as string, representation: p["representation"] as string };
}

/**
 * Decode a [[hexKey, node], …] list, feeding the children to the constructor in file
 * (insertion) order — the construction owns sorting and duplicate refusal.
 */
function children(pairs: unknown, child: (spelling: unknown) => Node<Option<Fixture>>) {
  assert.ok(Array.isArray(pairs), "children are a list");
  return pairs.map((pair): [Uint8Array, Node<Option<Fixture>>] => {
    assert.ok(Array.isArray(pair) && pair.length === 2, "[hexKey, node] pair");
    assert.equal(typeof pair[0], "string");
    return [fromHex(pair[0] as string), child(pair[1])];
  });
}

function ownOf(spelling: unknown): Option<Fixture> {
  const own = object(spelling, "own value spelling");
  const keys = Object.keys(own);
  assert.equal(keys.length, 1, "an own value is exactly one of none and some");
  if (keys[0] === "none") return undefined;
  assert.equal(keys[0], "some");
  return some(payload(own["some"]));
}

/** Build a node from its N[T] spelling: {"own": …, "children": [[hexKey, node], …]}. */
function build(spelling: unknown): Node<Option<Fixture>> {
  const node = object(spelling, "node spelling");
  return Node.compose(ownOf(node["own"]), children(node["children"], build));
}

/**
 * E(n) from a previous-model spelling, {"leaf": payload} or {"struct": […]}:
 * E(Leaf(t)) = Node(Some(t), ∅) and E(Struct(m)) = Node(None, k ↦ E(m(k))).
 */
function embed(spelling: unknown): Node<Option<Fixture>> {
  const node = object(spelling, "node spelling");
  if ("leaf" in node) return Node.compose(some(payload(node["leaf"])), []);
  if ("struct" in node) return Node.compose(undefined, children(node["struct"], embed));
  assert.fail('a previous-model node is {"leaf": …} or {"struct": …}');
}

interface IdentityCase {
  name: string;
  left: unknown;
  right: unknown;
  equal: boolean;
}

/**
 * Judge one identity case both ways round, and reflexivity; report whether it is an
 * equal judgment between nodes whose root representations differ.
 */
function judgeIdentity(c: IdentityCase, construct: (spelling: unknown) => Node<Option<Fixture>>) {
  const left = construct(c.left);
  const right = construct(c.right);

  assert.equal(left.equalBy(right, sameOwn), c.equal, c.name);
  // Equality is symmetric; the judgment must not depend on argument order.
  assert.equal(right.equalBy(left, sameOwn), c.equal, `${c.name} (flipped)`);
  // And every node equals itself under the fixture relation.
  assert.ok(left.equalBy(left, sameOwn), `${c.name} (left reflexive)`);
  assert.ok(right.equalBy(right, sameOwn), `${c.name} (right reflexive)`);

  const l = left.own();
  const r = right.own();
  return c.equal && l !== undefined && r !== undefined && l.value.representation !== r.value.representation;
}

test("identity vectors replay through the embedding", () => {
  // The embedded-identity law of node-embedding.json: for every case of identity.json,
  // E(left) ≡ E(right) in N iff the case's `equal` is true. The law pins the source's
  // counts, and a replayer must refuse when they differ.
  const laws = read("node-embedding.json") as {
    profile: string;
    cases: {
      name: string;
      op: string;
      source?: string;
      source_cases?: number;
      source_equal?: number;
      source_not_equal?: number;
    }[];
  };
  assert.equal(laws.profile, "deixis-node-embedding");
  const law = laws.cases.find((c) => c.op === "embedded-identity");
  assert.ok(law && law.source === "identity.json", "the embedded-identity law over identity.json");

  const file = read("identity.json") as { profile: string; cases: IdentityCase[] };
  assert.equal(file.profile, "deixis-core-identity");
  const equal = file.cases.filter((c) => c.equal).length;
  assert.deepEqual(
    [file.cases.length, equal, file.cases.length - equal],
    [law.source_cases, law.source_equal, law.source_not_equal],
    `${law.name}: identity.json no longer matches the counts the law pins — an erratum to ` +
      "identity.json, and the law must be re-checked by a person",
  );

  // The vectors must themselves exercise the coarseness of ≈: at least one equal
  // judgment between values whose representations differ, or they could not tell a
  // lifted relation from native equality.
  let coarsenessExercised = false;
  for (const c of file.cases) coarsenessExercised = judgeIdentity(c, embed) || coarsenessExercised;
  assert.ok(coarsenessExercised, "no equal judgment between values with differing representations");
});

test("node identity vectors replay", () => {
  const file = read("node-identity.json") as { profile: string; cases: IdentityCase[] };
  assert.equal(file.profile, "deixis-node-identity");
  assert.ok(file.cases.length >= 20, "vector file shrank?");

  let coarsenessExercised = false;
  for (const c of file.cases) coarsenessExercised = judgeIdentity(c, build) || coarsenessExercised;
  assert.ok(coarsenessExercised, "no equal judgment between values with differing representations");
});

test("node invalid vectors replay", () => {
  const file = read("node-invalid.json") as {
    profile: string;
    cases: { name: string; node: unknown; error: string; key: string }[];
  };
  assert.equal(file.profile, "deixis-node-invalid");
  assert.ok(file.cases.length >= 6, "vector file shrank?");

  for (const { name, node, error, key } of file.cases) {
    assert.equal(error, "duplicate_key", name);
    const expectedKey = fromHex(key);

    assert.throws(
      () => build(node),
      (thrown: unknown) => {
        assert.ok(thrown instanceof DuplicateKeyError, `${name}: error type`);
        assert.equal(thrown.code, "duplicate_key", name);
        assert.deepEqual(thrown.key, expectedKey, `${name}: offending key`);
        return true;
      },
      name,
    );
  }
});

test("node navigation vectors replay", () => {
  // The navigation laws of node-navigation.json: at, the own value read off the node at
  // a path (valueAt), and at composed with itself (S1).
  const file = read("node-navigation.json") as {
    profile: string;
    cases: {
      name: string;
      op: string;
      tree: unknown;
      path?: string[];
      first?: string[];
      then?: string[];
      expected: { defined?: unknown; undefined?: unknown };
    }[];
  };
  assert.equal(file.profile, "deixis-node-navigation");

  const path = (keys: string[] | undefined) => (keys ?? []).map(fromHex);
  for (const c of file.cases) {
    const tree = build(c.tree);
    let found: Node<Option<Fixture>> | undefined;
    if (c.op === "at" || c.op === "valueAt") found = tree.at(path(c.path));
    else if (c.op === "at-compose") found = tree.at(path(c.first))?.at(path(c.then));
    else assert.fail(`${c.name}: unknown op ${c.op}`);

    assert.notEqual("defined" in c.expected, "undefined" in c.expected, c.name);
    if ("undefined" in c.expected) {
      assert.equal(found, undefined, `${c.name}: defined, want undefined`);
      continue;
    }
    assert.ok(found, `${c.name}: undefined, want defined`);
    if (c.op === "valueAt") {
      const want = ownOf(c.expected.defined);
      const actual = found.own();
      if (want === undefined) assert.equal(actual, undefined, `${c.name}: want None`);
      else assert.ok(actual && sameClass(actual.value, want.value), `${c.name}: value`);
    } else {
      assert.ok(found.equalBy(build(c.expected.defined), sameOwn), `${c.name}: node found`);
    }
  }
});
