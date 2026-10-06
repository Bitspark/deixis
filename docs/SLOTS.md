# Slots

What can go in `(.)`, what deixis asks of it, and what an instantiation gets in return.

**Model decision (2026-09-23):** [ADR 0010](design/0010-mandatory-node-values.md)
requires one `T` at every existing node. Optional values use `Node[Option[T]]`;
pure shape uses `Node[Unit]`. The four delivered cores use this required-value
API. The codec tier below describes requirements; the delivered
`deixis-codec-v2` codec remains a candidate, not frozen.

[ADR 0012](design/0012-data-wire-tree-symmetry.md) names the family instances
`DataTree = DeixisNode<Data>` and `WireNode = DeixisNode<Wire>`. `Data` is an
addressless byte reader and `Wire` an addressless sender. Both are legal opaque
payloads with the same structural guarantees. A materialized `Node[Bytes]`
snapshot can be encoded with identity-bytes; that does not serialize the reader
or sender capabilities. Capability equality and portability remain the
payload domain's responsibility. [ADR 0014](design/0014-structural-identity-and-lifted-access.md)
reaffirms this symmetry. A receiver's handler tree is another instance, not a
replacement for a sender tree. Portable names become capabilities through a
declared binding profile (ADR 0013 §2), never through the codec alone.

## The rule

> Every requirement deixis places on a slot is a requirement on the pair `(T, ≈)` — a
> carrier together with a relation. **Never on the carrier alone.**

No carrier is admissible or inadmissible by itself. Floats, functions, sockets, and live
DOM nodes are all fine or not fine depending entirely on which relation accompanies them,
and the same carrier appears at different tiers under different relations. Any sentence of
the form "deixis can't hold *X*" is a mistake about where the requirement lives.

## What an instantiation supplies, and what it gets

| Supplied | Available |
| --- | --- |
| a carrier | shape, keys, paths, navigation, structural sharing |
| `+ ≈`, an equivalence relation | node identity |
| `+ e : T → Bytes` with `x ≈ y ⟺ e(x) = e(y)` | canonical bytes, hashing, content addressing |

Each tier is strictly optional. A slot that stops at the first is still a slot; it simply
never has an identity to ask about, and `equal_by` is never called.

## Admission

**For identity**, `≈` must be an equivalence relation — reflexive, symmetric, transitive.

Every carrier admits the **discrete** relation (each thing equal only to
itself) and the **total** relation (everything equal); these coincide for
empty and singleton carriers. So no carrier is ever excluded here.
What *is* excluded is a relation that isn't an equivalence, and the common ones are easy to
reach for by accident:

- IEEE `==` over floats. `NaN ≠ NaN` breaks reflexivity, so a node containing one stops
  being equal to itself.
- Tolerance comparison (`|a - b| < ε`). Not transitive.
- "Close enough" / fuzzy matching of any kind. Usually neither.

deixis lifts what it is given and does not repair it. A non-equivalence produces a
non-equivalence on nodes.

**For a codec**, the law `x ≈ y ⟺ e(x) = e(y)` says exactly that `e` factors through the
quotient `T/≈` and is injective on it. So:

- **Existence** requires `T/≈` to be **countable**. This is the one genuine impossibility:
  an uncountable quotient has no encoding at all, by any means.
- **Usability** additionally requires the injection to be computable, decodable, and
  canonical — one byte string per class.

The two come apart. Computable functions under extensional equality have a *countable*
quotient, so an encoding exists; but any computable encoder must read the program rather
than the function, and two programs computing the same function encode differently. The
law fails, and no amount of cleverness recovers it.

## The range

