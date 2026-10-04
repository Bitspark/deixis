#!/usr/bin/env node
// Conformance-suite mutation: design/0006's "the suite must kill every mutant".
//
// This measures the CORPUS, not the cores. It plants one of 0006's named defects in one
// core at one site, runs the harness against that core alone, and records whether any
// corpus check failed. A defect the corpus cannot tell from a correct core is a SURVIVOR,
// that is, a gap in the corpus. It goes to the vectors lane as its defect class and site,
// never as a case: the killing case is written from CODEC.md by the corpus's author, not
// by whoever planted the defect.
//
// Honesty rules, each enforced below rather than promised:
//   - Sites come from the core's source, not from the corpus. Every class names a
//     pattern for where its behaviour lives in each core, and the run refuses to start
//     if any match of that pattern is left without a planted site. A planter who knew
//     where the corpus probes could otherwise plant only there.
//   - A kill is a failed corpus CHECK. A core that crashes or will not build is reported
//     as such, never as a kill: a malformed plant proves nothing about the corpus.
//   - The unmutated core must pass the whole harness first, so every failure after a
//     plant is the plant's.
//   - Every planted file is restored byte for byte, and the run refuses to start on a
//     core with uncommitted changes, so a crashed run can never leave a defect behind.
//
// Usage: node tools/conformance/mutants.mjs [--only=py,ts,go,rs] [--class=<substring>]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url);
const path = (file) => new URL(file, ROOT);
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = arg("only")?.split(",");
const classFilter = arg("class");

// --- the cores ------------------------------------------------------------------------------

const CORES = {
  py: {
    files: ["core/py/deixis_core.py", "core/py/deixis_codec.py"],
    // A plant that does not parse proves nothing: check it before the harness sees it.
    build: (files) => files.map((f) => ["python", ["-c", "import ast,sys; ast.parse(open(sys.argv[1],'rb').read())", f]]),
    reach: reachPy,
  },
  ts: {
    files: ["core/ts/src/index.ts", "core/ts/src/codec.ts", "core/ts/src/codec-internal.ts"],
    // The CLI runs core/ts/dist, so every plant is compiled, type checks included.
    build: () => [["node", ["core/ts/node_modules/typescript/bin/tsc", "-p", "core/ts"]]],
    // No line-level reach for compiled output: reach is probed per site instead (see probe).
    marker: 'process.stderr.write("DEIXIS-REACH\\n"); ',
  },
  go: {
    files: ["core/go/deixis.go", "core/go/codec.go", "core/go/codec_flat.go", "core/go/codec_linked.go"],
    // The harness builds the CLI itself, once per run (harness.mjs, GO_BIN); compiling
    // first tells a plant that does not build apart from a kill.
    build: () => [["go", ["build", "-o", join(tmpdir(), `deixis-mutants-go${process.platform === "win32" ? ".exe" : ""}`), "./conformance/go"]]],
    marker: 'println("DEIXIS-REACH"); ', // the builtin println writes to stderr
  },
  rs: {
    files: ["core/rs/src/lib.rs", "core/rs/src/codec/cuvarint.rs", "core/rs/src/codec/flat.rs", "core/rs/src/codec/linked.rs"],
    // The harness runs target/debug/deixis-conformance, which this build replaces.
    build: () => [["cargo", ["build", "-q", "-p", "deixis-conformance"]]],
    marker: 'eprintln!("DEIXIS-REACH"); ',
    // A Rust file carries its unit tests; their assertions name the same faults, and
    // are not sites.
    code: (text) => text.split("#[cfg(test)]")[0],
  },
};

// Reach for a core without a whole-run measurement: plant only a marker at the site's first
// anchor, run the harness once, and look for it. The site is reached iff some corpus request
// executed the anchor's statement, the same sense as the line measurement above.
const probed = new Map();
function probe(core, mutant) {
  const e = mutant.probeAt ?? mutant.edits[0];
  const memo = `${core} ${e.file} ${e.old}`;
  if (!probed.has(memo)) {
    const indent = e.old.match(/^\s*/)[0];
    plant({ ...mutant, edits: [{ file: e.file, old: e.old, new: indent + CORES[core].marker + e.old.slice(indent.length) }] });
    const broken = CORES[core].build().map(([c, a]) => run(c, a)).find((b) => b.status !== 0);
    const out = broken ? "" : run("node", ["tools/conformance/harness.mjs", `--only=${core}`]).out;
    restore();
    if (broken) throw new Error(`mutants: the reach probe at ${core} ${mutant.site} does not build: ${broken.out.trim().split(/\r?\n/).pop()}`);
    probed.set(memo, out.includes("DEIXIS-REACH"));
  }
  return probed.get(memo) ? "reached" : "never reached";
}

