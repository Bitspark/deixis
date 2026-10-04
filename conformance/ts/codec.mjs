// deixis-codec-v2 operations of the conformance protocol (tools/conformance/README.md,
// "Codec protocol (deixis-codec-v2)"). The CLI answers with the built core's own
// judgment; it owns no vectors and no expectations. A codec is named by its id, and
// option-of is derived by the core's Registry from `02 ‖ id` (CODEC.md §13).
//
// A request this CLI cannot serve — one naming a codec it does not implement, or a root
// that is not a dxl2 address — is answered {"error": "unsupported"} before anything is
// judged. A malformed request (hex that is not hex, cuts that are not ascending interior
// offsets) is a CLI defect, and fails loudly rather than being answered.

import { createHash } from "node:crypto";

import { DuplicateKeyError, Node, some } from "../../core/ts/dist/index.js";
import {
  FlatDecoder,
  FlatHeaderReader,
  LinkedChunk,
  Registry,
  address,
  addressKey,
  checkClosure,
  decodeFlat,
  decodeLinked,
  encodeFlat,
  encodeLinked,
  flattenClosure,
  identityBytes,
  readFlatHeader,
} from "../../core/ts/dist/codec.js";

/** Strict hex: an odd length or a character that is not a hex digit is a malformed request. */
function fromHex(s) {
  if (typeof s !== "string" || s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) {
    throw new Error(`not hex: ${JSON.stringify(s)}`);
  }
  return Uint8Array.from(Buffer.from(s, "hex"));
}
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const sameBytes = (a, b) => a.length === b.length && a.every((octet, i) => octet === b[i]);
const only = (x, key) => x !== null && typeof x === "object" && Object.keys(x).length === 1 && key in x;
// A new object each time: main.mjs writes the request id into every response.
const unsupported = () => ({ error: "unsupported" });

// The fixture setoid of vectors/README.md: ≈ compares `class`, e is the UTF-8 of `class`,
// and D decodes UTF-8 strictly, to {class, representation: ""}. Its private id is
// 01 ‖ the first 16 octets of sha256("deixis vectors fixture setoid v1") ‖ k = 01.
const FIXTURE_ID = Uint8Array.from([
  0x01,
  ...createHash("sha256").update("deixis vectors fixture setoid v1").digest().subarray(0, 16),
  0x01,
]);
const FIXTURE = toHex(FIXTURE_ID);
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf8 = new TextEncoder();
const fixtureSetoid = {
  id: FIXTURE_ID,
  equal: (a, b) => a.class === b.class,
  encode: (value) => utf8.encode(value.class),
  decode: (payload) => {
    try {
      return some({ class: strictUtf8.decode(payload), representation: "" });
    } catch {
      return undefined;
    }
  },
};

// Every codec this CLI can build: the two base codecs, and option-of over them (§13).
const EVERY = new Registry([identityBytes, fixtureSetoid]);

/**
 * The registry a request's `holding` names, or undefined when it names anything but a
 * base id this CLI implements. The list names base ids only; option-of over a held id is
 * held (§13), and an option-of id in the list is not served, as in the other CLIs.
 */
function holding(ids) {
  const held = new Map();
  for (const spelled of ids ?? []) {
    if (spelled.startsWith("02")) return undefined;
    const codec = EVERY.lookup(fromHex(spelled));
    if (codec === undefined) return undefined;
    held.set(toHex(codec.id), codec);
  }
  return new Registry(held.values());
}

// --- payload carriers, by the id that names the codec ----------------------------------

function carrier(id) {
  if (id.startsWith("02")) {
    const inner = carrier(id.slice(2));
    return {
      read: (s) => (only(s, "none") ? undefined : some(inner.read(s.some))),
      spell: (v) => (v === undefined ? { none: {} } : { some: inner.spell(v.value) }),
    };
  }
  if (id === "0001") return { read: fromHex, spell: toHex };
  if (id === FIXTURE) {
    return {
      read: (s) => ({ class: s.class, representation: s.representation }),
      spell: (v) => ({ class: v.class, representation: v.representation }),
    };
  }
  throw new Error(`no carrier for slot codec ${id}`);
}

function build(spelling, c) {
  return Node.compose(
    c.read(spelling.own),
    spelling.children.map(([key, child]) => [fromHex(key), build(child, c)]),
  );
}

function spell(node, c) {
  return {
    own: c.spell(node.own()),
    children: node.entries().map(([key, child]) => [toHex(key), spell(child, c)]),
  };
}

// --- answers --------------------------------------------------------------------------

function verdict(v) {
  const out = { class: v.class, code: v.code };
  if (v.dimension !== undefined) out.dimension = v.dimension;
  return { verdict: out };
}

/** A core result spelled: its success by `accepted`, a store fault under "store", else a verdict. */
function answer(result, accepted) {
  if (result.class === "store") return { store: { code: result.code, digest: addressKey(result.address) } };
  if (result.class === "accepted" || result.class === "closure-present") return accepted(result);
  return verdict(result);
}

const valueOf = (result) => ({ value: spell(result.value, carrier(toHex(result.codec.id))) });

// --- requests -------------------------------------------------------------------------

function encode(request) {
  const id = fromHex(request.slot_codec);
  const codec = EVERY.lookup(id);
  if (codec === undefined) return unsupported();
  let node;
  try {
    node = build(request.node, carrier(toHex(id)));
  } catch (error) {
    if (error instanceof DuplicateKeyError) return { error: error.code, key: toHex(error.key) };
    throw error;
  }
  if (request.op === "codec.encodeFlat") return { bytes: toHex(encodeFlat(node, codec)) };
  const closure = encodeLinked(node, codec);
  return {
    root: { space: closure.root.space, digest: addressKey(closure.root) },
    chunks: [...closure.chunks].map(([digest, bytes]) => [digest, toHex(bytes)]),
  };
}

