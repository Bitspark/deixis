# Mandatory-node plan: expectations for `Node[T] = Node(T, FinMap[Key, Node[T]])` (ADR 0010)

**Status:** plan written 2026-09-23 (`6325543`), before any fixture file existed. **Nothing
below is a judgment until it is in a fixture file.** This plan follows the method of
[NODE-PLAN.md](NODE-PLAN.md): derivation first, fixtures after. **The first expectation set
was completed the same day: 118 cases in seven files** (`55c4f13`). The codec lane's spelling
review then found a coverage gap and a spelling reversal. The fixture-slot missing-value case
could pass for the wrong reason, so three missing-value cases were added under the `json` and
`unit` slots, and duplicate-key refusals got back their `error`/`key`. **The set is now 121
cases** (table below). Every item X1–X20 is
cited by at least one case note, and every defect W1–W10 is named by at least one; both
checks are mechanical, not a tally. W8 (a childless node decomposes without a child map) and
W10 (attachment as an upsert) rest on a single case each. No implementation of the mandatory
API existed at that authoring baseline; no file was then replayed.

**Execution update, 2026-09-23:** all seven files are now replayed against the
four required-payload cores. Their 121 cases yield 145 requests per language
(identity is checked in both directions). The full harness runs 368 requests,
including the optional specialization and profiles. Seeded defects W1–W10
were each detected against the TypeScript core or its conformance derivations,
with the code restored after every arm. [EVIDENCE.md](../docs/EVIDENCE.md)
records the scope and counts. This implementation consumes the independent spelling review and three
additional cases from `347c726`; it makes no changes to their expected judgments.

**Source, and the independence rule.** Every expectation below is derived from
[ADR 0010](../docs/design/0010-mandatory-node-values.md) and from [TREE.md](../docs/TREE.md)
and [PATH.md](../docs/PATH.md), as merged in `1a9bb6d`, and from nothing else.
This plan's author (the vectors lane) wrote none of those three texts. No implementation of
the mandatory API existed at the baseline: at `1a9bb6d` the four cores implement ADR 0009's optional
model. So no expected result can have been copied from an implementation's output, which
ADR 0010 §8 item 3 requires. Once fixtures exist, every disagreement with the spec is
recorded as a finding against one of the two. Neither side is silently brought into line.
On a genuine conflict, [README.md](README.md)'s precedence holds.

**Scope.** ADR 0010 §8 item 3: *"a supplied opaque value at every node; no default
parent; legal null-like payload versus a missing path; callback/comparison handling at
every node; complete parts; contexts; attachment; coarse slot equality; explicit optional
and unit instantiations; and heterogeneous assembly with a supplied parent."*
Not in scope:
- codec bytes (§8 item 6 keeps the grammar open);
- the compatible partial union `⊔` (§5; it is in the paper's item 2, and executable
  conflict refusal needs usable comparison);
- the set profile's migration (§6 says it must declare its own carrier and judgments,
  which is a separate piece of work);
- interpretation laws (§7 belongs to consumers).

## Why new files

The `node-*.json` files are ADR 0009's optional model, and their judgments are historical
(ADR 0010 §8 items 3 and 6). They are not edited. The mandatory model gets new files,
`mnode-*.json`, after the ADR's own name for it, `M[T]` (§2). Every case name starts with
`m-`: case names are unique across the whole corpus
([tools/conformance/README.md](../tools/conformance/README.md)), and `m-` is used by no
existing case.

**The historical files' optional interpretation** is declared in
[NODE-PLAN.md](NODE-PLAN.md) and the conformance protocol. Their node spelling,
`{"own": {"none": {}} | {"some": x}, "children": …}`, is exactly
this plan's spelling of `Node[Option[fixture]]` (below). So each file can be read as that
instantiation, case by case, wherever its judgment agrees with the mandatory laws at
`T = Option[fixture]`. That check is a separate step of this claim, and it is recorded
per file rather than assumed. Identity, navigation, attachment, parts,
embedding and duplicate-key files use conventional option equality; the set
file exercises the profile's explicitly optional root/member image. All seven
are replayed under those choices, without changing their judgments.

## Spelling

A node is always both fields. Neither is ever omitted:

```json
{ "own": <payload>, "children": [ ["<hex key>", <node>], … ] }
```

`children` entries are written in deliberate insertion order. Construction owns sorting and
duplicate detection, as in the existing files.

**Every case declares its slot**, meaning the carrier and its `≈`. The core consults
nothing else:

