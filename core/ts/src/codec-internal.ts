/**
 * The internals of deixis-codec-v2 (docs/CODEC.md). The public surface is `./codec.js`;
 * this module is not a package export.
 *
 * It holds what the flat and the linked form share: the verdict types, the resource
 * envelope, the cuvarint reader, the slot-codec-id's structure, a chunk's framing parse
 * and the closure walk. The walk takes its digest function as a parameter so that tests
 * can reach the one branch SHA-256 makes infeasible: a hash cycle (§12). Every public
 * caller passes SHA-256, and a hash other than SHA-256 is not deixis-codec-v2 (§7).
 */

// --- verdicts (§9, §14) -------------------------------------------------------------------

/** §9's four non-acceptance classes. A decoder never collapses them into one error. */
export type RefusalClass = "invalid" | "unsupported" | "incomplete" | "resource-refused";

/** §9's invalid codes: these octets are not canonical deixis-codec-v2, now or ever. */
export type InvalidCode =
  | "malformed_uvarint"
  | "non_shortest_uvarint"
  | "uvarint_overflow"
  | "unknown_magic"
  | "duplicate_key"
  | "unsorted_keys"
  | "trailing_bytes"
  | "unexpected_eof"
  | "bad_link_index"
  | "unused_link"
  | "duplicate_link_hash"
  | "links_out_of_order"
  | "slot_codec_mismatch"
  | "malformed_slot_codec_id"
  | "non_canonical_payload";

/** The store / traversal layer's codes (§9): facts about a store, never decoder verdicts. */
export type StoreCode = "missing_chunk" | "hash_mismatch" | "address_conflict";

/** §12's resource dimensions, by their stable tokens. */
export type Dimension =
  | "varint_value"
  | "slot_codec_id_length"
  | "key_length"
  | "payload_length"
  | "entries_per_node"
  | "links_per_chunk"
  | "flat_artifact_octets"
  | "chunk_octets"
  | "unique_chunks"
  | "unique_octets"
  | "logical_depth"
  | "unfolded_node_count"
  | "unfolded_flat_octets";

/** Every code the codec can name. */
export type Code =
  | InvalidCode
  | "unsupported_slot_codec"
  | "need_more_input"
  | "limit_exceeded"
  | StoreCode;

/** The octets are not a value, now or ever. */
export interface Invalid {
  readonly class: "invalid";
  readonly code: InvalidCode;
}

/** Well-formed framing under a slot codec this decoder does not hold (§11). */
export interface Unsupported {
  readonly class: "unsupported";
  readonly code: "unsupported_slot_codec";
}

/** Streaming only: no final verdict yet (§14). The one non-terminal state. */
export interface Incomplete {
  readonly class: "incomplete";
  readonly code: "need_more_input";
}

/** Valid so far, beyond a local limit: the reader declines to spend (§12). Never invalidity. */
export interface ResourceRefused {
  readonly class: "resource-refused";
  readonly code: "limit_exceeded";
  readonly dimension: Dimension;
}

/** A final non-acceptance. */
export type Refusal = Invalid | Unsupported | ResourceRefused;

/**
 * A content address (§7): always the pair of address space and digest, never a bare
 * 32-octet array. The digest is the SHA-256 of a root chunk's entire octets.
 */
export interface Address {
  readonly space: "dxl2";
  readonly digest: Uint8Array;
}

/**
 * A store-layer outcome met while resolving a closure (§9, §14). It is a fact about the
 * store that served the chunks, not about any octets, so it is never a decoder verdict:
 * `missing_chunk` when the store had nothing for an address, `hash_mismatch` when what it
 * served does not hash to the address it was asked for.
 */
export interface StoreFault {
  readonly class: "store";
  readonly code: "missing_chunk" | "hash_mismatch";
  readonly address: Address;
}

export const invalid = (code: InvalidCode): Invalid => Object.freeze({ class: "invalid", code });
export const refused = (dimension: Dimension): ResourceRefused =>
  Object.freeze({ class: "resource-refused", code: "limit_exceeded", dimension });
