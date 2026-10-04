import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DuplicateKeyError, Node, type Option, some } from "../../../core/ts/dist/index.js";
import { contains, isSet, recognize, setOf } from "./index.js";

const identity = (member: Uint8Array) => member;

interface Fixture {
  class: string;
  representation: string;
}

const classBytes = (member: Fixture) => new TextEncoder().encode(member.class);
const sameClass = (a: Fixture, b: Fixture) => a.class === b.class;
const octetEq = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

const text = (s: string) => new TextEncoder().encode(s);

const node = (own: Option<Uint8Array>, ...children: [Uint8Array, Node<Option<Uint8Array>>][]) =>
  Node.compose(own, children);
const member = (value: string) => node(some(text(value)));

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

test("enumeration is spelling order", () => {
  const built = setOf([text("b"), text("a")], identity);
  assert.deepEqual(built.keys(), [text("a"), text("b")]);
});

test("the second insert is not a node that exists", () => {
  assert.throws(
    () => setOf([text("k"), text("k")], identity),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateKeyError);
      assert.deepEqual(error.key, text("k"));
      return true;
    },
  );
});

test("a set is an unvalued node of valued childless members", () => {
  const built = setOf([text("a")], identity);
  assert.equal(built.own(), undefined);
  const a = built.get(text("a"));
  const own = a?.own();
  assert.ok(own && octetEq(own.value, text("a")) && a?.length === 0);
});

test("recognition is exact or refusal", () => {
  assert.equal(recognize(setOf([text("a")], identity), identity), undefined);
  // The empty set has nothing to be incoherent.
  assert.equal(recognize(node(undefined), identity), undefined);
  // Mis-keyed: key does not equal the member's bytes. Refused, never re-keyed.
  assert.equal(recognize(node(undefined, [text("x"), member("y")]), identity), "mis_keyed");
  // An unvalued child is the image of a Struct child.
  assert.equal(recognize(node(undefined, [text("k"), node(undefined)]), identity), "struct_member");
  // A valued node without children is well-formed deixis and simply not a set.
  assert.equal(recognize(member("k"), identity), "leaf_node");
  // New in N: the set node carries a value beside its members, even an empty one — a
  // presence check written as truthiness of the value would miss the second.
  for (const value of [text("v"), text("")]) {
    const valued = node(some(value), [text("a"), member("a")]);
    assert.equal(recognize(valued, identity), "valued_set_node");
  }
  // New in N: a member with a child, even an unvalued one.
  const grown = node(undefined, [text("a"), node(some(text("a")), [text("k"), node(undefined)])]);
  assert.equal(recognize(grown, identity), "member_with_children");
  assert.equal(isSet(grown, identity), false);
});

test("a set of handlers by registered name", () => {
  // The point of the slot-member form: members need not be data. A set of handlers,
  // self-keyed by registered name — membership and idempotence by name alone.
  interface Handler {
    name: string;
    run: () => number;
  }
  const byName = (handler: Handler) => new TextEncoder().encode(handler.name);

  const built = setOf(
    [
      { name: "route", run: () => 42 },
      { name: "other", run: () => 7 },
    ],
    byName,
  );
  assert.ok(isSet(built, byName));
  // A different closure — membership is by name.
  assert.ok(contains(built, { name: "route", run: () => 0 }, byName));

  const stored = built.get(text("route"))?.own();
  assert.ok(stored);
  assert.equal(stored.value.run(), 42);

  // Two handlers with one name are one member; the floor refuses the second.
  assert.throws(
    () =>
      setOf(
        [
          { name: "route", run: () => 1 },
          { name: "route", run: () => 2 },
        ],
        byName,
      ),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateKeyError);
      assert.deepEqual(error.key, text("route"));
      return true;
    },
  );
});