| Slot | `≈` | Tier | |
| --- | --- | --- | --- |
| `Void` (no values) | vacuous | codec | `Node[Void]` has no inhabitants: a node would need a root value |
| `()` | total | codec | pure shape: a set of paths, with the same unit value at every node. The slot value encodes to `""` |
| `Option[()]` | tag-respecting | codec | a set of paths with explicit membership marks; the slot codec distinguishes `None` and `Some(())` |
| `Bytes` | octet | codec | ontos. The slot encoder is the identity function |
| `Decimal` | numeric, `1.50 ≈ 1.5` | codec | equality coarser than representation; the encoder must normalize. The case that actually exercises a lifted equality |
| `Ontos.Value` | ontos structural | codec | leaf encoder is `ontos-codec-v1`, composed rather than replaced |
| `Hash` / CID | octet | codec | a Merkle DAG — how sharing is recovered without ever admitting a cycle |
| `Node(S)` | lifted from `S` | follows `S` | nested trees. A node holding a `Node(S)` as its own value is not that tree: resolution never enters a value, so holding a tree and being one stay distinct |
| `Handler` | same registered name | codec | a route table you can content-address, including a handler at a path that also has routes below it |
| `Definition` | same qualified name | codec | a module namespace |
| `Socket` | same endpoint | codec | the endpoint is encodable even though the kernel object is not |
| `Element` (DOM) | reference | identity | live and mutable; costs closedness, below |
| `f64` | bitwise | codec | |
| `f64` | IEEE `==` | **none** | not an equivalence |
| computable `ℕ → ℕ` | extensional | identity | countable quotient, no canonical computable encoder |
| `ℝ` | exact | identity | uncountable quotient; a codec cannot exist |
| *anything* | discrete | identity | always available |
| *anything* | total | codec | always available; node identity collapses to the path set; an empty carrier yields no node |

The `f64` row appearing twice is the rule made concrete: one carrier, two relations, and
the difference between admissible and not.

Note also that `Handler`, `Socket`, and `Definition` reach the codec tier. The obstacle for
a live resource is never that it is "not data" — it is whether the relation you chose has a
countable quotient. Identify handlers by name and a router is as encodable as a record.

## What weakens as the slot weakens

deixis's structural guarantees are unaffected by the choice of slot: every node is finite,
well-founded, and carries one mandatory own value. Four other properties are not
deixis's to guarantee, and a reader arriving from ontos should not assume them:

- **Immutability.** The *shape* of a node is immutable. Its contents are whatever the slot
  is. `Deixis(Element)` has an immutable tree of mutable things.
- **Closedness.** A slot may refer to ambient context — a file descriptor, a closure
  environment, a live document. Such a node is not self-contained, and ontos's
  context-free property does not survive the instantiation.
- **Decidability.** Nothing requires `≈` to be decidable. Where it isn't, node equality
  isn't either, and the structure is well-defined but partly uncomputable.
- **Portability.** Reference-identity slots do not survive a process boundary, a
  serialization round trip, or a second machine.

None of these make a slot inadmissible. They determine what a node *means* once you have
one.

## Choosing `≈`

Whatever `≈` merges is merged for everything above, permanently. deixis cannot recover a
distinction the slot has already erased, and neither can any layer above deixis — the
asymmetry ontos states at its floor applies here too, one level further down.

deixis is in no position to require anything about this. It has no view into the slot and
no way to tell a considered equality from a lazy one. So it is guidance rather than a
rule: **choose `≈` as fine as any consumer of that instantiation will ever need.** A
consumer can always quotient a fine equality afterwards. Nothing can refine a coarse one.

The corollary is that the discrete relation is the safe default when unsure, and the total
relation — however convenient for getting a slot admitted — throws away every distinction
in one step.

## Status

**Settled (2026-08-08): the floor is carrier-only, and identity is the first priced
tier.** The tiers above describe both what is available and what the floor requires —
namely, nothing beyond the carrier. [TREE.md](TREE.md) now says the same; the paper's
tier table, [PATH.md](PATH.md), and the shipped implementations (`T` unbounded,
`equal_by` optional at every call site) said it already, and the type-theory consult
flagged the residual split for resolution. The practical consequence stands unchanged:
every carrier admits an equivalence, so admission at the identity tier is never in
question — only whether a given instantiation cares to ask.

