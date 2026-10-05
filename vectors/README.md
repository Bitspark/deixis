# Vectors

Hand-authored conformance vectors. Every judgment in these files is computed from the
spec — [TREE.md](../docs/TREE.md) and the design records — never copied from an
implementation's output. No implementation is the reference; **the spec and these
files jointly define conformance** — the vectors are the executable oracle for the
cases they cover (a finite set cannot determine behavior on every unseen byte
string), and on apparent conflict the precedence is: normative algorithms and
grammar, then semantic laws, then vectors, then explanatory prose — a vector never
overrides a clear clause (refined 2026-08-08 per external advice,
research-docs/0001). Judgments are append-only except an explicit erratum; after a
freeze, a behavior-changing ambiguity is a recorded defect for a successor, never
silently "clarified" by a new vector.

Bytes are spelled as lowercase hex strings throughout (`"6b6579"`), the empty byte string
as `""`.

**Conformance claims are scoped** ([CODEC.md](../docs/CODEC.md) §16): a green run over
a subset of these files is evidence for that subset and nothing more. Full
`deixis-codec-v2` conformance requires both forms and the bridge between them; software
implementing a subset MUST claim it by naming the §2.1 profiles it implements —
"flat-encoder + flat-decoder" — and MUST NOT read a partial green as the whole. The v2
corpus is planned in [CODEC-V2-PLAN.md](CODEC-V2-PLAN.md). All four cores implement it,
and the harness replays it against each on every run. The v1 files, planned
in [CODEC-PLAN.md](CODEC-PLAN.md), are the withdrawn candidate's evidence and are never
replayed. The harness indexes both for names and references, and says what it replays on
every run.
<!-- claim holds: `node tools/conformance/harness.mjs` contains 4 of them the v2 codec's -->

> ⛔ **THIS SENTENCE READ *"and not yet authored"* FOR FOUR DAYS AFTER `4f067aa` AUTHORED
> IT**, and the codec lane found it by following a citation *to* here. ⇒ **A second
> direction of citation drift, and the harder one**: direction 1 is *the artifact moved and
> the citation did not*; this is ***the citation was faithful and the SOURCE was stale.***
> A reader checking the copy against its source finds agreement and both are wrong, and the
> copy inherits the defect **by doing exactly the right thing**. ⚠ Nothing built on
> 2026-09-03 finds this: `claimcheck` re-runs what a page quotes, `rotcheck` reads numbers
> and dates, and neither asks whether an unquoted assertion about the tree is still true.

## Who receives this corpus, and when

**This corpus is public, and an implementer commissioned to read the specification alone
does not receive it until their reading is committed.** Freeze step 3
([0007](../docs/design/0007-clean-room-commission.md)) commissions one clean-room
implementation built from [CODEC.md](../docs/CODEC.md), and the deliverable it buys is the
implementer's *ambiguity log*, every place the specification failed to decide something.
A vector silently teaches the reading it encodes, so an implementer holding this corpus
resolves ambiguities against the fixtures without noticing one existed, and the log comes
back empty of exactly the findings the commission pays for.

**The withholding is per implementer, not per repository.** While this repository was
private, that privacy enforced it. The operator ruled on 2026-10-04 that the repository goes
public, with the corpus, for a reason that also settles the question: 0007's brief
withholds the corpus, the four implementations *and* the design records, and the
implementations and design records were going public anyway. Keeping only the corpus
private would have protected nothing. Both external consultations on the codec (which are
not themselves published) already describe the protocol that remains: give the implementer
the specification first, with the vectors withheld during the initial implementation, and
reveal them once the implementer's interpretation package is committed.

So the commission rests on two things, and 0007 states both in full: the implementer's
undertaking not to consult this repository, its vectors or its implementations before
their reading is committed, and the lineage record, in which they disclose anything they
saw. That is weaker than access control, and it is stated here so nobody mistakes it for
access control: a disclosed glimpse is evidence, while an undisclosed one silently voids
the reading.

This constrains the commission only. It is not a reason to slow authoring: steps 3 and 4
are ordered against each other so the corpus can grow at full speed while a commission
runs.

## The fixture setoid

Identity in deixis is lifted from the slot, so identity vectors must fix a slot — and fix
one whose equality is visibly *not* native object equality, or the vectors could not tell
a lifted relation from a lazy one. The fixture setoid is:

```text
carrier:  { class: String, representation: String }
≈:        left.class = right.class   (exact byte equality of the class strings)
```