// ----- vector replay (vectors/set.json, vectors/node-set.json) ------------------------
//
// set.json is spelled in the previous model and is read through the embedding E of
// ADR 0009 §10.1, which is what node-set.json's five embedded laws say: each re-reads
// one kind of set.json case through E and pins the counts it re-reads, and a replayer
// must refuse when they differ. node-set.json's own cases are spelled in N, with own
// values spelled by the case's member encoder.

type Judge<T> = {
  member: (spelling: unknown) => T;
  e: (member: T) => Uint8Array;
  eq: (a: T, b: T) => boolean;
};

type Spelling = Record<string, unknown>;
type Construct = <T>(spelling: unknown, member: (spelling: unknown) => T) => Node<Option<T>>;

function children<T>(pairs: unknown, child: (spelling: unknown) => Node<Option<T>>) {
  assert.ok(Array.isArray(pairs), "children are a list");
  return pairs.map((pair): [Uint8Array, Node<Option<T>>] => {
    assert.ok(Array.isArray(pair) && pair.length === 2, "[hexKey, node] pair");
    assert.equal(typeof pair[0], "string");
    return [fromHex(pair[0] as string), child(pair[1])];
  });
}

/** E(n) from a previous-model spelling, leaf payloads parsed by `member`. */
const embed: Construct = (spelling, member) => {
  const n = spelling as Spelling;
  if ("leaf" in n) return Node.compose(some(member(n["leaf"])), []);
  if ("struct" in n) return Node.compose(undefined, children(n["struct"], (c) => embed(c, member)));
  assert.fail('a previous-model node is {"leaf": ...} or {"struct": ...}');
};

/** A node from its N[T] spelling, own values parsed by `member`. */
const build: Construct = (spelling, member) => {
  const n = spelling as Spelling;
  const own = n["own"] as Spelling;
  const keys = Object.keys(own);
  assert.equal(keys.length, 1, "an own value is exactly one of none and some");
  const value = keys[0] === "none" ? undefined : some(member(own["some"]));
  if (keys[0] !== "none") assert.equal(keys[0], "some");
  return Node.compose(value, children(n["children"], (c) => build(c, member)));
};

function runCase<T>(c: Spelling, judge: Judge<T>, construct: Construct): void {
  const name = c["name"] as string;
  const kind = c["kind"] as string;
  const members = () => (c["members"] as unknown[]).map(judge.member);

  if (kind === "form") {
    const built = setOf(members(), judge.e);
    const expected = construct(c["node"], judge.member);
    assert.ok(built.equalBy(expected, optionEqual(judge.eq)), `${name}: form`);
    assert.ok(expected.equalBy(built, optionEqual(judge.eq)), `${name}: form (flipped)`);
    assert.ok(isSet(built, judge.e), `${name}: a built set must recognize`);
  } else if (kind === "duplicate") {
    assert.equal(c["error"], "duplicate_key", name);
    assert.throws(
      () => setOf(members(), judge.e),
      (error: unknown) => {
        assert.ok(error instanceof DuplicateKeyError, `${name}: error type`);
        assert.deepEqual(error.key, fromHex(c["key"] as string), `${name}: key`);
        return true;
      },
      name,
    );
  } else if (kind === "recognize") {
    const reason = recognize(construct(c["node"], judge.member), judge.e);
    assert.equal(reason === undefined, c["valid"], name);
    // A refusal pins its reason only on a node with exactly one defect; a case without
    // one is judged on the verdict alone.
    if (c["valid"] === false && "reason" in c) assert.equal(reason, c["reason"], `${name}: reason`);
  } else if (kind === "membership") {
    const built = setOf(members(), judge.e);
    for (const query of c["queries"] as { value: unknown; in: boolean }[]) {
      assert.equal(
        contains(built, judge.member(query.value), judge.e),
        query.in,
        `${name}: query`,
      );
    }
  } else if (kind === "identity") {
    const left = construct(c["left"], judge.member);
    const right = construct(c["right"], judge.member);
    assert.equal(left.equalBy(right, optionEqual(judge.eq)), c["equal"], name);
    assert.equal(right.equalBy(left, optionEqual(judge.eq)), c["equal"], `${name} (flipped)`);
  } else {
    assert.fail(`${name}: unknown kind ${kind}`);
  }
}