One warning the consult adds, worth its place here: **a hash usable as an identity
surrogate exists only at the codec tier** (`H ∘ e`, over canonical bytes) — never from
representation. A consumer that derives host-language equality or keys a memo table on
representation behaves `≈`-unstably under any coarse slot, invisibly until a coarse slot
is deployed. Conformance grows a caching-under-a-coarse-slot vector family for exactly
this.
> ⛔ **THAT LAST SENTENCE IS AN OBLIGATION WRITTEN IN THE PRESENT TENSE, AND THE FAMILY DOES
> NOT EXIST — measured 2026-09-22.** Consult disposition 4 created *two* obligations:
> *"new vector family: caching/memoization under a coarse slot; SLOTS.md to state
> identity-surrogate hashes exist only at the codec tier."* **The paragraph above discharges
> the second. The sentence then reads as though it also discharges the first.**
>
> ```
> cases in the corpus mentioning coarse / cache / memo   ** 1 of 67 **
>   vectors/set.json  idempotence-under-coarse-equality
>   kind: duplicate — two (approx)-equal members, different representations, one key
>   ⇒ it tests whether e or native equality decides a DUPLICATE: the set profile's own
>     behaviour. Disposition 4's hazard is a CONSUMER keying a memo table on
>     representation. Adjacent subject, different subject.
> ⭐ CONTROL  the same reader finds 7 files under `identity`, so the 1 is a real count
>    and not a dead query.
>
> ⛔ **THE `1 of 67` ABOVE IS MY OWN BAD INSTRUMENT AND THE DENOMINATOR IS WRONG — corrected
> 2026-09-22, same day, by running the repository's OWN enumerator instead of my parser.**
>
> ```
> tools/conformance/harness.mjs, its own first line:
>   corpus: ** 86 named cases ** over 8 files (4 replayed, 4 indexed only), names unique,
>   references resolved
>   ** 103 requests ** over rs, go, ts, py        (go: 103/103; rs/ts/py unbuilt here)
>
> my ad-hoc parser:  67, then 91, then 88 — never 86, and `positional.json` read ZERO
>   every time, because its cases live under `keys` and `invalid` and carry no `name`.
> ```
>
> ⚠ **AND THE SEARCH CARRIED A SUBSTRING FALSE POSITIVE:** widening the parser surfaced
> `codec-linked.json` as a hit because **`memo` matches `memory`** ("reads whatever follows
> the header in memory"). A second apparent hit is prose in `codec-flat.json`'s description
> — *"the coarse fixture setoid"* — not a case.
>
> ✅ **THE FINDING ITSELF SURVIVES UNCHANGED**, which is why only the number is corrected:
> `set.json  idempotence-under-coarse-equality` is still the single genuinely adjacent case,
> and it still tests the set profile's own duplicate decision rather than a consumer's memo
> table. **The family is still owed.**
>
> ⇒ **THE LESSON IS THE INSTRUMENT, NOT THE ARITHMETIC: I hand-rolled an enumerator for a
> corpus that ships one** — and the harness does more than count, it asserts names unique and
> references resolved. *A repository that publishes its own census has already answered the
> question you are about to re-implement, and your version will disagree quietly.*
> ```
>
> ⇒ **So the coverage claim is UNEARNED, and `WIRES.md`'s own header is the rule it breaks:
> nothing is citable as an invariant until a check exists.** The hazard is real and is
> correctly described; what does not exist is the conformance family that would catch it.
>
> ⚠ **AND THE FAILURE DIRECTION IS THE QUIET ONE.** The hazard's own text says a
> representation-keyed memo table misbehaves *"invisibly until a coarse slot is deployed"* —
> so a reader who believes conformance already covers it has no second surface that would
> disagree. **A stated-but-unbuilt check on an invisible hazard is worse than a silence: the
> silence would at least prompt someone to look.**
>
> ⇒ **Read the sentence as OWED, not held.** `vectors/CODEC-PLAN.md` independently records
> that the corpus *needs* a coarse slot — for `non_canonical_payload`, a different purpose —
> so the slot itself is planned twice and built for neither.
>
> ✅ **AND THE PATTERN IS NOT SYSTEMIC — checked, because one instance invites the reader to
> assume a habit.** Swept `docs/`, `vectors/` and `research-docs/` for present-tense coverage
> claims (*vector family*, *pin a vector*, *vectors cover*, *conformance covers*): **the
> sentence above is the only one.** Every other hit is the trap register or the consult
> describing the hazard, which is the correct tense for a watch list.
>
> ⭐ **And the register's sibling vector obligation looks discharged:** item 5 (*representative
> normalization reported as a bug → pin a vector*) is met by
> `set.json  identity-across-entry-orders-and-representatives`, which pins exactly the
> (approx)-equal / raw-different property the trap describes. ⇒ *So the register is not a list
> of unkept promises — this one entry is, and it is the entry a downstream document promoted.*