// Which core lines the corpus executes, measured on the UNMUTATED core in one harness run.
// It splits the survivors in two: a site the corpus never reaches is a gap in what the
// requests exercise (possibly in the CLI protocol itself), and a site it reaches without
// noticing the defect is a missing discriminating case.
function reachPy() {
  const dir = mkdtempSync(join(tmpdir(), "deixis-reach-"));
  const out = join(dir, "lines.txt");
  writeFileSync(
    join(dir, "sitecustomize.py"),
    [
      "import atexit, os, sys",
      "_out = os.environ.get('DEIXIS_REACH_OUT')",
      "if _out:",
      "    _hits = set()",
      "    _m = sys.monitoring",
      "    _m.use_tool_id(_m.COVERAGE_ID, 'deixis-reach')",
      "    def _line(code, line):",
      "        name = os.path.basename(code.co_filename)",
      "        if name in ('deixis_core.py', 'deixis_codec.py'):",
      "            _hits.add(f'core/py/{name}:{line}')",
      "        return _m.DISABLE",
      "    _m.register_callback(_m.COVERAGE_ID, _m.events.LINE, _line)",
      "    _m.set_events(_m.COVERAGE_ID, _m.events.LINE)",
      "    atexit.register(lambda: open(_out, 'a').write(''.join(h + '\\n' for h in _hits)))",
      "",
    ].join("\n"),
  );
  const env = { ...process.env, PYTHONPATH: dir, DEIXIS_REACH_OUT: out };
  run("node", ["tools/conformance/harness.mjs", "--only=py"], { env });
  let lines;
  try {
    // Python writes the file in text mode, so on Windows each line ends CRLF.
    lines = new Set(readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return lines;
}

// The source lines a mutant's anchors span.
function lines(mutant) {
  const out = [];
  for (const e of mutant.edits) {
    const at = text(e.file).indexOf(eol(e.file, e.old));
    const first = text(e.file).slice(0, at).split("\n").length;
    const last = first + eol(e.file, e.old).replace(/\r?\n$/, "").split("\n").length - 1;
    for (let l = first; l <= last; l++) out.push(`${e.file}:${l}`);
  }
  return out;
}

// --- the defect classes and their sites ------------------------------------------------------
//
// `where[core]` is the pattern for every place the behaviour lives in that core's source.
// Each mutant plants the defect at one site; the run checks every pattern match is inside
// some site's planted text (or its `covers`, for a plant that changes a condition beside
// the verdict it guards).

// A site no §2.1 profile covers: the corpus cannot owe it a case, so a survivor there is
// reported apart from the corpus gaps (unit tests in the core are its cover).
const BUILDER = "the one-chunk builder is a store convenience outside every §2.1 profile";

const XOR = (e) => `bytes(b ^ 0x80 for b in ${e})`; // octets compared as signed
const STR = (e) => `${e}.decode("utf-8", "surrogateescape")`; // octets compared as host text

// TypeScript compares keys through one function; a defect replaces it at one call site.
const SIGNED_TS =
  "((x: Uint8Array, y: Uint8Array): number => { for (let i = 0; i < Math.min(x.length, y.length); i++) " +
  "{ const d = (x[i]! ^ 0x80) - (y[i]! ^ 0x80); if (d !== 0) return d; } return x.length - y.length; })";
const STRING_TS =
  "((x: Uint8Array, y: Uint8Array): number => { const s = new TextDecoder().decode(x), t = new TextDecoder().decode(y); " +
  "return s < t ? -1 : s > t ? 1 : 0; })"; // UTF-16 code units, the realistic form (vectors lane)
const tsKeyOrder = (name, compare) => [
  {
    site: "node model: construction order and lookup",
    edits: [
      { file: "core/ts/src/index.ts", old: "    owned.sort(([a], [b]) => compareBytes(a, b));", new: `    owned.sort(([a], [b]) => ${compare}(a, b));` },
      { file: "core/ts/src/index.ts", old: "      const order = compareBytes(this.#entries[middle]![0], key);", new: `      const order = ${compare}(this.#entries[middle]![0], key);` },
    ],
  },
  {
    site: "flat decode (streaming): key order check",
    edits: [{ file: "core/ts/src/codec.ts", old: "          const order = compareBytes(this.#range(key), this.#range(top.previous));", new: `          const order = ${compare}(this.#range(key), this.#range(top.previous));` }],
  },
  {
    site: "linked chunk parse: key order check",
    edits: [{ file: "core/ts/src/codec-internal.ts", old: "      const order = compareBytes(key, previous);", new: `      const order = ${compare}(key, previous);` }],
  },
  {
    site: "linked chunk navigation: resolveChild lookup",
    edits: [{ file: "core/ts/src/codec.ts", old: "      const order = compareBytes(keys[middle]!, key);", new: `      const order = ${compare}(keys[middle]!, key);` }],
  },
].map((m) => ({ ...m, core: "ts", class: name }));
const TS_KEY_ORDER = /compareBytes\((?!a: Uint8Array)(?!a, b\) === 0)/g;

// Key order lives in the same places for both ordering defects.
const keyOrderSites = (name, as) => [
  {
    core: "py",
    site: "node model: construction order and lookup",
    edits: [
      { file: "core/py/deixis_core.py", old: "            key=lambda entry: entry[0],\n", new: `            key=lambda entry: ${as("entry[0]")},\n` },
      {
        file: "core/py/deixis_core.py",
        old: "bisect_left(self._entries, wanted, key=lambda entry: entry[0])",
        new: `bisect_left(self._entries, ${as("wanted")}, key=lambda entry: ${as("entry[0]")})`,
      },
    ],
  },
  {
    core: "py",
    site: "flat decode: key order check",
    edits: [{ file: "core/py/deixis_codec.py", old: "if key < parent.previous:", new: `if ${as("key")} < ${as("parent.previous")}:` }],
  },
  {
    core: "py",
    site: "linked chunk parse: key order check",
    edits: [{ file: "core/py/deixis_codec.py", old: "if key < previous:", new: `if ${as("key")} < ${as("previous")}:` }],
  },
  {
    core: "py",
    site: "linked chunk navigation: child lookup",
    edits: [{
      file: "core/py/deixis_codec.py",
      old: "bisect_left(self.children, wanted, key=lambda entry: entry[0])",
      new: `bisect_left(self.children, ${as("wanted")}, key=lambda entry: ${as("entry[0]")})`,
    }],
  },
  {
    core: "py",
    site: "linked chunk builder: link order",
    outside: BUILDER,
    edits: [{ file: "core/py/deixis_codec.py", old: "key=lambda e: e[0]", new: `key=lambda e: ${as("e[0]")}` }],
  },
].map((m) => ({ ...m, class: name }));

const CLASSES = [
  {
    name: "signed-byte key comparison",
    where: { py: /key=lambda (e|entry): \1\[0\]|key < (parent\.)?previous/g, ts: TS_KEY_ORDER },
    mutants: [...keyOrderSites("signed-byte key comparison", XOR), ...tsKeyOrder("signed-byte key comparison", SIGNED_TS)],
  },
  {
    // "Host equality", pinned by the vectors lane: keys compared as decoded host strings
    // rather than as octets.
    name: "host-string key comparison",
    where: { py: /key=lambda (e|entry): \1\[0\]|key < (parent\.)?previous/g, ts: TS_KEY_ORDER },
    mutants: [...keyOrderSites("host-string key comparison", STR), ...tsKeyOrder("host-string key comparison", STRING_TS)],
  },
  {
    name: "duplicate-last-wins",
    where: { py: /Invalid\("duplicate_key"\)|raise DuplicateKeyError\(/g, ts: /invalid\("duplicate_key"\)|new DuplicateKeyError\(/g },
    mutants: [
      {
        core: "py",
        site: "flat decode: duplicate key check",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '            if key == parent.previous:\n                raise _Stop(Invalid("duplicate_key"))\n',
          new: "            if key == parent.previous:\n                parent.record.entries.pop()\n",
        }],
      },
      {
        core: "py",
        site: "linked chunk parse: duplicate key check",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '            if key == previous:\n                raise _Stop(Invalid("duplicate_key"))\n',
          new: "            if key == previous:\n                entries.pop()\n",
        }],
      },
      {
        core: "py",
        site: "node model: construction",
        edits: [{
          file: "core/py/deixis_core.py",
          old:
            "        owned = sorted(\n            ((bytes(key), node) for key, node in children),\n            key=lambda entry: entry[0],\n        )\n" +
            "        for previous, current in pairwise(owned):\n            if previous[0] == current[0]:\n                raise DuplicateKeyError(current[0])\n",
          new:
            "        owned = sorted(\n            dict((bytes(key), node) for key, node in children).items(),\n            key=lambda entry: entry[0],\n        )\n",
        }],
      },
      {
        core: "py",
        site: "linked chunk builder: duplicate key check",
        outside: BUILDER,
        edits: [{
          file: "core/py/deixis_codec.py",
          old:
            "    owned = sorted(\n        ((bytes(key), address) for key, address in children), key=lambda e: e[0]\n    )\n" +
            "    for previous, current in pairwise(owned):\n        if previous[0] == current[0]:\n            raise DuplicateKeyError(current[0])\n",
          new:
            "    owned = sorted(\n        dict((bytes(key), address) for key, address in children).items(), key=lambda e: e[0]\n    )\n",
        }],
      },
      {
        core: "ts",
        site: "flat decode (streaming): duplicate key check",
        edits: [{
          file: "core/ts/src/codec.ts",
          old: '          if (order === 0) return invalid("duplicate_key");',
          new: "          if (order === 0) { top.record.keys.pop(); top.record.children.pop(); }",
        }],
      },
      {
        core: "ts",
        site: "linked chunk parse: duplicate key check",
        edits: [{
          file: "core/ts/src/codec-internal.ts",
          old: '      if (order === 0) return invalid("duplicate_key");',
          new: "      if (order === 0) { keys.pop(); indices.pop(); }",
        }],
      },
      {
        core: "ts",
        site: "node model: construction",
        edits: [{
          file: "core/ts/src/index.ts",
          old:
            "    for (let i = 1; i < owned.length; i++) {\n      if (equalBytes(owned[i - 1]![0], owned[i]![0])) {\n" +
            "        throw new DuplicateKeyError(Uint8Array.from(owned[i]![0]));\n      }\n    }\n",
          // The sort is stable, so of equal keys the later child is kept.
          new: "    for (let i = owned.length - 1; i > 0; i--) {\n      if (equalBytes(owned[i - 1]![0], owned[i]![0])) owned.splice(i - 1, 1);\n    }\n",
        }],
      },
    ].map((m) => ({ ...m, class: "duplicate-last-wins" })),
  },
  {
    name: "overlong-varint acceptance",
    where: { py: /Invalid\("non_shortest_uvarint"\)/g, ts: /return "non_shortest_uvarint"/g },
    mutants: [
      {
        core: "py",
        site: "cuvarint reader (framing, id, links)",
        edits: [{ file: "core/py/deixis_codec.py", old: "            if width > 0 and octet == 0:\n", new: "            if False:\n" }],
        covers: [{ file: "core/py/deixis_codec.py", old: '            if width > 0 and octet == 0:\n                raise _Stop(Invalid("non_shortest_uvarint"))\n' }],
      },
      {
        core: "ts",
        site: "cuvarint reader (framing, id, links)",
        edits: [{
          file: "core/ts/src/codec-internal.ts",
          old: '      if (group === 0) return "non_shortest_uvarint";\n    } else if (last && group === 0 && i > 0) {\n      return "non_shortest_uvarint";\n    }\n',
          new: "    }\n",
        }],
        // The plant starts inside the tenth-octet branch; the check it removes runs on
        // every octet, so reach is probed where every octet passes.
        probeAt: { file: "core/ts/src/codec-internal.ts", old: "    if (i === 9) {\n" },
      },
    ].map((m) => ({ ...m, class: "overlong-varint acceptance" })),
  },
  {
    name: "sort-on-read",
    where: { py: /Invalid\("unsorted_keys"\)/g, ts: /invalid\("unsorted_keys"\)/g },
    mutants: [
      {
        core: "py",
        site: "flat decode: key order check",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '            if key < parent.previous:\n                raise _Stop(Invalid("unsorted_keys"))\n',
          new: "            if key < parent.previous:\n                pass\n",
        }],
      },
      {
        core: "py",
        site: "linked chunk parse: key order check",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '            if key < previous:\n                raise _Stop(Invalid("unsorted_keys"))\n',
          new: "            if key < previous:\n                pass\n",
        }],
      },
      {
        core: "ts",
        site: "flat decode (streaming): key order check",
        edits: [{ file: "core/ts/src/codec.ts", old: '          if (order < 0) return invalid("unsorted_keys");', new: "          if (order < 0) { /* sorted on read */ }" }],
      },
      {
        core: "ts",
        site: "linked chunk parse: key order check",
        edits: [{ file: "core/ts/src/codec-internal.ts", old: '      if (order < 0) return invalid("unsorted_keys");', new: "      if (order < 0) { /* sorted on read */ }" }],
      },
    ].map((m) => ({ ...m, class: "sort-on-read" })),
  },
  {
    name: "codec-mismatch acceptance",
    where: { py: /Invalid\("slot_codec_mismatch"\)/g, ts: /invalid\("slot_codec_mismatch"\)/g },
    mutants: [
      {
        core: "py",
        site: "linked resolve-child",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '    if framing.slot_codec_id != parent.slot_codec_id:\n        return Invalid("slot_codec_mismatch")\n',
          new: '    if False:\n        return Invalid("slot_codec_mismatch")\n',
        }],
      },
      {
        core: "py",
        site: "linked traversal (resolve, check, flatten)",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '        if framing.slot_codec_id != visits[digest].framing.slot_codec_id:\n            raise _Stop(Invalid("slot_codec_mismatch"))\n',
          new: '        if False:\n            raise _Stop(Invalid("slot_codec_mismatch"))\n',
        }],
      },
      {
        core: "ts",
        site: "linked fetch-and-verify (resolve-child and traversal)",
        edits: [{
          file: "core/ts/src/codec-internal.ts",
          old: '  if (parentId !== undefined && !equalBytes(chunk.id, parentId)) return invalid("slot_codec_mismatch");',
          new: '  if (false) return invalid("slot_codec_mismatch");',
        }],
      },
    ].map((m) => ({ ...m, class: "codec-mismatch acceptance" })),
  },
  {
    name: "unused-link acceptance",
    where: { py: /Invalid\("unused_link"\)/g, ts: /invalid\("unused_link"\)/g },
    mutants: [
      {
        core: "py",
        site: "linked chunk parse: link use check",
        edits: [{
          file: "core/py/deixis_codec.py",
          old: '    if used < nlinks:\n        raise _Stop(Invalid("unused_link"))\n',
          new: '    if False:\n        raise _Stop(Invalid("unused_link"))\n',
        }],
      },
      {
        core: "ts",
        site: "linked chunk parse: link use check",
        edits: [{
          file: "core/ts/src/codec-internal.ts",
          old: '  if (firstUnused < links.length) return invalid("unused_link");',
          new: '  if (false) return invalid("unused_link");',
        }],
      },
    ].map((m) => ({ ...m, class: "unused-link acceptance" })),
  },
];

