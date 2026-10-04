# Node plan — structural expectations for `N[T]` (ADR 0009)

**Scope after 2026-09-23 decision:** [ADR 0010](../docs/design/0010-mandatory-node-values.md)
selects mandatory `T`. This plan and `node-*.json` describe the preceding optional
model and are now replayed as the explicit `Node[Option[T]]` specialization,
with option equality supplied by each caller. They are not mandatory-core
coverage by themselves. [MNODE-PLAN.md](MNODE-PLAN.md) records the independent
mandatory expectations, now also replayed against all four implementations.

**The optional interpretation, declared (2026-09-23, ADR 0010 §8 item 3).** This plan's
six files read as the explicit instantiation `Node[Option[fixture]]`, with the
tag-respecting `option` slot of [MNODE-PLAN.md](MNODE-PLAN.md). Their node spelling is exactly
that instantiation's. **All 89 of their cases hold there under the mandatory core's generic
laws.** This was checked case by case, not argued: each case was re-judged by a direct
reading of ADR 0010's operations at that slot. That covers `E` and its recognizer (§6) and
the embedded-identity law over `identity.json` with its pins 21, 8 and 13. Planting a
flipped judgment in identity, attach and unembed makes the check report a disagreement, so
its agreement is a result, not a silence. No case in these files judges containment or
`map`, so ADR 0009's absence-sensitive order, which ADR 0010 §5 moves out of the generic
core, never appears as an expected result. [node-set.json](node-set.json) is not this
plan's. The spec-alignment lane declared its reading in `48dc638`: all 9 cases hold as
deixis-set-v1 over `Node[Option[U]]`, re-judged case by case, with planted flips reported.

**Status:** plan written 2026-09-23 (`eb7d0d8`), when no fixture file existed yet.
**Nothing below is a judgment until it is in a fixture file.** Planned the way
[CODEC-PLAN.md](CODEC-PLAN.md) planned the codec corpus: derivation first, fixtures after.
The fixture files, each listing its own cases:
[node-identity.json](node-identity.json) (§4),
[node-navigation.json](node-navigation.json) (§5),
[node-attach.json](node-attach.json) (§8),
[node-parts.json](node-parts.json) (§6–§7) and
[node-embedding.json](node-embedding.json) (§10.1), and
[node-invalid.json](node-invalid.json) (§3, construction refusals). A seventh file,
[node-set.json](node-set.json) (9 cases), is **not this plan's**. The spec-alignment lane
wrote it from 0005's ADR 0009 section alone (`4bd43d4`), because this seat wrote that
section. Its first finding corrected the section's definition of `valued_set_node`.
**The first expectation set was completed 2026-09-23 at `85a01ea`** (80 cases, five files).
Every X and C item below is cited by at least one case note, checked mechanically rather
than by tally. The spec-alignment lane's spelling review then found two coverage gaps, and
both are now filled: duplicate child keys (node-invalid.json, 6 cases) and a payload whose
`representation` is the literal spelling of a node, which is C8's other half (3 cases).
That brings this plan's set to 89 cases in six files, and the N[T] family with node-set.json
to 98 in seven. Four controls, C1, C5, C6 and C9, still rest
on a single case each, all in the attach file. The four cores implement `N[T]`, and the
harness replays all of these files against them.

**Source, and the independence rule this plan exists to keep.** Every expectation below is
derived from [ADR 0009](../docs/design/0009-optional-node-values.md) as merged at `0a877e0`,
and from nothing else. The spec alignment of TREE, PATH, SLOTS and WIRES that ADR 0009 §14.1
asks for is written by a different hand: the split agreed between the two deixis lanes
on 2026-09-23 is that whoever writes the spec does not also write its expected results.
This plan's author had not read that alignment when writing it. Once fixtures exist they
are compared against the aligned spec, and **every disagreement is recorded as a finding
against one of the two. Neither side is silently brought into line with the other.**
On a genuine conflict the precedence in [README.md](README.md) holds: normative algorithms
and grammar, then semantic laws, then vectors, then prose.

**Scope.** This covers ADR 0009 §14.5 (independent structural expectations) and §14.6
(negative controls). It does **not** cover codec bytes for `N` (§14.4 is held by both lanes,
and §12 is still open), overlay and `⊔` (§9.2: an executable comparison is separate from the
algebra), substitution for `N` (§9.3 puts no such API in scope), or the positional/set
profile review (§14.3, a separate piece of work by this seat).

## Why new files, not an edit of the existing ones

