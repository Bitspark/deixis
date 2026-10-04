#!/usr/bin/env node
// Cross-language interchange for deixis-codec-v2 — AGREEMENT, NOT CONFORMANCE.
//
// Four implementations written by one lane can agree on a shared misreading of the
// contract; catching that is the independent corpus's job (harness.mjs), not this file's.
// So nothing here counts toward conformance, its totals are kept out of the harness's,
// and it asserts no expected bytes of its own: every check below is either "all four
// produce the same octets" or a law that needs no octets written down.
//
//   1. agreement   every implementation encodes each generated value to the same octets
//   2. law 1 (=>)  values that are ≈ but spelled differently encode identically
//   3. law 1 (<=)  values that are not ≈ encode differently
//   4. exchange    every implementation decodes every implementation's octets back to the
//                  original, compared under ≈, never by spelling
//   5. linked      every implementation produces the same root address and chunk set
//   6. malformed   (--fuzz) every implementation gives each mutant of those octets the same
//                  answer (law 3), and each reads a split mutant as it reads the whole (§14)
//
// Values come from a seeded generator; the seed is printed on every run and on any
// failure, and `--seed=N` replays it. Dependency-free Node, like the harness.
//
// Usage: node tools/conformance/interop.mjs [--seed=N] [--count=N] [--only=rs,go,ts,py] [--fuzz=K]
//   --fuzz=K adds round C: K mutants per value, judged by every core (law 3, see round C).

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const ROOT = new URL("../../", import.meta.url);
const exe = process.platform === "win32" ? ".exe" : "";
const IMPLEMENTATIONS = [
  { name: "rs", command: `target/debug/deixis-conformance${exe}`, args: [] },
  { name: "go", command: "go", args: ["run", "./conformance/go"] },
  { name: "ts", command: "node", args: ["conformance/ts/main.mjs"] },
  { name: "py", command: "python", args: ["conformance/py/main.py"] },
];

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg("seed") ?? Math.floor(Math.random() * 2 ** 31));
const count = Number(arg("count") ?? 60);
const only = arg("only")?.split(",");
const fuzzN = Number(arg("fuzz") ?? 0);
const selected = IMPLEMENTATIONS.filter((i) => !only || only.includes(i.name));

// --- the codecs under test (ids from CODEC.md §13 and vectors/README.md) ---------------

const BYTES = "0001"; // deixis/identity-bytes
const FIXTURE = "01fb44faaf3a9db590cbc4cb1abfdadb0201"; // the fixture setoid, private
const OPTION = "02" + BYTES; // option-of(identity-bytes)
const HOLDING = [BYTES, FIXTURE];

// --- a seeded generator ------------------------------------------------------------------

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);
const int = (n) => Math.floor(rng() * n);
const pick = (xs) => xs[int(xs.length)];

// Lengths that cross cuvarint width boundaries turn up on purpose.
const LENGTHS = [0, 1, 2, 7, 126, 127, 128, 129, 255, 300];
function hexOf(length) {
  let s = "";
  for (let i = 0; i < length; i++) s += int(256).toString(16).padStart(2, "0");
  return s;
}
function key() {
  return pick([
    () => "", // the empty key
    () => "00",
    () => "ff",
    () => "61",
    () => "6162", // "a" and "ab": the shorter-is-smaller edge
    () => hexOf(1 + int(3)),
    () => hexOf(pick([127, 128])), // key length at the width boundary
  ])();
}
const CLASSES = ["", "a", "b", "é", "ab"];
function payload(kind) {
  if (kind === BYTES) return hexOf(pick(LENGTHS));
  if (kind === OPTION) return int(3) === 0 ? { none: {} } : { some: hexOf(pick(LENGTHS)) };
  return { class: pick(CLASSES), representation: hexOf(int(4)) };
}
function tree(kind, depth) {
  const width = depth > 3 ? 0 : pick([0, 0, 1, 2, 3, 5]);
  const keys = new Set();
  const children = [];
  for (let i = 0; i < width; i++) {
    const k = key();
    if (keys.has(k)) continue;
    keys.add(k);
    children.push([k, tree(kind, depth + 1)]);
  }
  // Insertion order is shuffled: construction owns the canonical order.
  for (let i = children.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [children[i], children[j]] = [children[j], children[i]];
  }
  return { own: payload(kind), children };
}

