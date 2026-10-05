#!/usr/bin/env node
// Black-box conformance harness — tools/conformance/README.md.
//
// Owns the vector files and the expected judgments; drives each implementation's thin
// CLI over NDJSON, sending every case minus its expectation and comparing the returned
// judgments. Dependency-free Node. Exit 0 iff every implementation answers every
// request with the expected judgment.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { MANDATORY_FILES, mandatoryRequests } from "./mandatory.mjs";
import { BINDING_FILES, bindingRequests } from "./binding.mjs";
import { PROJECTION_FILES, projectionRequests } from "./projection.mjs";
import { ENVELOPE_TIMEOUT_MS, codecRequests } from "./codec.mjs";

const ROOT = new URL("../../", import.meta.url);
const vectors = (name) =>
  JSON.parse(readFileSync(new URL(`vectors/${name}`, ROOT), "utf8"));

const exe = process.platform === "win32" ? ".exe" : "";
// Go runs as a binary built once per run, as rs does. `go run` compiles and links on every
// launch, and the envelope cases run in a launch of their own bounded at
// ENVELOPE_TIMEOUT_MS, so the bound measured the toolchain as well as the codec: on a
// loaded host `go run` alone took 14 to 16 s, and all 13 timed cases failed for a reason
// that was never the codec's. Building first leaves the bound to time the codec.
const GO_BIN = `target/conformance-go/deixis-conformance-go${exe}`;
const IMPLEMENTATIONS = [
  { name: "rs", command: `target/debug/deixis-conformance${exe}`, args: [] },
  { name: "go", command: GO_BIN, args: [], build: ["go", ["build", "-o", GO_BIN, "./conformance/go"]] },
  { name: "ts", command: "node", args: ["conformance/ts/main.mjs"] },
  { name: "py", command: "python", args: ["conformance/py/main.py"] },
];

// --- the corpus: one namespace, resolved before anything is sent ----------------------
//
// The codec vectors carry bridge assertions BY REFERENCE (vectors/CODEC-PLAN.md, ruling
// 1): a linked case names a flat case rather than repeating its octets, because two
// copies of one byte string drift silently. That ruling is only real if a broken
// reference cannot reach a green run — so names are resolved HERE, before a single
// request is written to a child, and a dangling or duplicated name is a loud failure of
// the whole run rather than a skipped case.
//
// Consequences, stated because they bind the vector files and not just this file:
//   - a case `name` is an IDENTIFIER, unique across every vector file;
//   - renaming a referenced case is a breaking act, not an edit.

