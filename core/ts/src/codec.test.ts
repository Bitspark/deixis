// Property tests of deixis-codec-v2 (docs/CODEC.md) over generated trees.
//
// No expected encoding is written here: every octet string under test is produced by the
// encoder, by a mutation of the encoder's output, or by a field-by-field assembler of a
// deliberately defective artifact whose verdict — never its octets — is what is checked.
// The independent corpus (vectors/codec-v2-*.json) is judged through the conformance CLI,
// not read here.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  type Fetch,
  type HeaderVerdict,
  type LimitsInput,
  type SlotCodec,
  type StreamVerdict,
  FLOORS,
  FlatDecoder,
  FlatHeaderReader,
  LinkedChunk,
  Registry,
  address,
  addressKey,
  checkClosure,
  chunkAddress,
  classOf,
  decodeCuvarint,
  decodeFlat,
  decodeLinked,
  encodeCuvarint,
  encodeFlat,
  encodeLinked,
  estimateUnfolded,
  flattenClosure,
  identityBytes,
  optionOf,
  parseSlotCodecId,
  readFlatHeader,
} from "./codec.js";
import { limitsOf, traverse } from "./codec-internal.js";
import { Node, type Option, some } from "./index.js";

// --- octets ---------------------------------------------------------------------------

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const text = (s: string) => new TextEncoder().encode(s);
const octets = (...values: number[]) => Uint8Array.from(values);
const EMPTY = new Uint8Array(0);
const cu = (n: number | bigint) => encodeCuvarint(BigInt(n));
const sha = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// --- a coarse slot: ≈ compares `class`, and e encodes only it ---------------------------

interface Classed {
  class: string;
  representation: string;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const coarse: SlotCodec<Classed> = {
  // A private id whose namespace is derived from a string distinctive to these tests.
  id: concat(octets(0x01), sha(text("deixis core/ts codec tests: a coarse class setoid")).subarray(0, 16), octets(0x01)),
  equal: (a, b) => a.class === b.class,
  encode: (value) => text(value.class),
  decode: (payload) => {
    try {
      return some({ class: strictUtf8.decode(payload), representation: "" });
    } catch {
      return undefined;
    }
  },
};

const IDENTITY = identityBytes.id;
/** Octet equality, typed for decoded nodes, whose payloads are `unknown`. */
const sameOctets = identityBytes.equal as (a: unknown, b: unknown) => boolean;
const HOLD_ALL = new Registry([identityBytes, coarse]);
const BLIND = new Registry();

// --- generated trees ------------------------------------------------------------------

function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    int,
    chance: (p: number) => next() < p,
    octets: (n: number) => Uint8Array.from({ length: n }, () => int(256)),
  };
}
type Random = ReturnType<typeof random>;

/** Distinct keys, with the edges §5 cares about: the empty key, prefixes, non-UTF-8. */
function keysFor(r: Random, count: number): Uint8Array[] {
  const keys = new Map<string, Uint8Array>();
  for (let tries = 0; keys.size < count && tries < 20 * count; tries++) {
    const existing = [...keys.values()];
    const base = existing[r.int(existing.length)];
    let key: Uint8Array;
    switch (r.int(6)) {
      case 0:
        key = EMPTY;
        break;
      case 1:
        key = base === undefined ? r.octets(2) : base.slice(0, r.int(base.length + 1));
        break;
      case 2:
        key = base === undefined ? r.octets(1) : concat(base, r.octets(1));
        break;
      case 3:
        key = octets([0x00, 0x80, 0xc0, 0xfe, 0xff][r.int(5)]!);
        break;
      default:
        key = r.octets(1 + r.int(3));
    }
    keys.set(hex(key), key);
  }
  return [...keys.values()];
}

function tree<T>(r: Random, own: (r: Random) => T, depth: number, width: number): Node<T> {
  const keys = depth > 0 ? keysFor(r, r.int(width + 1)) : [];
  return Node.compose(
    own(r),
    keys.map((key): [Uint8Array, Node<T>] => [key, tree(r, own, depth - 1, width)]),
  );
}

const blob = (r: Random) => (r.chance(0.04) ? r.octets(128 + r.int(8)) : r.octets(r.int(4)));
const optional = <T>(inner: (r: Random) => T) => (r: Random): Option<T> => (r.chance(0.3) ? undefined : some(inner(r)));
const CLASSES = ["", "a", "b", "é", "日本", "\u{1F600}", "\uFEFFbom"];
const classed = (r: Random): Classed => ({ class: CLASSES[r.int(CLASSES.length)]!, representation: String(r.int(1000)) });

interface Case {
  readonly name: string;
  readonly codec: SlotCodec<any>;
  readonly own: (r: Random) => unknown;
}

const CASES: Case[] = [
  { name: "identity-bytes", codec: identityBytes, own: blob },
  { name: "option-of(identity-bytes)", codec: optionOf(identityBytes), own: optional(blob) },
  { name: "coarse", codec: coarse, own: classed },
  { name: "option-of(coarse)", codec: optionOf(coarse), own: optional(classed) },
  { name: "option-of(option-of(identity-bytes))", codec: optionOf(optionOf(identityBytes)), own: optional(optional(blob)) },
];

/** A few encodings per codec, small enough to mutate exhaustively. */
function smallEncodings(seed: number, perCodec: number): { name: string; codec: SlotCodec<any>; bytes: Uint8Array }[] {
  const out = [];
  for (const { name, codec, own } of CASES) {
    const r = random(seed);
    for (let i = 0; i < perCodec; i++) out.push({ name, codec, bytes: encodeFlat(tree(r, own, 2, 2), codec) });
  }
  return out;
}

// --- verdicts -------------------------------------------------------------------------

type AnyVerdict =
  | StreamVerdict<unknown>
  | HeaderVerdict
  | ReturnType<typeof decodeLinked>
  | ReturnType<typeof checkClosure>
  | ReturnType<typeof flattenClosure>
  | ReturnType<typeof decodeCuvarint>
  | ReturnType<typeof estimateUnfolded>
  | ReturnType<typeof LinkedChunk.resolveRoot>
  | ReturnType<LinkedChunk["resolveChild"]>
  | ReturnType<LinkedChunk["own"]>
  | ReturnType<typeof parseSlotCodecId>
  | ReturnType<typeof traverse>;

/** One line per verdict: an accepted value is shown by its canonical re-encoding. */
function describe(v: AnyVerdict): string {
  if (v === undefined) return "undefined";
  if (v instanceof LinkedChunk) return `chunk ${addressKey(v.address)}`;
  if (!("class" in v)) return `walked ${v.order.length} chunks`;
  switch (v.class) {
    case "accepted":
      if ("end" in v) return `accepted ${v.value} to ${v.end}`;
      if ("form" in v) return `accepted form ${v.form.form}`;
      if ("own" in v) return `accepted own ${hex(v.codec.encode(v.own))}`;
      if ("value" in v) return `accepted ${hex(encodeFlat(v.value, v.codec))}`;
      if ("bytes" in v) return `accepted ${hex(v.bytes)}`;
      return `accepted header ${hex(v.id)}`;
    case "resource-refused":
      return `resource-refused/limit_exceeded/${v.dimension}`;
    case "store":
      return `store/${v.code}/${addressKey(v.address)}`;
    case "closure-present":
      return `closure-present ${hex(v.id)} ${v.chunks}`;
    case "estimated":
      return `estimated ${v.nodes} ${v.flatOctets} ${v.depth}`;
    default:
      return `${v.class}/${v.code}`;
  }
}

function accepted<V extends AnyVerdict>(v: V, what = ""): Extract<V, { class: "accepted" }> {
  assert.ok(v !== undefined && "class" in v && v.class === "accepted", `${what}: ${describe(v)}`);
  return v as Extract<V, { class: "accepted" }>;
}

const expectCode = (v: AnyVerdict, code: string, what = "") =>
  assert.equal(describe(v), code.includes("/") ? code : `invalid/${code}`, what);
const expectLimit = (v: AnyVerdict, dimension: string, what = "") =>
  assert.equal(describe(v), `resource-refused/limit_exceeded/${dimension}`, what);