The existing files spell nodes in the old model (`{"leaf"}` / `{"struct"}`, see
[README.md](README.md)), and their judgments are append-only except through an explicit
erratum. ADR 0009 §14 repeats that: *"Historical vector judgments change only through the
established explicit migration/erratum process."* So `N[T]` gets new files, the old files
are left untouched, and the old-tree embedding cases (E below) are the bridge between the
two.

## Node spelling for `N[T]`

```json
{ "own": { "none": {} }, "children": [ ["<hex key>", <node>], … ] }
{ "own": { "some": { "class": "…", "representation": "…" } }, "children": [] }
```

- **Tagged `none` / `some`: never JSON `null`, and never an omitted field.** ADR §3 asks
  for tagged sums throughout. §4 requires three things to stay distinct: an **absent** node,
  an existing node with **`None`**, and a node with **`Some(empty)`**. Both `null` and field
  omission are ways for implementations in the four core languages to blur two of them.
- The payload is the existing fixture setoid (`≈` compares `class` only). **That setoid IS
  the "coarse supplied equality" §14.5 asks for**, so no second relation is invented.
  `Some(empty)` is spelled `{"some": {"class": "", "representation": ""}}`.
- `children` entries are written in deliberate insertion order, exactly as in the old
  spelling: the construction owns sorting and duplicate detection.
- **A partial operation's result** is `{"defined": <node or value>}` or `{"undefined": {}}`.
  ⚠ **No refusal reason is spelled.** ADR 0009 says *when* an operation is undefined (§5,
  §8) and never *why* in machine terms, so a required reason string would be a vector
  teaching a reading the spec does not contain.
- **Payloads follow the file's member encoder.** The fixture setoid is spelled
  `{class, representation}`. Under set.json's `bytes` encoder a payload is a hex string, so
  `{"some": ""}` is `Some` of the empty byte string (introduced by node-set.json).
- **Construction refusals** use the case shape of the old model's
  [invalid.json](invalid.json), `{node, error, key}`, so they DO name an error class
  (`duplicate_key`) and the offending key. The no-reason rule above covers partial
  *operations*, where the ADR says when a result is undefined and not why. A malformed
  spelling has exactly one way to be wrong here, and the reviewed old corpus already
  names it.
- **Parts (§6–§7).** A `decompose` result is `{"parts": {"own": …, "children": […]}}`. Its
  fields match a node's, but it is kept distinct because it is a different type: the pair
  `(o, m)`, not `Node(o, m)`. A **hole** is `{"hole": {}}`, and it stands in for the
  *whole* subtree at its position, own value included. A context or skeleton is a node
  spelling that contains holes. A cut's subtree map is a list of `[path, node]` pairs, a
  path being a list of hex keys.

## Expectations (§14.5): each case, its expected judgment, its clause

Notation: `t`, `u` are fixture values; `e = Node(None,{})`; `ε` is the empty path.

| # | §14.5 item | case | expected | ADR clause |
|---|---|---|---|---|
| X1 | own value with children | `n = Node(Some(t), {k ↦ e})` | `own(n)=Some(t)`; `dom(children(n))={k}`; `at(n,[k])` defined | §3, §5 |
| X2 | unvalued nodes | `valueAt(Node(None,{k↦e}), ε)` | `defined: None`, not undefined | §5 *"returns None for an existing unvalued node"* |
| X3 | `None` vs `Some(empty)` | `Node(None,{})` vs `Node(Some(empty),{})` | `≢` | §4 *"differs from every Some(t), including a payload's own empty value"* |
| X4 | absent nodes | `valueAt(e, [k])` | `undefined`, distinct from `defined: None` | §5 |
| X5 | opaque and empty keys | a key `""`, and a non-UTF-8 key such as `ff00` | both valid; path `[""]` ≠ `ε`; `at(n,[""])` defined iff `"" ∈ dom` | §3 *"Empty key and empty path differ"*, `K = Bytes` |
| X6 | nested paths | depth ≥ 3 | `at(at(n,p),q) ≡ at(n,p++q)`; `at(n,ε) ≡ n` | §5 (S0), (S1) |
| X7 | full one-layer round trip | valued and unvalued nodes, with and without children | `compose(decompose(n)) ≡ n`; `decompose` returns the **complete** child map, `{}` when childless | §6 (R0), (R1) |
| X8 | cut round trip | a prefix-free `F`, plus two different complete cuts of one tree | `rebuild_F(cut_F(n)) ≡ n`; both cuts rebuild the same tree | §7 |
| X9 | ancestor values | a hole at `p` below a valued ancestor | `split_p` keeps that ancestor's `Some`; `plug_p(split_p(n)) ≡ n` | §7 *"retains every ancestor's optional own value"* |
| X10 | empty subtrees | attaching `e` | exactly one path is added and no value; `e` counts as a node in `D` | §7 *"This includes empty nodes"*, §8 (E0) |
| X11 | root and deep valued-parent attachment | `attach(Node(Some(t),{}), ε, k, B)`, and the same at a depth-2 valued node | **defined**; `own` at the parent stays `Some(t)`; `at(C, p++[k]) ≡ B` | §8 (E0)–(E2), *"N admits the operation at every existing node"* |
| X12 | old-tree embedding | `E` over existing `identity.json` pairs | `n ≡ m` iff `E(n) ≡ E(m)`; `E(Leaf(t)) = Node(Some(t),{})`; `E(Struct(m)) = Node(None,…)` | §10.1 |
| X13 | independent additions | two fresh keys `k ≠ j` at one `p` | `attach` in either order gives `≡` results | §8 (commutation) |
| X14 | coarse supplied equality | two trees differing only in `representation` | `≡`; and `map` preserves `D` and `V` | §4, §5 |