// A copy with every fixture `representation` changed: ≈ to the original, spelled apart.
function respell(node) {
  const own =
    node.own && typeof node.own === "object" && "class" in node.own
      ? { class: node.own.class, representation: node.own.representation + "7e" }
      : node.own;
  return { own, children: node.children.map(([k, c]) => [k, respell(c)]) };
}
// A copy that is NOT ≈: one class changed at one node, found by a seeded walk.
function perturb(node) {
  const nodes = [];
  (function walk(n) {
    nodes.push(n);
    n.children.forEach(([, c]) => walk(c));
  })(node);
  const target = pick(nodes);
  function copy(n) {
    const own =
      n === target ? { class: n.own.class + "x", representation: n.own.representation } : n.own;
    return { own, children: n.children.map(([k, c]) => [k, copy(c)]) };
  }
  return copy(node);
}

// --- equality under ≈ ---------------------------------------------------------------------

function samePayload(kind, a, b) {
  if (kind === FIXTURE) return a.class === b.class;
  if (kind === OPTION) {
    if ("none" in a || "none" in b) return "none" in a && "none" in b;
    return a.some === b.some;
  }
  return a === b;
}
function equivalent(kind, a, b) {
  if (!samePayload(kind, a.own, b.own)) return false;
  const ma = new Map(a.children);
  const mb = new Map(b.children);
  if (ma.size !== mb.size) return false;
  for (const [k, c] of ma) if (!mb.has(k) || !equivalent(kind, c, mb.get(k))) return false;
  return true;
}

// --- drive ---------------------------------------------------------------------------------

function drive(implementation, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(implementation.command, implementation.args, {
      cwd: new URL(".", ROOT),
      stdio: ["pipe", "pipe", "inherit"],
    });
    child.on("error", (e) => reject(new Error(`${implementation.name}: ${e.message}`)));
    const responses = new Map();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (line.trim()) {
        const r = JSON.parse(line);
        responses.set(r.id, r);
      }
    });
    child.on("close", (code) =>
      code === 0 ? resolve(responses) : reject(new Error(`${implementation.name}: exited ${code}`)),
    );
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    child.stdin.end();
  });
}

// --- main -----------------------------------------------------------------------------------

const failures = [];
const fail = (message) => failures.push(message);

const kinds = [BYTES, OPTION, FIXTURE];
const values = [];
for (let i = 0; i < count; i++) {
  const kind = kinds[i % kinds.length];
  values.push({ kind, node: tree(kind, 0) });
}
const fixtures = values.filter((v) => v.kind === FIXTURE);
const pairs = fixtures.flatMap((v) => [
  { kind: FIXTURE, a: v.node, b: respell(v.node), same: true },
  { kind: FIXTURE, a: v.node, b: perturb(v.node), same: false },
]);

// Round A: every implementation encodes everything, flat and linked.
const encodeRequests = [];
values.forEach((v, i) => {
  encodeRequests.push({ id: `f${i}`, op: "codec.encodeFlat", slot_codec: v.kind, node: v.node });
  encodeRequests.push({ id: `l${i}`, op: "codec.encodeLinked", slot_codec: v.kind, node: v.node });
});
pairs.forEach((p, i) => {
  encodeRequests.push({ id: `pa${i}`, op: "codec.encodeFlat", slot_codec: p.kind, node: p.a });
  encodeRequests.push({ id: `pb${i}`, op: "codec.encodeFlat", slot_codec: p.kind, node: p.b });
});

const encoded = new Map(); // name -> responses
for (const implementation of selected) {
  encoded.set(implementation.name, await drive(implementation, encodeRequests));
}
const names = [...encoded.keys()];
const bytesOf = (name, id) => encoded.get(name).get(id)?.bytes;