/** Feed `input` in the pieces `cuts` makes; declare end of input iff `end`. */
function streamed(input: Uint8Array, cuts: readonly number[], registry: Registry, end = true, limits?: LimitsInput) {
  const decoder = new FlatDecoder(registry, limits);
  let state: StreamVerdict<unknown> = decoder.feed(EMPTY);
  let start = 0;
  for (const cut of [...cuts, input.length]) {
    state = decoder.feed(input.subarray(start, cut));
    start = cut;
  }
  return end ? decoder.finish() : state;
}

/** Every single cut, byte at a time, and a few random multi-cuts. */
function splits(length: number, r: Random): number[][] {
  const out: number[][] = [];
  for (let i = 1; i < length; i++) out.push([i]);
  if (length > 2) out.push(Array.from({ length: length - 1 }, (_, i) => i + 1));
  for (let k = 0; k < 3 && length > 3; k++) {
    const cuts = new Set<number>();
    for (let j = 0; j < 1 + r.int(4); j++) cuts.add(1 + r.int(length - 1));
    out.push([...cuts].sort((a, b) => a - b));
  }
  return out;
}

/** The verdict must not depend on how the input is cut (§14), nor on end being declared late. */
function assertSplitInvariant(input: Uint8Array, registry: Registry, r: Random, limits?: LimitsInput, what = "") {
  const whole = describe(decodeFlat(input, registry, limits));
  for (const cuts of splits(input.length, r)) {
    assert.equal(describe(streamed(input, cuts, registry, true, limits)), whole, `${what} split ${cuts.join(",")} of ${hex(input)}`);
  }
  return whole;
}

// --- cuvarint (§3) ----------------------------------------------------------------------

const width = (v: bigint) => Math.max(1, Math.ceil(v.toString(2).length / 7));

test("cuvarint: every width boundary round-trips, in its shortest spelling", () => {
  const values = new Set<bigint>([0n, (1n << 64n) - 1n, 1n << 63n, (1n << 63n) - 1n]);
  for (let k = 1; k <= 9; k++) {
    values.add((1n << BigInt(7 * k)) - 1n);
    values.add(1n << BigInt(7 * k));
  }
  for (const v of values) {
    const spelled = encodeCuvarint(v);
    assert.equal(spelled.length, width(v), `C(${v})`);
    assert.deepEqual(decodeCuvarint(spelled), { class: "accepted", value: v, end: spelled.length }, `C(${v})`);
    // Read inside a longer input, it ends where its last octet does.
    const inside = decodeCuvarint(concat(octets(0xaa), spelled, octets(0x80)), 1);
    assert.deepEqual(inside, { class: "accepted", value: v, end: spelled.length + 1 });
  }
  assert.throws(() => encodeCuvarint(-1n), RangeError);
  assert.throws(() => encodeCuvarint(1n << 64n), RangeError);
});

test("cuvarint: longer, overlong, overflowing and truncated spellings get §3's codes", () => {
  const r = random(3);
  for (let i = 0; i < 400; i++) {
    const v = BigInt(r.int(2 ** 30)) * BigInt(1 + r.int(2 ** 30)) >> BigInt(r.int(60));
    const shortest = encodeCuvarint(v);
    // A longer spelling of the same value: continue the last octet with zero groups.
    for (let extra = 1; shortest.length + extra <= 10; extra++) {
      const longer = concat(shortest, new Uint8Array(extra));
      for (let j = shortest.length - 1; j < longer.length - 1; j++) longer[j]! |= 0x80;
      expectCode(decodeCuvarint(longer), "non_shortest_uvarint", `${v} in ${longer.length} octets`);
    }
    // Eleven octets or more is malformed whatever the tenth-and-later octets say.
    const eleven = concat(shortest, new Uint8Array(11 - shortest.length));
    for (let j = 0; j < 10; j++) eleven[j]! |= 0x80;
    expectCode(decodeCuvarint(eleven), "malformed_uvarint", `${v} in eleven octets`);
    // Cut off with its continuation bit set.
    if (shortest.length > 1) expectCode(decodeCuvarint(shortest.subarray(0, shortest.length - 1)), "malformed_uvarint");
  }
  // Ten octets whose last carries more than bit 63 denote a value ≥ 2^64.
  for (let last = 2; last < 0x80; last++) {
    expectCode(decodeCuvarint(concat(new Uint8Array(9).fill(0xff), octets(last))), "uvarint_overflow", `last ${last}`);
  }
  expectCode(decodeCuvarint(EMPTY), "unexpected_eof");
  expectCode(decodeCuvarint(octets(0x80)), "malformed_uvarint");
});

// --- slot codecs and ids (§4, §13) --------------------------------------------------------

test("option-of: D accepts exactly 00 and 01 ‖ b with b in the image of the inner e", () => {
  const o = optionOf(identityBytes);
  const check = (p: Uint8Array) => {
    const d = o.decode(p);
    const expected = (p.length === 1 && p[0] === 0x00) || (p.length >= 1 && p[0] === 0x01);
    assert.equal(d !== undefined, expected, hex(p));
    if (d !== undefined) assert.deepEqual(o.encode(d.value), p, hex(p));
  };
  check(EMPTY);
  for (let a = 0; a < 256; a++) {
    check(octets(a));
    for (let b = 0; b < 256; b++) check(octets(a, b));
  }
  const oc = optionOf(coarse);
  assert.equal(oc.decode(octets(0x01, 0xff)), undefined, "Some over a payload outside the inner image");
  assert.equal(oc.decode(octets(0x01, 0xc0, 0x80)), undefined, "an overlong UTF-8 spelling");
  assert.deepEqual(oc.decode(concat(octets(0x01), text("é")))?.value?.value.class, "é");
  // None and Some(empty) differ, and ≈ never relates them.
  assert.equal(o.equal(undefined, some(EMPTY)), false);
  assert.notDeepEqual(o.encode(undefined), o.encode(some(EMPTY)));
});

test("slot-codec-ids: the whole id is bounded at 32 octets, which is what bounds option-of nesting", () => {
  let codec: SlotCodec<any> = identityBytes;
  let value: unknown = octets(0xaa);
  for (let depth = 1; depth <= 30; depth++) {
    codec = optionOf(codec);
    value = some(value);
    assert.equal(codec.id.length, 2 + depth);
    const held = HOLD_ALL.lookup(codec.id);
    assert.ok(held !== undefined, `option-of nested ${depth} times over a held id is held`);
    assert.deepEqual(held.id, codec.id);
  }
  assert.equal(codec.id.length, 32);
  assert.throws(() => optionOf(codec), RangeError);
  // Thirty levels round-trip, flat and linked: nesting is capped by the id's length alone.
  const node = Node.compose(value, []);
  const flat = encodeFlat(node, codec);
  const decoded = accepted(decodeFlat(flat, HOLD_ALL), "the id at the bound");
  assert.deepEqual(encodeFlat(decoded.value, decoded.codec), flat);
  assert.deepEqual(accepted(readFlatHeader(flat, HOLD_ALL)).id, codec.id);
  const linked = encodeLinked(node, codec);
  accepted(decodeLinked(linked.root, (a) => linked.chunks.get(addressKey(a)), HOLD_ALL));
  // One more option-of octet makes a 33-octet id, refused when its length is read.
  const over = concat(octets(0x02), codec.id);
  expectCode(parseSlotCodecId(over), "malformed_slot_codec_id");
  const artifact = concat(text("dxf2"), cu(over.length), over, octets(0x00, 0x00));
  expectCode(decodeFlat(artifact, HOLD_ALL), "malformed_slot_codec_id");
  expectCode(streamed(artifact.subarray(0, 5), [], HOLD_ALL, false), "malformed_slot_codec_id", "never need_more_input");
});

