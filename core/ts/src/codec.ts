/**
 * deixis-codec-v2: canonical bytes for Node[T] (docs/CODEC.md). Import it as
 * `@bitspark/deixis-core/codec`.
 *
 * A CANDIDATE implementation of a CANDIDATE contract (§16). Nothing here is frozen, and a
 * `dxl2` address produced here is not a stable identity: a pre-freeze change to the
 * contract changes addresses. It is an in-house implementation, not the clean-room one of
 * docs/design/0007.
 *
 * Profiles claimed (§2.1, §16): flat-encoder, flat-decoder, flat-header-validator,
 * linked-resolver and closure-checker — codec-holding for exactly the slot-codec ids the
 * caller's {@link Registry} holds, and option-of over those (§13); codec-blind for every
 * other id. No chunk-store is implemented. A resolver reads chunks through the caller's
 * {@link Fetch}, and that store's faults come back as {@link StoreFault}s, never as
 * decoder verdicts (§9).
 *
 * Every integer on the wire is a `cuvarint` and is read as a `bigint` (§3's
 * implementation note). A length becomes an array offset only after a resource limit
 * (§12) has bounded it.
 *
 * Decoding runs in §11's order: the whole framing parse, codec-blind, then the capability
 * judgment (`unsupported_slot_codec`), then every payload through the slot codec's `D`
 * (`non_canonical_payload`). The streaming and the whole-buffer flat decoders are one
 * resumable parser, so they agree on every split by construction (§14).
 *
 * The linked form's operations are kept apart, as §14 requires: open and navigate lazily
 * ({@link LinkedChunk}, made only by resolve-root or resolve-child), validate the closure
 * ({@link checkClosure}), estimate its unfolded size ({@link estimateUnfolded}),
 * materialize it ({@link decodeLinked}) and flatten it ({@link flattenClosure}).
 */

import {
  type Address,
  type Code,
  type Fetch,
  type Incomplete,
  type Invalid,
  type Limits,
  type LimitsInput,
  type ParsedChunk,
  type Refusal,
  type RefusalClass,
  type ResourceRefused,
  type SlotCodecIdForm,
  type StoreFault,
  type Traversal,
  type Unsupported,
  FLAT_MAGIC,
  LINKED_MAGIC,
  MALFORMED_ID,
  MAX_U64,
  NEED_MORE_INPUT,
  UNSUPPORTED,
  Writer,
  address,
  compareBytes,
  equalBytes,
  fetchVerified,
  idStructure,
  innermost,
  invalid,
  limitsOf,
  refused,
  scanCuvarint,
  toHex,
  traverse,
  unfoldedFlatOctets,
} from "./codec-internal.js";
import { Node, type Option, some } from "./index.js";
import { sha256 } from "./sha256.js";

export type {
  Address,
  Code,
  Dimension,
  Fetch,
  Incomplete,
  Invalid,
  InvalidCode,
  Limits,
  LimitsInput,
  Refusal,
  RefusalClass,
  ResourceRefused,
  SlotCodecIdForm,
  StoreCode,
  StoreFault,
  Unsupported,
} from "./codec-internal.js";
export { FLOORS, address } from "./codec-internal.js";

// --- verdicts (§9, §14) -------------------------------------------------------------------

/**
 * An accepted value under full validation, with the slot codec it was decoded under
 * (§4: a decoded artifact retains its codec context).
 */
export interface Accepted<T> {
  readonly class: "accepted";
  readonly value: Node<T>;
  readonly codec: SlotCodec<T>;
}

/** A final verdict on one artifact. */
export type Verdict<T> = Accepted<T> | Refusal;

/** A streaming decoder's state: final, or `need_more_input`. */
export type StreamVerdict<T> = Verdict<T> | Incomplete;

const CLASSES: Readonly<Record<Code, RefusalClass | "store">> = {
  malformed_uvarint: "invalid",
  non_shortest_uvarint: "invalid",
  uvarint_overflow: "invalid",
  unknown_magic: "invalid",
  duplicate_key: "invalid",
  unsorted_keys: "invalid",
  trailing_bytes: "invalid",
  unexpected_eof: "invalid",
  bad_link_index: "invalid",
  unused_link: "invalid",
  duplicate_link_hash: "invalid",
  links_out_of_order: "invalid",
  slot_codec_mismatch: "invalid",
  malformed_slot_codec_id: "invalid",
  non_canonical_payload: "invalid",
  unsupported_slot_codec: "unsupported",
  need_more_input: "incomplete",
  limit_exceeded: "resource-refused",
  missing_chunk: "store",
  hash_mismatch: "store",
  address_conflict: "store",
};

/** The §9 class of a code; the store layer's codes are `"store"`, which is no decoder class. */
export function classOf(code: Code): RefusalClass | "store" {
  return CLASSES[code];
}

// --- cuvarint (§3) ------------------------------------------------------------------------

/** The canonical spelling C(v) of an integer in [0, 2^64 − 1] (§3). */
export function encodeCuvarint(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) throw new RangeError(`${value} is outside [0, 2^64 − 1]`);
  const out = new Writer(10);
  out.cuvarint(value);
  return out.finish();
}

/** A cuvarint read from `bytes`: its value and the offset just past it, or §3's fault. */
export type CuvarintResult =
  | { readonly class: "accepted"; readonly value: bigint; readonly end: number }
  | Invalid;

/**
 * Read one cuvarint at `offset`, taking the end of `bytes` as the end of input (§3):
 * nothing there is `unexpected_eof`, and an integer cut off with its continuation bit set
 * is `malformed_uvarint`.
 */