// 1. agreement
values.forEach((v, i) => {
  const outs = names.map((n) => bytesOf(n, `f${i}`));
  if (outs.some((o) => typeof o !== "string")) {
    fail(`value ${i}: not every implementation encoded it (${names.map((n, j) => `${n}=${JSON.stringify(encoded.get(n).get(`f${i}`))}`).join(", ")})`);
  } else if (new Set(outs).size !== 1) {
    fail(`value ${i}: flat octets differ across implementations: ${names.map((n, j) => `${n}=${outs[j]}`).join(" ")}`);
  }
  const roots = names.map((n) => encoded.get(n).get(`l${i}`)?.root?.digest);
  const sets = names.map((n) =>
    JSON.stringify((encoded.get(n).get(`l${i}`)?.chunks ?? []).map(([d]) => d).sort()),
  );
  if (new Set(roots).size !== 1 || new Set(sets).size !== 1) {
    fail(`value ${i}: linked root or chunk set differs across implementations`);
  }
});

// 2 and 3. law 1, both directions, per implementation
pairs.forEach((p, i) => {
  for (const n of names) {
    const a = bytesOf(n, `pa${i}`);
    const b = bytesOf(n, `pb${i}`);
    if (p.same && a !== b) fail(`pair ${i} (${n}): ≈ values encoded to different octets`);
    if (!p.same && a === b) fail(`pair ${i} (${n}): values that are not ≈ encoded to the same octets`);
  }
});

// Round B: every implementation decodes every implementation's octets.
for (const decoder of selected) {
  const requests = [];
  values.forEach((v, i) => {
    for (const producer of names) {
      const bytes = bytesOf(producer, `f${i}`);
      if (typeof bytes === "string") {
        requests.push({ id: `d${i}-${producer}`, op: "codec.decodeFlat", bytes, holding: HOLDING });
      }
    }
  });
  const responses = await drive(decoder, requests);
  values.forEach((v, i) => {
    for (const producer of names) {
      const r = responses.get(`d${i}-${producer}`);
      if (!r) continue;
      if (!r.value) {
        fail(`value ${i}: ${decoder.name} refused ${producer}'s octets: ${JSON.stringify(r.verdict ?? r)}`);
      } else if (!equivalent(v.kind, v.node, r.value)) {
        fail(`value ${i}: ${decoder.name} decoded ${producer}'s octets to a value that is not ≈ the original`);
      }
    }
  });
}

