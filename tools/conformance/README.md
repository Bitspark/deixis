# Black-box conformance

**Model scope (2026-09-23):** all four cores implement the required `T` of
[ADR 0010](../../docs/design/0010-mandatory-node-values.md). `mnode.*` exercises
the 121 independently authored cases of [MNODE-PLAN.md](../../vectors/MNODE-PLAN.md),
with each request declaring its payload carrier and equivalence. `required.*`
adds 14 direct fixture-payload checks. The earlier `node.*` and `core.*`
protocol explicitly exercises `Node[Option[T]]` and lifted option equality.

The harness ([`harness.mjs`](harness.mjs), dependency-free Node) owns the vector files
and the expected judgments; the per-language CLIs (`conformance/{rs,go,ts,py}`) own
nothing but their implementation. The harness sends each case *minus its expectation*,
the CLI answers with its own judgment, and the harness compares. No CLI ever reads a
vector file — which is what makes this a black-box check rather than a replay.

Run from the repo root (build `core/ts`, `pos/ts`, `set/ts`, and the rs CLI first):

```sh
node tools/conformance/harness.mjs            # all four implementations
node tools/conformance/harness.mjs --only=rs,py
```

## Protocol

`mnode.*` uses the operation names and fields in
[MNODE-PLAN.md](../../vectors/MNODE-PLAN.md). Its equality response is
`{"equal": bool}`; other operations return `{"result": value}` where `value`
has the operation's declared total or partial result shape. Slots are fixture,
option, unit, JSON, tagged sum and optional tagged sum. Each CLI stores the
whole decoded payload in the core and supplies the slot relation to core
equality. The harness judges payloads under that relation and structure by exact
key domains. It strips `result`, `equal`, names and notes before sending a case.
It never sends expected judgments to an implementation.

NDJSON over stdio: one JSON object per line in, one per line out, until EOF. Every
request carries an opaque string `id`, echoed verbatim in the response. Order of
responses need not match order of requests. A CLI that cannot serve an op answers
`{"id": …, "error": "unsupported"}`; a malformed line is a CLI defect (stderr +
nonzero exit).

Node and member spellings are exactly those of [`vectors/README.md`](../../vectors/README.md)
and [`vectors/NODE-PLAN.md`](../../vectors/NODE-PLAN.md). The `required.*` operations
use direct fixture payloads:
`{"own": {"class": "…", "representation": "…"}, "children": [[hexKey, node], …]}`.
The `core.*` and `node.*` operations explicitly exercise `Node(Option(T))`,
with `own` spelled `{"none": {}}` or `{"some": payload}` and conventional lifted
option equality. Fixture payload equality compares `class`; set nodes follow
their member sort. Bytes are lowercase hex.
**A request with `"embedded": true`** spells every node field in the
previous model (`{"leaf"}` / `{"struct"}`), and the CLI reads it through the embedding E
of [ADR 0009](../../docs/design/0009-optional-node-values.md) §10.1; no other request is
read in the previous model.