test("slot-codec-ids: an accepted id is exactly one id of its form", () => {
  // Every id of two to four octets over octets that matter to the grammar.
  const alphabet = [0x00, 0x01, 0x02, 0x03, 0x05, 0x7f, 0x80, 0x81, 0xff];
  const spell = (form: any): Uint8Array =>
    form.form === "option-of"
      ? concat(octets(0x02), spell(form.inner))
      : form.form === "public"
        ? concat(octets(0x00), cu(form.n))
        : concat(octets(0x01), form.namespace, cu(form.k));
  const ids: Uint8Array[] = [];
  const extend = (prefix: number[]) => {
    if (prefix.length >= 2) ids.push(Uint8Array.from(prefix));
    if (prefix.length < 4) for (const a of alphabet) extend([...prefix, a]);
  };
  extend([]);
  for (const id of ids) {
    const parsed = parseSlotCodecId(id);
    if (parsed.class !== "accepted") {
      assert.ok(["malformed_slot_codec_id", "malformed_uvarint", "non_shortest_uvarint"].includes(parsed.code), hex(id));
      continue;
    }
    let form: any = parsed.form;
    let wrappers = 0;
    while (form.form === "option-of") {
      form = form.inner;
      wrappers++;
    }
    if (form.form === "reserved") {
      assert.ok(form.first >= 0x03, hex(id));
      assert.equal(id[wrappers], form.first, hex(id));
    } else {
      assert.deepEqual(spell(parsed.form), id, `${hex(id)} is one id of its form`);
      assert.ok(form.form !== "public" || form.n >= 1n, hex(id));
    }
  }
  // The clauses of §13, one id each; the id is a bounded input.
  const ns = new Uint8Array(16).fill(0x5a);
  const judged: [Uint8Array, string][] = [
    [octets(0x00), "malformed_slot_codec_id"], // too short
    [octets(0x00, 0x00), "malformed_slot_codec_id"], // n = 0
    [octets(0x00, 0x80, 0x00), "non_shortest_uvarint"], // the integer rows first
    [octets(0x00, 0x7f, 0x05), "malformed_slot_codec_id"], // an octet left over
    [octets(0x00, 0xff), "malformed_uvarint"], // an integer reaching the id's end
    [octets(0x02, 0x00), "malformed_slot_codec_id"], // `00` alone
    [octets(0x02, 0x02), "malformed_slot_codec_id"], // `02` with nothing after it
    [concat(octets(0x01), ns.subarray(0, 15)), "malformed_slot_codec_id"], // namespace cut short
    [concat(octets(0x01), ns), "malformed_slot_codec_id"], // no k
    [concat(octets(0x01), ns, octets(0x80)), "malformed_uvarint"],
    [concat(octets(0x00), new Uint8Array(10).fill(0xff), octets(0x01)), "malformed_uvarint"], // eleven octets
  ];
  for (const [id, code] of judged) expectCode(parseSlotCodecId(id), code, hex(id));
  for (const id of [octets(0x02, 0x03), octets(0x03, 0x00), octets(0xff, 0xff), octets(0x00, 0x05), concat(octets(0x01), ns, octets(0x00))]) {
    assert.equal(parseSlotCodecId(id).class, "accepted", hex(id));
    assert.equal(HOLD_ALL.lookup(id), undefined, `${hex(id)} is not held`);
  }
});

test("registry: holds what it is given, derives option-of, and refuses ids that cannot name a codec", () => {
  assert.equal(new Registry([identityBytes]).lookup(coarse.id), undefined);
  assert.equal(new Registry([identityBytes]).lookup(optionOf(coarse).id), undefined);
  assert.deepEqual(new Registry([coarse]).lookup(optionOf(coarse).id)?.id, optionOf(coarse).id);
  // An option-of codec registered as such is held, and so is option-of over it.
  const o = optionOf(identityBytes);
  const onlyOption = new Registry([o]);
  assert.equal(onlyOption.lookup(IDENTITY), undefined);
  assert.deepEqual(onlyOption.lookup(optionOf(o).id)?.id, optionOf(o).id);
  const named = (id: Uint8Array): SlotCodec<Uint8Array> => ({ ...identityBytes, id });
  assert.throws(() => new Registry([named(octets(0x00, 0x00))]), RangeError);
  assert.throws(() => new Registry([named(octets(0x03, 0x01))]), RangeError);
  assert.throws(() => new Registry([named(octets(0x02, 0x03))]), RangeError);
  assert.throws(() => new Registry([identityBytes, named(IDENTITY)]), Error);
  assert.throws(() => encodeFlat(Node.compose(EMPTY, []), named(octets(0x00, 0x00))), RangeError);
  assert.throws(() => encodeLinked(Node.compose(EMPTY, []), named(octets(0xff, 0x00))), RangeError);
});

test("classOf gives every code its §9 class, and the store's codes none", () => {
  const invalidCodes = [
    "malformed_uvarint", "non_shortest_uvarint", "uvarint_overflow", "unknown_magic", "duplicate_key",
    "unsorted_keys", "trailing_bytes", "unexpected_eof", "bad_link_index", "unused_link",
    "duplicate_link_hash", "links_out_of_order", "slot_codec_mismatch", "malformed_slot_codec_id",
    "non_canonical_payload",
  ] as const;
  for (const code of invalidCodes) assert.equal(classOf(code), "invalid", code);
  assert.equal(classOf("unsupported_slot_codec"), "unsupported");
  assert.equal(classOf("need_more_input"), "incomplete");
  assert.equal(classOf("limit_exceeded"), "resource-refused");
  for (const code of ["missing_chunk", "hash_mismatch", "address_conflict"] as const) assert.equal(classOf(code), "store");
});

// --- the flat form (§5, §8 law 1) ---------------------------------------------------------

test("flat: generated trees round-trip, and accepted octets re-encode to themselves", () => {
  for (const { name, codec, own } of CASES) {
    const r = random(1);
    for (let i = 0; i < 120; i++) {
      const n = tree(r, own, 1 + r.int(4), 1 + r.int(4));
      const bytes = encodeFlat(n, codec);
      const v = accepted(decodeFlat(bytes, HOLD_ALL), name);
      assert.ok(v.value.equalBy(n, codec.equal), `${name}: decF(encF(n)) =≈ n`);
      assert.deepEqual(v.codec.id, codec.id);
      assert.deepEqual(encodeFlat(v.value, v.codec), bytes, `${name}: encF(decF(b)) = b`);
      assert.deepEqual(accepted(readFlatHeader(bytes, HOLD_ALL)).id, codec.id);
    }
  }
});

test("flat: the shapes §5 singles out", () => {
  const leaf = (payload: Uint8Array) => Node.compose(payload, []);
  const shapes: [string, Node<Uint8Array>][] = [
    ["a childless node with an empty payload", leaf(EMPTY)],
    ["a payload at a parent", Node.compose(octets(0xaa), [[text("a"), leaf(octets(1))]])],
    ["the empty key", Node.compose(EMPTY, [[EMPTY, leaf(octets(1))]])],
    ["keys that are prefixes of each other", Node.compose(EMPTY, [["ab", "a", "", "abc", "b"].map(text)].flat().map((k): [Uint8Array, Node<Uint8Array>] => [k, leaf(k)]))],
    ["a length octet equal to a key octet", Node.compose(EMPTY, [[octets(1), leaf(octets(1))]])],
    ["a two-octet payload length", leaf(new Uint8Array(128).fill(0xaa))],
    ["a wide node", Node.compose(EMPTY, Array.from({ length: 3000 }, (_, i): [Uint8Array, Node<Uint8Array>] => [octets(i >> 8, i & 0xff), leaf(octets(i & 7))]))],
    ["a chain two hundred deep", Array.from({ length: 200 }).reduce<Node<Uint8Array>>((n, _, i) => Node.compose(octets(i), [[octets(i % 3), n]]), leaf(EMPTY))],
  ];
  for (const [name, n] of shapes) {
    const bytes = encodeFlat(n, identityBytes);
    const v = accepted(decodeFlat(bytes, HOLD_ALL), name);
    assert.ok(v.value.equalBy(n, sameOctets), name);
    assert.deepEqual(encodeFlat(v.value, v.codec), bytes, name);
  }
  // Insertion order is not observable: the same children given in another order.
  const children: [Uint8Array, Node<Uint8Array>][] = ["b", "ab", "a", ""].map((k) => [text(k), leaf(text(k))]);
  assert.deepEqual(encodeFlat(Node.compose(EMPTY, children), identityBytes), encodeFlat(Node.compose(EMPTY, [...children].reverse()), identityBytes));
  // The flat form has no sharing: a repeated subtree is spelled in full each time.
  const s = Node.compose(octets(1), [[text("c"), leaf(EMPTY)]]);
  const shared = encodeFlat(Node.compose(EMPTY, [[text("a"), s], [text("b"), s]]), identityBytes);
  const alone = encodeFlat(s, identityBytes);
  const sBody = alone.subarray(7); // past "dxf2" ‖ 02 ‖ 00 01
  assert.equal(hex(shared).split(hex(sBody)).length - 1, 2, "the subtree's octets appear twice");
});