// Round C (--fuzz=K): every implementation judges the same MALFORMED octets.
//
// Law 3 (CODEC.md §8): every input that is not accepted gets a verdict in exactly one class
// and, for one artifact within §12's floors, THE SAME CODE in every conforming
// implementation. The corpus pins that for the cases it names; mutating canonical octets
// reaches cases nobody named. Each flat mutant goes to every core codec-holding, codec-blind
// and to the header validator, and a disagreement there fails. Two things are kept apart:
//   - a disagreement in which some core refuses on resource. Above a floor a reader MAY
//     refuse on resource (§12), and law 3 promises nothing there.
//   - a disagreement over a CLOSURE. A mutated linked root goes to resolve and checkClosure
//     under its own digest, but law 3 speaks of one artifact, never a closure, and law 4
//     lets a closure-checker report any fault it finds.
// And one check needs no second core: §14 requires a streaming decoder fed any split of the
// octets to reach the whole buffer's verdict, so each core's answer to the mutant cut once
// at random, and fed one octet at a time, must equal its own whole-buffer answer (for the
// decoder and for the header validator). Still agreement, not conformance: four cores
// sharing a misreading agree here too.
const fuzzAnswers = { mutants: 0, requests: 0, agreed: 0, beyondFloor: 0, closure: 0, reached: new Map() };
if (fuzzN > 0) {
  const mutants = [];
  const mutate = (hex) => {
    const b = [...Buffer.from(hex, "hex")];
    const pos = (extra = 0) => int(b.length + extra);
    const op = pick(b.length ? ["flip", "truncate", "insert", "delete", "append", "boundary"] : ["append"]);
    if (op === "flip") b[pos()] ^= 1 + int(255);
    else if (op === "truncate") b.length = int(b.length);
    else if (op === "insert") b.splice(pos(1), 0, int(256));
    else if (op === "delete") b.splice(pos(), 1);
    else if (op === "append") b.push(int(256));
    else {
      const i = pos();
      const v = pick([0x00, 0x01, 0x7f, 0x80, 0xff].filter((x) => x !== b[i]));
      b[i] = v;
    }
    return { op, hex: Buffer.from(b).toString("hex") };
  };
  const canonical = names[0];
  values.forEach((v, i) => {
    const flat = bytesOf(canonical, `f${i}`);
    const linked = encoded.get(canonical).get(`l${i}`);
    for (let k = 0; k < fuzzN; k++) {
      if (typeof flat === "string") {
        const m = mutate(flat);
        if (m.hex !== flat) mutants.push({ kind: "flat", value: i, ...m });
      }
      if (linked?.chunks?.length) {
        const rootHex = new Map(linked.chunks).get(linked.root.digest);
        const m = mutate(rootHex);
        if (m.hex !== rootHex) {
          const digest = createHash("sha256").update(Buffer.from(m.hex, "hex")).digest("hex");
          const chunks = linked.chunks.filter(([d]) => d !== linked.root.digest).concat([[digest, m.hex]]);
          mutants.push({ kind: "root", value: i, ...m, root: { space: "dxl2", digest }, chunks });
        }
      }
    }
  });
  const requests = [];
  const wholeOf = new Map(); // a split request's id -> the id of the same read, whole-buffer
  mutants.forEach((m, j) => {
    if (m.kind === "flat") {
      requests.push({ id: `z${j}h`, op: "codec.decodeFlat", bytes: m.hex, holding: HOLDING });
      requests.push({ id: `z${j}b`, op: "codec.decodeFlat", bytes: m.hex, holding: [] });
      requests.push({ id: `z${j}v`, op: "codec.readHeader", bytes: m.hex, holding: HOLDING });
      if (m.hex.length >= 4) {
        // Two splits: one random cut, and every octet on its own, which puts a fragment
        // boundary inside every field there is.
        const octets = m.hex.length / 2;
        const everyOctet = Array.from({ length: octets - 1 }, (_, i) => i + 1);
        const split = (id, whole, op, cuts) => {
          requests.push({ id, op, bytes: m.hex, holding: HOLDING, cuts, end: true });
          wholeOf.set(id, whole);
        };
        split(`z${j}s`, `z${j}h`, "codec.decodeFlat", [1 + int(octets - 1)]);
        split(`z${j}o`, `z${j}h`, "codec.decodeFlat", everyOctet);
        split(`z${j}w`, `z${j}v`, "codec.readHeader", everyOctet);
      }
    } else {
      requests.push({ id: `z${j}r`, op: "codec.resolve", root: m.root, chunks: m.chunks, holding: HOLDING, budget: {} });
      requests.push({ id: `z${j}c`, op: "codec.checkClosure", root: m.root, chunks: m.chunks });
    }
  });
  const answers = new Map();
  for (const implementation of selected) answers.set(implementation.name, await drive(implementation, requests));

  // A value is compared under ≈ without knowing its codec: a fixture payload keeps only its
  // class, and children are ordered by key, so two spellings of one value normalize alike.
  const norm = (n) =>
    n && typeof n === "object" && "children" in n
      ? {
          own: n.own && typeof n.own === "object" && "class" in n.own ? { class: n.own.class } : n.own,
          children: [...n.children].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, c]) => [k, norm(c)]),
        }
      : n;
  // A verdict keeps its dimension: two refusals on different dimensions are not one answer.
  const verdictOf = (v) => `${v.class}/${v.code}${v.dimension !== undefined ? `(${v.dimension})` : ""}`;
  const shape = (r) =>
    !r ? "no answer"
    : r.value !== undefined ? `value ${JSON.stringify(norm(r.value))}`
    : r.verdict ? verdictOf(r.verdict)
    : r.store ? `store/${r.store.code}/${r.store.digest}`
    : r.header ? `header ${r.header.slot_codec}`
    : r.ok ? "ok"
    : r.bytes ? `bytes ${r.bytes}`
    : `other ${JSON.stringify(r)}`;
  // What the agreed answers were, by kind: without it "all agree" cannot be told from a
  // round in which every mutant drew the same refusal.
  const reachedAs = (req, r) =>
    `${req.op.slice("codec.".length)} ${
      !r ? "no answer"
      : r.value !== undefined ? "accepted"
      : r.verdict ? verdictOf(r.verdict)
      : r.store ? `store/${r.store.code}`
      : r.header ? "header read"
      : r.ok ? "closure present"
      : "other"
    }`;
  const where = (req) => {
    const m = mutants[Number(req.id.slice(1, -1))];
    const cuts = !req.cuts ? "" : req.cuts.length > 1 ? " octet by octet" : ` split at ${req.cuts[0]}`;
    return `${m.kind} mutant of value ${m.value} (${m.op}) ${req.op}${cuts}${
      req.holding && !req.holding.length ? " codec-blind" : ""
    }: ${m.hex.length > 120 ? m.hex.slice(0, 120) + "…" : m.hex}`;
  };
  fuzzAnswers.mutants = mutants.length;
  fuzzAnswers.requests = requests.length;
  for (const req of requests) {
    const outs = names.map((n) => shape(answers.get(n).get(req.id)));
    if (req.cuts) {
      // §14, per core: the split must reach the whole buffer's verdict.
      names.forEach((n, j) => {
        const whole = shape(answers.get(n).get(wholeOf.get(req.id)));
        if (outs[j] !== whole) fail(`§14 ${n}: ${where(req)}\n      split=${outs[j]} | whole=${whole}`);
      });
    }
    if (new Set(outs).size === 1) {
      fuzzAnswers.agreed++;
      const kind = reachedAs(req, answers.get(names[0]).get(req.id));
      fuzzAnswers.reached.set(kind, (fuzzAnswers.reached.get(kind) ?? 0) + 1);
      continue;
    }
    const detail = names.map((n, j) => `${n}=${outs[j]}`).join(" | ");
    if (req.op === "codec.resolve" || req.op === "codec.checkClosure") {
      fuzzAnswers.closure++;
      console.error(`  ~ a closure, outside law 3: ${where(req)}\n      ${detail}`);
    } else if (outs.some((o) => /\/limit_exceeded\b/.test(o))) {
      fuzzAnswers.beyondFloor++;
      console.error(`  ~ beyond a floor: ${where(req)}\n      ${detail}`);
    } else {
      fail(`law 3: ${where(req)}\n      ${detail}`);
    }
  }
}