| op | request fields | response |
| --- | --- | --- |
| `required.equal` | `left`, `right` (direct-payload nodes) | `{"equal": bool}` |
| `required.roundtrip` | `tree` | a result: compose after decompose |
| `required.at` | `tree`, `path` | a result: the selected subtree |
| `required.valueAt` | `tree`, `path` | a result: the complete payload |
| `required.attach` | `tree`, `parent`, `key`, `subtree` | a result: the whole attached tree |
| `core.equal` | `left`, `right` (fixture nodes); `embedded`? | `{"equal": bool}` |
| `core.build` | `node`; `embedded`? | `{"ok": true}` or `{"error": "duplicate_key", "key": hex}` |
| `pos.key` | `position` (decimal string) | `{"key": hex}` |
| `pos.isKey` | `bytes` (hex) | `{"isKey": bool}` |
| `set.form` | `member`, `members`, `node`; `embedded`? | `{"equal": bool, "recognized": bool}` or `duplicate_key` as above |
| `set.recognize` | `member`, `node`; `embedded`? | `{"isSet": true}` or `{"isSet": false, "reason": code}` |
| `set.membership` | `member`, `members`, `queries` | `{"in": [bool, …]}` |
| `set.identity` | `member`, `left`, `right`; `embedded`? | `{"equal": bool}` |
| `node.at` | `tree`, `path` | a result: the node found |
| `node.valueAt` | `tree`, `path` | a result: the own value found, `{"none": {}}` or `{"some": payload}` |
| `node.atCompose` | `tree`, `first`, `then` | a result: `at(at(tree, first), then)` |
| `node.attach` | `tree`, `parent`, `key`, `subtree` | a result: the whole attached tree |
| `node.attachCommute` | `tree`, `parent`, `first` and `second` (each `{key, subtree}`) | `{"forward": result, "reverse": result}`: the two attachment orders |
| `node.decompose` | `tree` | a result: `{"parts": {"own": …, "children": […]}}` |
| `node.compose` | `parts` | a result: the node, or `duplicate_key` as above |
| `node.split` | `tree`, `path` | a result: `{"context": node with one hole, "subtree": node}` |
| `node.plug` | `context` (one `{"hole": {}}`), `subtree` | a result: the plugged tree |
| `node.cut` | `tree`, `paths` | a result: `{"skeleton": node with holes, "subtrees": [[path, node], …]}` |
| `node.rebuild` | `skeleton`, `subtrees` | a result: the rebuilt tree |
| `node.embed` | `old` (a previous-model node) | a result: E(old) |
| `node.unembed` | `tree` | a result: the previous-model node E maps to `tree` |

A path is a list of hex keys. **A result is `{"defined": value}` or `{"undefined": {}}`**
— the partial operations of ADR 0009 say *when* they are undefined and never *why*, so no
refusal reason is spelled ([NODE-PLAN.md](../../vectors/NODE-PLAN.md)). `member` is the
member-encoder id from `vectors/set.json` (`bytes` or `class`). `set.form` builds from
`members` in given order, then judges equality against `node` under the sort's `≈` and
recognition of the built set — the expected node is data to compare against, never a
judgment.

**The node operations that are not accessors of the floor are derived in the CLIs.**
Replacement, attachment, split and plug, cuts, E and its inverse are written in each CLI
through the core's accessors (compose, decompose, own, the children, at). That is the
claim [PATH.md](../../docs/PATH.md) makes of them — derivable, and no methods of the floor
— so these vectors exercise the accessors through a derivation. A core whose `decompose`
drops an own value, or whose `at` invents a child, fails here although the derivation is
correct.

**Results are judged here, not in the CLI.** A CLI answers with the spelling of its
result, and the harness compares it with the expected spelling under the structural
equality of `node-identity.json`: `≈` on payloads compares `class` only, keys are exact
lowercase hex, children are a finite map whose order is ignored and in which a repeated
key is a malformed answer, and a hole equals only a hole. So no expectation reaches a CLI
for these operations either.

**A refusal pins its reason only on a node with exactly one defect**
([0005](../../docs/design/0005-set-keys.md)): a `set.recognize` case with a `reason` is
judged on the reason as well as the verdict, and a case without one on the verdict alone,
never as "expect no reason".

## Binding protocol (`deixis-binding-scripted`)

[`binding.mjs`](binding.mjs) replays [`binding-scripted.json`](../../vectors/binding-scripted.json),
the scripted laws of [ADR 0013](../../docs/design/0013-binding-views-and-the-service-line.md)
§2, §3 and §5. Binding is not a deixis API. Each CLI answers these operations from a
scripted harness over its core's native node, which it builds and reads through compose,
decompose and at. A node's own value is a name, spelled as hex. A request is
`{"name": hex, "origin": γ, "at": [hex key, …]}`: the exact name bytes, the context and the
path from the original root. A binder is a script, `[[hex name, outcome], …]`, and records
every name it is asked for. A name the script does not list is refused as `unrecognized`.

