// Judge deixis-codec-v2 results against the codec-v2-*.json corpus (tools/conformance/README.md,
// "Codec protocol"). Loaded only by the harness, never by an implementation CLI, and only when
// the run asks for the codec (--codec): until the CLIs serve codec.*, the default run indexes
// these files and replays none of them.
//
// Nothing here parses the codec. Every expectation is a vector file's own, or follows from one
// by a rule the README states without reading the grammar: a split of an artifact reaches the
// whole-buffer verdict (§14), and a proper prefix of an accepted artifact, or the whole of one,
// with the stream open, is need_more_input (§14). A derivation that needed to know where a
// varint ends would be a decoder in the harness, and is not made.

export const CODEC_V2_FILES = [
  "codec-v2-flat.json", "codec-v2-linked.json", "codec-v2-invalid.json", "codec-v2-precedence.json",
];

// The base ids the harness decoder holds unless a case states `holding` (the vector files say the same).
const FIXTURE = "01fb44faaf3a9db590cbc4cb1abfdadb0201";
const HOLD = ["0001", FIXTURE];
// Wall-clock bound on the envelope drive: what makes "before materialization" observable.
export const ENVELOPE_TIMEOUT_MS = 10000;

const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (x, k) => object(x) && Object.keys(x).length === 1 && Object.hasOwn(x, k);
const show = (x) => JSON.stringify(x);

// --- values, judged under the slot codec the id names ------------------------------------
function sameOwn(id, a, b) {
  if (id.startsWith("02")) {
    if (only(b, "none")) return only(a, "none") && object(a.none) && Object.keys(a.none).length === 0;
    return only(b, "some") && only(a, "some") && sameOwn(id.slice(2), a.some, b.some);
  }
  if (id === "0001") return typeof a === "string" && a === b;
  if (id === FIXTURE) return object(a) && typeof a.class === "string" && a.class === b.class;
  throw new Error(`no carrier for slot codec ${id}`);
}
function sameValue(id, a, b) {
  if (!object(a) || !Object.hasOwn(a, "own") || !Array.isArray(a.children)) return false;
  if (!sameOwn(id, a.own, b.own) || a.children.length !== b.children.length) return false;
  const got = new Map();
  for (const row of a.children) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" || got.has(row[0])) return false;
    got.set(row[0], row[1]);
  }
  return b.children.every(([k, v]) => got.has(k) && sameValue(id, got.get(k), v));
}

// --- responses ------------------------------------------------------------------------------
const wantValue = (id, value) => (r) => {
  if (!Object.hasOwn(r, "value") || Object.hasOwn(r, "verdict") || Object.hasOwn(r, "store")) return `got ${show(r)}, want a value`;
  return sameValue(id, r.value, value) ? null : `got ${show(r.value)}, want ${show(value)}`;
};
const classOf = (code) => ({ unsupported_slot_codec: "unsupported", need_more_input: "incomplete", limit_exceeded: "resource-refused" })[code] ?? "invalid";
const wantVerdict = (code, extra = () => null) => (r) => {
  if (!object(r.verdict) || Object.hasOwn(r, "value") || Object.hasOwn(r, "store")) return `got ${show(r)}, want verdict ${code}`;
  if (r.verdict.code !== code || r.verdict.class !== classOf(code)) return `got ${show(r.verdict)}, want ${classOf(code)}/${code}`;
  return extra(r.verdict);
};
const wantStore = (code) => (r) =>
  object(r.store) && r.store.code === code && !Object.hasOwn(r, "verdict") && !Object.hasOwn(r, "value")
    ? null : `got ${show(r)}, want store ${code} (never a decoder verdict, §9)`;
const wantExpected = (c) => (c.class === "store" ? wantStore(c.code) : wantVerdict(c.code));

// Every single interior cut, and byte-at-a-time: each must reach the whole-buffer verdict (§14).
function splits(hex) {
  const n = hex.length / 2, out = [];
  for (let i = 1; i < n; i++) out.push([i]);
  if (n > 2) out.push(Array.from({ length: n - 1 }, (_, i) => i + 1));
  return out;
}

// A navigate answer (§14's resolve-root, then resolve-child per key): the reached chunk as
// its own value and its entries, `absent` at a path index, a verdict, or a store fault. The
// entries carry each child's digest, so a wrong link-index mapping shows at the last hop.
const NAVIGATE_ANSWERS = ["node", "absent", "verdict", "store"];
const answersOnly = (r, k) => Object.hasOwn(r, k) && NAVIGATE_ANSWERS.every((x) => x === k || !Object.hasOwn(r, x));
const wantNavigate = (id, e) => (r) => {
  if (Object.hasOwn(e, "node")) {
    if (!answersOnly(r, "node") || !object(r.node) || !Array.isArray(r.node.children)) return `got ${show(r)}, want a node`;
    if (!sameOwn(id, r.node.own, e.node.own)) return `own ${show(r.node.own)}, want ${show(e.node.own)}`;
    return show(r.node.children) === show(e.node.children) ? null : `children ${show(r.node.children)}, want ${show(e.node.children)}`;
  }
  if (Object.hasOwn(e, "absent")) return answersOnly(r, "absent") && r.absent === e.absent ? null : `got ${show(r)}, want absent at ${e.absent}`;
  if (e.class === "store") {
    return wantStore(e.code)(r) ?? (r.store.digest === e.digest ? null : `store fault on ${show(r.store.digest)}, want ${e.digest}`);
  }
  return wantVerdict(e.code)(r);
};

