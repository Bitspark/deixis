import assert from "node:assert/strict";
import { test } from "node:test";

import { compose, DuplicateKeyError, Node, type DeixisNode, type Option, some } from "./index.js";

test("direct opaque payloads survive parts and attachment without option wrappers", () => {
  const child = Node.compose(() => 7, []);
  const handler = () => 42;
  const root = Node.compose(handler, [[bytes(107), child]]);
  assert.equal(root.own(), handler);
  assert.equal(root.at([bytes(107)])!.own()(), 7);
  assert.equal(root.at([bytes(120)]), undefined);
  const { own, children } = root.decompose();
  const rebuilt = Node.compose(own, children);
  assert.equal(rebuilt.own()(), 42);
  assert.equal(rebuilt.at([bytes(107)])!.own()(), 7);
});

test("undefined and option tags are payloads whose entire equality is supplied", () => {
  const raw = Node.compose(undefined, []);
  assert.equal(raw.at([]), raw);
  assert.equal(raw.own(), undefined);
  assert.equal(raw.at([bytes(120)]), undefined);
  assert.equal(raw.equalBy(raw, () => false), false);
  const absent = Node.compose<Option<number>>(undefined, []);
  const present = Node.compose<Option<number>>(some(7), []);
  assert.equal(absent.equalBy(present, () => true), true);
  assert.equal(absent.equalBy(present, (a, b) => a === b), false);
});

// A slot whose equality is deliberately coarser than its representation. If an
// implementation reached for native equality instead of the supplied relation, every
// test using this type would fail.
interface Fixture {
  class: string;
  representation: string;
}

const sameClass = (a: Fixture, b: Fixture) => a.class === b.class;
const sameOwn = (a: Option<Fixture>, b: Option<Fixture>) =>
  a === undefined || b === undefined ? a === b : sameClass(a.value, b.value);

const value = (cls: string, representation: string): Option<Fixture> =>
  some({ class: cls, representation });

const node = (own: Option<Fixture>, ...children: [Uint8Array, Node<Option<Fixture>>][]) =>
  Node.compose(own, children);

const valued = (cls: string, representation: string) => node(value(cls, representation));

const unvalued = () => node(undefined);

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (s: string) => new TextEncoder().encode(s);

test("None is not Some of an empty value", () => {
  const empty = node(value("", ""));
  assert.equal(empty.equalBy(unvalued(), sameOwn), false);
  assert.equal(unvalued().equalBy(empty, sameOwn), false);

  // The value is boxed, so undefined itself is a legal Some.
  const holdsUndefined = Node.compose<Option<undefined>>(some(undefined), []);
  const unvaluedUndefined = Node.compose<Option<undefined>>(undefined, []);
  assert.notEqual(holdsUndefined.own(), undefined);
  assert.equal(holdsUndefined.equalBy(unvaluedUndefined, (a, b) => a === b), false);
});

test("a node carries a value and children at once", () => {
  const n = node(value("7", "seven"), [text("k"), unvalued()]);
  assert.equal(n.own()?.value.class, "7");
  assert.ok(n.get(text("k")));
  assert.equal(n.length, 1);
});

test("identical children with different own values are different nodes", () => {
  const valuedParent = node(value("7", "seven"), [text("k"), unvalued()]);
  const unvaluedParent = node(undefined, [text("k"), unvalued()]);
  const otherValue = node(value("8", "seven"), [text("k"), unvalued()]);
  assert.equal(valuedParent.equalBy(unvaluedParent, sameOwn), false);
  assert.equal(valuedParent.equalBy(otherValue, sameOwn), false);
});

test("a value relocated to a child is a different node", () => {
  const atRoot = node(value("7", "seven"), [text("k"), unvalued()]);
  const atChild = node(undefined, [text("k"), valued("7", "seven")]);
  assert.equal(atRoot.equalBy(atChild, sameOwn), false);
});