// Every file the corpus INDEX covers. The replayed files come first. The cores
// implement required T (ADR 0010). required-node.json exercises it directly;
// node-*.json exercises the explicit Node<Option<T>> specialization. The
// two previous-model files that a node-*.json law re-reads BY REFERENCE — identity.json
// (node-embedding.json) and set.json (node-set.json) — are replayed through the
// embedding E, on requests that say `embedded`, under that law's pinned counts.
//
// Indexed but NOT replayed, and said on every run:
//   - the v1 codec files, the withdrawn candidate's evidence (ADR 0011 s5): deixis-codec-v1
//     never had implementations, by construction (0006 fixes the order: spec ->
//     hand-authored vectors -> only then implementations);
//   - the v2 codec files, until the CLIs serve the codec.* operations. Their names and
//     refs are resolved now, so a v2 name that collides with v1's, or a bridge whose ref
//     has rotted, fails today and not on the day judging starts;
//   - invalid.json, the previous model's construction refusals: no node-*.json law
//     re-reads it, and replaying it through E anyway would check an expectation no
//     fixture states. node-invalid.json pins duplicate-key refusals in that specialization.
// Indexing them anyway is what checks the two properties that do not need an
// implementation: names are unique corpus-wide, and every `ref` resolves.
//
// Those refs were verified BY HAND at authoring time and by nothing since - and a
// bridge assertion whose ref has rotted still LOOKS like a bridge assertion. This is
// the same staleness class the codec lane and I hit three times in one morning: a
// thing that stopped being true without moving.
const REPLAYED_FILES = [
  ...MANDATORY_FILES,
  "required-node.json",
  "identity.json",
  "positional.json",
  "set.json",
  "node-identity.json",
  "node-navigation.json",
  "node-attach.json",
  "node-parts.json",
  "node-embedding.json",
  "node-invalid.json",
  "node-set.json",
  // ADR 0013's scripted binding laws: each CLI answers them from a scripted harness over
  // its core's native Node, since binding is not a deixis API (binding.mjs).
  ...BINDING_FILES,
  // IDENTITY.md's projection (ID9, ID10): each CLI answers it from a scripted harness over
  // its core's native Node, since projection is not a deixis API either (projection.mjs).
  ...PROJECTION_FILES,
];
const INDEXED_CODEC = [
  "codec-flat.json",
  "codec-invalid.json",
  "codec-linked.json",
  "codec-precedence.json",
];
const CODEC_V2_FILES = [
  "codec-v2-flat.json",
  "codec-v2-linked.json",
  "codec-v2-invalid.json",
  "codec-v2-precedence.json",
];
const INDEXED_PREVIOUS = ["invalid.json"];
// The v2 codec files are replayed on every run (codec.mjs): all four CLIs serve codec.*.
// --no-codec runs the node corpus alone; --codec is still accepted and changes nothing.
const CODEC = !process.argv.includes("--no-codec");
// codec.navigate (§14's resolve-root and resolve-child) is sent on every run: all four CLIs
// serve it. --no-navigate leaves it out; --navigate is still accepted and changes nothing.
const NAVIGATE = CODEC && !process.argv.includes("--no-navigate");
const VECTOR_FILES = [...REPLAYED_FILES, ...INDEXED_CODEC, ...CODEC_V2_FILES, ...INDEXED_PREVIOUS];

/** Index every named case across the corpus; throw on a collision or a dangling ref. */
function loadCorpus() {
  const index = new Map();
  const references = [];

  for (const file of VECTOR_FILES) {
    const document = vectors(file);
    for (const group of Object.values(document)) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
        const previous = index.get(entry.name);
        if (previous) {
          throw new Error(
            `corpus: duplicate case name ${JSON.stringify(entry.name)} in ${file} — ` +
              `already used by ${previous.file}. Names are identifiers: bridge assertions ` +
              `resolve by name, so a collision makes a reference ambiguous.`,
          );
        }
        index.set(entry.name, { file, case: entry });
        if (typeof entry.ref === "string") {
          references.push({ file, from: entry.name, ref: entry.ref });
        }
      }
    }
  }

  for (const { file, from, ref } of references) {
    if (!index.has(ref)) {
      throw new Error(
        `corpus: ${file} case ${JSON.stringify(from)} references ${JSON.stringify(ref)}, ` +
          `which no case defines. A dangling reference is a failure of the run, never a ` +
          `skipped assertion — a bridge that silently vanishes still reads green.`,
      );
    }
  }

  return index;
}

// --- judging N[T] spellings -----------------------------------------------------------
//
// A CLI answers an operation with the spelling of its result; the harness judges it
// here, against the expected spelling, so no expectation ever reaches a CLI. The
// judgment is the structural equality of node-identity.json under the fixture setoid of
// vectors/README.md: `≈` compares `class` only, keys are exact lowercase hex, children
// are a finite map (order ignored, a repeated key is a malformed answer), and a hole
// equals only a hole.

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value, key) =>
  isObject(value) && Object.keys(value).length === 1 && key in value;
const show = (value) => JSON.stringify(value);

function samePayload(a, b) {
  return isObject(a) && isObject(b) && typeof a.class === "string" && a.class === b.class;
}

function sameOwn(a, b) {
  if (only(a, "none")) return only(b, "none");
  if (only(a, "some")) return only(b, "some") && samePayload(a.some, b.some);
  return false;
}

/** A [[hexKey, x], …] list as a Map, or null when it is malformed or repeats a key. */
function entryMap(list) {
  if (!Array.isArray(list)) return null;
  const map = new Map();
  for (const pair of list) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") return null;
    if (map.has(pair[0])) return null;
    map.set(pair[0], pair[1]);
  }
  return map;
}