| op | request fields | response |
| --- | --- | --- |
| `binding.prepare` | `node`, `context` | a result: the prepared tree |
| `binding.at-after-prepare` | `node`, `context`, `path` | a result: `{"prepare-then-select": r, "select-then-prepare": r}`, each `r` defined or undefined |
| `binding.resolve-at` | `node`, `context`, `path`, `binder` | a result: `{"outcome": o, "consulted": [hex name, …]}`, where `o` is `{"absent": {}}` or the binder's outcome |
| `binding.resolve-all-or-fail` | `node`, `context`, `binder` | a result: `{"outcome": {"failed": o} or {"bound-tree": node}, "consulted": […]}` |

An outcome is `{"bound": id}`, `{"refused": reason}`, `{"fault": cause}` or
`{"cancelled": {}}`. The harness judges trees structurally, with children as a finite map
whose order is ignored. Requests, outcomes and ids compare exactly, and `consulted` compares
as an ordered list. Both sides of the law are judged against the one expected result, so a
CLI that computes only one side fails. The file's description states its case count, and
the harness refuses the run (exit 2) when the file holds a different number.

## Projection protocol (`deixis-projection-scripted`)

[`projection.mjs`](projection.mjs) replays
[`projection-scripted.json`](../../vectors/projection-scripted.json): the projection of
[IDENTITY.md](../../IDENTITY.md) ID9, its composition inside one tree (ID10), and the rows of
ID2 and ID4 it rests on. Projection is not a deixis API (ID8). Each CLI answers these
operations from a scripted harness over its core's native node, which it builds and reads
through compose, decompose and at only. A node's own value is a capability id, spelled as hex.
A fixture is initialised from `node` and `world`: one live capability object per distinct id,
used as the own value wherever that id occurs, and a fresh log. `world` is
`[[hex id, behaviour], …]`, a behaviour being `{"ok": s}`, `{"refused": r}`, `{"fault": c}` or
`{"count": {}}` (it answers `{"ok": "<n>"}`, n the number of invocations that object has
received). An id the world does not list faults as `unscripted`. Every invocation appends
`[hex id, hex args]` to the log; the argument bytes reach the capability unchanged.
`lift(N, p, args)` answers `{"missing-path": {}}` without invoking anything when `at(N, p)` is
absent, and otherwise invokes the selected node's own capability exactly once.

| op | request fields | response |
| --- | --- | --- |
| `projection.lift` | `node`, `world`, `path`, `args` | a result: `{"outcome": o, "invocations": [[hex id, hex args], …]}` |
| `projection.lift-cut` | `node`, `world`, `prefix`, `suffix`, `args` | a result: `{"select-then-lift": r, "lift-concat": r}`, each `r` an `{outcome, invocations}` pair from its own fixture |
| `projection.lift-sequence` | `node`, `world`, `steps` (`[[path, hex args], …]`), `reconstruct` | a result: `{"outcomes": [o, …], "invocations": […]}` from one fixture, rebuilt through decompose and compose first when `reconstruct` is true |
| `projection.keys-after-mutation` | `node` (plain hex own values), `probes` | a result: `{"found": [bool, …]}`, after every key buffer the harness handed to compose was XORed with `ff` |

An outcome is `{"ok": s}`, `{"refused": r}`, `{"fault": c}` or `{"missing-path": {}}`, and
compares exactly. A log compares as an ordered list. Both sides of `lift-cut` are judged
against the one expected pair, so a CLI that computes only one side, or both on one fixture,
fails. `keys-after-mutation` hands compose buffers the harness can still write: a `bytearray`
in Python, a `[]byte` in Go, a `Uint8Array` in TypeScript, and a `Vec<u8>` by reference in
Rust, whose `Node` keeps owned keys and so copies by construction; there the two cases pass
trivially. The file's description states its case count, and the harness refuses the run
(exit 2) when the file holds a different number.

## Codec protocol (`deixis-codec-v2`)

**Specified 2026-09-23; replayed on every run since all four CLIs serve it.** The harness
replays the four `codec-v2-*.json` files through [`codec.mjs`](codec.mjs), which plans
every request and judges every answer. `--no-codec` runs the node corpus alone.