/** Trees from a small space, so that ≈-equal pairs are common. */
function smallTree(r: Random, depth: number): Node<Classed> {
  const keys = depth > 0 ? ["", "k"].filter(() => r.chance(0.5)).map(text) : [];
  return Node.compose(
    { class: ["a", "b"][r.int(2)]!, representation: String(r.int(3)) },
    keys.map((k): [Uint8Array, Node<Classed>] => [k, smallTree(r, depth - 1)]),
  );
}

test("identity: equal octets and equal addresses exactly when the trees are ≈-equal (a coarse slot)", () => {
  const r = random(11);
  let equalPairs = 0;
  for (let i = 0; i < 3000; i++) {
    const n = smallTree(r, 2);
    const m = smallTree(r, 2);
    const same = n.equalBy(m, coarse.equal);
    equalPairs += same ? 1 : 0;
    assert.equal(hex(encodeFlat(n, coarse)) === hex(encodeFlat(m, coarse)), same, "flat");
    assert.equal(addressKey(encodeLinked(n, coarse).root) === addressKey(encodeLinked(m, coarse).root), same, "linked");
  }
  assert.ok(equalPairs > 100 && equalPairs < 2900, `both directions exercised (${equalPairs} equal pairs)`);
  // ≈-equal representatives: every representation changed, no octet and no address changes.
  for (let i = 0; i < 100; i++) {
    const n = tree(r, classed, 3, 3);
    const relabel = (x: Node<Classed>): Node<Classed> =>
      Node.compose({ class: x.own().class, representation: `${x.own().representation}!` }, x.entries().map(([k, c]): [Uint8Array, Node<Classed>] => [k, relabel(c)]));
    const m = relabel(n);
    assert.deepEqual(encodeFlat(m, coarse), encodeFlat(n, coarse));
    assert.equal(addressKey(encodeLinked(m, coarse).root), addressKey(encodeLinked(n, coarse).root));
  }
});

test("mutation: every single-octet change is refused, or decodes to what re-encodes as exactly those octets", () => {
  let acceptedMutants = 0;
  for (const { name, bytes } of smallEncodings(5, 4)) {
    for (let at = 0; at < bytes.length; at++) {
      for (let value = 0; value < 256; value++) {
        if (value === bytes[at]) continue;
        const mutant = Uint8Array.from(bytes);
        mutant[at] = value;
        const v = decodeFlat(mutant, HOLD_ALL);
        if (v.class === "accepted") {
          acceptedMutants++;
          assert.deepEqual(encodeFlat(v.value, v.codec), mutant, `${name}: ${hex(mutant)}`);
        } else {
          // A changed length or count can declare more than its §12 floor, and the reader
          // then declines at that field (limits are met in parse order), before it could
          // learn the input is too short. Nothing else is a resource refusal here.
          if (v.class === "resource-refused") {
            assert.ok(["key_length", "payload_length", "entries_per_node"].includes(v.dimension), `${name}: ${describe(v)}`);
          } else {
            assert.ok(v.class === "invalid" || v.class === "unsupported", `${name}: ${describe(v)}`);
          }
          assert.equal(classOf(v.code), v.class);
        }
      }
    }
  }
  assert.ok(acceptedMutants > 0, "some mutants are other values, and were checked as such");
});

test("flat: no proper prefix of an accepted artifact is accepted, and any octet after one trails", () => {
  for (const { name, bytes } of smallEncodings(9, 6)) {
    for (let k = 0; k < bytes.length; k++) {
      const v = decodeFlat(bytes.subarray(0, k), HOLD_ALL);
      assert.ok(v.class === "invalid" && (v.code === "unexpected_eof" || v.code === "malformed_uvarint"), `${name} prefix ${k}: ${describe(v)}`);
    }
    for (const extra of [0x00, 0x01, 0x80, 0xff]) expectCode(decodeFlat(concat(bytes, octets(extra)), HOLD_ALL), "trailing_bytes", name);
  }
});

test("streaming: every split reaches the whole-buffer verdict, open streams wait only where §14 says (F4)", () => {
  const r = random(13);
  const inputs: Uint8Array[] = [];
  for (const { bytes } of smallEncodings(17, 3)) {
    inputs.push(bytes);
    for (let i = 0; i < 6; i++) {
      const mutant = Uint8Array.from(bytes);
      mutant[r.int(mutant.length)] = r.int(256);
      inputs.push(mutant, mutant.subarray(0, r.int(mutant.length)), concat(mutant, r.octets(1 + r.int(2))));
    }
  }
  for (const input of inputs) {
    for (const registry of [HOLD_ALL, BLIND]) {
      const whole = assertSplitInvariant(input, registry, r);
      // With the stream open, the state is the final verdict once a fault is visible, and
      // need_more_input only where end of input could still change it.
      const open = describe(streamed(input, [], registry, false));
      if (open === whole) continue;
      assert.equal(open, "incomplete/need_more_input", hex(input));
      assert.ok(
        /^(accepted|unsupported\/)|^invalid\/(non_canonical_payload|unexpected_eof|malformed_uvarint)$/.test(whole),
        `open ${hex(input)} waits, but its whole verdict ${whole} does not depend on the end`,
      );
    }
  }
  // Every proper prefix of an accepted artifact, and the whole of it, waits with the stream open.
  for (const { bytes } of smallEncodings(19, 2)) {
    for (let k = 0; k <= bytes.length; k++) {
      expectCode(streamed(bytes.subarray(0, k), [], HOLD_ALL, false), "incomplete/need_more_input", `prefix ${k}`);
    }
  }
});

test("streaming: a final verdict sticks, and no octet is taken after end of input", () => {
  const good = encodeFlat(Node.compose(octets(1), []), identityBytes);
  const d = new FlatDecoder(HOLD_ALL);
  expectCode(d.feed(good), "incomplete/need_more_input");
  expectCode(d.feed(octets(0x00)), "trailing_bytes");
  expectCode(d.feed(good), "trailing_bytes");
  expectCode(d.finish(), "trailing_bytes");
  assert.throws(() => d.feed(good));
  const done = new FlatDecoder(HOLD_ALL);
  done.feed(good);
  accepted(done.finish());
  assert.throws(() => done.feed(EMPTY));
});

test("codec-blind: framing is judged in full, then unsupported — never a value (§11)", () => {
  const r = random(23);
  for (const { bytes } of smallEncodings(29, 3)) {
    for (let i = 0; i < 40; i++) {
      const mutant = Uint8Array.from(bytes);
      if (i > 0) mutant[r.int(mutant.length)] = r.int(256);
      const full = describe(decodeFlat(mutant, HOLD_ALL));
      const blind = describe(decodeFlat(mutant, BLIND));
      if (/^accepted|^unsupported\/|non_canonical_payload$/.test(full)) assert.equal(blind, "unsupported/unsupported_slot_codec", hex(mutant));
      else assert.equal(blind, full, hex(mutant));
    }
  }
});

test("flat-header-validator: magic and id only, on every split", () => {
  const r = random(31);
  for (const { codec, bytes } of smallEncodings(37, 2)) {
    const headerLength = 4 + 1 + codec.id.length;
    const header = bytes.subarray(0, headerLength);
    assert.deepEqual(accepted(readFlatHeader(header, HOLD_ALL)).id, codec.id, "the body is never read");
    assert.deepEqual(accepted(readFlatHeader(concat(header, octets(0xff, 0xff)), HOLD_ALL)).id, codec.id);
    expectCode(readFlatHeader(bytes, BLIND), "unsupported/unsupported_slot_codec");
    for (let k = 0; k < headerLength; k++) {
      const prefix = header.subarray(0, k);
      assert.match(describe(readFlatHeader(prefix, HOLD_ALL)), /^invalid\/(unexpected_eof|malformed_uvarint)$/, `prefix ${k}`);
      const open = new FlatHeaderReader(HOLD_ALL);
      expectCode(open.feed(prefix), "incomplete/need_more_input", `prefix ${k}, open`);
    }
    const whole = describe(readFlatHeader(bytes, HOLD_ALL));
    for (const cuts of splits(bytes.length, r)) {
      const reader = new FlatHeaderReader(HOLD_ALL);
      let start = 0;
      for (const cut of [...cuts, bytes.length]) {
        reader.feed(bytes.subarray(start, cut));
        start = cut;
      }
      assert.equal(describe(reader.finish()), whole);
    }
  }
  expectCode(readFlatHeader(text("dxf1"), HOLD_ALL), "unknown_magic");
  expectCode(readFlatHeader(text("dx"), HOLD_ALL), "unexpected_eof");
});