function sameEntries(a, b, same) {
  const left = entryMap(a);
  const right = entryMap(b);
  if (left === null || right === null || left.size !== right.size) return false;
  for (const [key, child] of left) {
    if (!right.has(key) || !same(child, right.get(key))) return false;
  }
  return true;
}

function sameRequiredNode(a, b) {
  return isObject(a) && isObject(b) && Object.keys(a).length === 2 &&
    samePayload(a.own, b.own) && sameEntries(a.children, b.children, sameRequiredNode);
}

function sameNode(a, b) {
  if (only(a, "hole") || only(b, "hole")) return only(a, "hole") && only(b, "hole");
  return (
    isObject(a) &&
    isObject(b) &&
    Object.keys(a).length === 2 &&
    sameOwn(a.own, b.own) &&
    sameEntries(a.children, b.children, sameNode)
  );
}

const sameParts = (a, b) =>
  only(a, "parts") &&
  only(b, "parts") &&
  sameOwn(a.parts.own, b.parts.own) &&
  sameEntries(a.parts.children, b.parts.children, sameNode);

const sameSplit = (a, b) =>
  isObject(a) && isObject(b) && sameNode(a.context, b.context) && sameNode(a.subtree, b.subtree);

/** A cut's subtrees, [[path, node], …], keyed by the path's JSON spelling. */
function sameSubtrees(a, b) {
  const keyed = (list) =>
    Array.isArray(list) &&
    list.every((pair) => Array.isArray(pair) && pair.length === 2 && Array.isArray(pair[0]))
      ? list.map(([path, node]) => [JSON.stringify(path), node])
      : null;
  return sameEntries(keyed(a), keyed(b), sameNode);
}

const sameCut = (a, b) =>
  isObject(a) &&
  isObject(b) &&
  sameNode(a.skeleton, b.skeleton) &&
  sameSubtrees(a.subtrees, b.subtrees);

/** The previous model's spelling, {leaf} / {struct}, under the same setoid. */
function sameOld(a, b) {
  if (only(a, "leaf")) return only(b, "leaf") && samePayload(a.leaf, b.leaf);
  if (only(a, "struct")) return only(b, "struct") && sameEntries(a.struct, b.struct, sameOld);
  return false;
}

/** Judge a partial operation's answer: {"defined": …} under `same`, or {"undefined": {}}. */
const expectResult = (expected, same) => (response) => {
  if (only(expected, "undefined")) {
    return isObject(response.undefined) && !("defined" in response)
      ? null
      : `got ${show(response)}, want undefined`;
  }
  if (!only(expected, "defined")) throw new Error(`malformed expectation ${show(expected)}`);
  if (!("defined" in response) || "undefined" in response) {
    return `got ${show(response)}, want defined`;
  }
  return same(response.defined, expected.defined)
    ? null
    : `got ${show(response.defined)}, want ${show(expected.defined)} under the fixture setoid`;
};

// --- the by-reference laws: pinned counts, checked before anything is sent ------------
//
// node-embedding.json and node-set.json re-read previous-model files BY REFERENCE: a law
// names a source file and pins the counts it re-reads, and says a replayer MUST refuse
// when the source's counts differ — such a change is an erratum to the source, and the
// law must be re-checked by a person, not silently re-run. The refusal is HERE: a
// mismatch fails the whole run (exit 2) before the first request, exactly like a
// duplicate name or a dangling reference, and never reads as a skipped case.

function refuse(law, what) {
  throw new Error(
    `law: ${law.name} pins ${what}. The source no longer matches, which is an erratum to ` +
      `${law.source}; the law must be re-checked by a person, not silently re-run.`,
  );
}