**X12 reuses the old corpus rather than inventing new pairs.** Mapping every `identity.json`
case through `E` and requiring the same `≡` verdict makes the embedding claim hold on
judgments that were already reviewed. A new pair invented for the purpose would only show
agreement with this plan.

**One more embedding case, stated because it looks like a failure and is not.** `E`'s image
is **not closed under attachment** (§10.1). Attaching under an embedded leaf is defined in
`N` and yields a tree outside the image. The expected judgment is `defined` in `N`, and
the result has no `L` preimage.

## Negative controls (§14.6): each targets a wrong behaviour and says how the case catches it

| # | §14.6 item | the wrong behaviour | the case that catches it | clause |
|---|---|---|---|---|
| C1 | dropped parent value | attach at a valued node returns `own = None` there | expected result keeps `Some(t)` at `p` | §8 (E1): `v_C ⊇ v_A` |
| C2 | relocated parent value | `t` is moved under a `head`-style child | expected `valueAt(C,p) = Some(t)` **and** `at(C, p++[head])` undefined | §1 decisive example; §8 (E0) exact domain |
| C3 | missing children | `decompose` returns only some of the children | expected child map has the exact full domain | §6 *"every immediate child with its exact key"* |
| C4 | renamed children | keys normalised (case folded, decoded, re-encoded) | keys that differ only in such ways (`6b` vs `4b`, a non-UTF-8 key) stay distinct | §3 `K = Bytes`, exact keys |
| C5 | extra children | attach also adds a synthesised child (a value slot, a marker) | expected `D_C` is **exactly** `D_A ∪ {r++q}` | §8 (E0) |
| C6 | refusal at a valued parent | the old-model behaviour: refusing to attach below a value | expected **`defined`** | §8 (E2) availability |
| C7 | occupied-key overwrite | attach replaces an existing child | expected **`undefined`** when `r ∈ D_A` | §8 preconditions |
| C8 | accidental payload interpretation | a value is read as structure, or `class` `"none"` / `"some"` / `""` is read as a tag | payloads whose `class` strings are exactly those words stay opaque `Some` values | §2 *"treats T as opaque"* |
| C9 | unrelated changes during attachment | a sibling or ancestor's value or **absence** changes | expected `restrict(C, D_A) ≡ A`: an unvalued sibling stays unvalued | §8 *"retains every old value **and absence**"* |
| C10 | auto-vivification | `at(n,[k])` for a missing `k` returns `e` instead of refusing | expected **`undefined`** | §5 *"Missing paths refuse; they neither create nodes nor choose a fallback"* |

C10 is not in §14.6's list. It is added because §5 states it as a law and it is the
commonest way a map-backed implementation goes wrong.

## Open before fixtures are written

- **Operations as fixture verbs.** The ADR says operation names are *"mathematical
  descriptions or derived operations"* and do not require a public method each (§2). So a
  replayer maps each case to whatever the core exposes, and the fixture names the *law*, not
  an API. How cores spell `attach` is §14.7's business and not this plan's.
- **Node spelling review.** The spelling above is this seat's proposal. It goes to the other
  lane with the first fixture file, **after** that file is committed, so that the review
  cannot shape the judgments.
- **Distribution.** Same constraint as the rest of this directory ([README.md](README.md),
  *This corpus does not travel*): none of this reaches an outside implementer before
  `deixis-codec-v1` freezes.