// --- the linked form (§6, §7, §8 law 2) -------------------------------------------------

const fetchFrom = (chunks: ReadonlyMap<string, Uint8Array>): Fetch => (where) => chunks.get(addressKey(where));

/** A store holding these chunks under their true digests (computed by the platform). */
function storeOf(chunks: Iterable<Uint8Array>): Fetch {
  const byDigest = new Map<string, Uint8Array>();
  for (const chunk of chunks) byDigest.set(hex(sha(chunk)), chunk);
  return (where) => byDigest.get(addressKey(where));
}

const addressOf = (chunk: Uint8Array) => address(sha(chunk));

test("linked: generated trees round-trip, flatten to the flat form, and check as present", () => {
  for (const { name, codec, own } of CASES) {
    const r = random(41);
    for (let i = 0; i < 60; i++) {
      const n = tree(r, own, 1 + r.int(4), 1 + r.int(3));
      const closure = encodeLinked(n, codec);
      for (const [key, chunk] of closure.chunks) assert.equal(hex(sha(chunk)), key, "a chunk is filed under its SHA-256");
      assert.equal(closure.root.space, "dxl2");
      assert.equal(addressKey(chunkAddress(closure.chunks.get(addressKey(closure.root))!)), addressKey(closure.root));
      const fetch = fetchFrom(closure.chunks);
      const v = accepted(decodeLinked(closure.root, fetch, HOLD_ALL), name);
      assert.ok(v.value.equalBy(n, codec.equal), `${name}: the closure decodes to the value`);
      // Law 2: the chunk set and the root are functions of the value.
      const again = encodeLinked(v.value, v.codec);
      assert.equal(addressKey(again.root), addressKey(closure.root));
      assert.deepEqual(new Set(again.chunks.keys()), new Set(closure.chunks.keys()));
      // The bridge: the flat octets of the closure's value are the flat form's.
      assert.deepEqual(accepted(flattenClosure(closure.root, fetch, HOLD_ALL)).bytes, encodeFlat(n, codec), name);
      const present = checkClosure(closure.root, fetch);
      assert.equal(describe(present), `closure-present ${hex(codec.id)} ${closure.chunks.size}`);
    }
  }
});

test("linked: equal subtrees are one chunk, whether or not they are one object", () => {
  const level = (depth: number): Node<Uint8Array> =>
    depth === 0 ? Node.compose(EMPTY, []) : Node.compose(octets(depth), [[text("a"), level(depth - 1)], [text("b"), level(depth - 1)]]);
  for (let depth = 0; depth <= 10; depth++) {
    const closure = encodeLinked(level(depth), identityBytes); // 2^(depth+1) − 1 node objects
    assert.equal(closure.chunks.size, depth + 1, `a full binary tree of depth ${depth}`);
    accepted(decodeLinked(closure.root, fetchFrom(closure.chunks), HOLD_ALL));
  }
  // A shared child is listed once in its parent's header and referenced twice.
  const child = Node.compose(octets(7), []);
  const parent = encodeLinked(Node.compose(EMPTY, [[text("x"), child], [text("y"), child]]), identityBytes);
  const rootChunk = parent.chunks.get(addressKey(parent.root))!;
  const childKey = addressKey(encodeLinked(child, identityBytes).root);
  assert.equal(hex(rootChunk).split(childKey).length - 1, 1);
});

test("linked: a store that tampers, or lacks a chunk, is a store fault — never a decoder verdict", () => {
  const r = random(43);
  for (let i = 0; i < 25; i++) {
    const n = tree(r, blob, 3, 3);
    const closure = encodeLinked(n, identityBytes);
    for (const [key, chunk] of closure.chunks) {
      const tampered = new Map(closure.chunks);
      const changed = Uint8Array.from(chunk);
      changed[r.int(changed.length)]! ^= 1 << r.int(8);
      tampered.set(key, changed);
      for (const v of [decodeLinked(closure.root, fetchFrom(tampered), HOLD_ALL), checkClosure(closure.root, fetchFrom(tampered)), flattenClosure(closure.root, fetchFrom(tampered), HOLD_ALL)]) {
        assert.equal(describe(v), `store/hash_mismatch/${key}`);
      }
      const lacking = new Map(closure.chunks);
      lacking.delete(key);
      for (const v of [decodeLinked(closure.root, fetchFrom(lacking), HOLD_ALL), checkClosure(closure.root, fetchFrom(lacking))]) {
        assert.equal(describe(v), `store/missing_chunk/${key}`);
      }
    }
  }
  // The root is verified against the address requested: a self-consistent closure of
  // another value, served under that address, is refused (§14's anchor).
  const asked = encodeLinked(Node.compose(octets(1), []), identityBytes);
  const other = encodeLinked(Node.compose(EMPTY, []), identityBytes);
  const liar: Fetch = () => [...other.chunks.values()][0];
  assert.equal(describe(decodeLinked(asked.root, liar, HOLD_ALL)), `store/hash_mismatch/${addressKey(asked.root)}`);
});

const size = (n: Node<unknown>): number => 1 + n.entries().reduce((s, [, c]) => s + size(c), 0);
const height = (n: Node<unknown>): number => n.entries().reduce((h, [, c]) => Math.max(h, 1 + height(c)), 0);

test("lazy navigation: resolve-root and resolve-child reach every node, each chunk verified, nothing built", () => {
  const r = random(59);
  for (let i = 0; i < 30; i++) {
    const n = tree(r, blob, 3, 3);
    const closure = encodeLinked(n, identityBytes);
    const fetch = fetchFrom(closure.chunks);
    const root = LinkedChunk.resolveRoot(closure.root, fetch);
    assert.ok(root instanceof LinkedChunk);
    assert.equal(addressKey(root.address), addressKey(closure.root));
    const pending: [Node<Uint8Array>, LinkedChunk][] = [[n, root]];
    while (pending.length > 0) {
      const [node, chunk] = pending.pop()!;
      assert.deepEqual(chunk.id, IDENTITY);
      assert.deepEqual(chunk.payload, node.own(), "the undecoded payload is e(own)");
      assert.deepEqual(accepted(chunk.own(HOLD_ALL)).own, node.own());
      assert.deepEqual(chunk.keys(), node.keys());
      assert.equal(chunk.length, node.length);
      for (const [key, child] of node.entries()) {
        const next = chunk.resolveChild(key, fetch);
        assert.ok(next instanceof LinkedChunk);
        assert.equal(next.depth, chunk.depth + 1);
        assert.equal(addressKey(next.address), addressKey(encodeLinked(child, identityBytes).root));
        pending.push([child, next]);
      }
      assert.equal(chunk.resolveChild(text("not a key of any generated node"), fetch), undefined);
    }
  }

  // resolve-root anchors on the address asked for, resolve-child on the parent's header.
  const child = Node.compose(octets(2), []);
  const n = Node.compose(octets(1), [[K, child]]);
  const closure = encodeLinked(n, identityBytes);
  const childKey = addressKey(encodeLinked(child, identityBytes).root);
  const other = encodeLinked(Node.compose(EMPTY, []), identityBytes);
  const liar: Fetch = () => [...other.chunks.values()][0];
  assert.equal(describe(LinkedChunk.resolveRoot(closure.root, liar)), `store/hash_mismatch/${addressKey(closure.root)}`);
  const root = LinkedChunk.resolveRoot(closure.root, fetchFrom(closure.chunks)) as LinkedChunk;
  const tampered = new Map(closure.chunks);
  tampered.set(childKey, [...other.chunks.values()][0]!);
  assert.equal(describe(root.resolveChild(K, fetchFrom(tampered))), `store/hash_mismatch/${childKey}`);
  const lacking = new Map(closure.chunks);
  lacking.delete(childKey);
  assert.equal(describe(root.resolveChild(K, fetchFrom(lacking))), `store/missing_chunk/${childKey}`);
  expectLimit(root.resolveChild(K, fetchFrom(closure.chunks), { logical_depth: 0 }), "logical_depth");
  // A child under another slot codec, valid on its own, is refused at resolve-child.
  const foreign = rawChunk({ id: coarse.id, payload: text("a") });
  const parent = rawChunk({ links: [sha(foreign)], entries: [[K, 0]] });
  const opened = LinkedChunk.resolveRoot(addressOf(parent), storeOf([parent, foreign])) as LinkedChunk;
  expectCode(opened.resolveChild(K, storeOf([parent, foreign])), "slot_codec_mismatch");
  // The payload is judged only when asked for, and only by a codec held.
  const bad = rawChunk({ id: coarse.id, payload: octets(0xff) });
  const lazy = LinkedChunk.resolveRoot(addressOf(bad), storeOf([bad])) as LinkedChunk;
  expectCode(lazy.own(HOLD_ALL), "non_canonical_payload");
  expectCode(lazy.own(BLIND), "unsupported/unsupported_slot_codec");
  // The only way to a LinkedChunk is through verification.
  assert.throws(() => new (LinkedChunk as any)(Symbol("forged"), closure.root, {}, 0), TypeError);
});