export function decodeCuvarint(bytes: Uint8Array, offset = 0): CuvarintResult {
  const scan = scanCuvarint(bytes, offset, bytes.length, Number.POSITIVE_INFINITY);
  if (typeof scan === "object") return Object.freeze({ class: "accepted", value: scan.value, end: scan.next });
  if (scan === "empty") return invalid("unexpected_eof");
  if (scan === "partial" || scan === "cap") return invalid("malformed_uvarint");
  return invalid(scan);
}

// --- slot codecs (§4, §13) ----------------------------------------------------------------

/**
 * A slot codec: `SlotCodec(T) = {id, ≈, e, D}` (§4), supplied and used as one unit.
 *
 * `encode` must be total and lawful: `equal(a, b)` exactly when `encode(a)` and
 * `encode(b)` are the same octets. `decode` is its exact partial inverse: `some(x)` with
 * `encode(x)` equal to `payload` when the payload is in the image of `encode`, and
 * `undefined` for every other octet string — a non-canonical spelling is refused, never
 * repaired. `decode` is handed a view of the input and must copy what it keeps.
 */
export interface SlotCodec<T> {
  /** The slot-codec-id (§13); it travels inside the octets. */
  readonly id: Uint8Array;
  /** `≈`, the slot's equivalence, which node identity lifts. */
  equal(a: T, b: T): boolean;
  /** `e`. */
  encode(value: T): Uint8Array;
  /** `D`. */
  decode(payload: Uint8Array): Option<T>;
}

const IDENTITY_BYTES_ID = Uint8Array.of(0x00, 0x01);

/** `deixis/identity-bytes`, public id `00 01` (§13): octet strings, octet equality, `e = id`. */
export const identityBytes: SlotCodec<Uint8Array> = Object.freeze({
  get id() {
    return Uint8Array.from(IDENTITY_BYTES_ID);
  },
  equal: (a: Uint8Array, b: Uint8Array) => equalBytes(a, b),
  encode: (value: Uint8Array) => value,
  decode: (payload: Uint8Array) => some(Uint8Array.from(payload)),
});

/**
 * `option-of(c)` (§13), id `0x02 ‖ id(c)`, over the core's `Option`: `undefined` is `None`
 * and `some(x)` is `Some(x)`. `e(None) = 00`, `e(Some(x)) = 01 ‖ e_c(x)`, and `D` accepts
 * exactly `00` and `01 ‖ b` with `b` in the image of `e_c`. Throws when the id would pass
 * the whole-id bound of 32 octets, which is what bounds nesting.
 */
export function optionOf<T>(inner: SlotCodec<T>): SlotCodec<Option<T>> {
  const innerId = Uint8Array.from(inner.id);
  if (innerId.length + 1 > 32) {
    throw new RangeError("option-of would make a slot-codec-id longer than 32 octets (§13)");
  }
  const id = new Uint8Array(innerId.length + 1);
  id[0] = 0x02;
  id.set(innerId, 1);
  return Object.freeze({
    get id() {
      return Uint8Array.from(id);
    },
    equal: (a: Option<T>, b: Option<T>) =>
      a === undefined || b === undefined ? a === b : inner.equal(a.value, b.value),
    encode: (value: Option<T>) => {
      if (value === undefined) return Uint8Array.of(0x00);
      const encoded = inner.encode(value.value);
      const out = new Uint8Array(encoded.length + 1);
      out[0] = 0x01;
      out.set(encoded, 1);
      return out;
    },
    decode: (payload: Uint8Array): Option<Option<T>> => {
      if (payload.length === 1 && payload[0] === 0x00) return some(undefined);
      if (payload.length === 0 || payload[0] !== 0x01) return undefined;
      const decoded = inner.decode(payload.subarray(1));
      return decoded === undefined ? undefined : some(some(decoded.value));
    },
  });
}

// --- slot-codec-ids and the registry (§13) ------------------------------------------------

/**
 * §13's structural judgment of a complete slot-codec-id: its form, or
 * `malformed_slot_codec_id` (or a §3 integer code) when the octets cannot be one id of
 * their form. A well-formed id of a reserved form is accepted here; holding it is a
 * separate question ({@link Registry.lookup}).
 */
export function parseSlotCodecId(
  id: Uint8Array,
): { readonly class: "accepted"; readonly form: SlotCodecIdForm } | Invalid {
  if (id.length < 2 || id.length > 32) return MALFORMED_ID;
  const form = idStructure(id, MAX_U64);
  if ("class" in form) return form as Invalid;
  return Object.freeze({ class: "accepted", form });
}

/** A codec's id, copied, and refused locally when it is not one well-formed, defined id. */
function checkedId(codec: SlotCodec<unknown>): Uint8Array {
  const id = Uint8Array.from(codec.id);
  const parsed = parseSlotCodecId(id);
  if (parsed.class !== "accepted") {
    throw new RangeError(`slot-codec-id ${toHex(id)} is not one id of its form: ${parsed.code}`);
  }
  if (innermost(parsed.form).form === "reserved") {
    throw new RangeError(`slot-codec-id ${toHex(id)} names a reserved form (§13)`);
  }
  return id;
}

/**
 * The slot codecs a decoder holds — §2.1's codec-holding / codec-blind modifier, stated
 * with the ids it ranges over. Option-of over a held codec is held (§13): it is derived
 * here, so it never needs registering. An empty registry is codec-blind for every id.
 */