`representation` is deliberately ignored by `≈`. An implementation that compares leaves
natively — object identity, deep structural equality, JSON equality — fails every case
whose representations differ while classes agree. Class strings in these files are ASCII,
so string equality is unambiguous across languages, except in the `deixis-codec-v2`
cases below, which carry two non-ASCII classes (U+00E9 and U+1F600) on purpose.

**As a slot codec** (the `codec-v2-*.json` bundle `fixture-setoid`), `e` is the UTF-8 of
`class`, and `D` accepts exactly the well-formed UTF-8 of RFC 3629: no overlong form, no
encoded surrogate (U+D800 to U+DFFF), and nothing above U+10FFFF. Any other octet string
is outside `im(e)` and is `non_canonical_payload`. The corpus pins each exclusion with one
case (`c0 80`, `ed a0 80`, `f4 90 80 80`), and pins two multi-octet classes that must be
accepted.

## Node spelling

The current core's direct-payload cases in `required-node.json` spell a node as:

```json
{ "own": { "class": "…", "representation": "…" }, "children": [["<hex key>", "<node>"], "…"] }
```

`node-*.json` uses the explicit `Node(Option(T))` specialization, with `own`
spelled `{"none": {}}` or `{"some": payload}`. Its conventional option
equivalence is supplied by each CLI, not the core. See [NODE-PLAN.md](NODE-PLAN.md).

The historical `identity.json` and `set.json` spell a node as one of:

```json
{ "leaf":   { "class": "…", "representation": "…" } }
{ "struct": [ ["<hex key>", <node>], … ] }
```

Struct entries are written in deliberate **insertion order**, which is not sorted order in
several cases. A replayer must feed entries to its constructor in file order; the
construction owns sorting and duplicate detection. Insertion order is otherwise
unobservable — that is one of the properties under test.

## A layout invariant, before the codec corpus exists

**Keep every replay test inside the module that owns the corpus** — or the test can pass
without reading it.

Measured 2026-08-30 on `ontos`, whose projection face is a **separate Go module on
purpose** and whose test reads `../vectors/ontos-projection.json` — one level *above* its
own module root. Go's test cache hashes the files a test opens **only within the module**,
so a corpus outside it is invisible to the cache key: falsify a golden, and `go test`
serves the previous PASS. Their red-proof of a corpus fix was void and read as green.

⭐ **This repo is currently SAFE, and by accident rather than design:**

```
deixis   go.mod at the repo root
         core/go reads ../../vectors/identity.json     INSIDE the module   -> tracked
         MEASURED: flip one `equal` verdict, bare `go test ./core/go/` FAILS. Control: ok.

ontos    go.mod at projection/deixis/go/  (nested)
         reads ../vectors/ontos-projection.json        OUTSIDE that module -> NOT tracked
```

⇒ **The exposure arrives the moment any face becomes its own module while the corpus stays
at `vectors/`.** The codec is getting `rs`/`go`/`ts`/`py` faces; if one of them is split out
— which is a reasonable thing to want — this repo inherits the hazard silently, and the tell
is a red-proof that cannot fail.

**So state it as a property of the layout, not a flag to remember:** a replay test reads its
corpus from inside its own module, or it passes `-count=1`. The first is checkable by
looking at two paths; the second is a habit, and habits are what this corpus is being built
to not depend on.

⚠ **Go is the measured case. The mechanism is not Go-specific** — any toolchain that caches
test results on a dependency graph it computes from *source* will miss a data file the test
opens at run time. Check the equivalent for `cargo`, `node --test` and the Python runner
before trusting a green replay of a corpus you just changed.

⭐ **The boundary claim is now a CONTROLLED result, not a two-repo comparison.** Mine
compared `deixis` against `ontos`, which differ in many ways at once. The ontos maintainer then ran
both arms **inside one repo with the boundary as the only variable**: their root module
reads `../../../vectors/*.json` — paths that resolve *inside* it — and falsifying a golden
FAILS the bare `go test`; their nested `projection/deixis/go` module reads a corpus above
its own root and returns a **cached PASS**. Same tool, same tree, one variable.

They also swept every `go.mod` in that repo: **exactly one exposed module**, the one that
bit them. That is what the narrow rule buys — it turns "probably fine elsewhere" into a
sweep that finishes.