test("estimate unfolded size: saturating measures over the DAG, with nothing decoded or built", () => {
  const r = random(61);
  for (const { codec, own } of CASES) {
    for (let i = 0; i < 20; i++) {
      const n = tree(r, own, 1 + r.int(3), 1 + r.int(3));
      const closure = encodeLinked(n, codec);
      const estimate = estimateUnfolded(closure.root, fetchFrom(closure.chunks));
      assert.deepEqual(estimate, { class: "estimated", nodes: BigInt(size(n)), flatOctets: BigInt(encodeFlat(n, codec).length), depth: height(n) });
    }
  }
  // The bomb's 2^71 − 1 nodes and their octets saturate at the limit plus one.
  const { root, chunks } = bomb(70, IDENTITY, EMPTY);
  assert.deepEqual(estimateUnfolded(addressOf(root), storeOf(chunks)), {
    class: "estimated",
    nodes: FLOORS.unfolded_node_count + 1n,
    flatOctets: FLOORS.unfolded_flat_octets + 1n,
    depth: 70,
  });
  const low = estimateUnfolded(addressOf(root), storeOf(chunks), { unfolded_node_count: 10, unfolded_flat_octets: 20 });
  assert.deepEqual(low, { class: "estimated", nodes: 11n, flatOctets: 21n, depth: 70 });
  // Estimating is a walk: its own dimensions still bind it.
  expectLimit(estimateUnfolded(addressOf(root), storeOf(chunks), { logical_depth: 69 }), "logical_depth");
  expectLimit(estimateUnfolded(addressOf(root), storeOf(chunks), { unique_chunks: 70 }), "unique_chunks");
});

// --- chunks assembled field by field (§6's grammar), for defects and for the envelope ---

interface RawChunk {
  magic?: Uint8Array;
  id?: Uint8Array;
  links?: Uint8Array[];
  payloadLength?: Uint8Array;
  payload?: Uint8Array;
  entries?: [Uint8Array, number][];
  tail?: Uint8Array;
}

function rawChunk(c: RawChunk): Uint8Array {
  const id = c.id ?? IDENTITY;
  const links = c.links ?? [];
  const payload = c.payload ?? EMPTY;
  const entries = c.entries ?? [];
  return concat(
    c.magic ?? text("dxl2"), cu(id.length), id, cu(links.length), ...links,
    c.payloadLength ?? cu(payload.length), payload, cu(entries.length),
    ...entries.flatMap(([key, index]) => [cu(key.length), key, cu(index)]),
    c.tail ?? EMPTY,
  );
}

interface RawNode {
  payload?: Uint8Array;
  entries?: [Uint8Array, RawNode][];
}

/** A flat artifact assembled field by field (§5's grammar), keys in the order given. */
function rawFlat(root: RawNode, id = IDENTITY): Uint8Array {
  const node = (n: RawNode): Uint8Array => {
    const payload = n.payload ?? EMPTY;
    const entries = n.entries ?? [];
    return concat(cu(payload.length), payload, cu(entries.length), ...entries.flatMap(([k, c]) => [cu(k.length), k, node(c)]));
  };
  return concat(text("dxf2"), cu(id.length), id, node(root));
}

const [A, B, K] = ["a", "b", "k"].map(text) as [Uint8Array, Uint8Array, Uint8Array];

test("linked: §6's link rules, and §10's order among them", () => {
  const e = rawChunk({});
  const o = rawChunk({ payload: octets(1) });
  const [he, ho] = [sha(e), sha(o)];
  const cases: [string, Uint8Array, string][] = [
    ["a hash listed twice", rawChunk({ links: [he, he], entries: [[A, 0], [B, 1]] }), "duplicate_link_hash"],
    ["an index past the header", rawChunk({ links: [he], entries: [[A, 0], [B, 1]] }), "bad_link_index"],
    ["a hash no entry uses", rawChunk({ links: [he, ho], entries: [[A, 0]] }), "unused_link"],
    ["first use out of order", rawChunk({ links: [ho, he], entries: [[A, 1], [B, 0]] }), "links_out_of_order"],
    ["the only entry takes position 1", rawChunk({ links: [he, ho], entries: [[A, 1]] }), "links_out_of_order"],
    ["duplicate beats a bad index", rawChunk({ links: [he, he], entries: [[A, 0], [B, 2]] }), "duplicate_link_hash"],
    ["a bad index beats an unused link", rawChunk({ links: [he, ho], entries: [[A, 0], [B, 2]] }), "bad_link_index"],
    ["out of order beats an unused link", rawChunk({ links: [ho, he], entries: [[A, 1]] }), "links_out_of_order"],
    ["keys out of order", rawChunk({ links: [he], entries: [[B, 0], [A, 0]] }), "unsorted_keys"],
    ["a key repeated", rawChunk({ links: [he], entries: [[A, 0], [A, 0]] }), "duplicate_key"],
    ["an octet after the body", rawChunk({ tail: octets(0xff) }), "trailing_bytes"],
    ["the previous version's magic", rawChunk({ magic: text("dxl1") }), "unknown_magic"],
    ["a flat artifact served as a chunk", encodeFlat(Node.compose(EMPTY, []), identityBytes), "unknown_magic"],
    ["n = 0", rawChunk({ id: octets(0x00, 0x00) }), "malformed_slot_codec_id"],
    ["a non-shortest payload length", rawChunk({ payloadLength: octets(0x81, 0x00), payload: octets(1) }), "non_shortest_uvarint"],
  ];
  for (const [name, chunk, code] of cases) {
    const fetch = storeOf([chunk, e, o]);
    expectCode(decodeLinked(addressOf(chunk), fetch, HOLD_ALL), code, name);
    expectCode(checkClosure(addressOf(chunk), fetch), code, `${name} (closure-checker)`);
  }
});

test("linked: read first, ruled last — a child's id is compared only after its framing (§10)", () => {
  const fixtureChild = rawChunk({ id: coarse.id, payload: text("a") });
  const mismatch = rawChunk({ links: [sha(fixtureChild)], entries: [[A, 0]] });
  expectCode(decodeLinked(addressOf(mismatch), storeOf([mismatch, fixtureChild]), HOLD_ALL), "slot_codec_mismatch");
  expectCode(checkClosure(addressOf(mismatch), storeOf([mismatch, fixtureChild])), "slot_codec_mismatch");
  const e = rawChunk({});
  for (const [name, child, code] of [
    ["a malformed body", rawChunk({ id: coarse.id, payloadLength: octets(0x81, 0x00), payload: text("a") }), "non_shortest_uvarint"],
    ["a malformed header", rawChunk({ id: coarse.id, links: [sha(e), sha(e)], entries: [[A, 0], [B, 1]] }), "duplicate_link_hash"],
  ] as const) {
    const parent = rawChunk({ links: [sha(child)], entries: [[K, 0]] });
    expectCode(decodeLinked(addressOf(parent), storeOf([parent, child, e]), HOLD_ALL), code, name);
  }
});