export const UNSUPPORTED: Unsupported = Object.freeze({ class: "unsupported", code: "unsupported_slot_codec" });
export const NEED_MORE_INPUT: Incomplete = Object.freeze({ class: "incomplete", code: "need_more_input" });
export const MALFORMED_ID = invalid("malformed_slot_codec_id");

export const storeFault = (code: StoreFault["code"], where: Address): StoreFault =>
  Object.freeze({ class: "store", code, address: where });

// --- the resource envelope (§12) ----------------------------------------------------------

/** One limit per §12 dimension, inclusive: a measure equal to its limit is admitted. */
export type Limits = { readonly [D in Dimension]: bigint };

/** Limits to override; a dimension left out stays at its §12 floor. */
export type LimitsInput = { readonly [D in Dimension]?: bigint | number };

export const MAX_U64 = (1n << 64n) - 1n;
const MiB = 1n << 20n;

/**
 * §12's MUST-accept floors, which are also the default limits. Lowering a limit below its
 * floor is possible, and makes a decoder non-conforming for the inputs it then refuses.
 * `logical_depth` counts edges: the root is at depth 0, so at the floor a node with 256
 * ancestors is admitted and one with 257 is not.
 */
export const FLOORS: Limits = Object.freeze({
  varint_value: MAX_U64,
  slot_codec_id_length: 32n,
  key_length: 4096n,
  payload_length: 16n * MiB,
  entries_per_node: 65_536n,
  links_per_chunk: 65_536n,
  flat_artifact_octets: 64n * MiB,
  chunk_octets: 32n * MiB,
  unique_chunks: 1_000_000n,
  unique_octets: 1024n * MiB,
  logical_depth: 256n,
  unfolded_node_count: 16_777_216n,
  unfolded_flat_octets: 1024n * MiB,
});

export function limitsOf(input: LimitsInput | undefined): Limits {
  if (input === undefined) return FLOORS;
  const out: Record<string, bigint> = { ...FLOORS };
  for (const [dimension, value] of Object.entries(input)) {
    if (!Object.hasOwn(FLOORS, dimension)) throw new TypeError(`unknown §12 dimension ${dimension}`);
    if (value === undefined) continue;
    const limit = typeof value === "bigint" ? value : BigInt(value);
    if (limit < 0n) throw new RangeError(`limit ${dimension} is negative`);
    out[dimension] = limit;
  }
  return Object.freeze(out as Limits);
}

// --- cuvarint (§3) ------------------------------------------------------------------------

export type Scan =
  | { readonly value: bigint; readonly next: number }
  | "empty" // no octet of the integer was available
  | "partial" // the available octets ended with the continuation bit set
  | "cap" // the next octet exists but lies at or past the reader's octet limit
  | "malformed_uvarint"
  | "uvarint_overflow"
  | "non_shortest_uvarint";

/**
 * Read one cuvarint at `pos` from the `available` octets of `buf`, never reading at or past
 * `cap`. The first octet the reader cannot take decides: absent (the input ended, or has
 * not arrived) before past the cap, since a reader that has seen the input end must say so
 * rather than refuse on resource. §3's faults are judged octet by octet, in §10's order:
 * malformed, then overflow, then non-shortest.
 */
export function scanCuvarint(buf: Uint8Array, pos: number, available: number, cap: number): Scan {
  let low = 0; // groups 0..6, exact in a double
  let high = 0n; // groups 7..9
  for (let i = 0; ; i++) {
    const at = pos + i;
    if (at >= available) return i === 0 ? "empty" : "partial";
    if (at >= cap) return "cap";
    const octet = buf[at]!;
    const group = octet & 0x7f;
    const last = octet < 0x80;
    if (i === 9) {
      // A tenth octet that continues needs an eleventh (§3 rule 2); a last one carries
      // bit 63 alone, so any other bit is past 2^64 − 1 and a zero is a longer spelling.
      if (!last) return "malformed_uvarint";
      if (group > 1) return "uvarint_overflow";
      if (group === 0) return "non_shortest_uvarint";
    } else if (last && group === 0 && i > 0) {
      return "non_shortest_uvarint";
    }
    if (i < 7) low += group * 2 ** (7 * i);
    else high |= BigInt(group) << BigInt(7 * i);
    if (last) return { value: BigInt(low) | high, next: at + 1 };
  }
}