export class Registry {
  readonly #held = new Map<string, SlotCodec<unknown>>();

  constructor(codecs: Iterable<SlotCodec<any>> = []) {
    for (const codec of codecs) {
      const key = toHex(checkedId(codec));
      if (this.#held.has(key)) throw new Error(`two slot codecs claim the id ${key}`);
      this.#held.set(key, codec);
    }
  }

  /**
   * The codec held for `id`, or `undefined`: the id is unassigned here, of a reserved
   * form, option-of over something not held, or not a well-formed id at all.
   */
  lookup(id: Uint8Array): SlotCodec<unknown> | undefined {
    if (id.length < 2 || id.length > 32) return undefined;
    const form = idStructure(id, MAX_U64);
    if ("class" in form) return undefined;
    return this.#resolve(Uint8Array.from(id), form);
  }

  #resolve(id: Uint8Array, form: SlotCodecIdForm): SlotCodec<unknown> | undefined {
    const key = toHex(id);
    const held = this.#held.get(key);
    if (held !== undefined || form.form !== "option-of") return held;
    const inner = this.#resolve(id.subarray(1), form.inner);
    if (inner === undefined) return undefined;
    const derived = optionOf(inner);
    this.#held.set(key, derived);
    return derived;
  }
}

// --- the flat form (§5) -------------------------------------------------------------------

/**
 * The canonical flat octets of `node` under `codec` (§5): `"dxf2" ‖ C(|id|) ‖ id`, then the
 * root, every node its framed payload, its child count and its entries in ascending key
 * order. The flat form has no sharing: a repeated subtree is spelled in full each time.
 * Throws, locally, when the codec's id is not one well-formed id of a defined form.
 */
export function encodeFlat<T>(node: Node<T>, codec: SlotCodec<T>): Uint8Array {
  const id = checkedId(codec as SlotCodec<unknown>);
  const out = new Writer();
  out.bytes(FLAT_MAGIC);
  out.cuvarint(id.length);
  out.bytes(id);

  const stack: { entries: [Uint8Array, Node<T>][]; next: number }[] = [];
  const open = (n: Node<T>) => {
    const payload = codec.encode(n.own());
    out.cuvarint(payload.length);
    out.bytes(payload);
    const entries = n.entries();
    out.cuvarint(entries.length);
    stack.push({ entries, next: 0 });
  };
  open(node);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.next === top.entries.length) {
      stack.pop();
      continue;
    }
    const [key, child] = top.entries[top.next++]!;
    out.cuvarint(key.length);
    out.bytes(key);
    open(child);
  }
  return out.finish();
}

/** A flat header judged well formed and held: the artifact's id and the codec it names. */
export interface HeaderAccepted {
  readonly class: "accepted";
  readonly id: Uint8Array;
  readonly codec: SlotCodec<unknown>;
}

/** The flat-header-validator's final verdict (§2.1): magic and id only. */
export type HeaderVerdict = HeaderAccepted | Refusal;

// The parser's steps. Each either completes and advances, or leaves the state untouched
// and waits, so a step is retried whole once more octets arrive.
const MAGIC = 0;
const ID_LENGTH = 1;
const ID = 2;
const PAYLOAD_LENGTH = 3;
const PAYLOAD = 4;
const COUNT = 5;
const NEXT_ENTRY = 6;
const KEY_LENGTH = 7;
const KEY = 8;
const ROOT_DONE = 9;

const WAIT = Symbol("need more input");
type Final = Accepted<unknown> | HeaderAccepted | Refusal;
type Stop = Final | typeof WAIT;

/** A node read by the framing parse; its payload is recorded, not judged (law 4). */
interface FlatRecord {
  readonly index: number;
  start: number;
  end: number;
  readonly keys: [number, number][];
  readonly children: FlatRecord[];
}

interface FlatFrame {
  readonly record: FlatRecord;
  readonly depth: number;
  remaining: bigint;
  previous: [number, number] | undefined;
}

/**
 * The single-pass flat parser P of docs/CODEC-proofs.md, resumable. It reads the framing
 * in parse order and, only once the root is complete, no octet trails it and the input
 * has ended, judges capability and then every recorded payload.
 *
 * Its every step depends only on the octets present and on whether the input has ended;
 * a step that needs an absent octet waits (streaming) or fails (end of input). Limits are
 * met in parse order too, at the first field or octet that exceeds them, never up front
 * on the input's length. That is what makes every split reach the whole-buffer verdict
 * (§14, CODEC-proofs §7).
 */
class FlatParser {
  buf: Uint8Array;
  available: number;
  ended = false;
  result: Final | undefined;

  readonly #limits: Limits;
  readonly #registry: Registry;
  readonly #headerOnly: boolean;
  // The reader declines to read octet `cap` or later (§12's flat_artifact_octets).
  readonly #cap: number;
  #pos = 0;
  #step = MAGIC;
  #pending = 0n;
  #id: Uint8Array | undefined;
  #nodes = 0n;
  readonly #frames: FlatFrame[] = [];
  readonly #records: FlatRecord[] = [];

  constructor(registry: Registry, limits: Limits, headerOnly: boolean, whole?: Uint8Array) {
    this.#registry = registry;
    this.#limits = limits;
    this.#headerOnly = headerOnly;
    this.#cap = Number(limits.flat_artifact_octets);
    this.buf = whole ?? new Uint8Array(64);
    this.available = whole === undefined ? 0 : whole.length;
    if (whole !== undefined) this.ended = true;
  }