test("linked: payloads are judged at every chunk, after the capability judgment", () => {
  const bad = rawChunk({ id: coarse.id, payload: octets(0xff) });
  const parent = rawChunk({ id: coarse.id, payload: text("p"), links: [sha(bad)], entries: [[K, 0]] });
  const fetch = storeOf([parent, bad]);
  expectCode(decodeLinked(addressOf(parent), fetch, HOLD_ALL), "non_canonical_payload", "a child's payload");
  expectCode(decodeLinked(addressOf(parent), fetch, new Registry([identityBytes])), "unsupported/unsupported_slot_codec");
  // The closure-checker never applies D: the closure is present, and nothing more is claimed.
  assert.equal(describe(checkClosure(addressOf(parent), fetch)), `closure-present ${hex(coarse.id)} 2`);
});

// --- the envelope (§12) ---------------------------------------------------------------

const chain = (edges: number, payload = (i: number) => octets(i & 0xff)): Node<Uint8Array> => {
  let n = Node.compose(payload(edges), []);
  for (let i = edges - 1; i >= 0; i--) n = Node.compose(payload(i), [[K, n]]);
  return n;
};

test("limits: a lowered limit refuses just past it, naming the dimension, and admits at it (flat)", () => {
  const r = random(47);
  const leaf = Node.compose(EMPTY, []);
  const probes: [string, Uint8Array, bigint][] = [
    ["key_length", encodeFlat(Node.compose(EMPTY, [[octets(1, 2, 3, 4, 5), leaf]]), identityBytes), 5n],
    ["payload_length", encodeFlat(Node.compose(new Uint8Array(7), []), identityBytes), 7n],
    ["entries_per_node", encodeFlat(Node.compose(EMPTY, [A, B, K].map((k): [Uint8Array, Node<Uint8Array>] => [k, leaf])), identityBytes), 3n],
    ["logical_depth", encodeFlat(chain(4), identityBytes), 4n],
    ["unfolded_node_count", encodeFlat(chain(4), identityBytes), 5n],
    ["slot_codec_id_length", encodeFlat(Node.compose(undefined, []), optionOf(identityBytes)), 3n],
    ["varint_value", encodeFlat(Node.compose(new Uint8Array(9), []), identityBytes), 9n],
  ];
  for (const [dimension, bytes, at] of probes) {
    accepted(decodeFlat(bytes, HOLD_ALL, { [dimension]: at }), `${dimension} at ${at}`);
    expectLimit(decodeFlat(bytes, HOLD_ALL, { [dimension]: at - 1n }), dimension, `${dimension} at ${at - 1n}`);
    assertSplitInvariant(bytes, HOLD_ALL, r, { [dimension]: at - 1n }, dimension);
  }
  const whole = encodeFlat(chain(3), identityBytes);
  accepted(decodeFlat(whole, HOLD_ALL, { flat_artifact_octets: whole.length }));
  expectLimit(decodeFlat(whole, HOLD_ALL, { flat_artifact_octets: whole.length - 1 }), "flat_artifact_octets");
  // Defaults are the §12 floors.
  assert.equal(FLOORS.logical_depth, 256n);
  assert.deepEqual(limitsOf(undefined), FLOORS);
  assert.throws(() => decodeFlat(whole, HOLD_ALL, { bogus: 1 } as LimitsInput), TypeError);
});

test("limits: a lowered limit refuses just past it, naming the dimension, and admits at it (linked)", () => {
  const n = Node.compose(EMPTY, [[A, chain(2)], [B, chain(3)], [K, chain(1)]]);
  const closure = encodeLinked(n, identityBytes);
  const fetch = fetchFrom(closure.chunks);
  const rootChunk = closure.chunks.get(addressKey(closure.root))!;
  const total = [...closure.chunks.values()].reduce((s, c) => s + c.length, 0);
  const flatLength = encodeFlat(n, identityBytes).length;
  const probes: [string, bigint][] = [
    ["links_per_chunk", 3n],
    ["chunk_octets", BigInt(Math.max(...[...closure.chunks.values()].map((c) => c.length)))],
    ["unique_chunks", BigInt(closure.chunks.size)],
    ["unique_octets", BigInt(total)],
    ["logical_depth", 4n],
    ["unfolded_node_count", 10n],
    ["unfolded_flat_octets", BigInt(flatLength)],
  ];
  assert.ok(rootChunk.length > 0);
  for (const [dimension, at] of probes) {
    accepted(decodeLinked(closure.root, fetch, HOLD_ALL, { [dimension]: at }), `${dimension} at ${at}`);
    accepted(flattenClosure(closure.root, fetch, HOLD_ALL, { [dimension]: at }), `${dimension} at ${at}`);
    expectLimit(decodeLinked(closure.root, fetch, HOLD_ALL, { [dimension]: at - 1n }), dimension, dimension);
    expectLimit(flattenClosure(closure.root, fetch, HOLD_ALL, { [dimension]: at - 1n }), dimension, dimension);
    const walked = checkClosure(closure.root, fetch, { [dimension]: at - 1n });
    // The closure-checker builds nothing, so only the walk's own dimensions bind it.
    if (dimension.startsWith("unfolded")) assert.equal(walked.class, "closure-present", dimension);
    else expectLimit(walked, dimension, `${dimension} (closure-checker)`);
  }
});

/** A sharing bomb: level i lists level i − 1 once and references it twice (§12). */
function bomb(levels: number, id: Uint8Array, bottom: Uint8Array, payload = EMPTY): { root: Uint8Array; chunks: Uint8Array[] } {
  const chunks = [rawChunk({ id, payload: bottom })];
  for (let i = 1; i <= levels; i++) {
    chunks.push(rawChunk({ id, payload, links: [sha(chunks[i - 1]!)], entries: [[A, 0], [B, 0]] }));
  }
  return { root: chunks[levels]!, chunks };
}

test("envelope: a sharing bomb is measured over the DAG and refused before anything is built", () => {
  const { root, chunks } = bomb(70, IDENTITY, EMPTY);
  const fetch = storeOf(chunks);
  const started = Date.now();
  assert.match(describe(decodeLinked(addressOf(root), fetch, HOLD_ALL)), /^resource-refused\/limit_exceeded\/unfolded_(node_count|flat_octets)$/);
  assert.match(describe(flattenClosure(addressOf(root), fetch, HOLD_ALL)), /^resource-refused\/limit_exceeded\/unfolded_(node_count|flat_octets)$/);
  assert.equal(checkClosure(addressOf(root), fetch).class, "closure-present", "validating builds nothing");
  assert.ok(Date.now() - started < 2000, "refused without materializing 2^71 nodes");
  // A budget that admits the exact unfolded count admits it, and one less refuses.
  const small = bomb(3, IDENTITY, EMPTY);
  const v = accepted(decodeLinked(addressOf(small.root), storeOf(small.chunks), HOLD_ALL, { unfolded_node_count: 15 }));
  assert.equal(encodeFlat(v.value, v.codec).length, encodeFlat(v.value, identityBytes).length);
  expectLimit(decodeLinked(addressOf(small.root), storeOf(small.chunks), HOLD_ALL, { unfolded_node_count: 14 }), "unfolded_node_count");
  // The materialized value has no aliasing: repeated subtrees are distinct objects.
  const a = v.value.get(A)!;
  const b = v.value.get(B)!;
  assert.notEqual(a, b);
  assert.notEqual(a.own(), b.own());
  assert.ok(a.equalBy(b, sameOctets));
});

// --- the pinned rules (I3, I4, I5) -----------------------------------------------

