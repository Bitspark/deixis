# deixis — the evidence ledger

**Current delivery, 2026-09-23:** [ADR 0010](design/0010-mandatory-node-values.md)
is implemented in all four cores. Compose/decompose and own-value access use
the complete `T`; equality delegates that entire payload to the caller.
The 121 independently authored `mnode-*.json` cases are replayed, unchanged.
The set profile and earlier corpus explicitly instantiate optional payloads.
Paper v4 states and proves the structural laws for this model; these are
mathematical proofs, not proof-assistant verification. The `deixis-codec-v2` candidate is
implemented in all four cores and its corpus is replayed on every run; its freeze and
downstream adoption remain open in [#1](https://github.com/Bitspark/deixis/issues/1). [API.md](API.md) documents
the delivered interfaces. Live counts below are bound to the harness output.

**Architecture review, 2026-10-05:** [ADR 0014](design/0014-structural-identity-and-lifted-access.md)
reaffirms the addressless sender and complete sender tree, alongside receiver
trees. This changes neither the core algebra nor codec bytes. Existing structural
evidence applies to every opaque carrier; it is not proof of transport,
distributed binding or service behavior. Wire migration evidence belongs to
bitwire and bitruntime and is not inferred from this documentation change.

**Naming and structural contract, accepted 2026-09-26:**
[ADR 0012](design/0012-data-wire-tree-symmetry.md) records addressless `Data`
and `Wire`, with `DataTree = DeixisNode[Data]` and
`WireTree = DeixisNode[Wire]`. Both require the complete deixis structural
contract; addressed read/send access alone is insufficient. The existing
generic structural evidence applies to the shape, not to I/O, authority,
lifetime or transport behavior of supplied primitives. A DataTree materializes
to `DeixisNode[Bytes]` for the existing candidate codec; the naming change
does not alter codec vectors or hash domains. Consumer migration and release
status are separate claims in [the mappings](consumers/README.md), not an
inference from this decision or from older conformance counts.

**What this is:** one page answering *what stands under each named artifact*. Every
record already carries its own `Status:` line, and [vectors/README.md](../vectors/README.md)
carries the oracle doctrine — but until this page there was no cross-cutting view, and a
reader had to grep the tree to learn which claims are enforced and which are merely
stated. **This page ratifies nothing.** It reports. ⚠ *Most* numbers here name the command
that recomputes them; the rest are marked `recorded` as readings of a one-off
exercise. **`tools/rotcheck.py` lists whatever is neither** — it said *every* number
until 2026-09-03, which was an overclaim by the page about itself.

> ⛔ **STANDING RULE FOR THIS PAGE, learned the hard way in both ledgers on 2026-09-03.**
> *A ledger citing another artifact goes stale in exactly one direction: the artifact
> changes, the citation does not.* Six live instances were found in one morning — four in
> 0003's Verdicts table and **two here**
> — and **a citation resolver would have caught none of them**, because the direction that
> fails carries no syntax. A dangling `§99` is trivially checkable and has never happened;
> a row asserting *"grep → 0"* about a file that now answers 15 is not checkable at all and
> happened four times in one table. <!-- claim recorded 2026-09-03: the 0-of-6 and 4-of-6 figures in this rule are counts of one morning's findings, not a recomputable property. --> ⇒ **So every measurement on this page is written in the
> past tense with its commit**, and any figure that must be live says when it was read and
> what moves it. Only reading catches the rest.

## The tiers

| tier | means |
| --- | --- |
| **proved** | a theorem in [the paper](paper/deixis.tex), with its assumptions stated |
| **enforced** | a named check fails the build if the claim breaks |
| **observed** | measured, not gated — true when someone last looked |
| **stated** | written down, with no instrument standing under it |

A proof and a witness answer different questions: the proof says the claim is *true*,
the witness says four independent implementations actually *do* it. An implementation
can be perfectly consistent with a theorem and still disagree with three peers about
bytes, which is why the vectors exist at all.

## Witnessed — proved, vectored, replayed by four implementations, CI-gated

| artifact | fixes | vectors | checks | implementations |
| --- | --- | --- | --- | --- |
| **`deixis-pos-v1`** ([0002](design/0002-positional-keys.md)) | the position spelling κ — *and nothing else* | `positional.json` 15 keys · 9 non-keys | **39** | `pos/{rs,go,ts,py}` |

> **Historical transition at `929c0b7`, 2026-09-23:** this table went from three rows to
> one when the cores implemented ADR 0009 ([#1](https://github.com/Bitspark/deixis/issues/1)). The floor and
> set rows witnessed the *previous* model, `Leaf | Struct`: the floor as `identity.json` 21
> and `invalid.json` 6, **48** checks over `core/{rs,go,ts,py}`, and the set profile as
> `set.json` 14, **16** checks over `set/{rs,go,ts,py}`. No implementation in this tree runs
> that model any more, so neither row measures anything it could still be checked against.
> Their judgments survive: `identity.json` and `set.json` are re-read through the embedding
> E by the laws that pin them, and `invalid.json` is indexed without being replayed, since
> no law re-reads it in N. At that revision both subjects were *witnessed, not
> proved*: the paper and [0008](design/0008-proof-obligations.md)'s obligations still stated
> the previous model. The pos row was unaffected. κ spells keys, and ADR 0009 left keys alone
> (`a0461d3`).

κ's injectivity, order-preservation-by-spelling and canonicity remain **proved**.
For v0.2.0, [paper v4](paper/deixis.tex) now proves lifted equivalence and congruence,
whole-payload mapping, quotient transport, identity by paths and total values,
navigation, complete parts, contexts and cuts, exact attachment, and compatible
overlay for the mandatory model. It states the sequence and set transport laws
over their explicit optional carrier. Its abstract encoder proof establishes an
invariant construction. On its own it neither validates the concrete
`deixis-codec-v2` grammar in CODEC.md, whose prose proofs are CODEC-proofs.md, nor
satisfies that artifact's freeze ledger. See the
completion record.

## Current core and profile conformance — replayed by four implementations, CI-gated

| artifact | fixes | vectors | checks | implementations |
| --- | --- | --- | --- | --- |
| **required-payload floor** ([ADR 0010](design/0010-mandatory-node-values.md)) | direct own values, full-payload equality, navigation, parts; derived mapping, contexts, cuts, attachment and assembly | 121 independent `mnode-*.json` cases; identity in both directions | **145** | `core/{rs,go,ts,py}` |
| **additional direct-payload cases** | direct fixture values, reconstruction, navigation, attachment and coarse equality | `required-node.json` 14, authored in the implementation task before its handlers | **14** | `core/{rs,go,ts,py}` |
| **optional specialization** `Node[Option[T]]` | explicit option equality, resolution, parts; derived contexts, cuts and attachment; the original leaf/struct embedding | `node-identity.json` 20 · `node-navigation.json` 19 · `node-attach.json` 15 · `node-parts.json` 18 · `node-embedding.json` 10, plus its law over `identity.json` 21 · `node-invalid.json` 6 | **150** | `core/{rs,go,ts,py}` with caller-chosen optional payloads |
| **`deixis-codec-v2`**, candidate ([CODEC.md](CODEC.md), [ADR 0011](design/0011-codec-for-mandatory-nodes.md)) | both forms and the bridge, every §9 code, precedence, streaming, the envelope | 197 cases and 101 chunks in `codec-v2-*.json`, authored from the contract text alone: 115 before any implementation existed, and batch 4's 23 `codec.navigate` cases before any core served that operation | **2846** (2833 requests + 13 envelope) | `core/{rs,go,ts,py}` |
| **`deixis-set-v1`**, slot-member form on `Node[Option[T]]` ([0005](design/0005-set-keys.md)) | the declared image and its five refusals, by reason | `set.json` 14 through `node-set.json`'s five laws · `node-set.json` 4 | **20** | `set/{rs,go,ts,py}` |
| **scripted binding laws** ([ADR 0013](design/0013-binding-views-and-the-service-line.md) §2, §3, §5) | preparation as a context-indexed map; the selection law, both sides; absence, refusal, fault and cancellation kept apart; selection that asks the binder nothing; the eager batch's counterexample | `binding-scripted.json` 19, authored in the implementation task before its handlers | **19** | a scripted harness in each `conformance/{rs,go,ts,py}` over `core/{rs,go,ts,py}` |
| **scripted projection laws** ([IDENTITY.md](../IDENTITY.md) ID9, ID10, with ID2's key buffers and ID4's reconstruction) | missing-path with no invocation, exactly one invocation otherwise, unchanged arguments, refusal and fault kept apart from absence; both sides of the composition law at every cut, each on its own fixture; aliasing observed by count and kept by reconstruction; caller key buffers overwritten after compose | `projection-scripted.json` 28, authored from IDENTITY.md and committed before any CLI answered it | **28** | a scripted harness in each `conformance/{rs,go,ts,py}` over `core/{rs,go,ts,py}` |

**Required-payload evidence.** The 121 independent cases were specified on
main through `347c726`, separately from this implementation. That revision
added missing-value coverage and explicit duplicate-key refusals after spelling
review; this implementation consumes those expectations without changing them. The `mnode.*` CLIs instantiate each core with complete JSON
payloads and caller equality for six slot choices. Native tests additionally
use direct callable payloads without comparison or option wrappers, and a
supplied relation that equates `None` and `Some` to verify that core equality
does not preempt the caller's whole-payload relation. The 14 additional shared
cases use direct fixture payloads; their author also wrote their handlers, so
they are not independent-oracle evidence.

**Negative controls, recorded 2026-09-23 at `397eb25` on `codex/required-node-values`.** Each
W1–W10 defect from [MNODE-PLAN.md](../vectors/MNODE-PLAN.md) was seeded separately
in the TypeScript core or its CLI derivation, detected by the harness, then
restored. Failure counts were W1 1, W2 3, W3 5, W4 1, W5 13, W6 4, W7 1,
W8 2, W9 3 and W10 6, against a restored 365/365 control. W5 altered core
equality to skip interior payloads; W10 altered attachment to upsert. The other
arms altered protocol/derived handling of own values, defaults, null, mapping,
option equality, attachment or parts. These demonstrate concrete failure
detection, not exhaustive verification of each defect class.
<!-- claim recorded 2026-09-23: W1-W10 failure counts came from isolated mutations on codex/required-node-values, each restored; they are not live repository properties. -->

**Scripted binding evidence, 2026-10-05.** [ADR 0013](design/0013-binding-views-and-the-service-line.md)
§10 item 1 asks for shared scripted vectors of §2, §3 and the structural rows of §5, run in
all four cores. `binding-scripted.json` is that family. Binding is not a deixis API, so the
row witnesses that four cores' compose, decompose and at carry the laws under one scripted
harness per language. It witnesses no binding library, because there is none. The binder is
a script table that logs the names it is asked for, which is §5's instrumented binder: a
case can require that selecting a missing path asked it nothing, and not merely that the
answer was right. The vectors were written from ADR 0013 before any CLI answered them, but
by the author of the four harnesses, so they are not independent-oracle evidence. §10 item
1's TypeScript and Go adapter conformance tests are not part of this row.
<!-- claim holds: `python -c "import json; print(len(json.load(open('vectors/binding-scripted.json',encoding='utf-8'))['cases']))"` == 19 -->
<!-- claim holds: `grep -c "binding-scripted.json" tools/conformance/binding.mjs` == 1 -->

**Its negative controls, recorded 2026-10-05 on the `binding-vectors` branch.** Each defect
was seeded alone, the harness run against that CLI with `--no-codec`, and the file restored
byte for byte, against a restored control at 387/387. Go's select-then-prepare side
restarting the context at γ instead of γ·p failed the 3 defined law cases. Go's resolve-at
resolving every request on the path before selection failed 7 of the 8 resolve-at cases.
Python's selection rewriting each cursor relative to the selected subtree failed the same 3
law cases. Python's resolve-at running the eager batch before selecting, with every outcome
unchanged, failed all 8 resolve-at cases on the binder log alone. TypeScript's eager batch
dropping a node that does not bind failed both of its failing-batch cases. A description
stating 18 cases made the harness exit 2 before sending anything.
<!-- claim recorded 2026-10-05: the five mutation arms and their failure counts are readings of one run each on the binding-vectors branch, each restored; they are not live repository properties. -->

**Scripted projection evidence, 2026-10-06.** Research 0006's row R25a and
[ADR 0015](design/0015-deixis-identity.md) §7 ask for hand-authored projection and effects
vectors, replayed by all four cores, that move [IDENTITY.md](../IDENTITY.md)'s ID9 and ID10
from "not yet" to checked. `projection-scripted.json` is that family. Projection is not a
deixis API (ID8), so, as with binding, the row witnesses four cores' compose, decompose and at
under one scripted harness per language, and no projection library. Own values are live
capability objects, one per distinct id in each fixture, so aliasing is observed by a `count`
capability rather than inferred. The description declares ID10's observation model: outcomes
and the ordered invocation log are observed; timing, result identity and harness internals are
not. The vectors were written from IDENTITY.md and committed before any CLI answered them, but
by the author of the four harnesses, so they are not independent-oracle evidence. ADR 0015
§7's `Atom`/`Uint8Array` boundary is not part of this row.
<!-- claim holds: `python -c "import json; print(len(json.load(open('vectors/projection-scripted.json',encoding='utf-8'))['cases']))"` == 28 -->
<!-- claim holds: `grep -c "projection-scripted.json" tools/conformance/projection.mjs` == 1 -->

**Its negative controls, recorded 2026-10-06 on the `projection-vectors` branch.**
`tools/conformance/mutants.mjs` gained three core defect classes, with sites from each core's
source, and planted them one at a time against an unmutated control at 3261/3261 in every
core. 20 plants, 17 killed, no survivor. The 3 that survived are TypeScript's structural
`compose()`, outside the corpus because no conformance CLI builds through it.
- *A miss answered with a fallback node* (`get` or `at` answering the parent, the ancestor
  reached or, in Rust's `Children::get`, the first child) was killed at all 8 node-model
  sites. Each plant turned 8 projection cases red, 6 for Rust's first-child plant, which
  cannot fall back below a childless node. Every one invoked something on absence or found a
  mutated key.
- *An own value copied by compose or decompose* was killed in Python, TypeScript and Go. A
  copying compose turned 3 cases red (counts of 1, 1, 1 for one id at three positions); a
  copying decompose turned only `proj-seq-aliasing-survives-reconstruction` red, a kill one
  case deep.
- *A caller's key buffer kept by compose* was killed in the same three cores by the two
  `keys-after-mutation` cases, again thin.

Rust cannot express the last two: compose and decompose take `T` with no `Clone` bound under
`forbid(unsafe_code)`, and `Node` keeps owned keys with no lifetime, so the runner reports
them as inexpressible and plants nothing. The harness-side defect, the two `lift-cut` sides
sharing one fixture, lives in CLI code rather than a core, so it was planted by hand in each
CLI and restored from git in the same command. It failed the 6 cut cases that invoke anything
in all four. A subtler variant, sharing capability objects but reporting each side's own
invocations, was planted in Python, TypeScript and Go and failed only
`proj-cut-count-is-one-on-each-side`. A description stating 27 cases made the harness exit 2
before sending anything.
<!-- claim recorded 2026-10-06: the mutation run (20 plants) and the hand-planted shared-fixture arms are readings of one run each on the projection-vectors branch, each restored; they are not live repository properties. -->

**What was executed, measured at `929c0b7` on 2026-09-23.** All 98 `node-*.json` cases
were run: 92 are judged directly, and the other 6 are laws. The six laws that re-read
`identity.json` and `set.json` count only because a moved pin fails the run: the harness
checks each pinned count before sending anything, and exits 2 on a mismatch. That arm was
red-proved on the branch: `source_equal` pinned at 9 instead of 8, and the recognize law
pinned at `mis_keyed` 2 instead of 1, each gave exit 2. `set.json`'s recognize reasons are
checked by machine for the first time; before, the harness checked only the verdict. A check
counts a judged request, and an identity case is two requests, one per direction. So 150 is
20·2 + 19 + 15 + 18 + 10 + 21·2 + 6, and 20 is 16 + 4.
<!-- claim holds: `python -c "import json,glob; print(sum(len(json.load(open(f,encoding='utf-8'))['cases']) for f in sorted(glob.glob('vectors/node-*.json'))))"` == 98 -->
<!-- claim holds: `node tools/conformance/harness.mjs` contains (24 replayed, 4 of them the v2 codec's -->

**The judge was red-proved as well as the pins.** Each arm mutated one implementation on
the branch, ran the harness, and was restored. Go's attach rebuilding the parent without its
own value failed the 7 attach cases whose parent is valued (C1). Python's `get` inventing an
empty child failed 23 (C10 among them). TypeScript's equality ignoring own values failed 24,
and Rust's recognizer accepting a valued set node failed the 2 `valued_set_node` cases. Each
ran against a control at 209/209 in every implementation. <!-- claim recorded 2026-09-23: the four mutation arms and their failure counts are readings of one run on the cores/node-values branch, not a recomputable property. -->

**The operations beyond the accessors are derived, and are witnessed as derivations.** The
cores ship compose, decompose, own, the children, at and lifted equality, and no method that
[PATH.md](PATH.md) calls derivable. Attachment, replacement, split and plug, cuts and E are
written in each conformance CLI through those accessors. What these rows witness is that four
cores' accessors support the ADR's laws under one derivation per language. They do not
witness a library API for the derived operations, because there is none.

**The first replay found one corpus defect.** `node-invalid.json` repeated three of
`invalid.json`'s case names, which the harness refuses once both files are indexed. The
vectors lane fixed it in `89d6fad`, and no judgment changed.

**The codec.** `deixis-codec-v2` ([CODEC.md](CODEC.md),
[ADR 0011](design/0011-codec-for-mandatory-nodes.md)) is the grammar for this model. Its
laws are proved in prose in [CODEC-proofs.md](CODEC-proofs.md), with
[0008](design/0008-proof-obligations.md)'s v2 ledger. All four cores implement it, and every
run replays its corpus (the row above, and the detail below). It is still a **candidate**:
0006's clean-room implementation and the signed manifest are outstanding, so no v2 byte or
address is frozen. `deixis-codec-v1` is withdrawn and was never implemented.

**The control:** 39 + 145 + 14 + 150 + 20 = 368 node requests, the scripted binding family
adds 19, the scripted projection family 28 and the v2 codec 2833, so
`node tools/conformance/harness.mjs` prints `3248 requests over rs, go, ts, py` on every run.
Its envelope drive adds 13 checks, for 3261 per implementation.
<!-- claim holds: `node tools/conformance/harness.mjs` contains 3248 requests over rs, go, ts, py --> If these tables and that line ever
disagree, one of them is wrong and the run says so — which is the only reason a status
page like this is worth keeping.

> ⚠ **THIS PARAGRAPH WAS ITSELF AN INSTANCE, AND THE WORST ONE EITHER LEDGER HELD.** It
> quoted the run as printing `corpus: 41 named cases over 4 files`. The corpus line now
> reads `corpus: 86 named cases over 8 files (4 replayed, 4 indexed only …)` — changed by
> `74352a0`, **an extension this lane wrote**, which split the codec files out as indexed
> but unreplayed and never updated the sentence quoting the old output. ⇒ *The row's own
> success is what made its measurement false*, and because the paragraph **instructs the
> reader to treat a disagreement as an error**, a reader at freeze would have compared 41
> against 86 and concluded the table was wrong. The request count is the durable half and
> is what the control now quotes; the corpus line moves whenever a file is added, so it is
> named rather than transcribed.

**Distribution:** `@bitspark/deixis-core` and `@bitspark/deixis-pos` publish on tag
(`release.yml`); `@bitspark/deixis-set` is built and tested but not published. The published
`@bitspark/deixis-core` 0.1.0 is the previous model's API. The next release of it breaks that
API: `Node.leaf`, `Node.structure`, `emptyStruct`, `view`, `kind` and
`leafValue` are gone. Under ADR 0010, `Node.compose`, `decompose` and `own`
use the complete `T`; `at` selects subtrees. The helper `some` is available
when the caller chooses an optional payload. See [API.md](API.md).

**`deixis-codec-v2`, in detail**: [CODEC.md](CODEC.md) (normative, **candidate contract**),
[ADR 0011](design/0011-codec-for-mandatory-nodes.md), the prose proofs in
[CODEC-proofs.md](CODEC-proofs.md) with [0008](design/0008-proof-obligations.md)'s v2
ledger, and the [vector plan](../vectors/CODEC-V2-PLAN.md). It keeps 0006's order below.

At `98cb228` (2026-09-23) the corpus holds **115 cases and 88 chunks across four
files**. The vectors lane authored it from the contract text alone, before any v2
implementation existed.
<!-- claim recorded 2026-09-23: 115 cases and 88 chunks are the name-bearing entries of the four codec-v2-*.json files at 98cb228 -->

| file | holds |
| --- | --- |
| `codec-v2-flat.json` | 17 accept cases over five bundles |
| `codec-v2-linked.json` | 5 chunks and 5 cases: sharing, the bridge, the address |
| `codec-v2-invalid.json` | 46 flat and 15 linked non-acceptance cases, 11 streaming cases, 3 envelope cases, 83 chunks |
| `codec-v2-precedence.json` | 18 orderings, each with the code the natural strategy returns |

**Writing it found six contract gaps, and the codec lane pinned each before the corpus
merged:**
- the missing code for an impossible id;
- the id as a bounded input, the whole-id bound, and the dimension tokens (F1–F3);
- the state of a complete root on an open stream, and the field-extent rule (F4–F5).

**All four cores implement it, and every run replays the corpus against each of them.**
Implementing it found eleven more places where the text allowed two readings, each pinned
by the codec lane (I1–I5; I6–I11). 0006's conformance-suite mutation then found
the corpus blind to how keys are compared: no key had an octet at or above `0x80`, and no
chunk carried a key-order fault. A Python core planted with signed-octet or host-string key
comparison, or with a chunk parser that deduplicates or sorts on read, still passed every
request. Sixteen entries close it (batch 3 of the vector plan), and every core passes them.
Then §14's `resolve-root` and `resolve-child`, obligations of every `linked-resolver`, were
found to be observed by no operation: batch 4 adds `codec.navigate` to the protocol and 23
cases for it, authored before any core implemented it. All four serve it, and
every run sends it. Batch 5 adds 17 more from §14's pins on what a navigation judges:
the codec only at the answering chunk, the order inside a chunk, fetch order along a path,
and second cases where mutation found a defect killed by one check. Batch 6 deepens the 16
kills the mutation run still found at two checks (key order at the node model and at the
lookup, the id comparison at traversal and at resolve-child, unused links). The corpus now
holds 197 cases and 101 chunks.
<!-- claim holds: `python tools/count-codec-v2-entries.py` == 197 cases, 101 chunks -->

| core | commit | scoped claim (CODEC.md §16) | replayed |
| --- | --- | --- | --- |
| Go | `34ee041`, with I6 at the root | flat-encoder; flat-decoder and flat-header-validator, each streaming; linked-resolver; closure-checker. Codec-holding for the ids its caller's registry resolves (`00 01`, option-of over a held id, and what the caller supplies), codec-blind for every other. No chunk-store. | 3261/3261 in every run, CI-gated |
| Python | `1d29d7c` | flat-encoder; flat-decoder and flat-header-validator, each streaming; linked-resolver; closure-checker. Codec-holding for the ids its caller's registry resolves (`00 01`, option-of over a held id, and what the caller supplies), codec-blind for every other. No chunk-store. | 3261/3261 in every run, CI-gated |
| TypeScript | `9280f41` | flat-encoder; flat-decoder and flat-header-validator, each streaming; linked-resolver; closure-checker. Codec-holding for the ids its caller's registry resolves (`00 01`, option-of over a held id, and what the caller supplies), codec-blind for every other. No chunk-store. | 3261/3261 in every run, CI-gated |
| Rust | `7c70c3b` | flat-encoder; flat-decoder and flat-header-validator, each streaming; linked-resolver; closure-checker. Codec-holding for the ids its caller's registry resolves (`00 01`, option-of over a held id, and what the caller supplies), codec-blind for every other. No chunk-store. | 3261/3261 in every run, CI-gated |

## Witnessed in a neighbouring repo

**The ontos bridge** — `projection/deixis` in the ontos repository: `PROJECTION.md`,
Rust, Go and TypeScript implementations, its own vector file and test. It witnesses the
claim that the incumbent value floor is recovered exactly, under *that* repository's CI.
All three pin deixis v0.2.0, since ontos (`de193e2`, 2026-09-23). That was read from
ontos's manifests; the bridge's tests were not re-run here. Named here because a reader of this tree cannot otherwise tell that
the claim has a witness at all.

## How independent is a witness?

The tiers above say *whether* a claim is checked; they do not say how much the check is
worth, and the difference matters most exactly where this page looks strongest.

**Four implementations replaying one corpus catch disagreement, not shared misreading.**
`core/{rs,go,ts,py}` were written in one lane against vectors authored in that same
lane, so they are strong evidence that no implementation drifted from the others, and
*weak* evidence that all four read the specification the way its author intended. A
misreading present in the vectors is a misreading present in every implementation, and
the corpus will agree with itself forever.

**Two things in this tree attack that**, and they are the only two:

- **The ontos bridge** replays a corpus this repository did not author — ontos's frozen
  codec vectors, from a specification frozen before deixis existed. That is why it
  witnesses the recovery claim more strongly than any amount of internal replay could.
- **The clean-room commission** ([0007](design/0007-clean-room-commission.md), freeze
  step 3) buys the missing half deliberately: one implementation built from
  [CODEC.md](CODEC.md) *alone*, with this corpus withheld. Its deliverable is the
  implementer's **ambiguity log** — every place the specification failed to decide
  something — and a vector silently teaches the reading it encodes, so an implementer
  holding the corpus resolves ambiguities against the fixtures without ever noticing one
  existed. The log then comes back empty of exactly the findings being paid for.

⚠ **Consequence for anyone reading this page as a summary of what we can share:**
until `deixis-codec-v1` freezes, [vectors/](../vectors/) must not reach anyone
implementing the codec from outside, and the withholding is enforced by repository
access and nothing else. Granting access ends the commission *silently* — nothing
records that the corpus was seen, and the resulting log looks exactly as valuable as a
real one. The delivery rule is in [0007](design/0007-clean-room-commission.md).

## Two mutation challenges were run. The scores are 9/10 and 20/20, and both are weaker than they look

<!-- claim recorded 2026-09-03: every fraction in this section is a reading of one dated exercise (a human adjudication and a seeded-mutation run). There is no command that recomputes them and there should not be; re-running is what the next challenge is for. -->

0003 Verdicts row 7 asks for a **blinded
scope-mutation challenge**, on the reasoning that a review process which has never been
tested against a seeded defect is a process nobody has measured. The spec lane cannot run
it on itself — you cannot un-see a mutation you seeded, and a challenge you grade yourself
is a red arm that passes for the wrong reason. **Run 2026-09-03**: the vectors lane
seeded, the codec lane ruled, and the key was sealed until the rulings were in.

> ⚠ **CITE IT BY ROW, NOT AS "R7".** This entry first linked `design/0003-freeze-readiness.md`
> — **a file that does not exist**; 0003 lives in `research-docs/`, and `design/0003-` is an
> unrelated document. The `R<n>` shorthand both lanes use in commit trailers is *resolvable
> but undefined*: 0003 numbers its recommendations as bare rows in a **Verdicts** table, so
> `grep R7` returns nothing and a reader who has not opened the table cannot follow the
> citation. ⇒ Rows, with a working link.

⛔ **AND FIXING THE CITATION SURFACED THE LARGER PROBLEM: WHAT RAN IS NOT WHAT ROW 7
SPECIFIES.** The protocol is set out in
the advice, §1:

| the protocol asks for | what was run |
| --- | --- |
| *"perhaps twenty"* mutations | **10 diffs, 7 of them mutations** |
| *"mix the mutations into separate copies **without telling the auditor where they are**"* | **a numbered diff list — every location disclosed** |
| *"run the **existing audits** and the proposed new procedure"* | one reviewer; `speccheck` run ad hoc on two diffs, not against each copy |
| *"especially for mutations that would **alter addresses or the encoder image**"* | **ZERO of the seven touch an address or the encoder image** |

⇒ **This measured ADJUDICATION, not DETECTION.** Ruling ten pinpointed diffs is a
different and far easier task than finding hidden mutations in a six-hundred-line
document. The Verdicts row 7 criterion is *"a zero with **near-complete detection** of
seeded identity-affecting mutations is convergence evidence"* — and detection of
identity-affecting mutations is precisely the half that was **not exercised at all**,
because no seeded mutation could change an address. **The challenge Verdicts row 7 describes
remains unrun.**

```
ten diffs against CODEC.md at 95c4758 — seven seeded defects, three clean changes,
shuffled, count NOT disclosed. Each ruled DEFECT or CLEAN with the clause and the reason;
a hedge scored as wrong, and a right verdict for a wrong reason scored as no catch.

agreement            9 / 10
FALSE POSITIVES      0      — including on the nearest-miss decoy, a reordering of §9's
                              code ENUMERATION built to look exactly like a §10
                              PRECEDENCE swap. Ruled clean on the correct ground.
wrong-reason catches 0      — and three reasons were better than the key's
```

⛔ **THE ONE DISAGREEMENT WAS A SEEDING ERROR, NOT A MISS.** The key called a widened
antecedent (*"any profile that parses a `cuvarint`"* → *"every profile"*) a defect on the
reasoning that it binds `flat-encoder`. **It does not.** §3's three rules all have refusal
consequents, and §2.1's *a profile owes only what it can observe* recovers the antecedent
that was deleted — so the obligation set is unchanged and the reviewer's CLEAN was right.
⇒ **The rule added to fix this defect class defeated an attack aimed at that class**,
which is the strongest single thing the run established.

⚠ **AND IT BOUNDS THE INSTRUMENT, WHICH IS THE PART TO CARRY FORWARD.** Three caveats
apply, and the third is the one nobody would have predicted:

1. **The reviewer was not blinded** — two days of continuous reading of this spec. They
   said so before answering.
2. **The seeder was not blinded either.** Sites were chosen from what both lanes had been
   reading that day, so the sample is biased toward well-trodden text.
3. **The key was measured at 9/10, not assumed at 10/10.** ⇒ **A challenge cannot certify
   a reviewer to a higher reliability than its own key.** Any future run should record the
   seeder's error rate as a first-class number — this one surfaced only because the
   reviewer disagreed and was right.

⇒ **So the honest reading is: on ten pinpointed diffs two readers agreed on nine, and the
tenth was a seeding error the reviewer identified correctly.** That is evidence about
adjudication, it is *not* a freeze verdict, and it is a **fourth** bound on top of the
three above — the exercise did not test the thing Verdicts row 7 says would be meaningful.

⛔ **AND IT LEAVES VERDICTS ROW 11 EXACTLY WHERE IT WAS, WHICH IS THE HARDER FINDING.** 0003 Verdicts row 11 is
recorded in 0003 as *partially refuting the auditor*, and its sharp half is a claim about
**this corpus**, not about implementations: *"the contamination risk is shared authorship,
not code generation — a hand-authored corpus written only by the specification author
encodes the same unstated interpretation just as effectively"* ⇒ ***our corpus is
contaminated by construction unless a non-author shadow-authors part of it.*** Two lanes
are not two authors for this purpose. No mutation challenge, at any kill rate, substitutes
for it.

⭐ **ROW 11 IS A GAP AWAITING WORK, NOT A CEILING — AND A RELATED CASE WAS CLOSED THE OTHER
WAY, SO SAY WHICH KIND OF ITEM IT IS.** Everything above reports row 11 as *open*. That could
mean a gap awaiting work, or a ceiling awaiting a decision, and until 2026-09-09 this page did
not distinguish the two.

In ontos, the `ontos-over-deixis-v1` projection profile was closed the other way. A qualified
independent witness was found, but the witness could be used only once and could be lost at
any time, because its holder worked on the deixis side and might read the corpus incidentally.
Waiting therefore had a cost, and the maintainers recorded the profile `unwitnessed`
permanently rather than defer it.

⇒ **That reasoning does not carry over to row 11.** Closing early is rational only if the pool
of eligible witnesses shrinks without being replenished. For row 11 it grows: measured over two
weeks in September 2026, new candidates appeared at least thirty times faster than candidates could
have been used up. Waiting does not spend the option, so row 11 stays a gap.

⚠ **What row 11 needs cannot be measured here.** It needs someone *willing* to enumerate the
identity surface without having read `CODEC.md`. Whether such a person exists is a question
someone has to ask, not a quantity any log can show. So row 11 is active work for this
repository's lanes, finding candidates and asking them; it is not a decision handed to
anyone else, and not a pending item that no reader could discharge.

### The defect this section shipped, and the gate that now catches it

⭐ **The dangling citation above was introduced by the commit recording how carefully the
specification had been reviewed** — a file name that never existed, in the sentence
claiming the review process had been measured. It was found by hand. **Nothing in CI
would have found the next one**, although `ci.yml`'s `paper` job has refused undefined
LaTeX cross-references since the paper existed: the gate was there for one document
language and absent for the other.

`tools/linkcheck.py` closes that asymmetry and is wired into the `spec` job. It reports every relative link in every
tracked `.md` and refuses the build if one does not resolve; **the count itself is
deliberately not transcribed here.**

> ⚠ **BECAUSE TRANSCRIBING IT FAILED IMMEDIATELY, WHICH IS THE BEST EVIDENCE THE RULE
> ABOVE HAS.** The first repair of this very paragraph wrote *"250 relative links across
> 52 files"*, read seconds earlier. **The same edit added one link — to 0003, in the
> standing rule — so the sentence was false when it was written, in the commit that
> existed to fix exactly this.** ⇒ *A live count transcribed into prose is stale at the
> moment of writing whenever the writing itself is part of the corpus being counted.*
> The gate is the number; the page names the gate. It was landed with both arms run, against the tree as it stood then:

```
green  243 links / 51 files  (at f6665bb)                            rc=0
red    a planted link                     -> reported at its line    rc=1
red    THE ORIGINAL DEFECT, replayed      -> EVIDENCE.md:85          rc=1
```

⚠ **It decides existence, not correctness.** A citation pointing at a real but *wrong*
document still passes, and the original defect had a plausible-looking target — so this
gate would have caught it only because the file was absent. ⇒ **The narrower lesson is
the durable one: a check that reads the source is the only kind that survives the reader
who wrote the text.**

### The real challenge: 20/20 by the reader, 0/20 by every machine

The exercise above measured adjudication. **The one Verdicts row 7 asks for was then run
properly** — a seeded *copy*, no diff list, locations and count undisclosed, twenty
mutations weighted to the identity-bearing sections (§3, §5, §6, §7). Every anchor matched
exactly once or the mutation was dropped rather than guessed; none was dropped. No decoys
were seeded — the six hundred unmutated lines are the decoy surface, so a report against
untouched text is a false positive.

```
seeded              20      (12 identity-affecting, 8 scope / verdict)
reported            20
matched             20      MISSES none · FALSE POSITIVES none
identity-affecting  12 / 12
undisclosed sites   18 / 18   (two sites were contaminated by a prior commit naming
                               them; the reviewer flagged both unprompted)
seeder key errors    0      (one in the morning run — see above)
```

⛔ **AND THE HEADLINE IS THE OTHER NUMBER: every existing audit passed the mutated file
clean.** Measured independently by both lanes, before and after the read:

```
speccheck 0 · linkcheck 0 · derive-vector-profiles 0 · conformance 103/103     0 / 20
```

⇒ The tools check cross-references, code declarations, digest arithmetic and profile
agreement. **None of them reads a sentence for meaning**, so a mutation leaving the
document's graph intact is invisible to all of them by construction.

### ⛔ Why 20/20 is weaker than 9/10 was, and four of the five reasons are the seeder's

⭐ **A perfect score is the outcome that hides the most** — the reviewer's own formulation,
made before this run.

1. **THE MUTATIONS WERE SELF-REFUTING BY CONSTRUCTION, AND THE KEY'S OWN DISCIPLINE IS
   WHY.** After the morning's seeding error every mutation was required to carry a
   *verified* field stating **what does not recover it** — and the cheapest way to prove a
   mutation is genuinely a defect is to choose one a neighbouring sentence contradicts.
   The reviewer's reasons show the result: *"self-refuting with its own next clause"*,
   *"contradicts rule 2 two lines down"*, *"refuted by its own following clause"*.
   ⇒ **Seeding-for-verifiability and seeding-for-difficulty are in direct tension**, and
   this run optimised the first while claiming the second. ⚠ **A real drafting defect is
   the opposite shape — locally consistent and globally wrong — which is exactly why it
   survives review.** Almost none were seeded. **This bound dwarfs the other four.**
2. **The base commit and both digests were disclosed**, so a diff was one command away.
   The reviewer states they did not take it and correctly notes nobody can verify that.
   ⇒ **A blinded challenge must be seeded from a base the auditor does not hold** — a
   requirement the reviewer stated and the seeder violated in the same exchange.
3. **THE TWO LANES SHARE ONE WORKING TREE, so "do not pull" was unenforceable.** A gate
   answering 17/20 sat in `tools/` for the last three minutes of the read. ⚠ **The seeder
   held a standing note about the shared checkout** — it is why staging here is by
   pathspec and never `git add -A` — and applied it to staging all day while failing to
   apply it to blinding. ⇒ **A blinding protocol that assumes separate working trees fails
   silently when both lanes share one**, and it would equally have leaked an answer key, a
   fixture, or a stray note. The gate is not the hazard; the tree is.
4. **The reviewer wrote most of the sentences.** For an author, reading for meaning partly
   means recognising text that is not theirs — a different faculty from an independent
   implementer's.
5. **The three-minute hint surface, disclosed unprompted by the reviewer**, and the
   sharpest available test points away from its use: `pins` is silent on exactly three of
   the twenty sites, and **the reviewer found all three**. A pins-guided reader
   over-focuses on the seventeen pinned sites and is blind to precisely those. Running
   `pincheck` in the shared tree also checks the tree's *unmutated* spec and returns green,
   so using it against the challenge required deliberately overwriting the tree's copy.

⇒ **So this measures: can a document's author detect twenty locally self-contradicting
edits? Completely, yes.** It does **not** measure sensitivity to the defect class that
actually ships.

### What the two instruments each caught

```
                      identity (12)    scope (8)     total
  pincheck               12 / 12        5 / 8       17 / 20
  the reader             12 / 12        8 / 8       20 / 20
  every other gate        0 / 12        0 / 8        0 / 20
```

⭐ **The three `pincheck` missed are exactly the three caught by meaning** — narrowed
antecedents no case quotes. ⇒ *Pins catch identity, a reader catches scope.*

⭐ **And `pincheck`'s 17/20 is invariant to bound (1)**, which was not anticipated: a
machine does not care whether the contradiction is local, only whether the pinned text
changed. ⇒ **A falsifiable prediction: against locally-consistent mutations the mechanical
number should hold and the human number should fall.**

### ⛔ The prediction was tested the same day. It held — and it broke the 17/20

The mechanical half needs no blinded reader, so it was run immediately. Twenty
identity-affecting mutations, **every one made locally consistent** by also editing the
neighbour that would betray it, over a surface enumerated from §3, §5, §6 and §7
**without consulting the pins file**. Two axes had been conflated and they separate
cleanly:

```
LOCAL CONSISTENCY   pincheck did not care at all           ** INVARIANT, as predicted **
COVERAGE            whether a pin exists at the site       ** 10 / 20 **
```

> ⛔ **THE SAME LANE COMMITTED THIS AGAIN THAT EVENING, HOURS AFTER WRITING THIS
> PARAGRAPH.** Diagnosing an unrelated tooling failure, the vectors lane misread one line
> of its own log, built a model of the failure on that misread, and validated the model
> against the one sample it came from. The codec lane's sample refuted it immediately. ⇒ ***Built from one sample, on a misread of that sample, checked against
> the same sample*** — this section's defect, in a different domain, by the author of this
> section, on the same day. ⚠ **Familiarity with a class is not immunity to it, and the
> interval here was hours.**

⛔ **AND THE 17/20 COULD NEVER HAVE ANSWERED THE COVERAGE QUESTION.** The pins were
written *after* the twenty mutations were seeded, by someone who knew all twenty sites —
so it measured a check built against a known answer set, and it was published as though
it measured coverage. **Same circularity as everything else here, this time in the
headline number of the instrument built to catch it.**

⭐ **The gap was not random, which is what made it fixable.** The first pass pinned the
numbered *"Canonicality rules, each a MUST"* lists and §7's bullets — **the prose** — and
left the code blocks defining the byte layout almost entirely unpinned: `header :=`,
`chunk :=`, `lentry :=`, `hash{32}`, and the LEB128 sentence. ⇒ *Prose reads like a
requirement and grammar reads like description, so prose is what a pin-writer reaches for
— while grammar is what determines the octets.*

⛔ **The worst survivor was the definition of an integer octet.** Reversing *"seven bits
per octet, **least-significant group first**"* changes every integer in both forms, hence
every address in the system, and **nothing pinned it**. That one sentence outranks most of
what the first pass did pin.

Repaired to 20/20 at `7aec3d7` — 95 fragments over 38 cases. ⚠ **And that number is
circular in its turn and is not offered as a coverage claim**: the surface is also the
pin-writer's, enumerated by the same hand that then pinned against it. The visible gap was
closed; the next unknown-unknown is exactly as unknown as before.

⇒ **Every number here is bounded by whoever enumerated the surface, and the escape is an
enumerator who is not the pin-writer.** ⭐ *Verdicts row 11, arriving somewhere neither
lane expected it — not in the corpus, but in the instrument built to check the corpus.*

### The first non-circular number: 17/25 against a surface the other lane enumerated

The codec lane then enumerated the identity-affecting surface **from `CODEC.md` alone** —
34 sites — and marked which of them an earlier message from the vectors lane had already
named. ⭐ **Scoring against those would have handed back the same answer key with additions
on top**, so only the 25 *blind* sites count. Their criterion, stated so it could be
rejected: *a site is identity-affecting iff changing it changes, for at least one value,
either the octets a conforming encoder emits or the 32-octet address computed* —
deliberately narrower than "normative", which puts §9's classes, §10's precedence, §12's
floors and §16's governance out of scope.

```
  self-graded, circular       20 / 20
  THE PEER'S BLIND SURFACE    17 / 25     <- neither lane controlled both ends
  after closing the gaps      25 / 25
```

⛔ **The eight misses cluster in three shapes that were invisible from inside the
pin-writer's own enumeration:**

1. **The BINDING rather than the rule.** §3's *"every grammar in this specification writes
   `cuvarint`, never `uvarint`"*. With all three canonicality rules intact, one grammar
   position saying `uvarint` admits two spellings of a value — and therefore two
   addresses. The rules were pinned; the sentence that binds them to the grammar was not.
2. **The DEFINITION under a rule.** §2's lexicographic order, including *"the shorter
   string orders first"*. ⭐ **The sharpest miss in the whole exercise**:
   `flat/prefix-order-a-before-ab` exists precisely to pin that tie-break, and the sentence
   defining it was unpinned. ⇒ *The case pinned the rule that keys are sorted and not the
   definition of sorted.* Reversing the tie-break re-orders every struct holding a key that
   is a prefix of another — different octets, different address — while the rule above
   still reads as satisfied.
3. **A section never enumerated at all.** §13's id production and its 2..32 length bound,
   which travel *inside* the hashed octets and so are identity-affecting on §7's own
   argument.

Closed at `909a204`; 139 fragments across 40 cases. ⚠ **Two anchors were refused rather
than guessed** during the pass, both from a hard-wrap indent, and both corrected against
the file. ⚠ **That commit's subject line says `17/24`** — a stale reading taken while one
site's *mutation* anchor was malformed and the site went unscored; the measured figure is
**17/25**, confirmed against the pre-fix tree. The subject is not being rewritten, because
history on `main` is shared with the other lane.

⚠ **AND THIS IS STILL NOT ROW 11.** Both lanes learned this codec from this document, and
**both have now been told that grammar is where the pins were missing** — that correction
is itself a shared prior. ⇒ *A defect neither lane can see because they read the same prose
is exactly what row 11 is for.* 25/25 is strictly better than grading one's own
enumeration, and it is not closure.

### Site 35, and the limit that `pins` cannot cross

The codec lane's enumeration excluded §4's lawfulness — `x ≈ y ⟺ e(x) = e(y)` — on the
ground that it *"cannot be broken by editing this file"*, then recorded the exclusion
itself as a defect: **a criterion was published and a second one silently applied.** The
stated criterion was *changing it changes the octets or the address*; what was applied was
*mutable by editing `CODEC.md`* — the shape of the instrument to hand rather than the shape
of the question. ⚠ *The recurring class again, this time in the enumeration rather than in
the specification.*

⇒ **And the substituted criterion also returned the wrong answer.** The ground holds of the
**obligation**, which falls on the slot; it fails of the **sentence**, which is editable
like any other. Weakening the biconditional to an implication lets two non-equivalent
values share octets — **one address then denotes two values.** Measured `UNCOVERED`, and
now pinned on the seven cases whose octets depend on `e` being injective up to the slot's
equivalence.

⛔ **§8's law 1 was measured under the test the codec lane proposed for it** — *a pin on the
laws earns its place only if it catches something no pin on A–E catches* — **and the test
cannot decide what it was built to decide:**

```
site 35 (§4 lawfulness)         UNCOVERED  ->  COVERED
§8 law 1 (flat canonicality)    UNCOVERED before AND after
```

Two situations produce that identical reading:

```
(a) law 1 IS a site and is uncovered          -> the decomposition is wrong
(b) A–E genuinely ENTAIL law 1, so weakening  -> uncovered is CORRECT, and the pins
    its statement changes no octet any            are right to be silent
    conforming encoder emits
```

⇒ ***`pins` measures textual dependence; the question is entailment, and no amount of
pinning distinguishes the two.*** Settling it means deciding whether A–E entail
`encF(x) = encF(y) ⟺ x =_≈ y`, which is a **proof obligation, not a measurement**.

⭐ **AND IT WAS ALREADY SETTLED — IN WRITING, WEEKS AGO.** This was first recorded here as
a judgement; it is not one. [0008](design/0008-proof-obligations.md) partitions premises
from theorems explicitly, and its rows answer both halves:

```
§2  ASSUMPTION INVENTORY
    A2   lawfulness  x ≈ y ⟺ e(x) = e(y)     where stated: CODEC.md §4     <- SITE 35
§4  LAW 1, DERIVED
    O1.2 encF injective up to =_≈             depends on: L1, ** A2 (⟸) **
```

⇒ **A2 is an assumption; law 1's obligations are derived from it.** So (b) holds
structurally: §8's laws are theorems about what §5 already forces, and mutating a theorem's
statement changes no octet. **The lane held as judgement what the ledger had settled — and
the ledger was not consulted before a pin-based test was proposed for it.**

⛔ **Sharper, and neither lane predicted it: `O1.2` depends on `A2 (⟸)` — precisely the
direction the site-35 mutation weakened.** The `⟺ → ⟹` edit removes exactly the half that
obligation leans on. ⇒ ***A dependency column written weeks earlier names which proof
obligation the mutation breaks, and the `pins` measurement found the same sentence from the
other end.*** Two instruments built for different purposes, agreeing without being made to.

⭐ **A2's citation is now transitively checked, which answers a gap the codec lane raised
in the same exchange.** They noted that 0008 cites `CODEC.md` and *nothing recomputes the
citation* — finding 5.1 sat closed-but-reading-open for five days, and A5's *where stated*
said "nowhere, normatively" while §4 stated it. **A2 is no longer exposed that way**: the
sentence it names is pinned by seven vector cases, so editing it fails CI — ⚠ **by accident
of the corpus needing it, not by design**, which is the reason to measure the rest rather
than assume them.

⛔ **MEASURED, BY MUTATING THE SENTENCE EACH ASSUMPTION RESTS ON:**

```
A2  lawfulness                      PROTECTED  (7 cases)
A3  e total and computable          PROTECTED  (7)
A4  D an exact partial inverse      PROTECTED  (3)
A5  im(e) membership DECIDABLE      *** UNPROTECTED ***
A6  SHA-256 collision-resistant     *** UNPROTECTED ***
```

⇒ ***A5 is the finding.*** It is the assumption that had **already** demonstrated citation
drift here — the one whose *where stated* read *"nowhere, normatively"* for five days after
§4 stated it — **and it was the one nothing guarded.** The failure that actually occurred
was unguarded against occurring again.

Closed to 5/5; 158 fragments over 40 cases. ⚠ **A1 rests in `SLOTS` rather than `CODEC.md`
and is out of a `CODEC.md` pin's reach by construction** — stated rather than silently
counted as covered, so 5/5 is of the five a pin could reach.

⚠ **AND THIS GUARDS THE SENTENCES, NOT THE CITATIONS.** A5's drift was a *where stated*
field going stale while the sentence was correct; pins fire when the sentence changes.
⇒ **The direction that actually failed is still unguarded**: a section-granular citation
(*"§4"*) cannot be pinned the way a sentence can, and only reading catches an inventory row
that describes the wrong world.

⭐ **This yields a sharper discriminator than "is it in a section anyone enumerated":**
*a sentence is a SITE if mutating it **licenses encoder behaviour the rest of the document
does not otherwise forbid**, and a CONSEQUENCE if it does not.* §4 states an obligation on
the slot, so it is a site. §8's laws are asserted about what §5 already forces, so they are
not — **and that is a claim about entailment, which is exactly why it belongs in the proof
bundle rather than in a gate.**

### The identity-affecting class had a kill rate of zero, and now has one of 12/12

0003's Verdicts row 7 singles out one class as the meaningful one — *mutations that would
alter **addresses or the encoder image***. For that class the grader need not be a reader:
a mutation to the rules that determine bytes should break something mechanical.
**Nothing did.** Measured against a 20-mutation copy of `CODEC.md` — 12 of them changing
which octets are canonical — scoring only against gates green at baseline:

```
speccheck 0 · linkcheck 0 · derive-vector-profiles 0 · conformance 103/103
                                              mechanical kill rate:  0 / 20
```

⛔ **AND THE MECHANISM NEEDED NO LARGER SAMPLE.** Nothing derived the corpus's bytes from
the prose:

- `speccheck` recomputes each published digest **from the preimage printed beside it**.
  That is internal consistency — `sha256(bytes) == sha256` holds whatever CODEC.md says
  about ordering.
- the conformance harness replays vectors against implementations **of the floor**. The
  withdrawn v1 codec never had one. The v2 codec's cores land one at a time and are
  replayed under `--codec` (see its entry below).
- `speccheck` states its own boundary in its output: *"out of reach of this tool: whether
  a stated scope is the intended one."*

⇒ Key ordering could be reversed from ascending to descending, and **the cases asserting
those very bytes would not notice.**

<!-- claim holds: `grep -c "cuvarint" docs/CODEC-v1.md` == 15 -->
<!-- claim measured-at 2026-08-24: `grep -c "conformance profile" docs/CODEC.md` == 0 -->
<!-- claim holds: `grep -c "conformance profile" docs/CODEC.md` == 1 -->

⚠ **THE ZERO DIRECTLY ABOVE IS HISTORICAL AND ITS LIVE COUNTERPART WAS MISSING UNTIL
2026-09-22.** `measured-at` means *nothing re-runs this*, so the line sat at `0` while
`CODEC.md` moved to `1` (§2.1's conformance profiles, landed `e791a42` on 2026-09-03).
**The date made it honest and the absence of a live twin made it stale-looking**: a reader
meets a zero with no adjacent claim saying what is true now.

⇒ **`0003` row 2 already solved this for the same measurement and this page did not copy
it** — it carries *both* markers, the `measured-at` zero and a live `holds`, with its
reason stated: *"the count is kept in the past tense on purpose — re-running it today
returns a non-zero and would read as refuting the row rather than as the row's own
repair."* ⇒ **The pair is the unit. A `measured-at` alone preserves a fact and abandons
the question it was answering.**

*(The two use different needles — this page greps `conformance profile` and returns 1,
`0003` greps `conformance profile|header-only validator` and returns 2. Both are correct
for their own sentence; neither is a recount of the other.)*

✅ **AND IT WAS THE ONLY UNPAIRED ONE — swept, because one instance invites a reader to
distrust the marker itself.** All three `measured-at` claims in the tree, checked for a live
twin: this one (now paired), `0003` row 2 (*paired, and the model this fix copied*), `0003`
row 4 (*paired:* `cuvarint == 15`). ⇒ **`measured-at` is not a loophole in practice — it was
used correctly twice and incompletely once.**

### `pins`: the binding that was missing

A `pins` entry on a case is not a citation for the reader. It is the claim ***if this text
changes, these bytes are no longer the right answer.*** 37 cases, 55 fragments, 24
distinct. Every fragment was verified uniquely present before being written — a pin typed
slightly wrong fails forever and teaches everyone to switch the gate off.

Scored against the sealed answer key **before the reviewer reported**, so the number could
not be tuned to what they found:

```
                     pincheck    every other gate
overall               17 / 20         0 / 20
identity-affecting    12 / 12         0 / 12
```

⭐ **The three survivors are all SCOPE mutations** — a narrowed antecedent that no case
quotes, including the §3 antecedent the two lanes disagreed over in the morning run.
⇒ **Pins catch identity; they do not catch scope.** Scope is what a reader and 0008's
proofs are for. ⇒ *The two halves are complementary rather than redundant* — a better
argument for keeping both than either lane made when they were the only instruments.

⚠ **THIS IS NOT A PROOF THAT THE CORPUS FOLLOWS FROM THE SPECIFICATION and must not be
read as one.** It misses any semantic change made where no case quotes; it is exact-match,
so an editorial rewording fails it. **A codec implementation is still the first artifact
that must read the rule and produce the octet**, which is 0006's ordering and is unchanged
by this. What `pins` buys is narrower and real: the corpus now notices when the sentence
it was written against stops saying what it said.

⚠ **Two of the twenty were skipped rather than guessed** in an earlier pass — an anchor
that matched seven times is not a mutation, the same discipline as a vector.

### What a third run needs — all three, or it measures nothing new

```
1. seed from a checkout the auditor does NOT share, hand over only the file, name no base
   -> kills the diff, the shared tree and the mtime leak together
2. LOCALLY CONSISTENT mutations — the seeder must then verify by global reasoning, with
   no neighbouring sentence to check against
3. a reviewer who is not the author — Verdicts row 11, untouched by any of this
```

## Specified, deliberately unwitnessed

**`deixis-codec-v1`**: withdrawn at the version boundary
([ADR 0011](design/0011-codec-for-mandatory-nodes.md) §5) and kept as that candidate's
evidence. It comprises [CODEC-v1.md](CODEC-v1.md),
[0006](design/0006-canonical-codec.md), the reviewed [vector plan](../vectors/CODEC-PLAN.md),
and the [clean-room commission](design/0007-clean-room-commission.md). The entry below is
its record as written, apart from the tripwire's re-pointing. 0006 fixes the
order — *review of the record → normative spec → hand-authored vectors → only then
implementations* — because bytes are the one artifact class where a defect is a
migration nobody gets to make.

⚠ **THIS ENTRY SAID "Zero vectors, zero implementations" AND THE FIRST HALF STOPPED
BEING TRUE ON 2026-09-03.** The corpus now stands at **40 cases and 5 chunks across
four files**, hand-authored from the spec:

| batch | file(s) | what it fixes |
| --- | --- | --- |
| 1 | `codec-flat.json`, `codec-linked.json` | the laws, canonicity, sharing, the bridge, the address |
| 2 | `codec-invalid.json` + the link codes | **all fifteen §9 invalid codes**, plus the unsupported class boundary |
| 3 | `codec-precedence.json` | 9 §10 precedence cases, and 3 orderings recorded as **unexercisable** |

**Zero implementations remains true and remains by construction** — that is the half
0006 is protecting, and it is why the corpus is ahead rather than late.

⇒ **So the codec now occupies a state the four tiers above do not name: AUTHORED BUT
UNREPLAYED.** Nothing runs these octets.

> **Re-pointed 2026-09-23, at the version boundary ([ADR 0011](design/0011-codec-for-mandatory-nodes.md)).**
> The gate below keyed on `4 indexed only`, the count of v1's files. v1 is now the withdrawn
> candidate and can never gain an implementation, so that line would have held forever and
> the gate would have died silently at the boundary. It now keys on the v2 count, which the
> harness computes from its list: the day a v2 file moves to replay, the number drops and
> this line fails. The event it watches, the codec gaining an implementation, can now only
> happen to v2. Each batch that adds a v2 file re-measures the count here.
>
> ⚠ **Corrected when the first v2 core landed (Go).** This gate fires when the
> default run starts replaying v2, which waits for all four cores. It does **not** fire
> when the codec first gains an implementation, which happened with the Go core. So the sentences
> below were re-read by hand at that merge, as this note says a person must. Changed:
> the harness's summary line, `vectors/README.md`'s scoped-conformance paragraph,
> `tools/conformance/README.md`'s indexing sentence, this page's harness bullet and its
> registry note (both now v1-scoped), and the v2 entry above. The v1 sentences stay:
> v1 never had an implementation, and never will.
>
> ⭐ **Fired at the default switch, as designed.** When all four cores had landed, the
> harness began replaying the v2 files on every run, the line this gate read stopped
> printing `4 v2 codec files indexed only`, and the gate failed. Every sentence it
> guarded was re-read in the same change: the harness line, both READMEs, the repository
> README's count, this page's codec paragraph, its control, and the v2 entry, now moved to
> the conformance section. The gate is retired. What replaces it is a claim that the run
> replays the v2 files, which fails if replay ever stops.

<!-- claim holds: `node tools/conformance/harness.mjs` contains 4 of them the v2 codec's -->

> ⭐ **NINE SENTENCES ACROSS THIS PAGE AND `vectors/README.md` ASSERT THAT THE CODEC HAS NO
> IMPLEMENTATION, AND THEY ALL BECOME FALSE AT THE SAME INSTANT.** They are the second
> direction of citation drift — *the citation is faithful and the source is stale* — which
> `claimcheck` cannot see (nothing quotes a command) and `rotcheck` cannot see (no number,
> no date). ⚠ **A grep worklist for negative existentials measured 9 of 14 useful here**,
> and it would still be a fuzzy instrument for a sharp fact. ⇒ *They do not need nine
> checks; they need one*, because they are nine restatements of a single event that has not
> happened. The claim above is that event: the harness prints `4 indexed only` while the
> codec has no implementation, and the day it does, this line fails and every one of the
> nine gets re-read by a person. **A precise gate on the fact beats a fuzzy gate on the
> prose about the fact.** The distinction worth holding is between two
different claims the corpus makes:

```
its INTERNAL CONSISTENCY   ENFORCED - three checks, none of which reads the grammar:
                           · speccheck gates the 29 cases carrying a verdict against
                             §2.1's profile table
                           · the harness indexes all 86 names corpus-wide and refuses
                             a duplicate name or a dangling ref
                           · every published digest is recomputed from the preimage
                             printed beside it, 9 of 9, and CI fails if one disagrees
its claims about OCTETS    UNWITNESSED - no implementation parses a single byte of it,
                           and a case whose bytes are THE WRONG BYTES passes all three
```

⭐ **The third check is the one worth explaining, because it looks like it crosses the
line and does not.** `sha256` is not the codec: recomputing a digest needs no grammar,
no leaf codec and no decoder, so the check is not a step toward the reference
implementation [0007](design/0007-clean-room-commission.md) withholds from the spec
lane. **That is exactly why this property was available and the rest are not** — every
remaining claim the corpus makes requires reading the octets as a *value*, which is the
thing no one here may write yet.

⇒ **And it does not move the bound above; it moves what the bound is about.** Before,
`method` blocks *offered* readers a recomputation — *"a digest with its preimage is
evidence; one without is an assertion"*. Those nine numbers had in fact been recomputed
several times, by both lanes, in ad-hoc scripts that were never committed — so a reader
taking the corpus at face value had **our word** that the arithmetic held. Now CI does
it every run. The octets can still be the wrong octets; a digest that disagrees with the
bytes printed beside it can no longer survive.

⇒ **A vector file that nothing replays is stronger than prose and weaker than a
witness**, and calling it either would misreport the codec. It is mechanically
replayable the moment an implementation exists, and until then it is one careful
reader's arithmetic.

⚠ **AND THE WITHHOLDING BELOW CHANGED FROM PROSPECTIVE TO LIVE.** While this entry
said *zero vectors*, "the corpus must not reach an outside implementer" described a
future artifact. There is now something to leak, it is complete enough to answer most
of what a clean-room implementer would otherwise have to decide for themselves, and
the protection is still repository access and nothing else.

⚠ **One thing about it IS enforced now, and the boundary is the point.**
`tools/speccheck.py` runs in CI (job `spec`) and gates the specification's **own
internal graph**: every `§N` reference resolves, every result code §9 declares is
ordered somewhere and the text says where, and no code is used without being
declared. It found `non_canonical_payload` missing from §10's precedence discussion
on its first run, and all four of its checks are red-proved — including that a
missing `CODEC.md` **refuses (exit 2)** rather than reporting clean.

⇒ **That moves a narrow class of claims from *stated* to *enforced* and moves nothing
else.** The tool decides facts about the document; it has no opinion about the octets,
so `deixis-codec-v1` stays behaviourally unwitnessed exactly as this section says.

⚠ **AMENDED: `speccheck` now reads `vectors/` too, and the boundary above needed
restating rather than deleting.** It checks §2.1's profile table against the corpus's
*claims about that table* — that every case's `code` is one its named profile may
report, and that the profile names in the spec and in the derivation agree. **It still
has no opinion about the octets:** no vector's bytes are parsed, and a case whose
octets are wrong passes this check exactly as before. What is enforced is a
cross-reference between two documents, which is the same kind of fact as the four
above.

⇒ **It exists because the drift it catches occurred, in one hour, between two agents
who were both being careful.** Widening `flat-header-validator`'s may-report set
(`a5b6a2a`) lowered the correct `min_profile` for a case authored an hour earlier
(`5837d0e`); nothing announced it, and the stale field stayed syntactically valid.
⚠ **Direction is the quiet one** — a too-high `min_profile` does not make a case
unfalsifiable, it makes it **under-demanding**: an implementation that should have been
required to report the fault is never asked to.

⚠ **THREE THINGS THIS CHECK FOUND IN ITSELF, all on its first runs.**

1. Its parser read **every** backticked code in a `may report` cell as *permitted*,
   including the one in *"never `non_canonical_payload`"* — a polarity error that
   demanded the corpus grant a profile the exact code §2.1 forbids it.
2. The guard against (1) was written with a word-boundary escape that collapsed to a
   literal **BACKSPACE (0x08)**, so the pattern silently never matched. The pre-write
   assertion missed it because it tested for **one specific control byte — the one the
   cautionary story names** — rather than for control characters as a class.
3. Its own red arm **could not fire**: importing the derivation tool *executed* it,
   which re-derived and rewrote the corpus before the check read it. The check repaired
   the defect it was about to look for, and `speccheck` was mutating `vectors/` on every
   CI run. Fixed in the derivation tool by a `__main__` guard — **importing a table must
   be a read.**

⇒ **Only (3) was found by testing. (1) and (2) were found by the check FAILING on its
own first run** — which is the argument for landing a gate red and reading what it says,
rather than tuning it until it is green.

⚠ **And (2) recurred while this very paragraph was being written**: the prose describing
the collapsed escape contained the same escape, and collapsed identically. It was caught
only because the assertion had by then been widened from that one byte to the whole
class — **so the fix for the defect is what caught the defect's second instance, in the
sentence describing it.** Recorded because the lesson is not "be careful with escapes":
it is **assert on the bytes you are about to write, over the whole class, never on the
one instance you have met.**

⛔ **And it deliberately cannot check the defect class that has produced the most
findings.** Four of [0008](design/0008-proof-obligations.md)'s — 5.2, A1, C2, C3 —
were *right rulings stated more widely than they hold*, which is a claim about the
world the spec describes rather than about the document. `speccheck` prints those
sentences as a **worklist** and **never fails on
them**
<!-- claim holds: `python tools/speccheck.py` contains WORKLIST 1 - 18 normative universals -->, because a worklist that can fail is a worklist someone deletes. **The proofs
close that half, and nothing cheaper does** — a proof assistant makes every
quantifier's domain explicit, and an over-wide claim simply fails to close.

## Proved but unbuilt

**The sequence container** — the paper's `prop:pos-transport` gives the dense-domain
sequence reading its retraction, exactness and identity-transport laws. Nothing in this
repository stands under it: no implementation directory, no vectors, no harness
operations, no minted profile name. Note the distinction this ledger exists to keep
visible: `deixis-pos-v1` is the **spelling** and is witnessed; the **container** over
that spelling is proved and unbuilt. ([0002](design/0002-positional-keys.md) is explicit
that it fixes the spelling and nothing else.)

**`deixis-set-v1`, node-member form** — the original self-keying scheme is superseded
(exponential under nesting); the sorted-positional replacement is sketched in
[0005](design/0005-set-keys.md) and ratifies with the codec.

## Stated, with a named future witness

**The ADR 0010 mandatory node model** moved to *Witnessed, not proved* on
2026-09-23 with the core implementation and replay recorded above. At `55c4f13`
it had 118 authored cases, zero replayed checks and zero implementations.
The independent spelling review in `347c726` expanded it to 121 cases; the
current checks execute that revised set in all four languages. The mandatory
structural proofs are delivered in paper v4 for v0.2.0, integrating and completing
the earlier paper branch as recorded in the
v4 scope note.
The concrete codec proofs and freeze remain outstanding.
<!-- claim holds: `python -c "import json,glob; print(sum(len(json.load(open(f,encoding='utf-8'))['cases']) for f in sorted(glob.glob('vectors/mnode-*.json'))))"` == 121 -->
<!-- claim holds: `grep -c "mnode-identity.json" tools/conformance/mandatory.mjs` == 1 -->

**The ADR 0009 node model** moved to *Witnessed, not proved* on 2026-09-23, when the four
cores implemented it and the harness began replaying its vectors (`929c0b7`). While it stood
here it had 98 cases, 0 checks and 0 implementations, and one independent result: a
convergence, not a check. The spec alignment and the expectations were written by different
lanes, each from the ADR alone. When they were compared, each side had found **exactly one**
defect in the spec, and it was the same one: cutting's domain was missing from PATH.md, fixed
in `8a3304f`. The tripwire that stood under this entry, `grep -c "node-identity.json"
tools/conformance/harness.mjs == 0`, fired as designed on the day the files were registered.
Its successor is the replayed-file claim in the entry's new tier, now including
ADR 0010's independent mandatory corpus and the additional direct-payload cases.

**The routing law** — [WIRES.md](WIRES.md) §4. Its structural half is *proved*
(resolution as a partial action of the free key monoid, commuting with `map`); its
crossing half has no battery, and the record says so in its own header. The witness it
names is two nodes on the identity wire in one process, which is cheap once a place
layer exists to host it.

**The leaf-codec registry** — `deixis/identity-bytes` (`00 01`), `ontos-codec-v1`
(`00 02`), and the fixtures' private id ([vectors/README.md](../vectors/README.md)).
Assignments in a registry whose codec does not yet exist.

> ⛔ **THIS ENTRY READ *"so nothing exercises them"* UNTIL 2026-09-03, AND THE VECTORS LANE
> HAD MADE THAT FALSE ITSELF.** The codec corpus exercises all three: **18 cases carry
> `0001`, 3 carry the private id form, 2 carry the reserved `0xff` boundary** — **23 of
> 41**. ⚠ *First reported as 23 of 45.* The four codec files hold **45** name-bearing
> entries but only **41 carry `bytes`**: `linked/cases` assert relationships between
> named chunks and have no octets of their own, and **an entry with no bytes cannot
> exercise a registry id at all**, so counting them understated the ratio. ⇒ The
> denominator is *codec-file entries carrying `bytes`*, recomputed by
> `tools/count-codec-cases.py` — the codec lane could not reconstruct 45 from the tree,
> which is the same defect as a coverage fraction whose boundary goes unstated.
> ⚠ **Do not conflate this 41 with the other one**: 86 named entries = 45 codec + 41
> non-codec, and the two 41s are unrelated.
> ⇒ *One act with an unrecorded consequence, by the author of both artifacts*, which is the
> class the codec lane found three instances of in 0008 an hour earlier and which this page
> then had a fourth of. **A commit that discharges a claim does not touch the claim, and
> nothing recomputes it.**
>
> ⚠ **The TIER is unchanged and that is not a technicality.** The cases *pin* the
> assignments; nothing *replays* them, because `deixis-codec-v1` never had an implementation
> — the AUTHORED-BUT-UNREPLAYED state recorded above. So the entry belongs exactly where it is,
> and only its sentence was wrong. ⇒ *A stale claim inside a correct classification is the
> hard kind to see: the shelf is right, so nobody re-reads the label.*
<!-- claim holds: `grep -c "6478663102ff01" vectors/codec-invalid.json` == 2 -->
<!-- claim holds: `python tools/count-codec-cases.py` == 23 of 41 -->

## Sketched only

**`deixis-omap-v1`** — appears in the place-layer notes, the topos proposal and one
consult. No design record, no ratified name, no spec. An idea with citations.

*(`deixis-pos-v2` appears exactly once, as a hypothetical successor, in
consult-01. It is named here only so that a grep
of the tree does not read it as inventory. `deixis-codec-v2` was listed here too until
2026-09-23, when [ADR 0011](design/0011-codec-for-mandatory-nodes.md) made it the codec
candidate; it now has its own entry under **Specified, deliberately unwitnessed**.)*

## The instruments, and what they cannot do

### The explanation is more dangerous than the number, and nothing here gates one

**Nine wrong values were produced across one evening's investigation** of an unrelated
tooling failure. Every one was caught by the other lane within the hour. ⛔ **The two that
mattered were not numbers at all.**

```
a model           built from one sample, on a MISREAD of that sample, and checked
                  against the same sample
a reconciliation  two record formats that "do not overlap in time, so they are
                  successive generations, and the scope was principled" —
                  they did not overlap because one of them DID NOT EXIST: the
                  pattern had matched a substring of an unrelated name
```

⇒ ***A wrong number invites a recount; a good explanation of a wrong number closes the
question.*** The second reconciliation converted an extraction bug into *a hidden virtue* —
it did not merely survive scrutiny, **it removed the reason to look**. And it was written
*after* the first was retracted for the identical shape, in the same investigation.

⛔ **THIS BOUNDS EVERY INSTRUMENT ON THIS PAGE.** `claimcheck` re-runs a quoted measurement;
`rotcheck` reads numbers and dates; `pincheck` compares text. **Not one of them reads a
`⇒`.** This page is mostly `⇒` — the explanations are what a reader acts on, they are
produced by the same lanes and the same hour as the numbers, and **they are the only part
of it that nothing checks.**

⇒ *The measured half is gated and the load-bearing half is not*, which is a sharper
statement of the same asymmetry recorded above for ledgers as a whole: **we gated the
destination and not the source, and within the destination we gated the arithmetic and not
the argument.**

### A grep-shaped finding is a candidate, never a result

**Four times on 2026-09-03 a naive pattern handed one lane a defect that reading
dissolved**, each costing about two minutes and each destined to be a false report to the
other:

```
0003:277        an escaped pipe read as a ragged table row
§5.6 / §5.7     "missing" markers that were present in a form the pattern did not match
0003 marks      11 and 27, counting the PROSE MENTIONS of `[K]`/`[B]` alongside the marks
0008 discharges 5.3 flagged as an ungated discharge — its hit is the phrase
                "obligation to be discharged twice", i.e. content about obligations
```

⇒ **Four for four, and none survived being read.** ⚠ That is the calibration to apply to
every grep-derived number on this page, including the ones in the sections above.

⭐ **It is also why `rotcheck` prints and never fails.** A grep-shaped instrument that can
fail a build converts a two-minute reading into a blocked commit, and the first time that
happens on a false positive the gate gets switched off — taking its real findings with it.
⇒ *The design follows from the measurement rather than from taste*, and the measurement was
available only because both lanes reported their dissolved candidates instead of quietly
dropping them.



⚠ **Placed here deliberately.** Both subsections below were written as insertions
anchored on `## The tiers`, so each new one pushed the page's actual evidence
further down and stacked tooling commentary above it — until the ledger opened
with two analyses of checks declined that morning. ⇒ ***An insertion anchor that
is itself content moves with every insertion***, and every gate stayed green
throughout: coherence is the only property that degrades with each correct edit.
Found by the codec lane in their own document, then by reading this one end to
end rather than assuming it differed.

### Why every one of the six was in a ledger, measured

⛔ **None of the six defects found on 2026-09-03 was in `CODEC.md`. All were in ledgers.**
The reason is not that the ledgers are written less carefully — it is that **nothing checks
a claim a ledger makes**:

| document | what actually reads it |
| --- | --- |
| `CODEC.md` | §ref resolution · code declaration and ordering · profile agreement · digest recomputation from preimages · **corpus pin binding** · table shape · link resolution |
| every ledger | **table shape · link resolution — both purely syntactic** |

⇒ **The specification's claims are checked six ways and the ledgers' claims are checked
none.** ⚠ *And the freeze manifest is signed against the ledgers.*

⭐ **The obvious remedy was measured and is worthless; a less obvious one covers most of
it.** A citation resolver was built first and would have caught **0 of 6** — the failing
direction carries no syntax. But sorting the six by *form* rather than by *subject* splits
them:

```
QUOTE A COMMAND AND ITS OUTPUT — re-executable, 4 of 6
  0003 row 2        "grep 'conformance profile|header-only validator' -> 0"   at 2026-09-03: 2
  0003 row 4        "0 occurrences" of cuvarint                               at 2026-09-03: 15
  EVIDENCE corpus   "the run prints corpus: 41 named cases over 4 files"      at 2026-09-03: 86 over 8
  EVIDENCE links    "243 relative links across 51 files"                      at 2026-09-03: 251 over 52

PROSE JUDGEMENT — genuinely needs a reader, 2 of 6
  0003 row 5        "D2 was repaired in prose"
  0008 A5 / §5.1    "where stated: nowhere, normatively" / a finding left open
```

⇒ ***The checkable subclass is not the citation, it is the quoted measurement.*** A gate
that re-ran the command beside each claim would have caught four of the six, against the
resolver's zero — and the two it misses are the two that assert a judgement rather than a
number. **That is a buildable check and it is not built**; recording the measurement rather
than the intention.

### Three proposed extensions, measured and declined

The codec lane raised two limits on the 2026-09-03 instruments, and a third followed. **All
three were measured before building, and all three said do not build** — recorded because a
declined extension with a number behind it is worth more than an undocumented intuition.

```
1  "correction banners degrade the checkers"      MEASURED 1 of 32
   A page that records its own past error quotes it, so a text search matches
   the error. Real mechanism, and the magnitude is currently negligible: 1
   `rotcheck` hit sits inside a blockquote, 31 in ordinary prose. ⇒ Revisit
   when the ratio moves, not on the argument.

2  "'still' is a rot carrier with no token"       MEASURED 0 of 7 live
   True as a class: *"X still says Y"* dates itself to an instant the reader
   cannot recover, and neither `rotcheck` nor `claimcheck` can see it. But the
   tight form (`still` + a verb of assertion) yields 7 hits of which 6 are
   ordinary prose, and the 7th — the only genuine cross-artifact citation — is
   in a document whose own header declares it *"a dated, point-in-time record"*.
   ⇒ **Correctly scoped already.** Bare `still` yields 88 and would flood.

3  "honour a document-level point-in-time status"  MEASURED 0 hits changed
   Would have removed nothing: no self-declaring historical document carries a
   flagged fraction or date. ⇒ A fix for a problem this tree does not have.
```

⛔ **AND THE MEASUREMENT IN (2) WAS ITSELF UNRECONSTRUCTIBLE — FIVE NUMBERS FOR ONE
QUESTION.** *"Bare `still` would flood"* was cited by both lanes with different figures, and
the discrepancy was only found because the pair had agreed to flag arithmetic rather than
route around it:

```
 88   vectors lane, first report   -- WRONG: `grep -co` sets both flags, -c wins,
                                      so it counted LINES while being read as occurrences
 93   occurrences, case-sensitive, docs/ + research-docs/
 96   the same, case-insensitive
104   the whole tree, including docs/paper and notes/
101   codec lane's figure -- reproducible from none of the above
```

⇒ **The spread is entirely explained by unstated scope and unstated flags**, on a number
cited inside the argument *about* unstated denominators. ⚠ **And no instrument here could
have caught it**: `rotcheck` and `claimcheck` read the ledgers, and these figures lived in
messages between the lanes. ⇒ *The tooling covers the artifacts and not the reasoning that
produces them* — which is where every number on this page comes from.

⇒ ***A document-level status header does the work a per-claim marker would***, which is why
(2)'s only real instance needed no gate. ⚠ **And (1) is the trade worth naming even at 1 of
32**: the convention that makes these ledgers honest — *keep the finding, quote the error,
never delete* — is the same convention that plants false positives for the tools built to
read them. **It gets worse with every banner, and every banner is correct.**

### Every published hash in this repository, and which kind of lock it is

⛔ **One of them was uncheckable on every platform until 2026-09-22, and the defect was
invisible because it fails on a *different* file depending on who looks.** The audit below
is the whole population, not a sample — the point is the RECONCILIATION, so a later reader
asks "is this still true?" rather than re-deriving which hashes exist.

```
KIND                     WHERE                          VERDICT
file-content lock        deixis.tex, 4 vector sha256    ** 1 of 4 WAS WRONG ** -> fixed
derived namespace id     vectors/README.md fixture      HOLDS, reproduces from its string
derived namespace id     0007 utf8 leaf codec           HOLDS, reproduces from its string
hex-preimage assertion   speccheck.py (vector cases)    STRUCTURALLY IMMUNE - see below
⭐ CONTROL  a deliberately wrong derivation string does NOT reproduce, so the check
   discriminates rather than always passing.
```

⇒ **THE THREE KINDS FAIL DIFFERENTLY, WHICH IS THE PART WORTH CARRYING.** A *derived* id
hashes a string literal printed beside it, so any reader reproduces it from the document
alone and no environment can touch it. A *preimage* assertion hashes `bytes.fromhex(...)`
out of the case, so line endings, encodings and checkouts are all irrelevant by
construction. **Only a FILE-CONTENT lock hashes something the environment gets to rewrite**
— and `core.autocrlf` rewrote it, so the published value matched the blob on one platform
and the worktree on another.

⚠ **AND THE MIXED SET IS WHAT HID IT:** two of the four vector files contain no CR at all,
so their hashes are identical under either convention and verify everywhere. **A reader
checking the corpus sees three pass and one fail**, which reads as *that file is corrupt*
rather than *these four were taken under two conventions*. The failure names the wrong
suspect, and it names a different one on each platform.

✅ **REMEDY, and it is verified rather than argued:** `.gitattributes` pins
`vectors/*.json` to `eol=lf`, so the worktree bytes equal the blob bytes on every checkout.
Measured after a forced re-checkout: both previously-divergent files read `CR=0` with
worktree hash == blob hash == the value the paper prints. ⇒ *A published hash is only a
lock if it denotes the same bytes for every reader; otherwise it is a number that happens
to be true where it was written.*

⚠ **BOUND:** this covers hashes published in `docs/`, `vectors/` and `research-docs/`
markdown and TeX. It does NOT audit hashes embedded in the vector JSON payloads themselves
— those are the preimage class, checked by `speccheck` on every run, which is a stronger
guarantee than this audit could give.

## How to recompute this page

```sh
node tools/conformance/harness.mjs                 # corpus, check counts, and the control
grep -rhoE "deixis-[a-z-]+-v[0-9]+" docs vectors   # the census of named artifacts
ls core pos set                                    # what is implemented
grep -n "working-directory" .github/workflows/release.yml    # what publishes
python tools/speccheck.py                          # the spec's internal graph + the worklist
python tools/derive-vector-profiles.py             # re-derives min_profile; refuses on a bad locus
#   ^ the harness line above also indexes the codec corpus: names unique, refs resolved.
#     Neither command parses a vector's OCTETS - nothing in this repository does yet.
```

The shape worth noticing: everything witnessed here is **spelling-shaped** — bytes a
reader can hand-compute from a spec and compare. Everything unwitnessed is either behind
the codec or is a **behavioural** claim, where a witness costs a rig rather than a JSON
file. That is not an accident of effort; it is what the two wings cost.