/** The number of octets in the canonical spelling of `value`. */
export function cuvarintLength(value: number): number {
  let length = 1;
  while (value >= 128) {
    value = Math.floor(value / 128);
    length++;
  }
  return length;
}

// --- the slot-codec-id (§13) --------------------------------------------------------------

/** One slot-codec-id's form (§13). A reserved first octet ends the structural judgment. */
export type SlotCodecIdForm =
  | { readonly form: "public"; readonly n: bigint }
  | { readonly form: "private"; readonly namespace: Uint8Array; readonly k: bigint }
  | { readonly form: "option-of"; readonly inner: SlotCodecIdForm }
  | { readonly form: "reserved"; readonly first: number };

/**
 * The structure of one id whose octets are exactly `id`, its length already judged to lie
 * in 2..32. The id is a bounded input: no field inside it is read past its end. Its end
 * plays the end of input for an integer already begun (`malformed_uvarint`), and a field
 * that would begin at or past it is missing (`malformed_slot_codec_id`); neither is ever
 * `need_more_input`. Integer faults inside the id keep §3's codes.
 */
export function idStructure(id: Uint8Array, varintLimit: bigint): SlotCodecIdForm | Invalid | ResourceRefused {
  const end = id.length;
  let pos = 0;
  let wrappers = 0;
  // Option-of nests by prefix, and nothing bounds it but the whole id's length.
  while (pos < end && id[pos] === 0x02) {
    wrappers++;
    pos++;
  }
  if (pos >= end) return MALFORMED_ID; // `02` with nothing after it
  const first = id[pos]!;
  let form: SlotCodecIdForm;
  if (first === 0x00 || first === 0x01) {
    pos++;
    let namespace: Uint8Array | undefined;
    if (first === 0x01) {
      if (pos + 16 > end) return MALFORMED_ID; // the namespace cut short
      namespace = id.slice(pos, pos + 16);
      pos += 16;
    }
    if (pos >= end) return MALFORMED_ID; // `00` alone, or a namespace with no `k`
    const scan = scanCuvarint(id, pos, end, end);
    if (typeof scan !== "object") {
      return scan === "empty" || scan === "partial" || scan === "cap" ? invalid("malformed_uvarint") : invalid(scan);
    }
    if (scan.value > varintLimit) return refused("varint_value");
    pos = scan.next;
    if (namespace === undefined) {
      if (scan.value === 0n) return MALFORMED_ID; // n = 0 is permanently reserved
      form = { form: "public", n: scan.value };
    } else {
      form = { form: "private", namespace, k: scan.value };
    }
    if (pos !== end) return MALFORMED_ID; // octets left over
  } else {
    form = { form: "reserved", first };
  }
  for (let i = 0; i < wrappers; i++) form = { form: "option-of", inner: form };
  return form;
}

export function innermost(form: SlotCodecIdForm): SlotCodecIdForm {
  while (form.form === "option-of") form = form.inner;
  return form;
}

// --- the linked form's chunk (§6) ---------------------------------------------------------

export const FLAT_MAGIC = Uint8Array.of(0x64, 0x78, 0x66, 0x32); // "dxf2"
export const LINKED_MAGIC = Uint8Array.of(0x64, 0x78, 0x6c, 0x32); // "dxl2"

/** One chunk after its framing parse (§6 rules 1–7); its payload is not yet judged. */
export interface ParsedChunk {
  readonly id: Uint8Array;
  readonly links: readonly Uint8Array[];
  readonly payload: Uint8Array;
  readonly keys: readonly Uint8Array[];
  /** The header position each entry references, in key order. */
  readonly indices: readonly number[];
}

/** A whole-input reader for one chunk: the chunk's end is the end of input. */
class ChunkReader {
  pos = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly limits: Limits,
  ) {}

  cuvarint(): bigint | Invalid | ResourceRefused {
    const scan = scanCuvarint(this.bytes, this.pos, this.bytes.length, Number.POSITIVE_INFINITY);
    if (typeof scan !== "object") {
      if (scan === "empty") return invalid("unexpected_eof");
      return invalid(scan === "partial" || scan === "cap" ? "malformed_uvarint" : scan);
    }
    if (scan.value > this.limits.varint_value) return refused("varint_value");
    this.pos = scan.next;
    return scan.value;
  }

  take(length: bigint): Uint8Array | Invalid {
    if (length > BigInt(this.bytes.length - this.pos)) return invalid("unexpected_eof");
    const out = this.bytes.subarray(this.pos, this.pos + Number(length));
    this.pos += out.length;
    return out;
  }
}