export function codecRequests(vectors, send, sendEnvelope, { navigate = false } = {}) {
  const flat = vectors("codec-v2-flat.json");
  const linked = vectors("codec-v2-linked.json");
  const invalid = vectors("codec-v2-invalid.json");
  const precedence = vectors("codec-v2-precedence.json");
  const chunkBytes = new Map([...linked.chunks, ...invalid.chunks].map((c) => [c.name, c.bytes]));
  const chunkBy = new Map(linked.chunks.map((c) => [c.name, c]));
  // Published digests are looked up, never computed: speccheck recomputes each from its preimage.
  const digests = new Map([...linked.chunks, ...invalid.chunks].map((c) => [c.name, c.sha256]));
  const flatBy = new Map(flat.cases.map((c) => [c.name, c]));
  const store = (pairs) => pairs.map(([digest, name]) => {
    if (!chunkBytes.has(name)) throw new Error(`codec corpus: store names unknown chunk ${name}`);
    return [digest, chunkBytes.get(name)];
  });
  const flatDecode = (fields, name, verify, stream = true) => {
    send("codec.decodeFlat", fields, name, verify);
    if (!stream) return;
    for (const cuts of splits(fields.bytes)) {
      send("codec.decodeFlat", { ...fields, cuts, end: true }, `${name} (split ${cuts.length > 1 ? "every octet" : cuts[0]})`, verify);
    }
  };

  // flat accept: encode, decode, header, and the open-stream prefixes
  for (const c of flat.cases) {
    const id = flat.bundles[c.bundle].id;
    send("codec.encodeFlat", { slot_codec: id, node: c.node }, c.name, (r) =>
      r.bytes === c.bytes ? null : `got ${show(r)}, want bytes ${c.bytes}`);
    flatDecode({ bytes: c.bytes, holding: HOLD }, c.name, wantValue(id, c.node));
    send("codec.readHeader", { bytes: c.bytes, holding: HOLD }, c.name, (r) =>
      object(r.header) && r.header.slot_codec === id ? null : `got ${show(r)}, want header ${id}`);
    const n = c.bytes.length / 2;
    for (let i = 0; i <= n; i++) {
      send("codec.decodeFlat", { bytes: c.bytes.slice(0, 2 * i), holding: HOLD, cuts: [], end: false },
        `${c.name} (prefix ${i} of ${n}, open)`, wantVerdict("need_more_input"));
    }
  }

  // flat non-acceptance and precedence; the header validator on header-locus cases
  const flatFaults = [...invalid.cases, ...precedence.precedence_cases.filter((c) => Object.hasOwn(c, "bytes"))];
  for (const c of flatFaults) {
    flatDecode({ bytes: c.bytes, holding: c.holding }, c.name, wantExpected(c));
    if (c.streaming_code) {
      send("codec.decodeFlat", { bytes: c.bytes, holding: c.holding, cuts: [], end: false },
        `${c.name} (open)`, wantVerdict(c.streaming_code));
    }
    if (c.fault_locus === "header") {
      send("codec.readHeader", { bytes: c.bytes, holding: c.holding }, c.name, wantVerdict(c.code));
    }
  }

  // stream cases: the vector file's own cuts and end
  for (const c of invalid.stream_cases) {
    const ref = flatBy.get(c.ref) ?? invalid.cases.find((x) => x.name === c.ref);
    if (!ref || !ref.bytes.startsWith(c.bytes)) throw new Error(`codec corpus: ${c.name} is not a prefix of ${c.ref}`);
    const fields = { bytes: c.bytes, holding: c.holding, cuts: c.cuts, end: c.end };
    send("codec.decodeFlat", fields, c.name, c.accept ? wantValue(flat.bundles[ref.bundle].id, ref.node) : wantVerdict(c.code));
  }

  // linked accept and bridges: encode to the closure, resolve, check, flatten
  const address = (name) => ({ space: "dxl2", digest: chunkBy.get(name).sha256 });
  const pairsOf = (names) => names.map((n) => [chunkBy.get(n).sha256, chunkBy.get(n).bytes]);
  const idL = linked.bundle.id;
  for (const c of linked.cases) {
    if (c.kind === "accept") {
      const want = new Set(c.closure.map((n) => chunkBy.get(n).bytes));
      const root = chunkBy.get(c.chunk);
      send("codec.encodeLinked", { slot_codec: idL, node: root.value }, c.name, (r) => {
        if (!object(r.root) || r.root.space !== "dxl2" || r.root.digest !== root.sha256) return `root ${show(r.root)}, want ${root.sha256}`;
        if (!Array.isArray(r.chunks)) return `got ${show(r)}, want chunks`;
        const got = new Set(r.chunks.map(([, hex]) => hex));
        if (got.size !== r.chunks.length) return "a repeated chunk in the answer";
        return got.size === want.size && [...want].every((h) => got.has(h)) ? null : `chunk set differs: got ${got.size}, want ${want.size}`;
      });
      send("codec.resolve", { root: address(c.chunk), chunks: pairsOf(c.closure), holding: HOLD, budget: {} }, c.name, wantValue(idL, root.value));
      send("codec.checkClosure", { root: address(c.chunk), chunks: pairsOf(c.closure) }, c.name, (r) => r.ok === true ? null : `got ${show(r)}, want ok`);
    } else if (c.kind === "bridge") {
      // The store is every published chunk: a superset of the closure, which a resolver
      // reads only as far as the root reaches.
      const f = flatBy.get(c.ref);
      if (!sameValue(idL, chunkBy.get(c.chunk).value, f.node)) throw new Error(`codec corpus: bridge ${c.name} joins two different values`);
      send("codec.flatten", { root: c.address, chunks: pairsOf(linked.chunks.map((x) => x.name)), holding: HOLD, budget: {} }, c.name, (r) =>
        r.bytes === f.bytes ? null : `got ${show(r)}, want the flat octets of ${c.ref}`);
    }
  }

  // linked non-acceptance and linked precedence: resolve; closure-checker on link-locus framing faults
  const linkedFaults = [...invalid.linked_cases, ...precedence.precedence_cases.filter((c) => Object.hasOwn(c, "root"))];
  for (const c of linkedFaults) {
    const chunks = store(c.store);
    send("codec.resolve", { root: c.root, chunks, holding: c.holding, budget: {} }, c.name, wantExpected(c));
    if (c.fault_locus === "links" && c.code !== "unsupported_slot_codec") {
      send("codec.checkClosure", { root: c.root, chunks }, c.name, wantVerdict(c.code));
    }
  }

  // navigate (§14): resolve-root once, resolve-child per key, nothing materialized, so no
  // budget. Sent only under --navigate until every CLI serves the op. A `bounded` case walks
  // into the sharing bomb and goes to the timed drive: a navigator that materializes never answers.
  if (navigate) {
    for (const c of linked.navigate_cases) {
      const chunks = c.store ? store(c.store) : c.store_chunks.map((n) => {
        if (!digests.has(n)) throw new Error(`codec corpus: ${c.name} names unknown chunk ${n}`);
        return [digests.get(n), chunkBytes.get(n)];
      });
      (c.bounded ? sendEnvelope : send)("codec.navigate", { root: c.root, chunks, holding: c.holding, path: c.path },
        c.name, wantNavigate(c.slot_codec ?? idL, c.expect));
    }
  }

  // envelope: a caller budget, in its own timed drive
  for (const c of invalid.envelope_cases) {
    // A case may file its own store (an untrusted one, as in the linked cases); otherwise
    // every named chunk is filed under its published digest.
    const chunks = c.store ? store(c.store) : c.store_chunks.map((n) => {
      if (!digests.has(n)) throw new Error(`codec corpus: ${c.name} names unknown chunk ${n}`);
      return [digests.get(n), chunkBytes.get(n)];
    });
    const fields = { root: c.root, chunks, holding: c.holding, budget: c.budget };
    const e = c.expect;
    let verify;
    if (e.accept && c.op === "flatten") {
      const f = flatBy.get(e.bytes_of);
      if (!f) throw new Error(`codec corpus: ${c.name} names unknown flat case ${e.bytes_of}`);
      verify = (r) => (r.bytes === f.bytes ? null : `got ${show(r)}, want the flat octets of ${e.bytes_of}`);
    } else if (e.accept) {
      verify = wantValue(idL, e.value);
    } else {
      verify = wantVerdict(e.code, (v) => {
        if (e.code !== "limit_exceeded") return null;       // a dimension belongs to limit_exceeded only
        const ok = e.dimension ? v.dimension === e.dimension : e.dimension_one_of.includes(v.dimension);
        return ok ? null : `dimension ${show(v.dimension)}, want ${show(e.dimension ?? e.dimension_one_of)}`;
      });
    }
    sendEnvelope(c.op === "flatten" ? "codec.flatten" : "codec.resolve", fields, c.name, verify);
  }
}