*Found by an ontos maintainer, who hit the void red-proof and sent the warning; the module
boundary was identified here after their finding did not reproduce on this tree, and
red-proved by them on theirs. **A non-reproduction is the result nobody publishes, and it is
what made the mechanism findable** — agreement would have left the blanket rule standing.
Landed by the codec lane (2026-08-30) as a note to whoever authors the codec
corpus — the constraint binds the harness, and this is where its reader arrives.*


## Files

- **The independent mandatory family** ([MNODE-PLAN.md](MNODE-PLAN.md)):
  `mnode-identity`, `mnode-navigation`, `mnode-map`, `mnode-parts`, `mnode-attach`,
  `mnode-instantiation` and `mnode-invalid` `.json`. All 121 cases run in the
  shared harness against all four cores, using each case's declared slot.
  Identity is checked in both directions, giving 145 requests per language.
- **The scripted binding family** ([ADR 0013](../docs/design/0013-binding-views-and-the-service-line.md)
  §10 item 1): [`binding-scripted.json`](binding-scripted.json), `deixis-binding-scripted`.
  Its 19 cases cover the two-stage binding of §2, the outcome classes of §3 and the
  structural rows of §5. Binding is not a deixis API, so each conformance CLI answers its
  four operations from a scripted harness over its core's native node, and the file's
  description defines them. Own values are names, spelled as hex. A binder is a script table
  that records every name it is asked for, so a case can require that selection asked it
  nothing. The file's `spec` field cites ADR 0013, and `tools/pincheck.py` checks each
  case's `pins` against that record. All 19 cases run in the shared harness against all
  four cores, one request each, and the harness refuses the run when the description's
  stated count differs from the file's.
  <!-- claim holds: `python -c "import json; print(len(json.load(open('vectors/binding-scripted.json',encoding='utf-8'))['cases']))"` == 19 -->