const isFault = (x: unknown): x is Invalid | ResourceRefused =>
  typeof x === "object" && x !== null && Object.hasOwn(x, "class");

/**
 * The framing parse of one chunk, codec-blind, in parse order, with every limit met at
 * the field that exceeds it. Within the links group §10's order holds because each fault
 * is judged at the step that first shows it: a repeated hash while the header is read, an
 * index out of range or out of first-use order at its entry, and an unused hash only once
 * every entry has been read.
 */
export function parseChunk(bytes: Uint8Array, limits: Limits): ParsedChunk | Invalid | ResourceRefused {
  if (bytes.length < 4) return invalid("unexpected_eof");
  for (let i = 0; i < 4; i++) if (bytes[i] !== LINKED_MAGIC[i]) return invalid("unknown_magic");
  const r = new ChunkReader(bytes, limits);
  r.pos = 4;

  const idLength = r.cuvarint();
  if (isFault(idLength)) return idLength;
  if (idLength < 2n || idLength > 32n) return MALFORMED_ID;
  if (idLength > limits.slot_codec_id_length) return refused("slot_codec_id_length");
  const idOctets = r.take(idLength);
  if (isFault(idOctets)) return idOctets;
  const form = idStructure(idOctets, limits.varint_value);
  if ("class" in form) return form;

  const nlinks = r.cuvarint();
  if (isFault(nlinks)) return nlinks;
  if (nlinks > limits.links_per_chunk) return refused("links_per_chunk");
  const links: Uint8Array[] = [];
  const listed = new Set<string>();
  for (let i = 0n; i < nlinks; i++) {
    const hash = r.take(32n);
    if (isFault(hash)) return hash;
    const key = toHex(hash);
    if (listed.has(key)) return invalid("duplicate_link_hash");
    listed.add(key);
    links.push(hash);
  }

  const payloadLength = r.cuvarint();
  if (isFault(payloadLength)) return payloadLength;
  if (payloadLength > limits.payload_length) return refused("payload_length");
  const payload = r.take(payloadLength);
  if (isFault(payload)) return payload;

  const count = r.cuvarint();
  if (isFault(count)) return count;
  if (count > limits.entries_per_node) return refused("entries_per_node");
  const keys: Uint8Array[] = [];
  const indices: number[] = [];
  let firstUnused = 0; // the header position the next new index must take
  for (let i = 0n; i < count; i++) {
    const keyLength = r.cuvarint();
    if (isFault(keyLength)) return keyLength;
    if (keyLength > limits.key_length) return refused("key_length");
    const key = r.take(keyLength);
    if (isFault(key)) return key;
    const previous = keys[keys.length - 1];
    if (previous !== undefined) {
      const order = compareBytes(key, previous);
      if (order === 0) return invalid("duplicate_key");
      if (order < 0) return invalid("unsorted_keys");
    }
    const index = r.cuvarint();
    if (isFault(index)) return index;
    if (index >= nlinks) return invalid("bad_link_index");
    const position = Number(index);
    if (position >= firstUnused) {
      if (position !== firstUnused) return invalid("links_out_of_order");
      firstUnused++;
    }
    keys.push(key);
    indices.push(position);
  }
  if (firstUnused < links.length) return invalid("unused_link");
  if (r.pos < bytes.length) return invalid("trailing_bytes");
  return { id: Uint8Array.from(idOctets), links, payload, keys, indices };
}

// --- the closure walk (§12, §14) ----------------------------------------------------------

/** A caller's chunk source (a store). Untrusted: every chunk is verified against its address. */
export type Fetch = (where: Address) => Uint8Array | undefined;

/** The address with this 32-octet digest (copied). */
export function address(digest: Uint8Array): Address {
  if (digest.length !== 32) throw new RangeError("a dxl2 digest is 32 octets");
  return Object.freeze({ space: "dxl2", digest: Uint8Array.from(digest) });
}