/** The input cut at the request's ascending interior offsets. */
function pieces(bytes, cuts) {
  const out = [];
  let at = 0;
  for (const cut of cuts) {
    if (!Number.isInteger(cut) || cut <= at || cut >= bytes.length) {
      throw new Error(`cuts ${JSON.stringify(cuts)} are not ascending interior offsets of ${bytes.length} octets`);
    }
    out.push(bytes.subarray(at, cut));
    at = cut;
  }
  out.push(bytes.subarray(at));
  return out;
}

/**
 * The flat-decoder or the flat-header-validator. With neither cuts nor end the whole
 * buffer is decoded; otherwise the pieces are fed to the streaming reader, end of input
 * is declared iff end, and only the final state is reported.
 */
function flat(request) {
  const registry = holding(request.holding);
  if (registry === undefined) return unsupported();
  const header = request.op === "codec.readHeader";
  const spelled = header ? (h) => ({ header: { slot_codec: toHex(h.id) } }) : valueOf;
  const bytes = fromHex(request.bytes);
  if (request.cuts === undefined && request.end === undefined) {
    return answer(header ? readFlatHeader(bytes, registry) : decodeFlat(bytes, registry), spelled);
  }
  const reader = header ? new FlatHeaderReader(registry) : new FlatDecoder(registry);
  let state;
  for (const piece of pieces(bytes, request.cuts ?? [])) state = reader.feed(piece);
  return answer(request.end === true ? reader.finish() : state, spelled);
}

/** The request's root, or undefined when it is not a dxl2 address (§7). */
function root(spelling) {
  const digest = fromHex(spelling.digest);
  return spelling.space === "dxl2" && digest.length === 32 ? address(digest) : undefined;
}

/**
 * The request's chunk list as an untrusted store: a digest need not be the SHA-256 of its
 * octets, and the core verifies every chunk it reads. Two different chunks filed under one
 * digest are the store's own address_conflict (§15), answered before anything is read.
 */
function store(chunks) {
  const byDigest = new Map();
  for (const [digest, hex] of chunks) {
    const key = toHex(fromHex(digest));
    const octets = fromHex(hex);
    const filed = byDigest.get(key);
    if (filed !== undefined && !sameBytes(filed, octets)) {
      return { conflict: { store: { code: "address_conflict", digest } } };
    }
    byDigest.set(key, octets);
  }
  return { fetch: (where) => byDigest.get(addressKey(where)) };
}

/** A caller budget: §12 tokens to decimal strings; a dimension left out is at its floor. */
const budget = (spelling) =>
  Object.fromEntries(Object.entries(spelling ?? {}).map(([token, value]) => [token, BigInt(value)]));

/** The linked-resolver (resolve, flatten) and the closure-checker, which holds no codec. */
function linked(request) {
  const where = root(request.root);
  if (where === undefined) return unsupported();
  const checking = request.op === "codec.checkClosure";
  const registry = checking ? undefined : holding(request.holding);
  if (!checking && registry === undefined) return unsupported();
  const { fetch, conflict } = store(request.chunks);
  if (conflict !== undefined) return conflict;
  if (checking) return answer(checkClosure(where, fetch), () => ({ ok: true }));
  if (request.op === "codec.resolve") return answer(decodeLinked(where, fetch, registry, budget(request.budget)), valueOf);
  return answer(flattenClosure(where, fetch, registry, budget(request.budget)), (f) => ({ bytes: toHex(f.bytes) }));
}

/**
 * §14's two constructors and nothing else: resolve-root once, then resolve-child per key
 * of the path, nothing fetched off it and nothing materialized. The answer is the reached
 * chunk's own value and its entries, each with its link digest; `absent` at the first key
 * no entry has; or the verdict or store fault that stopped the walk.
 */
function navigate(request) {
  const where = root(request.root);
  if (where === undefined) return unsupported();
  const registry = holding(request.holding);
  if (registry === undefined) return unsupported();
  const { fetch, conflict } = store(request.chunks);
  if (conflict !== undefined) return conflict;
  let chunk = LinkedChunk.resolveRoot(where, fetch);
  for (let i = 0; chunk instanceof LinkedChunk && i < request.path.length; i++) {
    const next = chunk.resolveChild(fromHex(request.path[i]), fetch);
    if (next === undefined) return { absent: i };
    chunk = next;
  }
  if (!(chunk instanceof LinkedChunk)) return answer(chunk, () => ({}));
  // The slot codec enters only here, at the chunk answered with (§14).
  const own = chunk.own(registry);
  if (own.class !== "accepted") return verdict(own);
  return {
    node: {
      own: carrier(toHex(chunk.id)).spell(own.own),
      children: chunk.children().map(([key, child]) => [toHex(key), addressKey(child)]),
    },
  };
}

export function handleCodec(request) {
  switch (request.op) {
    case "codec.encodeFlat":
    case "codec.encodeLinked":
      return encode(request);
    case "codec.decodeFlat":
    case "codec.readHeader":
      return flat(request);
    case "codec.resolve":
    case "codec.checkClosure":
    case "codec.flatten":
      return linked(request);
    case "codec.navigate":
      return navigate(request);
  }
  return unsupported();
}