// --- report -----------------------------------------------------------------------------------

const label = "interop: AGREEMENT, NOT CONFORMANCE";
console.log(
  `${label} — seed ${seed}; ${values.length} values (${kinds.length} slot codecs), ` +
    `${pairs.length} law-1 pairs, ${names.length} implementations (${names.join(", ")})`,
);
if (fuzzN > 0) {
  console.log(
    `${label} — fuzz: ${fuzzAnswers.mutants} mutants, ${fuzzAnswers.requests} requests per core, ` +
      `${fuzzAnswers.agreed} identical answers; set apart: ${fuzzAnswers.beyondFloor} over a floor, ` +
      `${fuzzAnswers.closure} over a closure`,
  );
  const reached = [...fuzzAnswers.reached].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  console.log(`${label} — fuzz reached ${reached.length} kinds of answer:`);
  for (const [kind, n] of reached) console.log(`    ${String(n).padStart(6)}  ${kind}`);
}
if (failures.length) {
  for (const f of failures.slice(0, 30)) console.error(`  ✖ ${f}`);
  if (failures.length > 30) console.error(`  … ${failures.length - 30} more`);
  console.error(`${label}: ${failures.length} disagreement(s). Replay with --seed=${seed}`);
  process.exit(1);
}
console.log(`${label}: all agree (replay with --seed=${seed})`);