/**
 * §14's per-chunk verification: fetch the chunk a hash names, verify its octets against
 * that hash, framing-parse it, and — for a child — compare its slot-codec-id with its
 * parent's, which is read first and ruled last (§10). `admit` sees the served length
 * before the octets are hashed, for a walk's own budgets.
 */
export function fetchVerified(
  hash: Uint8Array,
  fetch: Fetch,
  limits: Limits,
  digest: (bytes: Uint8Array) => Uint8Array,
  parentId: Uint8Array | undefined,
  admit?: (length: number) => ResourceRefused | undefined,
): { readonly where: Address; readonly chunk: ParsedChunk } | Invalid | ResourceRefused | StoreFault {
  const where = address(hash);
  const served = fetch(where);
  if (served === undefined) return storeFault("missing_chunk", where);
  // The digest check reads every octet before the parse reads any, so it is the first
  // reader to meet the chunk's length.
  if (BigInt(served.length) > limits.chunk_octets) return refused("chunk_octets");
  const over = admit?.(served.length);
  if (over !== undefined) return over;
  // Judge a copy: a store that changed its buffer after the check would otherwise have
  // unverified octets parsed.
  const bytes = Uint8Array.from(served);
  if (!equalBytes(digest(bytes), hash)) return storeFault("hash_mismatch", where);
  const chunk = parseChunk(bytes, limits);
  if ("class" in chunk) return chunk;
  if (parentId !== undefined && !equalBytes(chunk.id, parentId)) return invalid("slot_codec_mismatch");
  return { where, chunk };
}

/** A verified, framing-parsed chunk of the closure, with its unfolded measures (§12). */
export interface ChunkInfo {
  readonly chunk: ParsedChunk;
  /** The chunk each header position resolved to. */
  readonly linked: ChunkInfo[];
  /** Whether every chunk below this one has been walked. */
  done: boolean;
  /** Unfolded nodes, saturating at the limit plus one: never found by materializing. */
  nodes: bigint;
  /** Unfolded flat octets of this node (no header), saturating likewise. */
  flat: bigint;
  /** The depth of the deepest node below, in edges. */
  height: number;
}

export interface Traversal {
  readonly root: ChunkInfo;
  /** Every reachable chunk once, in first-visit order. */
  readonly order: readonly ChunkInfo[];
}

/**
 * Walk the closure of `root` depth first, in each chunk's header order, verifying every
 * chunk against the hash that reached it: the root against the address the caller asked
 * for (resolve-root), every other chunk against its parent's links header
 * (resolve-child), §14. A visited set keeps the walk linear in the unique chunks, and
 * measures are computed bottom-up as each chunk closes (§12).
 *
 * The walk meets its dimensions as it goes (§12): a chunk's octets, the unique chunks and
 * octets when a chunk is fetched, and logical depth at every link — as the depth of a new
 * chunk, as the depth reached below an already walked one, and as a hash cycle, a link
 * back to one of the current chunk's own ancestors, which denotes no finite tree.
 */