test("equality is the supplied relation, not the native one", () => {
  const a = node(value("7", "seven"), [text("k"), valued("1", "one")]);
  const b = node(value("7", "SEVEN"), [text("k"), valued("1", "ONE")]);
  const c = node(value("9", "nine"), [text("k"), valued("1", "one")]);
  assert.notEqual(a.own()?.value.representation, b.own()?.value.representation);
  assert.ok(a.equalBy(b, sameOwn));
  assert.equal(a.equalBy(c, sameOwn), false);
});

test("keys are copied on construction", () => {
  const live = text("live");
  const n = node(undefined, [live, valued("1", "x")]);
  live.fill("!".charCodeAt(0));

  assert.ok(n.get(text("live")));
  assert.equal(n.get(text("!!!!")), undefined);
});

test("keys are copied on the way out", () => {
  const n = node(undefined, [text("k"), valued("1", "x")]);
  for (const out of [n.keys()[0]!, n.entries()[0]![0], n.decompose().children[0]![0]]) {
    out.fill(0);
    assert.ok(n.get(text("k")), "mutating a returned key must not touch the node");
  }
});

test("an opaque mutable payload is retained without cloning", () => {
  const box = { value: { class: "7", representation: "seven" } };
  const n = node(box);
  assert.equal(n.own(), box);
  box.value = { class: "8", representation: "eight" };
  assert.equal(n.own()?.value.class, "8");
});

test("keys are exact byte strings", () => {
  const n = node(
    undefined,
    [bytes(), valued("1", "empty key")],
    [bytes(1), valued("2", "one")],
    [bytes(1, 0), valued("3", "one zero")],
  );

  assert.ok(n.get(bytes()));
  assert.ok(n.get(bytes(1)));
  assert.ok(n.get(bytes(1, 0)));
  assert.equal(n.get(bytes(0, 1)), undefined);
  assert.equal(n.length, 3);
});

test("children are sorted regardless of insertion order", () => {
  const n = node(undefined, [text("b"), valued("2", "")], [text("a"), valued("1", "")]);
  assert.deepEqual(n.keys(), [text("a"), text("b")]);
});

test("duplicate keys are refused under any parent", () => {
  for (const own of [undefined, value("3", "valued")]) {
    assert.throws(
      () => node(own, [text("k"), valued("1", "first")], [text("k"), valued("2", "second")]),
      (thrown: unknown) =>
        thrown instanceof DuplicateKeyError &&
        thrown.code === "duplicate_key" &&
        new TextDecoder().decode(thrown.key) === "k",
    );
  }
});

test("decompose returns complete parts", () => {
  const original = node(
    value("7", "seven"),
    [text("b"), unvalued()],
    [text("a"), node(value("4", "a"), [text("g"), valued("5", "c")])],
  );
  const { own, children } = original.decompose();
  assert.equal(own?.value.class, "7");
  assert.equal(children.length, 2);
  // Children are whole subtrees, not their own values.
  assert.ok(children[0]![1].get(text("g")));

  assert.ok(Node.compose(own, children).equalBy(original, sameOwn));

  // A node without children returns an empty map, never a missing one.
  assert.deepEqual(valued("1", "x").decompose().children, []);
});

const nested = () =>
  node(undefined, [text("a"), node(value("4", "a"), [text("b"), valued("1", "deep")])]);

test("the empty path resolves to the node itself", () => {
  const n = nested();
  assert.ok(n.at([])?.equalBy(n, sameOwn));
});

test("resolution walks keys in order", () => {
  const n = nested();
  assert.equal(n.at([text("a"), text("b")])?.own()?.value.class, "1");
  // Order matters, and a miss is a miss — never a default, never a search.
  assert.equal(n.at([text("b"), text("a")]), undefined);
  assert.equal(n.at([text("a"), text("nope")]), undefined);
  // A childless node resolves no nonempty path, whatever its own value.
  assert.equal(n.at([text("a"), text("b"), text("c")]), undefined);
});

test("resolution passes through a valued node", () => {
  const n = nested();
  assert.equal(n.at([text("a")])?.own()?.value.class, "4");
  assert.ok(n.at([text("a"), text("b")]));
});