| slot | carrier, spelled as | `≈` |
| --- | --- | --- |
| `fixture` | `{class, representation}` strings ([README.md](README.md#the-fixture-setoid)) | equal `class`; `representation` ignored. **This is the coarse slot equality.** |
| `option` | `{"none": {}}` or `{"some": <fixture>}` | tag-respecting: `none ≈ none`; `some(x) ≈ some(y)` iff `x ≈ y`; `none ≉ some(_)` |
| `unit` | `{}` (the one value) | always equal |
| `json` | any JSON value, **including `null`**, spelled as itself | structural JSON equality (object member order ignored) |
| `sum` | `{"left": <fixture>}` or `{"right": <json>}` | tag-respecting, componentwise |
| `option-sum` | `{"none": {}}` or `{"some": <sum>}` | tag-respecting, with `sum`'s `≈` inside |

`option-sum` was added while writing `mnode-instantiation.json`: X17's `Option[A ⊎ B]` root
needs a carrier of its own, and the first table did not have one.

`json` is the slot that admits a null-like payload. It is how the cases separate a legal
`null` from a missing path (§4, TREE *Existing versus missing*). `option` is the explicit
optional instantiation, and `unit` the pure-shape one (§1).

**Results of partial operations** are `{"defined": <value>}` or `{"undefined": {}}`. No
refusal reason is spelled, because the spec names none. `{"defined": null}` under the
`json` slot and `{"undefined": {}}` are therefore distinct results, and a case can require
exactly one of them.

**Construction refusals.** A duplicate sibling key is spelled as
[invalid.json](invalid.json) and NODE-PLAN spell it: `"error": "duplicate_key"` and the
offending `"key"`, at case level, which makes the refusal specific. A spelling with no
`own` value is `{"undefined": {}}` with no class, because neither the spec nor the old corpus
names one. **A harness must never count a protocol error, a parse failure or an
unsupported operation as a refusal.** An adapter answers a refusal as a well-formed result,
and anything else fails the case. *This paragraph was added after the codec lane's spelling
review: the first draft dropped `error`/`key` for every refusal, so a broken adapter would
have read as a correct one.*

**No numbers in `json` payloads.** Number equality differs across the four languages
(serde_json keeps `1` and `1.0` apart; JavaScript and Python do not). No case uses a number,
and a later case that needs one must first define its equality.

**A known limit: JavaScript `undefined` cannot be spelled.** ADR 0010 §4 requires a missing
path to be distinguished from every legal payload, `undefined` included where `T` admits it.
`undefined` is not a JSON value, so the TypeScript core's form of that distinction is out of
this corpus's reach and needs a TypeScript-side test. Python's `None` is covered, since JSON
`null` maps to it.

**Paths** are arrays of hex keys. `[]` is `ε`. `[""]` is the path of one empty key, which is
not `ε`.

**Named functions for `map`** (total, deterministic, defined here):

| name | slot | effect |
| --- | --- | --- |
| `id` | any | identity |
| `class-suffix-x` | `fixture` | appends `x` to `class`. It respects `≈`, and it changes every node observably |
| `representation-upper` | `fixture` | upper-cases `representation`. It is invisible to `≈` |
| `none-to-z` | `option` | `none ↦ some({class:"z",representation:"z"})`; `some(v) ↦ some(v)` |
| `option-map-class-suffix-x` | `option` | `Option.map(class-suffix-x)`: `none ↦ none` |
| `wrap-in-array` | `json` | `v ↦ [v]`, so `null ↦ [null]` |

A list of functions is applied left to right: `["f", "g"]` means `map(g, map(f, n))`.

**Contexts and cuts** reuse NODE-PLAN's hole spelling: a context is a node spelling with
exactly one subtree replaced by `{"hole": {}}`. A skeleton has one hole per cut path, and
the subtrees are listed as `[path, node]`.

## Items

Each case note cites at least one item. Each item is traced to its source.

| item | expectation | source |
| --- | --- | --- |
| X1 | `own` and `valueAt` return the supplied payload itself at the root, interior and terminal nodes | §1, §4 |
| X2 | a childless node carries `T`: `decompose(Node(t,{})) = (t,{})` | §3 |
| X3 | **no default parent**: a spelling without `own` does not construct; composing needs a supplied `t` | §3 "New-parent composition needs a parent value" |
| X4 | a legal null-like payload (`json` `null`, `option` `none`, `unit` `{}`) at an existing path is **defined**; a missing path is **undefined** | §4; TREE; PATH `valueAt` |
| X5 | `map` applies `f` at **every** node; functor laws; `at(map(f,n),p) ≡ map(f,at(n,p))`; the domain is unchanged | §4 |
| X6 | under `option`, generic `map` may change `none`; the specialization `Option.map(f)` keeps it | §4; TREE |
| X7 | identity lifts `≈` at every node, interior ones included; exact key domains; sibling order is irrelevant; `≈` is coarse (`representation` ignored) at every node | §3; TREE *Identity* |
| X8 | `option` equality respects tags: `Node(none,{}) ≠ Node(some(e),{})`, including for an empty `e` | TREE; PATH |
| X9 | `unit`: identity is equality of path domains | §1 |
| X10 | paths are retained when the payload reads as absence: `Node(none,{a↦Node(none,{})}) ≠ Node(none,{})` | PATH *Identity, extensionally* |
| X11 | complete parts both ways; identical children with different parent values give different nodes | §3; TREE *Composition* |
| X12 | `split`/`plug`, both laws; the four replacement laws, congruence included; a missing path refuses | §4; PATH |
| X13 | `cut`/`rebuild`, both laws; a missing path in `F` refuses | §4; PATH |
| X14 | `attach` has exactly the domain `p ∈ D_A`, `r ∉ D_A`: a missing parent refuses, and an occupied key refuses even when `B` equals the occupant; it is available at every node, including a `null`, `none` or `unit` parent, whose value is not promoted; `D_C` and `v_C` are exact | §5 |
| X15 | the consequences of attachment: `A ⊑ C`, `at(C,r) ≡ B`, the value at `p` is unchanged, distinct fresh keys commute; the subtree at `p` grows and is not equal to the old one | §5 |
| X16 | `M[T]` embeds in `O[T] = M[Option[T]]` by wrapping each value in `some` | §2 |
| X17 | heterogeneous assembly needs a supplied parent in the common carrier; `Option[A ⊎ B]` permits a `none` root | §5 |
| X18 | resolution never enters a value: a `json` payload that spells a node is opaque content | TREE; PATH |
| X19 | keys are exact bytes: the empty key, non-UTF-8 keys, and `[""]` versus `ε` | §3; PATH |
| X20 | duplicate sibling keys do not construct | §3 |

## Defects the cases must catch

ADR 0010 §8 item 3 asks the expectations to *"distinguish the mandatory API from an
automatic option wrapper"*. Each defect below is one an implementation could plausibly
have, and each must fail at least one case. The item lists which. When the fixtures exist,
each defect is run as a red arm against a scratch implementation, the method of
node-set.json (`4bd43d4`).

| defect | caught by |
| --- | --- |
| W1: `own`/`valueAt` return a wrapped value (`some(t)`) instead of `t` | X1 under `fixture` and `json` |
| W2: a missing `own` defaults to `none` or another value | X3 |
| W3: a `null`/`none`/`unit` payload is read as a missing node, or its path is dropped | X4, X10 |
| W4: `map` skips `none` payloads, interior nodes or the root | X5, X6 |
| W5: equality compares only terminal values | X7 (differences at interior nodes only) |
| W6: `option` equality ignores tags (`none ≈ some(empty)`) | X8 |
| W7: `attach` refuses at, or rewrites the value of, a `null`/`none`/`unit` parent | X14 |
| W8: a childless node decomposes as a value with no child map | X2 |
| W9: `compose` infers the parent value from its children | X11 |
| W10: `attach` behaves as an upsert | X14 |

## Files

| file | items | cases |
| --- | --- | --- |
| [mnode-identity.json](mnode-identity.json) | X7–X10, X19 | 24 |
| [mnode-navigation.json](mnode-navigation.json) | X1, X4, X18, X19 | 24 |
| [mnode-map.json](mnode-map.json) | X5, X6 | 11 |
| [mnode-parts.json](mnode-parts.json) | X2, X3, X11–X13 | 26 |
| [mnode-attach.json](mnode-attach.json) | X14, X15 | 17 |
| [mnode-instantiation.json](mnode-instantiation.json) | X16, X17 | 7 |
| [mnode-invalid.json](mnode-invalid.json) | X3, X4, X20 | 12 |
| **total** | | **121** |

The first draft of this table held estimates, 92 in total. Each file's description states
its own count, and a mechanical check compares the two. The
protocol operation names these files use (`equal`, `at`, `valueAt`, `own`, `decompose`,
`compose`, `construct`, `map`, `split`, `plug`, `replace`, `cut`, `rebuild`, `attach`,
`assemble`, `embed-some`) are a proposal for the conformance adapter. The judgments do not
depend on them.