  /**
   * Take more input. Octets past `cap + 1` are dropped: the reader never reads at or past
   * its cap, and one octet there already decides everything that could depend on it.
   */
  append(octets: Uint8Array): void {
    const room = this.#cap + 1 - this.available;
    const n = Math.min(octets.length, room);
    if (n <= 0) return;
    if (this.available + n > this.buf.length) {
      let capacity = this.buf.length;
      while (capacity < this.available + n) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.buf.subarray(0, this.available));
      this.buf = grown;
    }
    this.buf.set(octets.subarray(0, n), this.available);
    this.available += n;
  }

  /** Advance as far as the input allows: a final verdict, or {@link WAIT}. */
  run(): Stop {
    if (this.result !== undefined) return this.result;
    for (;;) {
      const stop = this.#advance();
      if (stop === undefined) continue;
      if (stop !== WAIT) this.result = stop;
      return stop;
    }
  }

  #advance(): Stop | undefined {
    switch (this.#step) {
      case MAGIC: {
        // Rule 1 presupposes four octets: fewer is unexpected_eof, never unknown_magic.
        const stop = this.#need(4);
        if (stop !== undefined) return stop;
        for (let i = 0; i < 4; i++) if (this.buf[i] !== FLAT_MAGIC[i]) return invalid("unknown_magic");
        this.#pos = 4;
        this.#step = ID_LENGTH;
        return undefined;
      }
      case ID_LENGTH: {
        const length = this.#cuvarint();
        if (typeof length !== "bigint") return length;
        // Judged when the length is read: no octets that could follow make it legal.
        if (length < 2n || length > 32n) return MALFORMED_ID;
        if (length > this.#limits.slot_codec_id_length) return refused("slot_codec_id_length");
        this.#pending = length;
        this.#step = ID;
        return undefined;
      }
      case ID: {
        const n = Number(this.#pending);
        const stop = this.#need(n);
        if (stop !== undefined) return stop;
        const id = this.buf.slice(this.#pos, this.#pos + n);
        const form = idStructure(id, this.#limits.varint_value);
        if ("class" in form) return form;
        this.#id = id;
        this.#pos += n;
        if (this.#headerOnly) {
          const codec = this.#registry.lookup(id);
          return codec === undefined ? UNSUPPORTED : Object.freeze({ class: "accepted", id: Uint8Array.from(id), codec });
        }
        return this.#begin(0, undefined);
      }
      case PAYLOAD_LENGTH: {
        const length = this.#cuvarint();
        if (typeof length !== "bigint") return length;
        if (length > this.#limits.payload_length) return refused("payload_length");
        this.#pending = length;
        this.#step = PAYLOAD;
        return undefined;
      }
      case PAYLOAD: {
        const stop = this.#needLength(this.#pending);
        if (stop !== undefined) return stop;
        const record = this.#top().record;
        record.start = this.#pos;
        record.end = this.#pos + Number(this.#pending);
        this.#pos = record.end;
        this.#step = COUNT;
        return undefined;
      }
      case COUNT: {
        const count = this.#cuvarint();
        if (typeof count !== "bigint") return count;
        if (count > this.#limits.entries_per_node) return refused("entries_per_node");
        this.#top().remaining = count;
        this.#step = NEXT_ENTRY;
        return undefined;
      }
      case NEXT_ENTRY: {
        if (this.#top().remaining > 0n) {
          this.#step = KEY_LENGTH;
          return undefined;
        }
        this.#frames.pop();
        if (this.#frames.length === 0) this.#step = ROOT_DONE;
        return undefined;
      }
      case KEY_LENGTH: {
        const length = this.#cuvarint();
        if (typeof length !== "bigint") return length;
        if (length > this.#limits.key_length) return refused("key_length");
        this.#pending = length;
        this.#step = KEY;
        return undefined;
      }
      case KEY: {
        // A key is judged only once its stated extent has been read (§5).
        const stop = this.#needLength(this.#pending);
        if (stop !== undefined) return stop;
        const key: [number, number] = [this.#pos, this.#pos + Number(this.#pending)];
        const top = this.#top();
        if (top.previous !== undefined) {
          const order = compareBytes(this.#range(key), this.#range(top.previous));
          if (order === 0) return invalid("duplicate_key");
          if (order < 0) return invalid("unsorted_keys");
        }
        top.previous = key;
        top.remaining -= 1n;
        this.#pos = key[1];
        return this.#begin(top.depth + 1, key);
      }
      case ROOT_DONE: {
        if (this.#pos < this.available) return invalid("trailing_bytes");
        // A complete root with the stream open is need_more_input (§14): an octet
        // arriving next would make it trailing_bytes, and acceptance is terminal.
        if (!this.ended) return WAIT;
        return this.#judge();
      }
    }
    throw new Error("unreachable parser step");
  }

  #top(): FlatFrame {
    return this.#frames[this.#frames.length - 1]!;
  }

  #range([start, end]: [number, number]): Uint8Array {
    return this.buf.subarray(start, end);
  }

  /** Start a node (the root, or a child under `key`): §12's node count and depth. */
  #begin(depth: number, key: [number, number] | undefined): Stop | undefined {
    this.#nodes += 1n;
    if (this.#nodes > this.#limits.unfolded_node_count) return refused("unfolded_node_count");
    if (BigInt(depth) > this.#limits.logical_depth) return refused("logical_depth");
    const record: FlatRecord = { index: this.#records.length, start: 0, end: 0, keys: [], children: [] };
    this.#records.push(record);
    if (key !== undefined) {
      const parent = this.#top().record;
      parent.keys.push(key);
      parent.children.push(record);
    }
    this.#frames.push({ record, depth, remaining: 0n, previous: undefined });
    this.#step = PAYLOAD_LENGTH;
    return undefined;
  }

  /** Read a cuvarint, or stop: §3's fault, a limit, or a wait. */
  #cuvarint(): bigint | Stop {
    const scan = scanCuvarint(this.buf, this.#pos, this.available, this.#cap);
    if (typeof scan === "object") {
      if (scan.value > this.#limits.varint_value) return refused("varint_value");
      this.#pos = scan.next;
      return scan.value;
    }
    switch (scan) {
      case "empty":
        return this.ended ? invalid("unexpected_eof") : WAIT;
      case "partial":
        // Input ending inside a cuvarint already begun (§5 rule 6, §3 rule 2).
        return this.ended ? invalid("malformed_uvarint") : WAIT;
      case "cap":
        return refused("flat_artifact_octets");
      default:
        return invalid(scan);
    }
  }

  /**
   * Require `n` octets at the position. As for a cuvarint, the first octet the reader
   * cannot take decides: absent is a wait or unexpected_eof, present at or past the cap is
   * limit_exceeded.
   */
  #need(n: number): Stop | undefined {
    const end = this.#pos + n;
    if (end <= this.available) return end > this.#cap ? refused("flat_artifact_octets") : undefined;
    if (this.available > this.#cap) return refused("flat_artifact_octets");
    return this.ended ? invalid("unexpected_eof") : WAIT;
  }

  #needLength(length: bigint): Stop | undefined {
    if (length > BigInt(this.available - this.#pos)) {
      if (this.available > this.#cap) return refused("flat_artifact_octets");
      return this.ended ? invalid("unexpected_eof") : WAIT;
    }
    return this.#need(Number(length));
  }

  /** §11 after a complete framing parse: capability, then every payload in parse order. */
  #judge(): Final {
    const codec = this.#registry.lookup(this.#id!);
    if (codec === undefined) return UNSUPPORTED;
    const records = this.#records;
    const values: unknown[] = new Array(records.length);
    for (const record of records) {
      const decoded = codec.decode(this.buf.subarray(record.start, record.end));
      if (decoded === undefined) return invalid("non_canonical_payload");
      values[record.index] = decoded.value;
    }
    // Children follow their parent in parse order, so building from the back finds every
    // child already built.
    const built: Node<unknown>[] = new Array(records.length);
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]!;
      built[i] = Node.compose(
        values[i],
        record.children.map((child, j): [Uint8Array, Node<unknown>] => [this.#range(record.keys[j]!), built[child.index]!]),
      );
    }
    return Object.freeze({ class: "accepted", value: built[0]!, codec });
  }
}

/**
 * The streaming flat-decoder (§14). {@link FlatDecoder.feed} returns `need_more_input`
 * until the verdict is certain: a framing fault is final as soon as it is visible, and so
 * is `trailing_bytes`; acceptance, `unsupported_slot_codec` and `non_canonical_payload`
 * wait for {@link FlatDecoder.finish}, since a following octet would make any of them
 * `trailing_bytes`. Every split of an artifact reaches {@link decodeFlat}'s verdict on the
 * whole.
 */
export class FlatDecoder<T = unknown> {
  readonly #parser: FlatParser;
  #finished = false;

  constructor(registry: Registry, limits?: LimitsInput) {
    this.#parser = new FlatParser(registry, limitsOf(limits), false);
  }

  /** More octets of the artifact. After a final verdict, further octets change nothing. */
  feed(octets: Uint8Array): StreamVerdict<T> {
    if (this.#finished) throw new Error("FlatDecoder: end of input was already declared");
    if (this.#parser.result === undefined) this.#parser.append(octets);
    const stop = this.#parser.run();
    return (stop === WAIT ? NEED_MORE_INPUT : stop) as StreamVerdict<T>;
  }

  /**
   * Declare the end of input, and take the final verdict: after a complete root, the one
   * the remaining checks reach; otherwise §5's end-of-input verdict, `malformed_uvarint`
   * inside a cuvarint already begun and `unexpected_eof` anywhere else.
   */
  finish(): Verdict<T> {
    this.#finished = true;
    this.#parser.ended = true;
    return this.#parser.run() as Verdict<T>;
  }
}

/**
 * The streaming flat-header-validator (§2.1): magic and id only. Final as soon as the id
 * has been read and judged; the body is never read.
 */
export class FlatHeaderReader {
  readonly #parser: FlatParser;
  #finished = false;

  constructor(registry: Registry, limits?: LimitsInput) {
    this.#parser = new FlatParser(registry, limitsOf(limits), true);
  }

  feed(octets: Uint8Array): HeaderVerdict | Incomplete {
    if (this.#finished) throw new Error("FlatHeaderReader: end of input was already declared");
    if (this.#parser.result === undefined) this.#parser.append(octets);
    const stop = this.#parser.run();
    return (stop === WAIT ? NEED_MORE_INPUT : stop) as HeaderVerdict | Incomplete;
  }

  finish(): HeaderVerdict {
    this.#finished = true;
    this.#parser.ended = true;
    return this.#parser.run() as HeaderVerdict;
  }
}

/**
 * The flat-decoder on a whole artifact (§5, §11): the value under full validation, or the
 * one verdict law 4 determines. `T` is the caller's assertion about the codecs the
 * registry holds.
 */
export function decodeFlat<T = unknown>(bytes: Uint8Array, registry: Registry, limits?: LimitsInput): Verdict<T> {
  return new FlatParser(registry, limitsOf(limits), false, bytes).run() as Verdict<T>;
}

/** The flat-header-validator on a whole input. */
export function readFlatHeader(bytes: Uint8Array, registry: Registry, limits?: LimitsInput): HeaderVerdict {
  return new FlatParser(registry, limitsOf(limits), true, bytes).run() as HeaderVerdict;
}

// --- the linked form (§6, §7) -------------------------------------------------------------

/** The address of a chunk: the SHA-256 of its entire octets (§7). */
export function chunkAddress(chunk: Uint8Array): Address {
  return address(sha256(chunk));
}

/** An address's digest in lowercase hex: the key of {@link EncodedClosure.chunks}. */
export function addressKey(where: Address): string {
  return toHex(where.digest);
}

/** A value's linked form: its root address and every chunk of its closure, once each. */
export interface EncodedClosure {
  readonly root: Address;
  /** Chunk octets by {@link addressKey}. */
  readonly chunks: ReadonlyMap<string, Uint8Array>;
}

/**
 * The linked form of `node` under `codec` (§6): one chunk per node, each carrying its own
 * payload and listing its distinct child hashes in first-use order. Equal subtrees are one
 * chunk, stored once. Throws, locally, on a codec id that is not one well-formed id of a
 * defined form.
 */
export function encodeLinked<T>(node: Node<T>, codec: SlotCodec<T>): EncodedClosure {
  const id = checkedId(codec as SlotCodec<unknown>);
  const head = new Writer();
  head.bytes(LINKED_MAGIC);
  head.cuvarint(id.length);
  head.bytes(id);
  const prefix = head.finish();

  const chunks = new Map<string, Uint8Array>();
  // A node object met twice is encoded once; equal nodes that are distinct objects meet
  // in `chunks`, since their chunks are the same octets.
  const digests = new Map<Node<T>, Uint8Array>();
  interface Frame {
    readonly node: Node<T>;
    readonly entries: [Uint8Array, Node<T>][];
    readonly children: Uint8Array[];
  }
  const frame = (n: Node<T>): Frame => ({ node: n, entries: n.entries(), children: [] });
  const stack: Frame[] = [frame(node)];
  for (;;) {
    const top = stack[stack.length - 1]!;
    if (top.children.length < top.entries.length) {
      const child = top.entries[top.children.length]![1];
      const known = digests.get(child);
      if (known !== undefined) top.children.push(known);
      else stack.push(frame(child));
      continue;
    }
    const chunk = chunkOf(prefix, codec.encode(top.node.own()), top.entries, top.children);
    const digest = sha256(chunk);
    const key = toHex(digest);
    if (!chunks.has(key)) chunks.set(key, chunk);
    digests.set(top.node, digest);
    stack.pop();
    const parent = stack[stack.length - 1];
    if (parent === undefined) return Object.freeze({ root: address(digest), chunks });
    parent.children.push(digest);
  }
}

/** One chunk's octets, given its children's digests in key order. */
function chunkOf(
  prefix: Uint8Array,
  payload: Uint8Array,
  entries: readonly [Uint8Array, unknown][],
  children: readonly Uint8Array[],
): Uint8Array {
  // First-use order (§6): each distinct hash takes the next header position when first met.
  const positions = new Map<string, number>();
  const links: Uint8Array[] = [];
  const indices = children.map((digest) => {
    const key = toHex(digest);
    let position = positions.get(key);
    if (position === undefined) {
      position = links.length;
      positions.set(key, position);
      links.push(digest);
    }
    return position;
  });
  const out = new Writer();
  out.bytes(prefix);
  out.cuvarint(links.length);
  for (const link of links) out.bytes(link);
  out.cuvarint(payload.length);
  out.bytes(payload);
  out.cuvarint(entries.length);
  entries.forEach(([key], e) => {
    out.cuvarint(key.length);
    out.bytes(key);
    out.cuvarint(indices[e]!);
  });
  return out.finish();
}

/**
 * The closure judged in §12's order: its walk (framing, links and digests, and the
 * dimensions the walk meets), then the capability judgment, then every unique chunk's
 * payload; and only then, before anything is built or written, the caller's budget for
 * the build. So an over-budget closure that is invalid or unsupported gets that verdict.
 */
function judgeClosure(
  root: Address,
  fetch: Fetch,
  registry: Registry,
  limits: Limits,
): { t: Traversal; codec: SlotCodec<unknown> } | Refusal | StoreFault {
  const t = traverse(root, fetch, limits, sha256);
  if ("class" in t) return t;
  const codec = registry.lookup(t.root.chunk.id);
  if (codec === undefined) return UNSUPPORTED;
  for (const info of t.order) {
    if (codec.decode(info.chunk.payload) === undefined) return invalid("non_canonical_payload");
  }
  if (t.root.nodes > limits.unfolded_node_count) return refused("unfolded_node_count");
  if (unfoldedFlatOctets(t, limits) > limits.unfolded_flat_octets) return refused("unfolded_flat_octets");
  return { t, codec };
}

/** A chunk's own payload through the codec held for its id (§11: capability, then `D`). */
export interface OwnAccepted<T> {
  readonly class: "accepted";
  readonly own: T;
  readonly codec: SlotCodec<T>;
}

/** A verified chunk, or why none could be had: a decoder verdict or a store fault. */
export type ChunkVerdict = LinkedChunk | Invalid | ResourceRefused | StoreFault;

/**
 * One verified chunk of a closure, opened lazily (§14 "open / navigate lazily"): nothing
 * below it is fetched until asked for, and nothing is materialized.
 *
 * It is made only by the two retrievals §14 keeps apart, whose hashes come from different
 * places: {@link LinkedChunk.resolveRoot}, verified against the address the caller asks
 * for, and {@link LinkedChunk.resolveChild}, verified against the links header of a chunk
 * already verified. There is no third way, and no single call taking an address for both.
 */
export class LinkedChunk {
  static readonly #mint = Symbol("a verified chunk");
  readonly #where: Address;
  readonly #chunk: ParsedChunk;
  readonly #depth: number;

  private constructor(mint: symbol, where: Address, chunk: ParsedChunk, depth: number) {
    if (mint !== LinkedChunk.#mint) throw new TypeError("a LinkedChunk is made by resolveRoot or resolveChild");
    this.#where = where;
    this.#chunk = chunk;
    this.#depth = depth;
  }

  /**
   * resolve-root (§14): the chunk at `root`, whose octets must hash to the address the
   * caller asked for — the one place a caller's question enters, which is what anchors
   * everything reached from here to the value that was asked for.
   */
  static resolveRoot(root: Address, fetch: Fetch, limits?: LimitsInput): ChunkVerdict {
    if (root.space !== "dxl2" || root.digest.length !== 32) {
      throw new TypeError('an address is the pair ("dxl2", 32-octet digest) (§7)');
    }
    const verified = fetchVerified(root.digest, fetch, limitsOf(limits), sha256, undefined);
    if ("class" in verified) return verified;
    return new LinkedChunk(LinkedChunk.#mint, verified.where, verified.chunk, 0);
  }

  /**
   * resolve-child (§14): the chunk this one references under `key`, fetched by the hash in
   * this chunk's own links header and verified against it, its id compared with this
   * chunk's after its framing (§10). `undefined` when this chunk has no entry under `key`.
   * Depth counts from the chunk navigation started at (§12's `logical_depth`).
   */
  resolveChild(key: Uint8Array, fetch: Fetch, limits?: LimitsInput): ChunkVerdict | undefined {
    const keys = this.#chunk.keys;
    let low = 0;
    let high = keys.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const order = compareBytes(keys[middle]!, key);
      if (order < 0) low = middle + 1;
      else if (order > 0) high = middle - 1;
      else {
        const bounds = limitsOf(limits);
        const depth = this.#depth + 1;
        if (BigInt(depth) > bounds.logical_depth) return refused("logical_depth");
        const link = this.#chunk.links[this.#chunk.indices[middle]!]!;
        const verified = fetchVerified(link, fetch, bounds, sha256, this.#chunk.id);
        if ("class" in verified) return verified;
        return new LinkedChunk(LinkedChunk.#mint, verified.where, verified.chunk, depth);
      }
    }
    return undefined;
  }

  /** The address this chunk was verified against. */
  get address(): Address {
    return address(this.#where.digest);
  }

  /** The slot-codec-id the chunk carries (copied). */
  get id(): Uint8Array {
    return Uint8Array.from(this.#chunk.id);
  }

  /** The chunk's own payload octets, not yet judged by any slot codec (copied). */
  get payload(): Uint8Array {
    return Uint8Array.from(this.#chunk.payload);
  }

  /** Edges from the chunk navigation started at. */
  get depth(): number {
    return this.#depth;
  }

  /** The number of entries. */
  get length(): number {
    return this.#chunk.keys.length;
  }

  /** The entries' keys, in ascending order (copied). */
  keys(): Uint8Array[] {
    return this.#chunk.keys.map((key) => Uint8Array.from(key));
  }

  /**
   * The entries, in ascending key order: each key with the address its link names
   * (copied). Nothing is fetched; {@link LinkedChunk.resolveChild} is what verifies a child.
   */
  children(): [Uint8Array, Address][] {
    return this.#chunk.keys.map((key, i) => [Uint8Array.from(key), address(this.#chunk.links[this.#chunk.indices[i]!]!)]);
  }

  /**
   * This chunk's own value: `unsupported_slot_codec` when `registry` holds no codec for
   * its id, `non_canonical_payload` when the payload is outside that codec's image.
   */
  own<T = unknown>(registry: Registry): OwnAccepted<T> | Unsupported | Invalid {
    const codec = registry.lookup(this.#chunk.id);
    if (codec === undefined) return UNSUPPORTED;
    const decoded = codec.decode(this.#chunk.payload);
    if (decoded === undefined) return invalid("non_canonical_payload");
    return Object.freeze({ class: "accepted", own: decoded.value, codec }) as OwnAccepted<T>;
  }
}

/** The linked-resolver's verdict on a closure: a value, a decoder verdict, or a store fault. */
export type ResolveVerdict<T> = Verdict<T> | StoreFault;

/**
 * Materialize (§14): the value at `root`, under full validation. The root is fetched by
 * resolve-root, against the address the caller asked for; every other chunk only through
 * an already-verified parent's links header (resolve-child). `limits` carries the
 * caller's budget: the unfolded size is measured over the DAG in saturating arithmetic
 * before anything is built, and the value is then built node by node, with no aliasing
 * between repeated subtrees. `T` is the caller's assertion about the codecs the registry
 * holds.
 */
export function decodeLinked<T = unknown>(
  root: Address,
  fetch: Fetch,
  registry: Registry,
  limits?: LimitsInput,
): ResolveVerdict<T> {
  const judged = judgeClosure(root, fetch, registry, limitsOf(limits));
  if ("class" in judged) return judged;
  const { t, codec } = judged;

  interface Frame {
    readonly info: Traversal["root"];
    entry: number;
    readonly children: [Uint8Array, Node<unknown>][];
  }
  const stack: Frame[] = [{ info: t.root, entry: 0, children: [] }];
  for (;;) {
    const top = stack[stack.length - 1]!;
    const c = top.info.chunk;
    if (top.entry < c.keys.length) {
      stack.push({ info: top.info.linked[c.indices[top.entry]!]!, entry: 0, children: [] });
      continue;
    }
    // Judged above; decoded again here so that no two positions share a payload object.
    const node = Node.compose(codec.decode(c.payload)!.value, top.children);
    stack.pop();
    const parent = stack[stack.length - 1];
    if (parent === undefined) return Object.freeze({ class: "accepted", value: node, codec }) as Accepted<T>;
    parent.children.push([parent.info.chunk.keys[parent.entry]!, node]);
    parent.entry++;
  }
}

/**
 * The closure-checker's success (§2.1, §15): framing, link structure and digests hold for
 * every reachable chunk. It is **opaque closure present**, not a validated value: no
 * payload was decoded.
 */
export interface ClosurePresent {
  readonly class: "closure-present";
  /** The slot-codec-id every chunk of the closure carries. */
  readonly id: Uint8Array;
  /** The number of unique chunks reachable from the root. */
  readonly chunks: number;
}

export type ClosureVerdict = ClosurePresent | Invalid | ResourceRefused | StoreFault;

/**
 * The closure-checker (§2.1): every reachable chunk present, hash-matching and well
 * framed, with one slot-codec-id throughout. Codec-blind by construction: it never
 * reports `unsupported_slot_codec` or `non_canonical_payload`, and builds nothing.
 */
export function checkClosure(root: Address, fetch: Fetch, limits?: LimitsInput): ClosureVerdict {
  const t = traverse(root, fetch, limitsOf(limits), sha256);
  if ("class" in t) return t;
  return Object.freeze({ class: "closure-present", id: Uint8Array.from(t.root.chunk.id), chunks: t.order.length });
}

/**
 * The unfolded size of a closure's value (§12, §14 "estimate unfolded size"), in
 * saturating arithmetic over the DAG: a measure past its limit reads as that limit plus
 * one. Nothing is decoded or built.
 */
export interface UnfoldedEstimate {
  readonly class: "estimated";
  /** Nodes of the unfolded tree, saturating at `unfolded_node_count` + 1. */
  readonly nodes: bigint;
  /** Octets of the whole flat artifact, header included, saturating at `unfolded_flat_octets` + 1. */
  readonly flatOctets: bigint;
  /** The deepest node's depth in edges; within `logical_depth`, or the walk refuses. */
  readonly depth: number;
}

export type EstimateVerdict = UnfoldedEstimate | Invalid | ResourceRefused | StoreFault;

/**
 * Estimate the unfolded size of the value at `root` (§14): the closure walked as the
 * closure-checker walks it — every chunk verified, the walk's own dimensions met as it
 * goes — and its measures reported rather than judged against a build budget.
 */
export function estimateUnfolded(root: Address, fetch: Fetch, limits?: LimitsInput): EstimateVerdict {
  const bounds = limitsOf(limits);
  const t = traverse(root, fetch, bounds, sha256);
  if ("class" in t) return t;
  return Object.freeze({ class: "estimated", nodes: t.root.nodes, flatOctets: unfoldedFlatOctets(t, bounds), depth: t.root.height });
}

/** The flat octets of a closure's value (§14 flatten), under full validation. */
export interface Flattened {
  readonly class: "accepted";
  readonly bytes: Uint8Array;
  readonly codec: SlotCodec<unknown>;
}

export type FlattenVerdict = Flattened | Refusal | StoreFault;

/**
 * flatten (§14): the closure at `root` judged in full, then written out as the flat form —
 * or refused, before a single octet is written, when its unfolded measures exceed the
 * caller's budget (`unfolded_flat_octets` is the whole flat artifact, header included).
 * Payload octets are copied from the chunks: under full validation each is in the image of
 * `e`, so it is exactly what {@link encodeFlat} would write.
 */
export function flattenClosure(root: Address, fetch: Fetch, registry: Registry, limits?: LimitsInput): FlattenVerdict {
  const bounds = limitsOf(limits);
  const judged = judgeClosure(root, fetch, registry, bounds);
  if ("class" in judged) return judged;
  const { t, codec } = judged;
  const id = t.root.chunk.id;

  const out = new Writer(Number(unfoldedFlatOctets(t, bounds)));
  out.bytes(FLAT_MAGIC);
  out.cuvarint(id.length);
  out.bytes(id);
  const stack: { info: Traversal["root"]; entry: number }[] = [];
  const open = (info: Traversal["root"]) => {
    out.cuvarint(info.chunk.payload.length);
    out.bytes(info.chunk.payload);
    out.cuvarint(info.chunk.keys.length);
    stack.push({ info, entry: 0 });
  };
  open(t.root);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const c = top.info.chunk;
    if (top.entry === c.keys.length) {
      stack.pop();
      continue;
    }
    const key = c.keys[top.entry]!;
    const child = top.info.linked[c.indices[top.entry]!]!;
    top.entry++;
    out.cuvarint(key.length);
    out.bytes(key);
    open(child);
  }
  return Object.freeze({ class: "accepted", bytes: out.finish(), codec });
}