| op | request | response |
| --- | --- | --- |
| `codec.encodeFlat` | `slot_codec` (id hex), `node` | `{"bytes": hex}` |
| `codec.decodeFlat` | `bytes`, `holding`; `cuts`?, `end`? | `{"value": node}` or `{"verdict": v}` |
| `codec.readHeader` | `bytes`, `holding`; `cuts`?, `end`? | `{"header": {"slot_codec": hex}}` or `{"verdict": v}` (flat-header-validator) |
| `codec.encodeLinked` | `slot_codec`, `node` | `{"root": address, "chunks": [[digest, hex], …]}` |
| `codec.resolve` | `root` (address), `chunks` ([[digest, hex], …]), `holding`, `budget` | `{"value"}`, `{"verdict"}` or `{"store": {"code", "digest"}}` |
| `codec.checkClosure` | `root`, `chunks` | `{"ok": true}`, `{"verdict"}` or `{"store"}` (closure-checker: no `D`, so no `holding`) |
| `codec.flatten` | `root`, `chunks`, `holding`, `budget` | `{"bytes": hex}`, `{"verdict"}` or `{"store"}` |
| `codec.navigate` | `root`, `chunks`, `holding`, `path` ([key hex, …]) | `{"node": {"own", "children": [[key, digest], …]}}`, `{"absent": i}`, `{"verdict"}` or `{"store"}` |

A verdict `v` is `{"class", "code"}`: `class` is one of §9's `invalid`, `unsupported`,
`incomplete` or `resource-refused`, and `code` is its §9 code. `limit_exceeded` adds
`dimension`, a §12 token. An address is `{"space": "dxl2", "digest": hex}` (§7).

- **A codec is named by its id.** The id is the contract's only name for a codec and lies
  inside the octets compared. `option-of` is built by parsing `02 ‖ id`, which a bundle
  name would let a CLI skip. The vector files keep `bundle` as a label for readers.
- **`holding` is explicit on every decoding request.** It lists the base ids the decoder
  holds for that request; option-of over a held id is held (§13). §2.1 makes holding a
  modifier that changes which verdict is correct, so the request carries it, and a CLI
  acts codec-blind on request.
- **The chunk set is an untrusted store.** A pair's digest need not be the SHA-256 of its
  octets. That is how §14's anchor is tested: the root is verified against the address
  requested, each child against its parent's link hash. `missing_chunk` and
  `hash_mismatch` travel under `store`, never as a `verdict`: §9 says they are not decoder
  verdicts, and an answer that makes them one is judged a failure. `address_conflict` needs
  a SHA-256 collision to arise honestly and is not requested.
- **The harness chooses the cuts.** `cuts` are ascending interior offsets. The CLI feeds
  the pieces in order to its streaming decoder, declares end of input after the last iff
  `end`, and reports the final state only: §14 pins the final verdict, not intermediate
  ones. A CLI whose core has no streaming decoder answers `unsupported` to a request with
  `cuts`, and that is reported as not served. If the CLI chose its own splits, one that
  tried none would pass unseen.
- **No request carries a local limit.** A local limit makes a verdict
  implementation-relative. `budget` appears only where §12 and §14 require an explicit
  caller budget (`resolve`, which spells the whole value, and `flatten`). It maps §12
  tokens to decimal strings, and a dimension it does not name is at its floor. Every
  corpus artifact is below every floor, so `limit_exceeded` on any ordinary case is a
  failure. Each request has a wall-clock bound, which is what makes "before
  materialization" observable on the sharing bomb.
- **Encoded chunk sets are compared as sets keyed by digest.** The harness recomputes
  every digest, and a repeated digest is a malformed answer.
- **`codec.navigate` is §14's two constructors, and nothing else.** It resolves the root
  once against the requested address, then resolves one child per key in `path`: the
  entry whose key equals it octet for octet, fetched by that entry's link hash and
  verified against it, with the child's id checked against the parent's. It fetches
  nothing off the path and materializes nothing, so it takes no `budget` (§12 budgets
  materialization and flattening) and can never report an `unfolded_*` dimension. The
  answer is the reached chunk's own value and its entries, each with its link digest, or
  `absent` with the index of the first key no entry has. Cases that walk into the sharing
  bomb go to the timed drive, where a navigator that materializes never answers.
  **Sent on every run** since all four CLIs serve it; `--no-navigate` leaves it out.
  A case whose answering chunk is not identity-bytes names its `slot_codec`, and the harness
  judges the own value under that id; the request itself is unchanged.