test("resolution is a partial monoid action", () => {
  const n = nested();
  const whole = n.at([text("a"), text("b")]);
  const staged = n.at([text("a")])?.at([text("b")]);
  assert.ok(whole && staged && whole.equalBy(staged, sameOwn));

  // Defined in exactly the same cases, including when neither is.
  assert.equal(n.at([text("x"), text("y")]), undefined);
  assert.equal(n.at([text("x")])?.at([text("y")]), undefined);
});

test("path elements are byte strings, not a delimited string", () => {
  // The empty key is a key, and a key may contain what a separator would be.
  const n = node(undefined, [bytes(), node(undefined, [text("a/b"), valued("1", "slash")])]);

  assert.ok(n.at([bytes(), text("a/b")]));
  // The two path elements do not concatenate into one.
  assert.equal(n.at([text("a/b")]), undefined);
  // The empty key and the empty path are different.
  assert.equal(n.at([])!.equalBy(n.at([bytes()])!, sameOwn), false);
});

test("the slot carries no bounds", () => {
  // Closures implement no meaningful equality and are still legal own values, beside
  // children or without them.
  type Handler = () => number;
  const route = Node.compose<Handler>(() => 42, []);
  const handlers = Node.compose<Handler>(() => 7, [[text("route"), route]]);
  assert.equal(handlers.get(text("route"))?.own()(), 42);
  assert.equal(handlers.own()(), 7);
});

test("DataTree and WireTree share selection and complete structure", async () => {
  interface Data { read(): Promise<Uint8Array> }
  interface Wire { send(message: string): void }
  const messages: string[] = [];
  const payload = bytes(0, 255);
  const data: Data = { async read() { return Uint8Array.from(payload); } };
  const wire: Wire = { send(message) { messages.push(message); } };
  const refusing: Wire = { send() { throw new Error("refused"); } };
  const key = bytes(255, 0); // Not a text-only key.
  const dataTree: DeixisNode<Data> = Node.compose(data, [[key, Node.compose(data, [])]]);
  const wireTree: DeixisNode<Wire> = Node.compose(wire, [[key, Node.compose(refusing, [])]]);

  assert.deepEqual(await dataTree.at([key])!.own().read(), payload);
  wireTree.at([])!.own().send("root");
  assert.deepEqual(messages, ["root"]);
  assert.throws(() => wireTree.at([key])!.own().send("child"), /refused/);
  assert.equal(wireTree.at([bytes(42)]), undefined);
  assert.equal(wireTree.children().length, 1, "a refusing Wire remains an existing child");

  for (const tree of [dataTree, wireTree] as const) {
    const child = tree.children()[0]!;
    child[0].fill(0);
    assert.ok(tree.at([key]), "structural keys are copied");
    assert.equal(tree.decompose().children.length, tree.children().length);
    assert.equal(tree.decompose().own, tree.own());
  }

  const parts = wireTree.decompose();
  const rebuilt = compose(parts.own, parts.children);
  assert.equal(rebuilt.own(), wireTree.own());
  assert.equal(rebuilt.at([]), rebuilt);
  assert.equal(rebuilt.at([key])!.own(), refusing);
  assert.deepEqual(rebuilt.children().map(([k]) => k), [key]);
  parts.children[0]![0].fill(0);
  rebuilt.children()[0]![0].fill(0);
  assert.equal(rebuilt.at([key])!.own(), refusing);
  assert.equal(rebuilt.at([bytes(0)]), undefined);
  assert.throws(() => compose(wire, [[key, wireTree], [key, wireTree]]), DuplicateKeyError);
});

test("generic structural selection does not recurse through a deep valid tree", () => {
  const key = bytes(1);
  const leaf = compose("leaf", []);
  let root = leaf;
  const depth = 12_000;
  for (let i = 0; i < depth; i++) root = compose("parent", [[key, root]]);
  assert.equal(root.at(Array.from({ length: depth }, () => key)), leaf);
});