const bytesJudge: Judge<Uint8Array> = {
  member: (spelling) => {
    assert.equal(typeof spelling, "string");
    return fromHex(spelling as string);
  },
  e: identity,
  eq: octetEq,
};
const classJudge: Judge<Fixture> = {
  member: (spelling) => {
    const leaf = spelling as Spelling;
    assert.equal(typeof leaf["class"], "string");
    assert.equal(typeof leaf["representation"], "string");
    return {
      class: leaf["class"] as string,
      representation: leaf["representation"] as string,
    };
  },
  e: classBytes,
  eq: sameClass,
};

function runSorted(c: Spelling, construct: Construct): void {
  const sort = c["member"];
  if (sort === "bytes") runCase(c, bytesJudge, construct);
  else if (sort === "class") runCase(c, classJudge, construct);
  else assert.fail(`unknown member sort ${String(sort)}`);
}

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../vectors/${name}`, import.meta.url), "utf8")) as {
    profile: string;
    form: string;
    cases: Spelling[];
  };

/** The counts one embedded law pins, checked against the set.json cases it re-reads. */
function checkPin(law: Spelling, source: Spelling[]): void {
  const count = (predicate: (c: Spelling) => boolean) => source.filter(predicate).length;
  const queries = source.flatMap((c) => (c["queries"] as { in: boolean }[] | undefined) ?? []);
  const got: Record<string, number> = {
    source_cases: source.length,
    source_valid: count((c) => c["valid"] === true),
    source_refused: count((c) => c["valid"] === false),
    source_queries: queries.length,
    source_in: queries.filter((q) => q.in).length,
    source_out: queries.filter((q) => !q.in).length,
    source_equal: count((c) => c["equal"] === true),
    source_not_equal: count((c) => c["equal"] === false),
  };
  const message = `${String(law["name"])}: set.json no longer matches the counts the law pins — an erratum to set.json, and the law must be re-checked by a person`;
  for (const [field, value] of Object.entries(got)) {
    if (field in law) assert.equal(law[field], value, `${message} (${field})`);
  }
  if ("source_reasons" in law) {
    const reasons: Record<string, number> = {};
    for (const c of source) {
      if (c["valid"] === false) {
        const reason = c["reason"] as string;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
    }
    assert.deepEqual(reasons, law["source_reasons"], `${message} (source_reasons)`);
  }
}

test("set vectors replay through the embedding", () => {
  const laws = read("node-set.json");
  const source = read("set.json");
  for (const file of [laws, source]) {
    assert.equal(file.profile, "deixis-set-v1");
    assert.equal(file.form, "slot-member");
  }

  const covered = new Set<string>();
  for (const law of laws.cases.filter((c) => c["kind"] === "embedded")) {
    assert.equal(law["source"], "set.json");
    const kind = law["source_kind"] as string;
    checkPin(law, source.cases.filter((c) => c["kind"] === kind));
    covered.add(kind);
  }
  assert.equal(covered.size, 5, "node-set.json states five embedded laws");

  for (const c of source.cases) {
    assert.ok(covered.has(c["kind"] as string), `set.json's ${String(c["kind"])} cases have no law`);
    runSorted(c, embed);
  }

  const own = laws.cases.filter((c) => c["kind"] !== "embedded");
  assert.ok(own.length >= 4, "node-set.json shrank?");
  for (const c of own) runSorted(c, build);
});

function optionEqual<T>(equal: (a: T, b: T) => boolean) {
  return (a: Option<T>, b: Option<T>) =>
    a === undefined || b === undefined ? a === b : equal(a.value, b.value);
}