// Go's catalogue, by class. Go differs from the others in ways the plants must respect: its
// sort is not stable (last-wins needs the stable one), a decoded node is assembled without
// sorting (sort-on-read must sort, or it is only accept-unsorted), and it compares strings
// octet by octet, so the host-string defect is an equivalent mutant there.
const GO_SIGNED =
  "func(x, y []byte) int { for i := 0; i < min(len(x), len(y)); i++ { if d := int(int8(x[i])) - int(int8(y[i])); d != 0 { return d } }; return len(x) - len(y) }";
const GO_SORT = (entries) =>
  `\t\tfor a := 1; a < len(${entries}); a++ { for b := a; b > 0 && bytes.Compare(${entries}[b-1].Key, ${entries}[b].Key) > 0; b-- { ${entries}[b-1], ${entries}[b] = ${entries}[b], ${entries}[b-1] } }\n`;
const GO = {
  "signed-byte key comparison": {
    where: /bytes\.Compare\b/g,
    sites: [
      {
        site: "node model: construction order and lookup",
        edits: [
          { file: "core/go/deixis.go", old: "\t\treturn bytes.Compare(a.Key, b.Key)\n", new: `\t\treturn ${GO_SIGNED}(a.Key, b.Key)\n` },
          { file: "core/go/deixis.go", old: "\t\treturn bytes.Compare(entry.Key, k)\n", new: `\t\treturn ${GO_SIGNED}(entry.Key, k)\n` },
        ],
      },
      {
        site: "flat decode (streaming): key order check",
        edits: [{ file: "core/go/codec_flat.go", old: "\t\t\tswitch c := bytes.Compare(key, f.prevKey); {\n", new: `\t\t\tswitch c := ${GO_SIGNED}(key, f.prevKey); {\n` }],
      },
      {
        site: "linked chunk parse: key order check",
        edits: [{ file: "core/go/codec_linked.go", old: "\t\t\tswitch cmp := bytes.Compare(key, c.keys[i-1]); {\n", new: `\t\t\tswitch cmp := ${GO_SIGNED}(key, c.keys[i-1]); {\n` }],
      },
      {
        site: "linked chunk navigation: ResolveChild lookup",
        edits: [{ file: "core/go/codec_linked.go", old: "\ti, found := slices.BinarySearchFunc(c.keys, key, bytes.Compare)\n", new: `\ti, found := slices.BinarySearchFunc(c.keys, key, ${GO_SIGNED})\n` }],
      },
    ],
  },
  "host-string key comparison": {
    equivalent: "Go compares strings octet by octet: string(a) < string(b) is the octet order, so the defect changes nothing",
  },
  "duplicate-last-wins": {
    where: /invalid\(CodeDuplicateKey\)|&DuplicateKeyError\{/g,
    sites: [
      {
        site: "flat decode (streaming): duplicate key check",
        edits: [{
          file: "core/go/codec_flat.go",
          old: "\t\t\tswitch c := bytes.Compare(key, f.prevKey); {\n\t\t\tcase c == 0:\n\t\t\t\treturn invalid(CodeDuplicateKey)\n",
          new:
            "\t\t\tswitch c := bytes.Compare(key, f.prevKey); {\n\t\t\tcase c == 0:\n\t\t\t\tparent := &p.nodes[f.node]\n" +
            "\t\t\t\tparent.keys = parent.keys[:len(parent.keys)-1]\n\t\t\t\tparent.children = parent.children[:len(parent.children)-1]\n",
        }],
      },
      {
        site: "linked chunk parse: duplicate key check",
        edits: [{
          file: "core/go/codec_linked.go",
          old: "\t\tif i > 0 {\n\t\t\tswitch cmp := bytes.Compare(key, c.keys[i-1]); {\n\t\t\tcase cmp == 0:\n\t\t\t\treturn nil, invalid(CodeDuplicateKey)\n",
          // The predecessor is the last key kept, no longer the previous index, so the loop
          // index goes unused (and Go refuses an unused variable).
          new:
            "\t\t_ = i\n\t\tif len(c.keys) > 0 {\n\t\t\tswitch cmp := bytes.Compare(key, c.keys[len(c.keys)-1]); {\n\t\t\tcase cmp == 0:\n" +
            "\t\t\t\tc.keys, c.index = c.keys[:len(c.keys)-1], c.index[:len(c.index)-1]\n",
        }],
      },
      {
        site: "node model: construction",
        edits: [
          { file: "core/go/deixis.go", old: "\tslices.SortFunc(owned, func(a, b Entry[T]) int {\n", new: "\tslices.SortStableFunc(owned, func(a, b Entry[T]) int {\n" },
          {
            file: "core/go/deixis.go",
            old:
              "\tfor i := 1; i < len(owned); i++ {\n\t\tif bytes.Equal(owned[i-1].Key, owned[i].Key) {\n" +
              "\t\t\treturn Node[T]{}, &DuplicateKeyError{Key: bytes.Clone(owned[i].Key)}\n\t\t}\n\t}\n",
            new: "\tfor i := len(owned) - 1; i > 0; i-- {\n\t\tif bytes.Equal(owned[i-1].Key, owned[i].Key) {\n\t\t\towned = append(owned[:i-1], owned[i:]...)\n\t\t}\n\t}\n",
          },
        ],
      },
    ],
  },
  "overlong-varint acceptance": {
    where: /return 0, (?:10|i \+ 1), uvarintNonShortest/g,
    sites: [{
      site: "cuvarint reader (framing, id, links)",
      edits: [
        {
          file: "core/go/codec.go",
          old: "\t\t\tcase c > 1:\n\t\t\t\treturn 0, 10, uvarintOverflow\n\t\t\tcase c == 0:\n\t\t\t\treturn 0, 10, uvarintNonShortest\n",
          new: "\t\t\tcase c > 1:\n\t\t\t\treturn 0, 10, uvarintOverflow\n",
        },
        { file: "core/go/codec.go", old: "\t\t\tif c == 0 && i > 0 {\n\t\t\t\treturn 0, i + 1, uvarintNonShortest\n\t\t\t}\n", new: "" },
      ],
      probeAt: { file: "core/go/codec.go", old: "\t\tif i == 9 {\n" },
    }],
  },
  "sort-on-read": {
    where: /invalid\(CodeUnsortedKeys\)/g,
    sites: [
      {
        site: "flat decode (streaming): key order check",
        edits: [
          { file: "core/go/codec_flat.go", old: "\t\t\tcase c < 0:\n\t\t\t\treturn invalid(CodeUnsortedKeys)\n", new: "" },
          {
            file: "core/go/codec_flat.go",
            old: "\t\tbuilt[i] = Node[T]{own: values[i], entries: entries}\n",
            new: GO_SORT("entries") + "\t\tbuilt[i] = Node[T]{own: values[i], entries: entries}\n",
          },
        ],
        probeAt: { file: "core/go/codec_flat.go", old: "\t\t\tswitch c := bytes.Compare(key, f.prevKey); {\n" },
      },
      {
        site: "linked chunk parse: key order check",
        edits: [
          { file: "core/go/codec_linked.go", old: "\t\t\tcase cmp < 0:\n\t\t\t\treturn nil, invalid(CodeUnsortedKeys)\n", new: "" },
          {
            file: "core/go/codec_linked.go",
            old: "\t\tnode := Node[T]{own: own, entries: f.entries}\n",
            new: GO_SORT("f.entries") + "\t\tnode := Node[T]{own: own, entries: f.entries}\n",
          },
        ],
        probeAt: { file: "core/go/codec_linked.go", old: "\t\t\tswitch cmp := bytes.Compare(key, c.keys[i-1]); {\n" },
      },
    ],
  },
  "codec-mismatch acceptance": {
    where: /invalid\(CodeSlotCodecMismatch\)/g,
    sites: [
      {
        site: "linked resolve-child",
        edits: [{ file: "core/go/codec_linked.go", old: "\tif !bytes.Equal(child.id, c.id) {\n", new: "\tif false {\n" }],
        covers: [{ file: "core/go/codec_linked.go", old: "\tif !bytes.Equal(child.id, c.id) {\n\t\treturn nil, true, invalid(CodeSlotCodecMismatch)\n" }],
      },
      {
        site: "linked traversal (resolve, check, flatten)",
        edits: [{ file: "core/go/codec_linked.go", old: "\t\t\tif !bytes.Equal(chunk.id, f.node.chunk.id) {\n", new: "\t\t\tif false {\n" }],
        covers: [{ file: "core/go/codec_linked.go", old: "\t\t\tif !bytes.Equal(chunk.id, f.node.chunk.id) {\n\t\t\t\treturn nil, invalid(CodeSlotCodecMismatch)\n" }],
      },
    ],
  },
  "unused-link acceptance": {
    where: /invalid\(CodeUnusedLink\)/g,
    sites: [{
      site: "linked chunk parse: link use check",
      edits: [{ file: "core/go/codec_linked.go", old: "\tif used < nlinks {\n", new: "\tif false {\n" }],
      covers: [{ file: "core/go/codec_linked.go", old: "\tif used < nlinks {\n\t\treturn nil, invalid(CodeUnusedLink)\n" }],
    }],
  },
};
// Rust's catalogue, by class. Its decoders assemble through Node::compose, which sorts and
// refuses a repeated key, so sort-on-read needs only the refusal gone, and last-wins must
// keep the later child where the flat decoder composes. Its string order is octet order
// for valid UTF-8, so the host-string defect is planted as the realistic lossy conversion.
const RS_SIGNED = (a, b) => `${a}.iter().map(|&x| x as i8).cmp(${b}.iter().map(|&x| x as i8))`;
const RS_STRING = (a, b) => `String::from_utf8_lossy(&${a}).cmp(&String::from_utf8_lossy(&${b}))`;
const rsKeyOrder = (compare) => [
  {
    site: "node model: construction order and lookup",
    edits: [
      { file: "core/rs/src/lib.rs", old: "        entries.sort_by(|(a, _), (b, _)| a.cmp(b));\n", new: `        entries.sort_by(|(a, _), (b, _)| ${compare("a", "b")});\n` },
      { file: "core/rs/src/lib.rs", old: "            .binary_search_by(|(k, _)| k.as_ref().cmp(key))\n", new: `            .binary_search_by(|(k, _)| ${compare("k", "key")})\n` },
    ],
  },
  {
    site: "flat decode (streaming): key order check",
    edits: [{
      file: "core/rs/src/codec/flat.rs",
      old: "                        match window.readable[key.clone()].cmp(&window.readable[previous.clone()]) {\n",
      new: `                        match ${compare("window.readable[key.clone()]", "window.readable[previous.clone()]")} {\n`,
    }],
  },
  {
    site: "linked chunk parse: key order check",
    edits: [{
      file: "core/rs/src/codec/linked.rs",
      old: "            match octets[key.clone()].cmp(&octets[previous.clone()]) {\n",
      new: `            match ${compare("octets[key.clone()]", "octets[previous.clone()]")} {\n`,
    }],
  },
  {
    site: "linked chunk navigation: resolve_child lookup",
    edits: [{
      file: "core/rs/src/codec/linked.rs",
      old: "            .binary_search_by(|(entry, _)| self.octets[entry.clone()].cmp(key))\n",
      new: `            .binary_search_by(|(entry, _)| ${compare("self.octets[entry.clone()]", "key")})\n`,
    }],
    probeAt: { file: "core/rs/src/codec/linked.rs", old: "        let at = entries\n" },
  },
];
const RS_FLAT_PROBE = { file: "core/rs/src/codec/flat.rs", old: "                    if let Some(previous) = &node.previous {\n" };
const RS_LINKED_PROBE = { file: "core/rs/src/codec/linked.rs", old: "        if let Some(previous) = &previous {\n" };
const RS = {
  "signed-byte key comparison": { where: /(?<!index)\.cmp\(/g, sites: rsKeyOrder(RS_SIGNED) },
  "host-string key comparison": { where: /(?<!index)\.cmp\(/g, sites: rsKeyOrder(RS_STRING) },
  "duplicate-last-wins": {
    where: /Fault::DuplicateKey|Err\(DuplicateKey\(/g,
    sites: [
      {
        site: "flat decode (streaming): duplicate key check",
        edits: [
          {
            file: "core/rs/src/codec/flat.rs",
            old: "                            Ordering::Equal => return refused(Fault::DuplicateKey),\n",
            new: "                            Ordering::Equal => {}\n",
          },
          {
            // Both children of the repeated key reach assembly; the later one is kept.
            file: "core/rs/src/codec/flat.rs",
            old: "            let composed = Node::compose(\n                value,\n                children.into_iter().map(|(key, child)| (&buf[key], child)),\n",
            new:
              "            let mut kept: Vec<(Range<usize>, Node<R::Value>)> = Vec::new();\n" +
              "            for (key, child) in children {\n" +
              "                if kept.last().is_some_and(|(last, _)| buf[last.clone()] == buf[key.clone()]) {\n" +
              "                    kept.pop();\n                }\n                kept.push((key, child));\n            }\n" +
              "            let composed = Node::compose(\n                value,\n                kept.into_iter().map(|(key, child)| (&buf[key], child)),\n",
          },
        ],
        probeAt: RS_FLAT_PROBE,
      },
      {
        site: "linked chunk parse: duplicate key check",
        edits: [{
          file: "core/rs/src/codec/linked.rs",
          old: "                Ordering::Equal => return Err(Fault::DuplicateKey.into()),\n",
          new: "                Ordering::Equal => {\n                    entries.pop();\n                }\n",
        }],
        probeAt: RS_LINKED_PROBE,
      },
      {
        site: "node model: construction",
        edits: [{
          file: "core/rs/src/lib.rs",
          old:
            "        for pair in entries.windows(2) {\n            if pair[0].0 == pair[1].0 {\n" +
            "                return Err(DuplicateKey(pair[0].0.clone()));\n            }\n        }\n",
          // sort_by is stable, so of equal keys the later child is kept.
          new:
            "        let mut kept: Vec<(Key, Node<T>)> = Vec::with_capacity(entries.len());\n" +
            "        for entry in entries {\n            if kept.last().is_some_and(|(key, _)| *key == entry.0) {\n" +
            "                kept.pop();\n            }\n            kept.push(entry);\n        }\n        let entries = kept;\n",
        }],
      },
    ],
  },
  "overlong-varint acceptance": {
    where: /Fault::NonShortestUvarint/g,
    sites: [{
      site: "cuvarint reader (framing, id, links)",
      edits: [{
        file: "core/rs/src/codec/cuvarint.rs",
        old: "            if index > 0 && octet == 0 {\n                return Scan::Fault(Fault::NonShortestUvarint);\n            }\n",
        new: "",
      }],
      probeAt: { file: "core/rs/src/codec/cuvarint.rs", old: "            return Scan::Value(value, index + 1);\n" },
    }],
  },
  "sort-on-read": {
    where: /Fault::UnsortedKeys/g,
    sites: [
      {
        site: "flat decode (streaming): key order check",
        edits: [{ file: "core/rs/src/codec/flat.rs", old: "                            Ordering::Less => return refused(Fault::UnsortedKeys),\n", new: "                            Ordering::Less => {}\n" }],
        probeAt: RS_FLAT_PROBE,
      },
      {
        site: "linked chunk parse: key order check",
        edits: [{ file: "core/rs/src/codec/linked.rs", old: "                Ordering::Less => return Err(Fault::UnsortedKeys.into()),\n", new: "                Ordering::Less => {}\n" }],
        probeAt: RS_LINKED_PROBE,
      },
    ],
  },
  "codec-mismatch acceptance": {
    where: /Fault::SlotCodecMismatch/g,
    sites: [{
      site: "linked child retrieval (resolve-child and traversal)",
      edits: [{ file: "core/rs/src/codec/linked.rs", old: "        if child.slot_codec_id() != self.slot_codec_id() {\n", new: "        if false {\n" }],
      covers: [{ file: "core/rs/src/codec/linked.rs", old: "        if child.slot_codec_id() != self.slot_codec_id() {\n            return Err(Fault::SlotCodecMismatch.into());\n" }],
    }],
  },
  "unused-link acceptance": {
    where: /Fault::UnusedLink/g,
    sites: [{
      site: "linked chunk parse: link use check",
      edits: [{ file: "core/rs/src/codec/linked.rs", old: "    if unused < nlinks {\n", new: "    if false {\n" }],
      covers: [{ file: "core/rs/src/codec/linked.rs", old: "    if unused < nlinks {\n        return Err(Fault::UnusedLink.into());\n" }],
    }],
  },
};

for (const [core, catalogue] of [["go", GO], ["rs", RS]]) {
  for (const klass of CLASSES) {
    const entry = catalogue[klass.name];
    if (!entry) continue;
    if (entry.where) klass.where[core] = entry.where;
    if (entry.equivalent) (klass.equivalent ??= {})[core] = entry.equivalent;
    klass.mutants.push(...(entry.sites ?? []).map((m) => ({ ...m, core, class: klass.name })));
  }
}
// --- plumbing --------------------------------------------------------------------------------

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: path("."), encoding: "utf8", maxBuffer: 64 << 20, ...options });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

// Core files may be CRLF; the catalogue is written with LF and follows the file.
const originals = new Map();
const original = (file) => {
  if (!originals.has(file)) originals.set(file, readFileSync(path(file)));
  return originals.get(file);
};
const text = (file) => original(file).toString("utf8");
const eol = (file, s) => (text(file).includes("\r\n") ? s.replaceAll("\n", "\r\n") : s);
const count = (haystack, needle) => haystack.split(needle).length - 1;

function restore() {
  for (const [file, bytes] of originals) writeFileSync(path(file), bytes);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (restore(), process.exit(130)));

function plant(mutant) {
  const planted = new Map();
  for (const edit of mutant.edits) {
    const current = planted.get(edit.file) ?? text(edit.file);
    const old = eol(edit.file, edit.old);
    if (count(current, old) !== 1) throw new Error(`${mutant.core} ${mutant.class} @ ${mutant.site}: anchor found ${count(current, old)} times in ${edit.file}`);
    // A function replacer: a `$` in planted code must not be read as a replacement pattern.
    planted.set(edit.file, current.replace(old, () => eol(edit.file, edit.new)));
  }
  for (const [file, s] of planted) writeFileSync(path(file), s);
}

// Every match of a class's pattern must fall inside the planted text of one of its sites.
function uncovered(klass, core) {
  const pattern = klass.where[core];
  if (!pattern) return [];
  const spans = klass.mutants
    .filter((m) => m.core === core)
    .flatMap((m) => [...m.edits, ...(m.covers ?? [])])
    .map((e) => {
      const at = text(e.file).indexOf(eol(e.file, e.old));
      return { file: e.file, from: at, to: at + eol(e.file, e.old).length };
    });
  const missing = [];
  for (const file of CORES[core].files) {
    // Only the core's own code is scanned; a prefix keeps every offset valid in the file.
    const code = (CORES[core].code ?? ((t) => t))(text(file));
    for (const match of code.matchAll(pattern)) {
      const inside = spans.some((s) => s.file === file && s.from >= 0 && s.from <= match.index && match.index < s.to);
      if (!inside) missing.push(`${file}:${text(file).slice(0, match.index).split("\n").length} ${match[0]}`);
    }
  }
  return missing;
}

// The harness against one core: a kill is a failed check, anything else is not.
function judge(core) {
  const r = run("node", ["tools/conformance/harness.mjs", `--only=${core}`]);
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith(`✔ ${core}:`) || l.startsWith(`✖ ${core}:`));
  const tally = line?.match(/: (\d+)\/(\d+)$/);
  if (r.status === 0 && tally) return { outcome: "survived", passed: Number(tally[1]), total: Number(tally[2]) };
  if (r.status === 1 && tally) {
    const failures = r.out.split(/\r?\n/).filter((l) => l.startsWith("    ")).map((l) => l.trim());
    return { outcome: "killed", failed: Number(tally[2]) - Number(tally[1]), total: Number(tally[2]), failures };
  }
  return { outcome: "no verdict", detail: (line ?? r.out.trim().split(/\r?\n/).pop() ?? "").slice(0, 200) };
}

// --- main ------------------------------------------------------------------------------------

const cores = Object.keys(CORES).filter((c) => !only || only.includes(c));
const classes = CLASSES.filter((k) => !classFilter || k.name.includes(classFilter));

for (const core of cores) {
  const dirty = run("git", ["status", "--porcelain", "--", ...CORES[core].files]).out.trim();
  if (dirty) {
    console.error(`mutants: refusing to run on ${core}: uncommitted changes in its core files\n${dirty}`);
    process.exit(2);
  }
  const gaps = classes.flatMap((k) => uncovered(k, core).map((g) => `${k.name}: ${g}`));
  if (gaps.length) {
    console.error(`mutants: ${core} has sites no mutant plants (sites come from the source):\n  ${gaps.join("\n  ")}`);
    process.exit(2);
  }
}

const results = [];
try {
  for (const core of cores) {
    // A compiled core is built from its committed source first: stale output would make
    // the baseline, and every plant after it, about some other source.
    const stale = CORES[core].marker && CORES[core].build().map(([c, a]) => run(c, a)).find((b) => b.status !== 0);
    if (stale) {
      console.error(`mutants: the unmutated ${core} core does not build: ${stale.out.trim().split(/\r?\n/).pop()}`);
      process.exit(2);
    }
    const baseline = judge(core);
    if (baseline.outcome !== "survived") {
      console.error(`mutants: the unmutated ${core} core does not pass the harness: ${JSON.stringify(baseline)}`);
      process.exit(2);
    }
    console.log(`${core}: unmutated core passes ${baseline.passed}/${baseline.total}`);
    const reached = CORES[core].reach?.();
    if (reached) console.log(`${core}: the corpus executes ${reached.size} lines of the core`);
    for (const klass of classes) {
      for (const mutant of klass.mutants.filter((m) => m.core === core)) {
        plant(mutant);
        let result;
        const built = CORES[core].build([...new Set(mutant.edits.map((e) => e.file))]).map(([c, a]) => run(c, a));
        const broken = built.find((b) => b.status !== 0);
        result = broken ? { outcome: "no verdict", detail: `does not build: ${broken.out.trim().split(/\r?\n/).pop()}` } : judge(core);
        restore();
        const reach =
          reached ? (lines(mutant).some((l) => reached.has(l)) ? "reached" : "never reached")
          : CORES[core].marker ? probe(core, mutant)
          : "unmeasured";
        results.push({ core, class: mutant.class, site: mutant.site, reach, outside: mutant.outside, ...result });
        const r = results.at(-1);
        const said =
          r.outcome === "killed" ? `killed, ${r.failed} of ${r.total} checks failed; first: ${r.failures[0] ?? "?"}`
          : r.outcome === "survived" && r.outside ? `survived, outside the corpus's scope: ${r.outside}`
          : r.outcome === "survived" ? `SURVIVED: no corpus check failed (site ${r.reach} by the corpus)`
          : `no verdict: ${r.detail}`;
        console.log(`  ${mutant.class} @ ${mutant.site}: ${said}`);
      }
    }
  }
} finally {
  restore();
}

// A compiled core's build output is not tracked, so restoring its source is not enough: it
// is rebuilt from the restored source and must pass the harness again.
for (const core of cores) {
  if (!CORES[core].marker) continue;
  const broken = CORES[core].build().map(([c, a]) => run(c, a)).find((b) => b.status !== 0);
  const closing = broken ? { outcome: "does not build" } : judge(core);
  if (closing.outcome !== "survived") throw new Error(`mutants: ${core} rebuilt from its restored source does not pass: ${JSON.stringify(closing)}`);
}

// Restored means byte-identical to what was read, and git agrees.
for (const [file, bytes] of originals) {
  if (!readFileSync(path(file)).equals(bytes)) throw new Error(`mutants: ${file} was not restored`);
}
const residue = run("git", ["status", "--porcelain", "--", ...cores.flatMap((c) => CORES[c].files)]).out.trim();
if (residue) throw new Error(`mutants: core files differ from HEAD after the run:\n${residue}`);

// The reach measurement's own control: a defect the corpus killed was at a site the corpus
// executed. A kill at a "never reached" site means the measurement, not the corpus, is wrong.
const impossible = results.filter((r) => r.outcome === "killed" && r.reach === "never reached");
if (impossible.length) {
  throw new Error(`mutants: the reach measurement is broken, it calls killed sites unreached: ${impossible.map((r) => `${r.core} ${r.site}`).join("; ")}`);
}

// A kill that rests on this many failed checks or fewer is one case edit from a survivor:
// it is listed, so a reader sees where the corpus is only one case deep.
const THIN = 2;
const killed = results.filter((r) => r.outcome === "killed");
const thin = killed.filter((r) => r.failed <= THIN);
const survived = results.filter((r) => r.outcome === "survived" && !r.outside);
const outside = results.filter((r) => r.outcome === "survived" && r.outside);
const unjudged = results.filter((r) => r.outcome === "no verdict");
console.log(
  `mutants: ${results.length} planted, ${killed.length} killed (${thin.length} thin, by ${THIN} checks or fewer), ` +
    `${survived.length} survived, ${outside.length} survived outside every profile, ${unjudged.length} without a verdict`,
);
for (const s of survived) console.log(`  survivor: ${s.core} ${s.class} @ ${s.site} (site ${s.reach} by the corpus)`);
for (const t of thin) console.log(`  thin: ${t.core} ${t.class} @ ${t.site}, killed by ${t.failed} of ${t.total} checks`);
for (const core of cores) {
  for (const klass of classes) {
    const why = klass.equivalent?.[core];
    if (why) console.log(`  not planted: ${core} ${klass.name}, an equivalent mutant (${why})`);
  }
}
process.exit(survived.length || unjudged.length ? 1 : 0);