export function traverse(
  root: Address,
  fetch: Fetch,
  limits: Limits,
  digest: (bytes: Uint8Array) => Uint8Array,
): Traversal | Invalid | ResourceRefused | StoreFault {
  if (root.space !== "dxl2" || root.digest.length !== 32) {
    throw new TypeError('an address is the pair ("dxl2", 32-octet digest) (§7)');
  }
  const seen = new Map<string, ChunkInfo>();
  const order: ChunkInfo[] = [];
  let octets = 0n;

  const admit = (length: number): ResourceRefused | undefined => {
    if (BigInt(seen.size + 1) > limits.unique_chunks) return refused("unique_chunks");
    octets += BigInt(length);
    return octets > limits.unique_octets ? refused("unique_octets") : undefined;
  };
  const visit = (hash: Uint8Array, parentId: Uint8Array | undefined): ChunkInfo | Invalid | ResourceRefused | StoreFault => {
    const verified = fetchVerified(hash, fetch, limits, digest, parentId, admit);
    if ("class" in verified) return verified;
    const { chunk } = verified;
    const info: ChunkInfo = { chunk, linked: new Array(chunk.links.length), done: false, nodes: 0n, flat: 0n, height: 0 };
    seen.set(toHex(hash), info);
    order.push(info);
    return info;
  };

  const depthLimit = limits.logical_depth;
  const first = visit(root.digest, undefined);
  if ("class" in first) return first;
  const stack: { info: ChunkInfo; next: number; depth: number }[] = [{ info: first, next: 0, depth: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const links = top.info.chunk.links;
    if (top.next === links.length) {
      measure(top.info, limits);
      stack.pop();
      continue;
    }
    const position = top.next++;
    const link = links[position]!;
    const depth = top.depth + 1;
    const known = seen.get(toHex(link));
    if (known !== undefined) {
      // Open means on the stack: one of this chunk's own ancestors, or itself.
      if (!known.done) return refused("logical_depth");
      if (BigInt(depth + known.height) > depthLimit) return refused("logical_depth");
      top.info.linked[position] = known;
      continue;
    }
    if (BigInt(depth) > depthLimit) return refused("logical_depth");
    const child = visit(link, first.chunk.id);
    if ("class" in child) return child;
    top.info.linked[position] = child;
    stack.push({ info: child, next: 0, depth });
  }
  return { root: first, order };
}

/** A chunk's unfolded measures from its children's, in saturating arithmetic (§12). */
function measure(info: ChunkInfo, limits: Limits): void {
  const nodeCap = limits.unfolded_node_count + 1n;
  const flatCap = limits.unfolded_flat_octets + 1n;
  const c = info.chunk;
  let nodes = 1n;
  let flat = BigInt(cuvarintLength(c.payload.length) + c.payload.length + cuvarintLength(c.keys.length));
  let height = 0;
  for (let e = 0; e < c.keys.length; e++) {
    const child = info.linked[c.indices[e]!]!;
    const key = c.keys[e]!;
    nodes = min(nodes + child.nodes, nodeCap);
    flat = min(flat + BigInt(cuvarintLength(key.length) + key.length) + child.flat, flatCap);
    height = Math.max(height, child.height + 1);
  }
  info.nodes = min(nodes, nodeCap);
  info.flat = min(flat, flatCap);
  info.height = height;
  info.done = true;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * The whole flat artifact the closure flattens to, header included (§12), saturating at
 * `unfolded_flat_octets` + 1 like the node measures it is built from.
 */
export function unfoldedFlatOctets(t: Traversal, limits: Limits): bigint {
  const id = t.root.chunk.id;
  return min(BigInt(FLAT_MAGIC.length + cuvarintLength(id.length) + id.length) + t.root.flat, limits.unfolded_flat_octets + 1n);
}

// --- octets -------------------------------------------------------------------------------

/** A growable octet buffer. */
export class Writer {
  #buf: Uint8Array;
  #length = 0;

  constructor(capacity = 64) {
    this.#buf = new Uint8Array(Math.max(capacity, 16));
  }

  #reserve(n: number): void {
    if (this.#length + n <= this.#buf.length) return;
    let capacity = this.#buf.length * 2;
    while (capacity < this.#length + n) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.#buf.subarray(0, this.#length));
    this.#buf = grown;
  }

  bytes(octets: Uint8Array): void {
    this.#reserve(octets.length);
    this.#buf.set(octets, this.#length);
    this.#length += octets.length;
  }

  /** C(v) (§3); `v` is a non-negative integer below 2^64. */
  cuvarint(v: number | bigint): void {
    this.#reserve(10);
    if (typeof v === "number") {
      while (v >= 128) {
        this.#buf[this.#length++] = (v % 128) | 0x80;
        v = Math.floor(v / 128);
      }
      this.#buf[this.#length++] = v;
      return;
    }
    while (v >= 128n) {
      this.#buf[this.#length++] = Number(v & 0x7fn) | 0x80;
      v >>= 7n;
    }
    this.#buf[this.#length++] = Number(v);
  }

  finish(): Uint8Array {
    return this.#buf.slice(0, this.#length);
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]!];
  return out;
}

/** Unsigned-octet lexicographic comparison, the shorter prefix first (§2). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i++) {
    const difference = a[i]! - b[i]!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && compareBytes(a, b) === 0;
}