**Derived requests.** From each flat case the harness also sends every single cut point
and byte-at-a-time, each expected to equal the whole-buffer verdict (§14). From each
accepted artifact it sends every prefix with the stream open, the whole artifact included,
expecting `need_more_input`: §14 makes a complete root with the stream open
`need_more_input` too (F4). Closed prefixes are not derived. Their code depends on whether
the cut falls inside a varint, and knowing that would need a decoder in the harness. The
vector files carry the closed cases they need. Nothing here parses the codec.

**Cross-implementation interchange** (seeded values, identical octets across all four,
cross-decoding, law 1 checked in both directions) is the codec lane's, in its own file.
It is agreement, not conformance: four cores from one author can share a misreading,
which is what this independent corpus exists to catch. Its counts are not in this
harness's totals.

## The corpus is one namespace

Vector files are loaded as a **corpus**, not one at a time, and the load runs to
completion *before* the first request reaches any implementation. Three invariants are
asserted there, all loud:

- **A case `name` is an identifier, unique across every vector file.** A collision
  fails the run (exit 2) — bridge assertions resolve by name, so a duplicate makes a
  reference ambiguous. Renaming a referenced case is therefore a breaking act, not an
  edit.
- **A `ref` naming no case fails the run**, never a skipped assertion. This is the
  enforcement half of [CODEC-PLAN.md](../../vectors/CODEC-PLAN.md) ruling 1: bridge
  cases carry the flat octets by reference rather than inline, because two copies of one
  byte string drift silently — but that ruling is only real if a broken reference cannot
  reach a green run. A vanished bridge that reads green is worse than one never written.
- **A law that re-reads another file by reference refuses when the counts it pins have
  moved** (exit 2). `node-embedding.json`'s embedded-identity law pins `identity.json`'s
  cases and verdicts, and `node-set.json`'s five laws pin `set.json`'s cases per kind,
  including the recognize reasons. A mismatch is an erratum to the source, which a person
  must re-check, so the law is never silently re-run over a changed source.

The run prints what it resolved (`corpus: N named cases over M files (… replayed, …
indexed only …), names unique, references resolved, pinned laws hold`) so the assertion
is visible rather than silent. The first two arms are red-proved: a duplicate name and a
dangling ref each exit 2 with a message naming the offending case, against a control run
that exits 0. The third was red-proved on 2026-09-23 on the branch that introduced it:
`source_equal` pinned at 9 instead of `identity.json`'s 8, and `set.json`'s recognize law
pinned at `mis_keyed` 2 instead of 1, each exit 2 with a message naming the law, against a
control run at 209/209 in each implementation.

**What is replayed, and what is only indexed.** The cores implement required `T`
([ADR 0010](../../docs/design/0010-mandatory-node-values.md)). The 121 independent
`mnode-*.json` cases and 14
`required-node.json` cases exercise that contract directly; the seven
`node-*.json` files exercise its explicit optional specialization.
`identity.json` and `set.json` are replayed through E on
`embedded` requests, under the laws that pin them. `positional.json` spells keys and is
replayed as it is. `binding-scripted.json` is replayed through `binding.mjs`, and
`projection-scripted.json` through `projection.mjs`. The four `codec-v2-*.json` files are
replayed through `codec.mjs`.
Indexed and not replayed, and said on every run: the four v1 codec files, because
`deixis-codec-v1` is withdrawn and never had an implementation, and `invalid.json`, the previous
model's construction refusals, because no law re-reads it in the optional specialization. Replaying
it through E anyway would check an expectation that no fixture states; `node-invalid.json`
pins duplicate-key refusals in that specialization. The current total is 3248
requests per implementation over 24 replayed files, 2833 of them the v2 codec's, 19 the
binding family's and 28 the projection family's, and the envelope drive adds 13 checks: 3261
per implementation.