- **The scripted projection family** ([IDENTITY.md](../IDENTITY.md) ID9 and ID10, research
  0006's R25a, [ADR 0015](../docs/design/0015-deixis-identity.md) §7):
  [`projection-scripted.json`](projection-scripted.json), `deixis-projection-scripted`. Its 28
  cases cover the projection `lift(N, p, args)`, its composition inside one tree at every cut,
  and the rows of ID2 (a caller's key buffer) and ID4 (reconstruction keeps handles and
  aliasing) it rests on. Projection is not a deixis API either, so each conformance CLI
  answers its four operations, `lift`, `lift-cut`, `lift-sequence` and `keys-after-mutation`,
  from a scripted harness over its core's native node, and the file's description defines
  them. Own values are capability ids, spelled as hex. Each fixture makes one live
  capability object per distinct id, so two positions holding one id hold one object, and a
  world script gives each capability an `ok`, `refused`, `fault` or `count` behaviour.
  Every invocation is logged as `[id, args]`.

  **The observation model O** that ID10's `≃_O` compares under is declared in the
  description. Observed: each lift's outcome, and the fixture's log, which capability object
  by id, with which argument bytes, in which order. Not observed: timing, the identity of a
  result object, and the harness's internals. The two sides of a `lift-cut` case run on
  separately initialised fixtures, with fresh capability objects and a fresh log, so a
  `count` capability answers 1 on each side.

  `keys-after-mutation` builds the tree from key buffers the harness owns, then XORs every
  one of them with `ff` and probes. Python hands `compose` a `bytearray`, Go a `[]byte`,
  TypeScript a `Uint8Array`. Rust hands it each `Vec<u8>` by reference, but `Node` keeps
  owned keys with no lifetime, so it copies by construction and the Rust core passes these
  two cases trivially. The file's `spec` field cites IDENTITY.md, and `tools/pincheck.py`
  checks each case's `pins` against it. All 28 cases run in the shared harness against all
  four cores, one request each, and the harness refuses the run when the description's
  stated count differs from the file's.
  <!-- claim holds: `python -c "import json; print(len(json.load(open('vectors/projection-scripted.json',encoding='utf-8'))['cases']))"` == 28 -->
- [`identity.json`](identity.json) — `deixis-core-identity`. Cases
  `{ name, left, right, equal, note }`: build both nodes, judge them with the fixture
  equality, expect exactly `equal`. Equality is symmetric; replayers should assert both
  directions.
- [`invalid.json`](invalid.json) — `deixis-core-invalid`. Cases
  `{ name, node, error, key, note }`: constructing the node must fail with the stable
  rejection code `error` (`duplicate_key`), reporting the duplicated key bytes `key`.
  Construction of every *other* spelling in these files must succeed — near-duplicates
  (`01` vs `0100`) are distinct keys, and their distinctness is pinned in
  `identity.json`, not here.
  It is indexed and no longer replayed: no `node-*.json` law re-reads it,
  and `node-invalid.json` pins duplicate-key refusals in the optional specialization.
- [`positional.json`](positional.json) — `deixis-pos-v1`, the position spelling κ of
  [0002](../docs/design/0002-positional-keys.md). See its embedded description.
- [`set.json`](set.json) — `deixis-set-v1`, slot-member form
  ([0005](../docs/design/0005-set-keys.md)). Cases carry a `member` naming the encoder
  and a `kind` selecting the check:
  - `form` — build the set from `members` in authored order; the result must equal
    `node` under node identity (and must recognize as a set).
  - `duplicate` — building must fail `duplicate_key` at the spelled `key`
    (idempotence-by-construction).
  - `recognize` — judge `node` against the slot-member image: `valid`, with `reason`
    (`mis_keyed` | `struct_member` | `leaf_node`) when refused.
  - `membership` — build from `members`, then each query's `in` is decided by one
    lookup at `e(value)`.
  - `identity` — judge `left`/`right` with the member sort's `≈`, both directions.

  These reasons describe the previous model. N[T] adds `valued_set_node` and
  `member_with_children`, which apply only to shapes the previous model could not spell
  ([0005](../docs/design/0005-set-keys.md)); they are pinned in `node-set.json` below.
- **The direct-payload family** ([ADR 0010](../docs/design/0010-mandatory-node-values.md)):
  `required-node.json`, 14 cases covering reconstruction, navigation, exact
  attachment, caller equivalence and tag-looking opaque payloads. Expectations
  never reach the CLI. Native tests additionally check callable payloads and
  equality relations over entire optional values.
- **The optional-specialization family** (originating in
  [ADR 0009](../docs/design/0009-optional-node-values.md)):
  `node-identity`, `node-navigation`, `node-attach`, `node-parts`, `node-embedding`,
  `node-invalid` and `node-set` `.json`. Their spelling and derivation are in
  [NODE-PLAN.md](NODE-PLAN.md). The four cores instantiate `Node(Option(T))`, and the harness replays
  all seven files against them. The laws of `node-embedding.json` and `node-set.json` also
  re-read `identity.json` and `set.json` through the embedding E, under the counts they
  pin.

  Member encoders (the instance pair of 0005's framing, ids local to this file):
  - **`bytes`** — members are byte strings, `e = id`; a member and a leaf are spelled
    as hex.
  - **`class`** — members are the fixture setoid above, `e` = the UTF-8 bytes of
    `class` (representation deliberately ignored); leaves are spelled
    `{ class, representation }`.

## Leaf-codec ids for these fixtures

[0006](../docs/design/0006-canonical-codec.md) fixes the leaf-codec-id grammar, so the
encoders above stop being "ids local to this file" and take real ones. The two ranges
are both exercised here on purpose — a test carrier must never occupy a public number,
and the id form must be tried in anger before it freezes:

| encoder | id (hex octets) | range |
| --- | --- | --- |
| `bytes` | `00 01` | **public** — `deixis/identity-bytes`, the trivial slot every vector file needs |
| `class` | `01 fb44faaf3a9db590cbc4cb1abfdadb02 01` | **private** — the fixture setoid, self-scoped |

The private id is `0x01 ‖ 16 namespace octets ‖ uvarint(k)`, `k = 1`. The namespace
octets are the first 16 of `sha256("deixis vectors fixture setoid v1")`. [0006](../docs/design/0006-canonical-codec.md)
states the namespace as an **obligation, not a method** — two independent parties must
not collide *without consulting any registry* — and a derivation discharges that the
same way a random draw does, while also being *checkable*: anyone can recompute it and
see the namespace was minted for a stated purpose rather than squatted. **The
distinctiveness of the string is what carries the obligation**, so a fixture author
adding a second namespace here must derive from something as specific as the line
above; `"test"` or `"fixture"` would be exactly as collidable as the bare name. The
octets carry no meaning outside this file, and nothing may read structure into them.

**Why the fixture setoid stays private, permanently.** Its `≈` compares `class` and
ignores `representation` — deliberately coarse, so that an implementation comparing
leaves natively fails visibly. That is a property a *test* wants and no consumer
should ever inherit; a public number would invite exactly that inheritance. `k` is
local to this namespace, so a second fixture sort takes `k = 2` here without touching
the registry.