function pinIdentityLaw(identity) {
  const laws = vectors("node-embedding.json").cases.filter((c) => c.op === "embedded-identity");
  if (laws.length !== 1 || laws[0].source !== "identity.json") {
    throw new Error("law: node-embedding.json states no single embedded-identity law over identity.json");
  }
  const [law] = laws;
  const equal = identity.cases.filter((c) => c.equal === true).length;
  const notEqual = identity.cases.filter((c) => c.equal === false).length;
  const got = { cases: identity.cases.length, equal, notEqual };
  if (
    got.cases !== law.source_cases ||
    got.equal !== law.source_equal ||
    got.notEqual !== law.source_not_equal
  ) {
    refuse(
      law,
      `${law.source_cases} cases, ${law.source_equal} equal and ${law.source_not_equal} not; ` +
        `identity.json has ${got.cases}, ${got.equal} and ${got.notEqual}`,
    );
  }
  return law;
}

function pinSetLaws(set) {
  const laws = vectors("node-set.json").cases.filter((c) => c.kind === "embedded");
  const byKind = new Map();
  for (const law of laws) {
    if (law.source !== "set.json") {
      throw new Error(`law: ${law.name} re-reads ${law.source}, which this harness does not replay`);
    }
    if (byKind.has(law.source_kind)) {
      throw new Error(`law: two laws over set.json's ${law.source_kind} cases`);
    }
    const source = set.cases.filter((c) => c.kind === law.source_kind);
    const count = (predicate) => source.filter(predicate).length;
    const queries = source.flatMap((c) => c.queries ?? []);
    const reasons = {};
    for (const c of source) {
      if (c.kind === "recognize" && c.valid === false) reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
    }
    const checks = [
      ["source_cases", source.length],
      ["source_valid", count((c) => c.valid === true)],
      ["source_refused", count((c) => c.valid === false)],
      ["source_queries", queries.length],
      ["source_in", queries.filter((q) => q.in === true).length],
      ["source_out", queries.filter((q) => q.in === false).length],
      ["source_equal", count((c) => c.equal === true)],
      ["source_not_equal", count((c) => c.equal === false)],
    ];
    for (const [field, got] of checks) {
      if (field in law && law[field] !== got) {
        refuse(law, `${field} = ${law[field]} for set.json's ${law.source_kind} cases; set.json has ${got}`);
      }
    }
    if ("source_reasons" in law && show(sortedObject(law.source_reasons)) !== show(sortedObject(reasons))) {
      refuse(law, `reasons ${show(law.source_reasons)}; set.json has ${show(reasons)}`);
    }
    byKind.set(law.source_kind, law);
  }
  for (const c of set.cases) {
    if (!byKind.has(c.kind)) {
      throw new Error(`law: set.json's ${c.kind} case ${c.name} has no law in node-set.json`);
    }
  }
  return byKind;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// --- vector files → (request, check) pairs --------------------------------------------

/** checks: list of {id, op, name, verify(response) -> string | null (failure reason)} */
function plan() {
  const requests = [];
  const checks = new Map();
  let sequence = 0;

  const send = (op, fields, name, verify) => {
    const id = String(sequence++);
    requests.push({ id, op, ...fields });
    checks.set(id, { op, name, verify });
  };

  const expectField = (field, expected) => (response) =>
    response[field] === expected
      ? null
      : `${field} = ${JSON.stringify(response[field])}, want ${JSON.stringify(expected)}`;

  const expectRefusal = (key) => (response) =>
    response.error === "duplicate_key" && response.key === key
      ? null
      : `got ${JSON.stringify(response)}, want duplicate_key at ${key}`;

  // A refusal pins its reason only on a node with exactly one defect (0005): a case
  // without a reason is judged on the verdict alone, never read as "expect no reason".
  const expectRecognition = (valid, reason) => (response) => {
    if (response.isSet !== valid) return `isSet = ${show(response.isSet)}, want ${valid}`;
    if (!valid && reason !== undefined && response.reason !== reason) {
      return `reason = ${show(response.reason)}, want ${show(reason)}`;
    }
    return null;
  };

  mandatoryRequests(vectors, send);
  bindingRequests(vectors, send);
  projectionRequests(vectors, send);

  // Direct T payloads: these cases have no structural option wrapper.
  for (const c of vectors("required-node.json").cases) {
    const { name, op, expected, equal, ...fields } = c;
    const verify = op === "equal" ? expectField("equal", equal)
      : expectResult(expected, op === "valueAt" ? samePayload : sameRequiredNode);
    send("required." + op, fields, name, verify);
  }

  // identity.json, through E: node-embedding.json's embedded-identity law.
  const identity = vectors("identity.json");
  const identityLaw = pinIdentityLaw(identity);
  for (const c of identity.cases) {
    const name = `${identityLaw.name} ← ${c.name}`;
    const fields = { embedded: true, left: c.left, right: c.right };
    send("core.equal", fields, name, expectField("equal", c.equal));
    send(
      "core.equal",
      { embedded: true, left: c.right, right: c.left },
      `${name} (flipped)`,
      expectField("equal", c.equal),
    );
  }

  const positional = vectors("positional.json");
  for (const c of positional.keys) {
    send("pos.key", { position: c.position }, `κ(${c.position})`, expectField("key", c.key));
    send("pos.isKey", { bytes: c.key }, `is_key(κ(${c.position}))`, expectField("isKey", true));
  }
  for (const c of positional.invalid) {
    send("pos.isKey", { bytes: c.bytes }, `reject ${c.bytes}`, expectField("isKey", false));
  }

  // set.json, through E: node-set.json's five embedded laws, one per case kind. Set
  // cases in node-set.json itself are spelled in N.
  const setCase = (c, name, embedded) => {
    const base = embedded ? { member: c.member, embedded: true } : { member: c.member };
    if (c.kind === "form") {
      send(
        "set.form",
        { ...base, members: c.members, node: c.node },
        name,
        (response) =>
          response.equal === true && response.recognized === true
            ? null
            : `got ${JSON.stringify(response)}, want equal+recognized`,
      );
    } else if (c.kind === "duplicate") {
      // The members cannot form a set, so there is no expected node; the placeholder
      // is the empty node, spelled in the request's own model.
      const empty = embedded ? { struct: [] } : { own: { none: {} }, children: [] };
      send("set.form", { ...base, members: c.members, node: empty }, name, expectRefusal(c.key));
    } else if (c.kind === "recognize") {
      send("set.recognize", { ...base, node: c.node }, name, expectRecognition(c.valid, c.reason));
    } else if (c.kind === "membership") {
      send(
        "set.membership",
        { ...base, members: c.members, queries: c.queries.map((q) => q.value) },
        name,
        (response) => {
          const want = c.queries.map((q) => q.in);
          const got = response.in;
          return Array.isArray(got) &&
            got.length === want.length &&
            want.every((w, i) => got[i] === w)
            ? null
            : `in = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
        },
      );
    } else if (c.kind === "identity") {
      send("set.identity", { ...base, left: c.left, right: c.right }, name, expectField("equal", c.equal));
      send(
        "set.identity",
        { ...base, left: c.right, right: c.left },
        `${name} (flipped)`,
        expectField("equal", c.equal),
      );
    } else {
      throw new Error(`unknown set case kind ${c.kind}`);
    }
  };

  const set = vectors("set.json");
  const setLaws = pinSetLaws(set);
  for (const c of set.cases) {
    setCase(c, `${setLaws.get(c.kind).name} ← ${c.name}`, true);
  }

  // --- Node<Option<T>>: the node-*.json files (originating in ADR 0009) ---

  for (const c of vectors("node-identity.json").cases) {
    send("core.equal", { left: c.left, right: c.right }, c.name, expectField("equal", c.equal));
    send(
      "core.equal",
      { left: c.right, right: c.left },
      `${c.name} (flipped)`,
      expectField("equal", c.equal),
    );
  }

  for (const c of vectors("node-invalid.json").cases) {
    if (c.error !== "duplicate_key") throw new Error(`${c.name}: unknown refusal ${c.error}`);
    send("core.build", { node: c.node }, c.name, expectRefusal(c.key));
  }

  for (const c of vectors("node-navigation.json").cases) {
    if (c.op === "at") {
      send("node.at", { tree: c.tree, path: c.path }, c.name, expectResult(c.expected, sameNode));
    } else if (c.op === "valueAt") {
      send("node.valueAt", { tree: c.tree, path: c.path }, c.name, expectResult(c.expected, sameOwn));
    } else if (c.op === "at-compose") {
      send(
        "node.atCompose",
        { tree: c.tree, first: c.first, then: c.then },
        c.name,
        expectResult(c.expected, sameNode),
      );
    } else {
      throw new Error(`${c.name}: unknown navigation op ${c.op}`);
    }
  }

  for (const c of vectors("node-attach.json").cases) {
    if (c.op === "attach") {
      send(
        "node.attach",
        { tree: c.tree, parent: c.parent, key: c.key, subtree: c.subtree },
        c.name,
        expectResult(c.expected, sameNode),
      );
    } else if (c.op === "attach-commute") {
      const judge = expectResult(c.expected, sameNode);
      send(
        "node.attachCommute",
        { tree: c.tree, parent: c.parent, first: c.first, second: c.second },
        c.name,
        (response) => {
          for (const order of ["forward", "reverse"]) {
            if (!isObject(response[order])) return `no ${order} result in ${show(response)}`;
            const failure = judge(response[order]);
            if (failure !== null) return `${order}: ${failure}`;
          }
          return null;
        },
      );
    } else {
      throw new Error(`${c.name}: unknown attach op ${c.op}`);
    }
  }

  for (const c of vectors("node-parts.json").cases) {
    const judged = {
      decompose: [{ tree: c.tree }, sameParts],
      compose: [{ parts: c.parts }, sameNode],
      split: [{ tree: c.tree, path: c.path }, sameSplit],
      plug: [{ context: c.context, subtree: c.subtree }, sameNode],
      cut: [{ tree: c.tree, paths: c.paths }, sameCut],
      rebuild: [{ skeleton: c.skeleton, subtrees: c.subtrees }, sameNode],
    }[c.op];
    if (judged === undefined) throw new Error(`${c.name}: unknown parts op ${c.op}`);
    const [fields, same] = judged;
    send(`node.${c.op}`, fields, c.name, expectResult(c.expected, same));
  }

  for (const c of vectors("node-embedding.json").cases) {
    if (c.op === "embed") {
      send("node.embed", { old: c.old }, c.name, expectResult(c.expected, sameNode));
    } else if (c.op === "unembed") {
      send("node.unembed", { tree: c.tree }, c.name, expectResult(c.expected, sameOld));
    } else if (c.op !== "embedded-identity") {
      // embedded-identity is replayed above, as identity.json through E.
      throw new Error(`${c.name}: unknown embedding op ${c.op}`);
    }
  }

  for (const c of vectors("node-set.json").cases) {
    if (c.kind !== "embedded") setCase(c, c.name, false);
  }

  // The envelope cases go in their own drive, under a wall-clock bound: a core that
  // materializes the sharing bomb before measuring it never answers, and must not stall
  // every other case with it.
  const envelope = { requests: [], checks: new Map() };
  if (CODEC) {
    const sendEnvelope = (op, fields, name, verify) => {
      const id = `envelope-${envelope.requests.length}`;
      envelope.requests.push({ id, op, ...fields });
      envelope.checks.set(id, { op, name, verify });
    };
    codecRequests(vectors, send, sendEnvelope, { navigate: NAVIGATE });
  }

  return { requests, checks, envelope };
}

// --- drive one implementation ---------------------------------------------------------

function drive(implementation, requests, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(implementation.command, implementation.args, {
      cwd: new URL(".", ROOT),
      stdio: ["pipe", "pipe", "inherit"],
    });
    // A bounded drive is killed at its deadline and judged on what it answered by then.
    let timedOut = false;
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (error) =>
      reject(new Error(`${implementation.name}: failed to start: ${error.message}`)),
    );

    const responses = new Map();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      const response = JSON.parse(line);
      responses.set(response.id, response);
    });

    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) {
        resolve(responses);
        return;
      }
      if (code !== 0) {
        reject(new Error(`${implementation.name}: exited ${code}`));
        return;
      }
      resolve(responses);
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

// --- main -----------------------------------------------------------------------------

const chosen = process.argv
  .find((argument) => argument.startsWith("--only"))
  ?.split("=")[1]
  ?.split(",");
const selected = IMPLEMENTATIONS.filter(
  (implementation) => !chosen || chosen.includes(implementation.name),
);
if (selected.length === 0) {
  console.error("no implementations selected");
  process.exit(2);
}

// Build what runs as a binary once, before anything is sent or timed (see GO_BIN). A
// build failure fails the run: a stale binary from an earlier build must never answer.
for (const implementation of selected) {
  if (!implementation.build) continue;
  try {
    execFileSync(implementation.build[0], implementation.build[1], {
      cwd: new URL(".", ROOT),
      stdio: "inherit",
    });
  } catch {
    console.error(`${implementation.name}: build failed`);
    process.exit(2);
  }
}

// Resolve the corpus and the pinned laws BEFORE sending anything: a name collision, a
// dangling reference or a moved pin must fail the run outright, never survive as a case
// nobody sends.
let corpus;
let planned;
try {
  corpus = loadCorpus();
  planned = plan();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const { requests, checks, envelope } = planned;

console.log(
  `corpus: ${corpus.size} named cases over ${VECTOR_FILES.length} files ` +
    `(${REPLAYED_FILES.length + (CODEC ? CODEC_V2_FILES.length : 0)} replayed, ` +
    (CODEC ? `${CODEC_V2_FILES.length} of them the v2 codec's` : `the ${CODEC_V2_FILES.length} v2 codec files skipped (--no-codec)`) +
    ` — ${INDEXED_CODEC.length} v1 codec files indexed only — the withdrawn candidate's evidence — ` +
    `and ${INDEXED_PREVIOUS.length} indexed as the ` +
    `previous model's: ${INDEXED_PREVIOUS.join(", ")}, which no law re-reads in the optional specialization), ` +
    `names unique, references resolved, pinned laws hold`,
);
console.log(`${requests.length} requests over ${selected.map((s) => s.name).join(", ")}`);
if (CODEC) {
  console.log(
    `codec: the ${CODEC_V2_FILES.length} v2 codec files are replayed, and ` +
      `${envelope.requests.length} envelope requests run in their own drive, bounded at ${ENVELOPE_TIMEOUT_MS / 1000} s`,
  );
  console.log(
    NAVIGATE
      ? "navigate: codec.navigate is sent"
      : "navigate: the navigate cases are indexed only (--no-navigate)",
  );
}

let anyFailure = false;
for (const implementation of selected) {
  let passed = 0;
  const failures = [];
  let responses;
  try {
    responses = await drive(implementation, requests);
  } catch (error) {
    console.error(`✖ ${implementation.name}: ${error.message}`);
    anyFailure = true;
    continue;
  }

  const judge = (judged, answers, silence) => {
    for (const [id, check] of judged) {
      const response = answers.get(id);
      if (response === undefined) {
        failures.push(`${check.op} ${check.name}: ${silence}`);
        continue;
      }
      const failure = check.verify(response);
      if (failure === null) passed++;
      else failures.push(`${check.op} ${check.name}: ${failure}`);
    }
  };
  judge(checks, responses, "no response");
  let total = checks.size;
  if (envelope.requests.length > 0) {
    let bounded;
    try {
      bounded = await drive(implementation, envelope.requests, ENVELOPE_TIMEOUT_MS);
    } catch (error) {
      bounded = new Map();
      failures.push(`envelope drive: ${error.message}`);
    }
    judge(envelope.checks, bounded, `no response within ${ENVELOPE_TIMEOUT_MS / 1000} s`);
    total += envelope.checks.size;
  }

  if (failures.length === 0) {
    console.log(`✔ ${implementation.name}: ${passed}/${total}`);
  } else {
    anyFailure = true;
    console.error(`✖ ${implementation.name}: ${passed}/${total}`);
    for (const failure of failures.slice(0, 20)) console.error(`    ${failure}`);
    if (failures.length > 20) console.error(`    … ${failures.length - 20} more`);
  }
}

process.exit(anyFailure ? 1 : 0);