test("I3: logical depth counts edges — 256 ancestors are within the floor, 257 are not — and a hash cycle is refused as logical_depth", () => {
  const within = chain(256);
  const beyond = chain(257);
  accepted(decodeFlat(encodeFlat(within, identityBytes), HOLD_ALL), "a node with 256 ancestors");
  expectLimit(decodeFlat(encodeFlat(beyond, identityBytes), HOLD_ALL), "logical_depth", "a node with 257 ancestors");
  for (const [n, fits] of [[within, true], [beyond, false]] as const) {
    const closure = encodeLinked(n, identityBytes);
    const fetch = fetchFrom(closure.chunks);
    for (const v of [decodeLinked(closure.root, fetch, HOLD_ALL), flattenClosure(closure.root, fetch, HOLD_ALL), checkClosure(closure.root, fetch)]) {
      if (fits) assert.notEqual(v.class, "resource-refused");
      else expectLimit(v, "logical_depth");
    }
  }

  // Depth is measured in the tree the closure denotes: a deep path that reaches an
  // already-walked chunk the long way round is still met. Under key a the shared subtree
  // sits at depth 1; under b, at the end of a chain, it sits deeper.
  const shared = chain(5);
  let long: Node<Uint8Array> = shared;
  for (let i = 0; i < 6; i++) long = Node.compose(octets(0x40 + i), [[K, long]]);
  const dag = Node.compose(EMPTY, [[A, shared], [B, long]]); // deepest node: 1 + 6 + 5 edges
  const closure = encodeLinked(dag, identityBytes);
  const fetch = fetchFrom(closure.chunks);
  for (const [limit, fits] of [[12, true], [11, false]] as const) {
    const flat = decodeFlat(encodeFlat(dag, identityBytes), HOLD_ALL, { logical_depth: limit });
    for (const v of [flat, decodeLinked(closure.root, fetch, HOLD_ALL, { logical_depth: limit }), checkClosure(closure.root, fetch, { logical_depth: limit })]) {
      if (fits) assert.notEqual(v.class, "resource-refused", `limit ${limit}`);
      else expectLimit(v, "logical_depth", `limit ${limit}`);
    }
  }

  // A hash cycle cannot be built under SHA-256, and the walk may not rely on that (§12).
  // The internal walk takes its digest as a parameter; under a stand-in digest that names
  // chunks by label, a chunk can list one of its own ancestors.
  const label = (n: number) => new Uint8Array(32).fill(n);
  const walk = (named: [number, Uint8Array][], start: number) => {
    const byLabel = new Map(named.map(([n, chunk]) => [hex(label(n)), chunk]));
    const labelOf = new Map(named.map(([n, chunk]) => [hex(chunk), label(n)]));
    const digest = (bytes: Uint8Array) => labelOf.get(hex(bytes)) ?? sha(bytes);
    return traverse(address(label(start)), (where) => byLabel.get(addressKey(where)), limitsOf(undefined), digest);
  };
  const leafChunk = rawChunk({});
  const acyclic = walk([[1, rawChunk({ links: [label(2)], entries: [[K, 0]] })], [2, rawChunk({ links: [label(3)], entries: [[K, 0]] })], [3, leafChunk]], 1);
  assert.ok(!("class" in acyclic), "the stand-in digest walks an acyclic closure to its end");
  const twoCycle = walk([[1, rawChunk({ links: [label(2)], entries: [[K, 0]] })], [2, rawChunk({ links: [label(1)], entries: [[K, 0]] })]], 1);
  expectLimit(twoCycle, "logical_depth", "a two-chunk cycle");
  const selfLoop = walk([[1, rawChunk({ payload: octets(9), links: [label(1)], entries: [[K, 0]] })]], 1);
  expectLimit(selfLoop, "logical_depth", "a chunk listing itself");
  const deepCycle = walk([
    [1, rawChunk({ links: [label(2), label(4)], entries: [[A, 0], [B, 1]] })],
    [2, rawChunk({ links: [label(3)], entries: [[K, 0]] })],
    [3, rawChunk({ payload: octets(3), links: [label(2)], entries: [[K, 0]] })],
    [4, leafChunk],
  ], 1);
  expectLimit(deepCycle, "logical_depth", "a cycle below the root");
});

test("I4: limits are met in parse order, at the first field or octet past them — never up front on the input's length", () => {
  const r = random(53);
  const big = { payload: new Uint8Array(200).fill(0x61) };
  const cap = { flat_artifact_octets: 40 };
  // A fault early in the parse wins, although the input is five times the cap.
  const early = rawFlat({ entries: [[B, {}], [A, {}], [K, big]] });
  assert.ok(early.length > 200);
  expectCode(decodeFlat(early, HOLD_ALL, cap), "unsorted_keys");
  assert.equal(assertSplitInvariant(early, HOLD_ALL, r, cap), "invalid/unsorted_keys");
  // The same fault after the cap: the reader meets the cap first.
  const late = rawFlat({ entries: [[A, big], [K, {}], [B, {}]] });
  expectLimit(decodeFlat(late, HOLD_ALL, cap), "flat_artifact_octets");
  assert.equal(assertSplitInvariant(late, HOLD_ALL, r, cap), "resource-refused/limit_exceeded/flat_artifact_octets");
  // An octet past the cap after a complete root is trailing, not a refusal.
  const valid = encodeFlat(chain(3), identityBytes);
  const trailing = concat(valid, new Uint8Array(100));
  expectCode(decodeFlat(trailing, HOLD_ALL, { flat_artifact_octets: valid.length }), "trailing_bytes");
  assertSplitInvariant(trailing, HOLD_ALL, r, { flat_artifact_octets: valid.length });
  // Input ending inside the capped region is judged as ended, whole or streamed.
  expectCode(decodeFlat(valid.subarray(0, valid.length - 1), HOLD_ALL, { flat_artifact_octets: valid.length - 1 }), "unexpected_eof");
  expectCode(streamed(valid.subarray(0, valid.length - 1), [], HOLD_ALL, false, { flat_artifact_octets: valid.length - 1 }), "incomplete/need_more_input");
  // A per-field limit is met at its field, before a later fault.
  const wideThenBad = rawFlat({ entries: [[text("abcde"), {}], [A, {}]] }); // "a" sorts before "abcde"
  expectLimit(decodeFlat(wideThenBad, HOLD_ALL, { key_length: 4 }), "key_length");
  expectCode(decodeFlat(wideThenBad, HOLD_ALL), "unsorted_keys");
  // unfolded_flat_octets is the whole flat artifact, header included.
  for (const { codec, own } of CASES) {
    const n = tree(r, own, 3, 2);
    const closure = encodeLinked(n, codec);
    const flatLength = encodeFlat(n, codec).length;
    const fetch = fetchFrom(closure.chunks);
    assert.deepEqual(accepted(flattenClosure(closure.root, fetch, HOLD_ALL, { unfolded_flat_octets: flatLength })).bytes, encodeFlat(n, codec));
    expectLimit(flattenClosure(closure.root, fetch, HOLD_ALL, { unfolded_flat_octets: flatLength - 1 }), "unfolded_flat_octets");
  }
});

test("I5: the build budget guards the build, not the judgments — an over-budget closure that is unsupported or invalid gets that verdict", () => {
  const tight = { unfolded_node_count: 1000, unfolded_flat_octets: 100 };
  const held = bomb(20, IDENTITY, EMPTY);
  const [root, fetch] = [addressOf(held.root), storeOf(held.chunks)];
  expectLimit(decodeLinked(root, fetch, HOLD_ALL, { unfolded_node_count: 1000 }), "unfolded_node_count");
  expectLimit(flattenClosure(root, fetch, HOLD_ALL, { unfolded_flat_octets: 100 }), "unfolded_flat_octets");
  // Codec-blind: the capability judgment comes first.
  for (const v of [decodeLinked(root, fetch, BLIND, tight), flattenClosure(root, fetch, BLIND, tight), decodeLinked(root, fetch, BLIND)]) {
    expectCode(v, "unsupported/unsupported_slot_codec");
  }
  // A payload outside im(e) at the bottom of an over-budget closure: the payload judgment comes first.
  const optionId = optionOf(identityBytes).id;
  const invalidBomb = bomb(20, optionId, octets(0x02), octets(0x00));
  for (const v of [
    decodeLinked(addressOf(invalidBomb.root), storeOf(invalidBomb.chunks), HOLD_ALL, tight),
    flattenClosure(addressOf(invalidBomb.root), storeOf(invalidBomb.chunks), HOLD_ALL, tight),
  ]) {
    expectCode(v, "non_canonical_payload");
  }
  const validBomb = bomb(20, optionId, octets(0x00), octets(0x00));
  expectLimit(decodeLinked(addressOf(validBomb.root), storeOf(validBomb.chunks), HOLD_ALL, tight), "unfolded_node_count");
  // At the floors, the 2^71-node bomb unheld is unsupported, not refused on resource.
  const huge = bomb(70, IDENTITY, EMPTY);
  expectCode(decodeLinked(addressOf(huge.root), storeOf(huge.chunks), BLIND), "unsupported/unsupported_slot_codec");
});
