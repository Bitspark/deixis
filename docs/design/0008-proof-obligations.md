# deixis — the codec's proof obligations

**Model revision, 2026-09-23:** [0010](0010-mandatory-node-values.md) supersedes
0009's optional core with mandatory `T`. The obligations below remain scoped to
their original leaf/struct codec until explicitly re-derived. Neither the old
proofs nor the optional-model replay prove the revised generic contract.
Paper v4 now proves the mandatory structural laws and an abstract framed encoder
construction. That construction is not CODEC.md's concrete grammar and does not
discharge or revive the historical obligations below.

## The v2 ledger (`deixis-codec-v2`, 2026-09-23)

[ADR 0011](0011-codec-for-mandatory-nodes.md) replaced the node grammar, and CODEC.md now
states `deixis-codec-v2`. This section re-derives the ledger for it. The concrete
discharges are in [CODEC-proofs.md](../CODEC-proofs.md), written against the v2 byte
grammar itself rather than the paper's abstract encoder. **Everything below this section
is the v1 ledger, kept as history:** its obligations named v1's grammar, and its findings
keep that subject.

**Imported.**
- I1 (`≈` is an equivalence) is unchanged.
- I2 is ADR 0010's lift over one constructor: `Node(t, m) =_≈ Node(t', m')` iff `t ≈ t'`,
  the key sets are equal, and the children are pointwise related.
- **I3 is gone.** There are no node kinds, so there is no disjointness to stipulate.

**Assumptions.**
- A1–A6 carry over. A2–A5 now bind the slot codec for the **whole** payload type at
  **every** node (§4), not a leaf codec at terminal positions.
- **A7 is new and explicit:** every payload length, key length and count of a value
  being encoded is below `2^64`. It is an encoder precondition, and the decoder checks
  the domain (§3).

**Lemmas and obligations.** Each is proved in CODEC-proofs.md.

| item | v2 statement | discharged in |
| --- | --- | --- |
| C1 | `cuvarint` is injective, prefix-free and exactly decodable, so it meets the paper's `def:framing` with the marker empty | §1 |
| L1 | unique decodability. It now rests on explicit lengths and counts, with no tag dispatch | §2 |
| L2 | termination within `\|b\|` octets, without appeal to §12 | §2 |
| L3 | the canonical parse order is unique | §2 |
| L4 | §9's classes partition the verdicts on one artifact | §2 |
| L5 | §10 decides every realizable pair: the tag row is gone and the slot-codec-id row is new, and neither added an undecided pair | §2 |
| L6 | first-use order is a function of the value | §2 |
| L7 | the chunk set is a function of the value | §2 |
| O1.1–O1.5 | flat well-definedness, injectivity, round trip, encoder soundness, and accept-set exactness under full validation | §3 |
| O2.1–O2.6 | the linked analogues. O2.4 is computational, under A6 | §4 |
| O3.1–O4.2 | totality, one class, fault determinism | §5 |
| option-of | lawful, with decidable image and exact decoder, whenever the inner codec is | §6 |
| split-invariance | a streaming decoder reaches the whole-buffer verdict for every split | §7 |

**The O1.5 audit, re-run on v2.**

| rule | deletes | verdict |
| --- | --- | --- |
| §5.1 magic `dxf2` | every other 4-octet prefix | load-bearing |
| §5.2 | retired: v2 has no node kinds | — |
| §5.3 `count` | nothing | constitutive, as v1's finding A2 |
| §5.4 strictly ascending keys | reorderings and repeats | load-bearing |
| §5.5 `payload ∈ im(e)` at **every** node | payloads outside the image, now at interior nodes too | load-bearing wherever `im(e)` is a proper subset (v1's finding A3 still applies to `00 01`) |
| §5.6 no trailing, no truncation | extensions and prefixes | load-bearing |
| §3 domain, length, shortest form | out-of-range, over-long and alternative spellings | load-bearing |
| §13 id rules | a second spelling of an id (a second address), and ids that are not exactly one id of their form (`malformed_slot_codec_id`) | load-bearing |

**Carried findings.**
- **§5.5 (pair-shaped obligations) applies to v2 unchanged.** O1.1, O1.2, O2.3 and O2.4
  quantify over pairs. The v2 corpus carries pair cases for O1.1, O1.2, O2.3
  and O2.6, listed in CODEC-proofs.md §8. O2.4 stays untestable, by collision
  resistance.
- **A new class, found in review by the vectors lane (F5):** input ending inside a
  length-framed field whose present octets already prove a fault. It is decided by
  CODEC.md §5's field-extent rule (`unexpected_eof`), not by precedence, and it
  generalises §5.6's B3.
- §5.6's result (the precedence content is the links-header group) and §5.7's (disjoint,
  and exhaustive once "input" is one artifact) hold as in v1.
- The non-obligations of §6 carry over.

**What discharges the v2 ledger.** The proofs above, which are prose and not
machine-checked, plus the independently authored v2 corpus exercising every expressible
obligation, plus implementations replaying it. The freeze additionally needs 0006's
clean-room step and the signed manifest. None of those two is done.

**Status:** ledger, open. Freeze step 2 of
[0006](0006-canonical-codec.md)'s process — [CODEC.md](../CODEC.md) §8 states five
laws under the heading *"To be proved in the freeze bundle"* and stops there. This
record turns that line into an enumerated list of what must actually be discharged,
what each obligation leans on, and what must deliberately **not** be proved.

Nothing here proves anything. The proofs' home is the paper; this is the ledger
that says when the paper is done, and it is the artifact the freeze manifest's
*"formal definitions and proof artifacts"* line is checked against.

It also carries findings — four against §8 as written (§5), and three more from
running the O1.5 audit the ledger prescribes (§4). Three of the seven changed the
frozen text; that is why this is a ledger and not a checklist inside the paper.

## 1. Imported obligations — cited, never restated

Three things are assumed by everything below and are **not** codec obligations.
They belong to the floor and the slot, and the paper proves or imports them there:

| # | obligation | home |
| --- | --- | --- |
| I1 | `≈` is an equivalence relation on the carrier | [SLOTS.md](../SLOTS.md) § *Admission* |
| I2 | `=_≈` — the floor's lift of `≈` to nodes — is an equivalence, and is structural (leaves related by `≈`; structs with equal key sets and pointwise-related children) | [TREE.md](../TREE.md) |
| I3 | constructor disjointness: no node is both a leaf and a struct | [TREE.md](../TREE.md), stipulated |

If any of the three fails, no codec law survives, and none of them is the codec's
to establish. **I2 is the one to watch**: every induction below is an induction on
the node structure I2 describes, so a change to the lift invalidates this whole
ledger and not merely a step of it.

> ⛔ **2026-09-23: [ADR 0010](0010-mandatory-node-values.md) changes I2 and removes I3,
> so by this section's own rule the whole ledger is invalidated, not a step of it.**
> I3 has no counterpart: there are no node kinds or core presence tags. I2's lift
> becomes `Node(t, m) = Node(t', m')` iff `t ≈ t'` on the complete payload, the key sets are
> equal, and the children are pointwise related ([TREE.md](../TREE.md)), so every
> induction below runs over one constructor instead of two. The obligations are to
> be re-derived together with the codec grammar decision
> ([#1](https://github.com/Bitspark/deixis/issues/1)); this note flags them and
> changes none.

## 2. The assumption inventory

The single most useful output of step 2 is knowing **what each law costs**. Six
assumptions are in play, and exactly one of them is computational:

| # | assumption | where stated | kind |
| --- | --- | --- | --- |
| A1 | `≈` is an equivalence | SLOTS § *Admission* | structural (= I1) |
| A2 | **lawfulness**: `x ≈ y ⟺ e(x) = e(y)` | [CODEC.md](../CODEC.md) §4 | structural |
| A3 | `e` is total and computable | §4 | structural |
| A4 | `D` is an exact partial inverse: `D(e(x)) ≈ x`, defined exactly on `im(e)` | §4 | structural |
| A5 | **membership in `im(e)` is decidable, and `D` is computable** | [CODEC.md](../CODEC.md) §4 — ⚠ *was* nowhere normative; repaired `2a67b0d`, see §5.1 | structural |
| A6 | SHA-256 is collision-resistant | §7 | **computational** |

**A6 is used in exactly one place** — the forward direction of law 2's address
equality (O2.4) — and nowhere else. Everything else in this ledger is
unconditional. Stated as a consequence, because it is the question someone will ask
under pressure and the answer should be on the record before then:

> **If SHA-256 fell tomorrow, law 1 would survive entirely, law 2 would survive in
> the direction that matters for encoding (equal values have equal addresses), and
> laws 3 and 4 would be untouched. Only "equal addresses imply equal values" is at
> risk, and it is at risk by assumption rather than by surprise.**

That is the honest scope of the hash's role: it makes addresses *usable as
identity*, and it earns nothing else.

## 3. Structural lemmas

Seven lemmas carry the laws. They are stated once here because the laws share them,
and proving them per-law would prove them four times.

- **L1 — unique decodability.** The flat grammar is parseable left-to-right with no
  backtracking and no ambiguity. *Why it holds:* every production is either
  tag-dispatched on a one-octet alphabet (`0x00`/`0x01`, disjoint by I3) or prefixed
  by an explicit `uvarint` length or count. *Needs:* §3's shortest-form rule, without
  which one value has many length spellings and the map to octets stops being
  injective.
- **L2 — parser termination.** Every parser step either consumes at least one input
  octet or terminates, so the parse halts in at most `|b|` steps on every finite
  input. *Why it matters:* it is what makes law 3's *totality* true, and it must be
  proved **without appealing to §12's resource envelope** — a `count` of `2^64 − 1`
  must terminate by input exhaustion (`unexpected_eof`), not by a limit. A proof that
  leans on the envelope proves a different theorem, about a differently-configured
  decoder.
- **L3 — the canonical parse order is unique.** §5.3 (entries read sequentially, the
  structure closing at `count`) fixes a left-to-right, depth-first order. *Why it
  matters:* law 4 says the fault code is determined by where the parser *"first
  cannot continue"*, and "first" is meaningless until the order is pinned. L3 is what
  makes law 4 a proposition at all.
- **L4 — §9's result classes partition.** Pairwise disjoint **and** exhaustive over
  every input. Exhaustiveness is the half that is easy to skip and is exactly law 3's
  content.
- **L5 — §10's precedence decides every realizable pair.** For every pair of
  conditions simultaneously observable at one parser step, §10 names a winner.
  *Discharge by enumerating the realizable pairs, not the table* — a table that is
  total on pairs which cannot co-occur is still incomplete on one that can.
- **L6 — first-use order is well-defined and a function of the value.** Scanning body
  entries in canonical key order (§5.4) and appending each distinct child hash at
  first reference yields one header, determined by the value. *Needs:* L1's
  determinacy plus the induction hypothesis that each child's chunk octets are
  themselves determined.
- **L7 — the chunk set is a function of the value.** The set is the image of the
  value's distinct sub-nodes under chunk-encoding; identical subtrees collapse to one
  chunk, and that collapse is what dedup *is*. *Note:* the multiset of positions is
  **not** recoverable, and is not meant to be.

## 4. The obligations

### Law 1 — flat canonicality

| # | obligation | leans on |
| --- | --- | --- |
| O1.1 | `encF` is constant on `=_≈` classes (well-definedness): `x =_≈ y ⟹ encF(x) = encF(y)` | I2, A2 (⟹), A3, induction on node structure |
| O1.2 | `encF` is injective up to `=_≈`: `encF(x) = encF(y) ⟹ x =_≈ y` | L1, A2 (⟸) |
| O1.3 | round trip: `decF(encF(x)) =_≈ x` | A4, A3 |
| O1.4 | encoder soundness: `im(encF) ⊆ Accept` — the encoder never emits octets its own validator refuses | §5 rules 1–6 |
| O1.5 | **accept-set exactness**: `Accept ⊆ im(encF)` — every accepted string is one the encoder could have produced | L1, A4, **A5**, and every §5 canonicality rule |

**O1.5 is where the canonicality rules earn their keep, and it is the obligation
worth reading the rules against one at a time.** Each rule exists to delete octets
that would otherwise be accepted but never emitted: shortest-form uvarint (§3.3)
deletes alternative length spellings; strictly-ascending keys (§5.4) deletes
re-orderings and repeats; `payload ∈ im(e)` (§5.5) deletes payloads outside the
encoder's range; `trailing_bytes` (§5.6) deletes suffixes. A rule that deletes
nothing is decoration; a missing rule is a hole in O1.5 and therefore in law 1's
third clause. *(§5.3's `count` was in this list until the audit below; it deletes
nothing — see A2.)* **Auditing the
rule list against this obligation is a step-2 deliverable in itself** — the list is
the proof's structure, not context for it.

⚠ **O1.5 is not provable as §8 states it.** See §5.2.

#### The O1.5 audit, run 2026-08-29

Each rule was read against one question: **what octet strings does it delete that
the encoder could never emit?** A rule that deletes nothing is decoration; a string
the encoder cannot emit that no rule deletes is a hole in law 1.

| rule | deletes | verdict |
| --- | --- | --- |
| §5.1 magic `dxf1` | every other 4-octet prefix | load-bearing |
| §5.2 tag ∈ {`00`,`01`} | 254 values per node position | load-bearing |
| §5.3 `count` = entries following | **nothing** | **constitutive, not restrictive** — see A2 |
| §5.4 strictly ascending keys | `n! − 1` orderings, plus repeats | load-bearing, the largest deletion |
| §5.5 `payload ∈ im(e)` | payloads outside the encoder's range | load-bearing **only for codecs whose image is a proper subset** — see A3 |
| §5.6 no trailing / no truncation | proper extensions and prefixes | load-bearing |
| §3.1–3.3 uvarint domain, length, shortest form | out-of-range, over-long, and alternative spellings | load-bearing |

Three findings. **A1 is a hole and has been repaired; A2 and A3 are not defects in
the rules but in what surrounds them.**

**A1 — the integer domain was scoped by ROLE, and the id's ordinals are not in any
of those roles. REPAIRED 2026-08-29.** §3 opened *"All lengths, counts, and indices
are `uvarint`"*, while §13's `n` and `k` are **registry ordinals** — neither a
length, nor a count, nor an index. §10's precedence table says *"any `uvarint`"*, so
the two sections disagreed on scope and the narrower one was the normative home.

⇒ **The consequence is not cosmetic: the id travels inside the hashed octets (§7),**
so a non-shortest spelling of `n` is a second byte string for one codec id and
therefore **a second address for one value**. That breaks O1.2 (injectivity) and
O2.3/O2.4 (address determinism) — the two obligations the whole addressing scheme
rests on. An implementer reading §3 for the rule and §13 for the grammar could
satisfy both and still emit two addresses for one value.

§3 is now scoped by exhaustion rather than by role, with the reason attached, and
§13 states the binding at the site where `n` and `k` are defined. **This is the same
shape as finding 5.1** — an obligation that was real, was written down, and did not
reach the clause that needed it — arriving one section over, which is why the audit
found it and the first pass did not.

**A2 — §5.3 is constitutive, not restrictive.** There is no independent "actual
number of entries" for `count` to disagree with: the encoder writes `count` and then
that many entries, and the decoder reads `count` and then that many. A wrong count
does not produce a distinguishable string — it re-parses as a different structure and
is caught by §5.6 or `unexpected_eof`. So the rule deletes nothing and belongs to the
grammar rather than to the canonicality list. **Deliberately not repaired**, on the
same grounds as finding 5.3: it misleads nobody and the freeze should not churn on
taxonomy.

**A3 — §5.5 is VACUOUS under the bootstrap codec, and that is a problem for the
commission rather than for the spec.** For `00 01` `deixis/identity-bytes`,
`im(e) = Bytes`, so every payload is in the image and the rule can never fire.

⇒ **[0007](0007-clean-room-commission.md) scopes the clean-room implementer to
`00 01` alone.** So as written the commission cannot exercise §5.5 — and cannot
exercise the *validated* versus *header-only* distinction of finding 5.2 either,
because that distinction is precisely about whether a decoder can check §5.5. **The
commission would have been unable to test the clause whose repair landed the same
day.** 0007 now supplies a second leaf codec with a proper-subset image.

⭐ **SECOND INSTANCE, 2026-08-30, IN THE CORPUS RATHER THAN THE SPEC — so this is a
class, not a one-off.** Reviewing the vectors lane's batch 1, `linked/sharing-is-lawful`
uses a value with **one distinct child referenced twice**, so `nlinks = 1`:

```
§6 rule 6   "the header order MUST equal first-use order"
a ONE-element links header has exactly one order
⇒ the rule ** CANNOT BE VIOLATED ** by that case, and the case names law 2
```

⇒ Same shape as A3 one artifact over: **a fixture chosen for a good reason makes a clause
unexercisable, and the case still reads as covering it.** There the bundle was picked for
readability (`e` = identity, payloads legible by eye); here the value was picked to
demonstrate sharing. Neither choice is wrong; both silently narrow what the artifact can
test.

⇒ **The general form, and it is the one to carry** — stated first as a disposition (*ask
of every fixture not only "does this exercise the rule" but "could this fixture, in
principle, VIOLATE it"*), and then given a **checkable** form by the vectors lane, which is
better and is the one to use:

> **For each area, name the case that would FAIL if the rule were broken. If there is
> none, the area is not covered — whatever the case count says.**

*Mine is something to remember; theirs is something to run, per area, at authoring time,
which is where it has to bite.* **Adopted from the vectors lane, which proposed it while
accepting the ruling below.**

⭐ **AND THE REPAIR THEY LANDED IS STRONGER THAN THE RULING ASKED FOR — "non-trivial" is
not "discriminating".** A two-child case merely makes the header orderable; theirs makes
the two candidate rules produce **different addresses for one value**, both recomputed and
published:

```
first-use (by key)   header [a07bb26f…, 0fcf34e8…]   address 075a4e46…
sorted by hash       header [0fcf34e8…, a07bb26f…]   address 5567e8a3…
⇒ a hash-sorting encoder emits a DIFFERENT ADDRESS, checkably
```

⚠ **And the counterfactual has a trap that it passes silently.** Re-ordering the header
means the body's link indices are **positions into that header** and must be renumbered
(`61 → idx 1`, `63 → idx 0`). Leaving them alone yields `740c856e…` — which encodes
`61 ↦ Leaf(02)`, **a different value**, so the comparison would "discriminate" while
proving nothing. *Verified here by reconstruction: they renumbered.* ⇒ **A counterfactual
must hold the value fixed and vary only the rule**, and nothing in a published digest shows
which one you did.

**Ruled back to the vectors lane and accepted: a lawful two-distinct-child case belongs in
batch 1**, with the refusal staying in batch 2 — the lawful twin proves the encoder chooses
right, the refusal proves the decoder catches wrong.

⚠ **The vector corpus does NOT have this gap, and it is worth saying so before someone
goes looking for it.** [vectors/README.md](../../vectors/README.md)'s fixture setoid
encodes `class` as UTF-8, so its image is the valid UTF-8 sequences — a proper subset
of the octet strings, and §5.5 bites there on any invalid sequence. **The corpus can
exercise the rule; only the commission's original one-codec scope could not.**



### Law 2 — linked canonicality

| # | obligation | leans on |
| --- | --- | --- |
| O2.1 | first-use order is well-defined and value-determined | L6 |
| O2.2 | the chunk set is a function of the value | L7 |
| O2.3 | `x =_≈ y ⟹ addr(x) = addr(y)` | O2.1, O2.2, A2 (⟹) — **unconditional** |
| O2.4 | `addr(x) = addr(y) ⟹ x =_≈ y`, within one leaf-codec-id | **A6**, plus the linked analogue of O1.2 — **computational** |
| O2.5 | linked accept-set exactness | the analogue of O1.5, plus §6 rules 2–6 (`nlinks` exact, no duplicate hash, in-range indices, no unused link, header in first-use order) |
| O2.6 | bridge agreement: decoding a closure agrees with flat decoding up to `=_≈` | O1.3, O2.5, induction |

**On O2.4's scope.** Under a collision, two distinct children sharing a hash would
be deduplicated into one link index by first-use order, and decoding would return a
value that is not the one encoded. This is inherent to content addressing and is not
a defect — but it is why O2.3 and O2.4 are split rather than proved as one
biconditional. **The encoding direction never needs the hash to be sound; only the
reading direction does.**

**On the bridge.** §16 requires conformance to cover *"both forms and the bridge
between them"*, and the bridge is `decF` followed by `encL`, or the reverse. It is
**derived, not primitive** — there is no separate conversion function in the spec
and there should not be one. Its correctness is O2.6 and nothing further.

### Laws 3 and 4 — refusal and fault determinism

| # | obligation | leans on |
| --- | --- | --- |
| O3.1 | **totality**: every input receives a verdict | L2 |
| O3.2 | every input falls in **exactly one** §9 class | L4 |
| O4.1 | the fault code is determined by the first point at which the canonical parse cannot continue | L3 |
| O4.2 | where two conditions are observable at one step, §10 decides | L5 |

Law 3's third clause — *"the same code across every conforming implementation, for
one artifact decoded sequentially"* — **is** O4.1 + O4.2 and is not a separate
obligation. Proved once, cited twice (§5.3).

### Law 5 — no lenient mode

**No obligation. Law 5 is not a theorem** — see §5.4.

## 5. Findings against §8 as written

⛔ **THREE OF THESE FINDINGS WERE DISCHARGED BY ONE COMMIT AND NONE OF THEM SAID SO.**
`2a67b0d` (2026-08-29) landed the repairs proposed by §5.1, §5.2 and §5.4. For five days
all three read as open, and the assumption inventory above asserted A5 was stated
*"nowhere, normatively"* while §4 stated it. §5.1 was found by accident on 2026-09-03
while checking something else; §5.2 and §5.4 only by then surveying every finding for a
state marker.

⇒ **It is one act with three unrecorded consequences, not three oversights.** A commit
that discharges a finding does not touch the finding, and nothing here recomputed the
citation. ⭐ *A ledger of obligations is what a freeze manifest is signed against, so a
finding that misreports its own state is a defect in the governing artifact rather than
an untidiness in a note.*

⚠ **Each discharge below now carries a `claim holds` gate** on the sentence it depends
on, so deleting that sentence from `CODEC.md` fails the build instead of silently
re-opening the finding. **That gates the DEPENDENCY, not the judgement** — whether a
finding is genuinely closed is still a reading, and §5.3's and §5.5's states rest on no
gate at all.

### 5.1 — A5 is load-bearing and stated nowhere normative

> ⭐ **DISCHARGED 2026-08-29 by `2a67b0d`. The finding below is kept, and reads in the
> past tense from here.** CODEC.md §4 now states the repair this section proposed, in
> the form it proposed: *"`D` MUST be **computable**, and membership in `im(e)` MUST be
> **decidable**"*, followed by *"Decidability is a slot admission requirement at this
> tier, not a quality note."*
>
> <!-- claim holds: `grep -c "Decidability is a slot admission requirement" docs/CODEC.md` == 1 -->
> ⭐ **That discharge is now gated**: the line above re-runs on every CI run, so deleting
> the sentence from §4 breaks the build instead of silently re-opening this finding. It is
> the exact drift that happened here, now unable to happen quietly.
>
> ⚠ **It stayed open here for five days after it was closed there, and that is its own
> defect.** A ledger of obligations is a governing artifact at freeze: a finding recorded
> as open invites the repair a second time, and the assumption inventory above asserted
> A5 was stated **nowhere normatively** while §4 stated it. ⇒ *This ledger cites CODEC.md
> and nothing recomputes the citation* — the same hidden semantic dependency this very
> section is about, pointing the other way. Found 2026-09-03 while checking whether §8's
> laws are sites or consequences; not by any check.
>
> **Kept rather than deleted**, per this repository's standing rule: the argument is why
> the sentence in §4 is there, and a reader who deletes it re-opens the question.

§4 requires `e` to be *"total, computable, and lawful"*, and requires `D` to be *"an
exact partial inverse"*. **It never requires `D` to be computable, nor membership in
`im(e)` to be decidable.**

But §5.5 makes `payload ∈ im(e)` a MUST that *"a decoder holding the leaf codec MUST
check"*, and law 3 promises every input a verdict. **An undecidable `im(e)` makes
that check impossible and law 3 false** — not hard, not slow: impossible.

[SLOTS.md](../SLOTS.md) does say it, in § *Admission*: *"Usability additionally
requires the injection to be computable, decodable, and canonical."* That sentence is
prose about what makes a tier **usable**, in a document about the slot ladder — and
the normative clause that consumes it, one document away, does not carry it. **This
is exactly the hidden semantic dependency the review discipline exists for: the
obligation is real, it is written down, and the clause that needs it does not say so
— so an implementer reading §4 alone supplies a `D` that satisfies every stated
requirement and breaks a frozen law.**

⇒ **Proposed repair, for 0006 and then CODEC.md §4:** `D` MUST be computable, and
membership in `im(e)` MUST be decidable — stated as a slot admission requirement at
the canonical-bytes tier, not as a note. The identity-bytes codec (`00 01`) satisfies
it trivially, which is precisely why the gap has never been felt.

### 5.2 — law 1's third clause over-claims against §11's two tiers

> ⭐ **DISCHARGED 2026-08-29 by `2a67b0d`, the same commit as §5.1. Recorded 2026-09-03.**
> §8 law 1 now reads *"for every `b` accepted **under full validation** (§11)"*, and the
> paragraph below it carries the second half of the repair — *"under header-only
> validation the guarantee is framing and structure only, with payload membership
> uncertified"*. Law 2 states the scoping applies unchanged, which is the O2.5 half.
>
> <!-- claim holds: `grep -c "under full validation" docs/CODEC.md` == 1 -->
> The scoping is gated: deleting it from §8 breaks the build rather than re-opening this
> finding in silence.

Law 1 asserts `encF(decF(b)) = b` **"for every accepted `b`"**. §5.5 explicitly
contemplates a decoder that does *not* hold the leaf codec, and §11 gives that
decoder a validation state of its own — *opaque closure present* rather than *value
validated*. Such a decoder cannot check `payload ∈ im(e)`, so **its accept set is
strictly larger than `im(encF)` and O1.5 fails for it.**

The clause is true of *validated* decoding and false of *codec-less* decoding, and as
written it does not say which it means. This is not academic: **topos's M1 contract
already depends on the two-tier distinction** (proposal 0002,
the valueRef clause — a server certifies opaque closure presence and *never* asserts
full validation). A law quantifying over "every accepted `b`" without naming the tier
will be read by a server implementer as a promise their server cannot keep.

⇒ **Proposed repair:** scope the clause — `encF(decF(b)) = b` for every `b` accepted
**under full validation**; under header-only validation the guarantee is framing and
structure only, with payload membership uncertified. The same repair applies to O2.5
on the linked side.

### 5.3 — laws 3 and 4 overlap

Law 3's *"the same code across every conforming implementation"* is exactly law 4's
subject. Harmless in prose; a defect in a proof bundle, where it invites the same
obligation to be discharged twice with two different scopes and nobody noticing they
disagree. **Recorded here so it is proved once (O4.1 + O4.2) and cited from law 3**,
rather than repaired in the frozen text — the redundancy is readable, and the freeze
should not churn on it.

### 5.4 — law 5 is not a theorem

> ⭐ **DISCHARGED 2026-08-29 by `2a67b0d`, the same commit as §5.1 and §5.2. Recorded
> 2026-09-03.** §8 is re-headed as this section asked: *"Laws 1–4 are propositions … Law 5
> is not a proposition — it is a governance commitment, ratified by §16's version policy
> and enforced by §14 offering no such option."*
>
> <!-- claim holds: `grep -c "governance commitment" docs/CODEC.md` == 1 -->

Law 5 — *"There is no accept-noncanonical/emit-canonical option, and none will be
added under any future compatibility pressure"* — is a **governance commitment about
future versions**, not a property of the artifact. It has no proof and cannot acquire
one. It sits under a heading reading *"To be proved in the freeze bundle"*.

A freeze manifest claiming all five laws proved would be making a category error in
public, and the clean-room implementer ([0007](0007-clean-room-commission.md)) will
reasonably ask what a proof of law 5 looks like — a good ambiguity-log entry we can
predict, and should simply not earn.

⇒ **Proposed repair:** re-head §8 so that laws 1–4 are the proof obligations and law
5 is stated as what it is — a commitment ratified by the version policy (§16) and
enforced by there being no such option in the API surface (§14). The commitment loses
no force by being correctly classified; it gains the right enforcement mechanism.

## 5.5 — five obligations the planned corpus cannot express

**Found 2026-08-29 by transfer, and it is the strongest kind of finding: it arrived
from another repo's corpus and reproduced here.** ontos's maintainers measured that
`ontos-over-deixis-v1`'s 17 vectors are all single-value, while its law 4 is a
statement about a *pair* — so that law lives only in a harness loop, and a witness
handed spec plus corpus reports green having tested it **zero times**.

The general form, which is what transfers: **a corpus whose case schema cannot
express a law's subject cannot test that law, and the run still reads green.**

Applied here. [vectors/CODEC-PLAN.md](../../vectors/CODEC-PLAN.md) states the case
shape as `{ name, bundle, bytes, verdict, … }` — **one artifact, one verdict**. Sort
the obligations by what their subject *is*:

| obligation | subject | expressible? |
| --- | --- | --- |
| O1.3, O1.4, O1.5, O3.1, O3.2, O4.1, O4.2 | one artifact | **yes** — this is what the schema is for |
| O2.6 bridge | one value, two forms | **yes** — `codec-linked.json` carries "the same value in both forms" |
| O1.1, O1.2 | **two values**, compared by their encodings | **no field carries a second value** |
| O2.3, O2.4 | **two values**, compared by their addresses | same |

⇒ **The five obligations that quantify over a pair have nowhere to live in a case**,
so they would live in replayer code — where they are invisible to a conformance
claim and absent from any independent implementation that did not happen to write
the same loop.

⚠ **And the plan already states the claim it cannot carry**, which is the tell:
coverage area 1 says *"`≈`-equal values spell identical octets"* and *"two `≈`-equal
members with different representations must produce **identical** bytes"*. That is
exactly O1.1, in prose, above a schema with no second value in it.

**One direction is fine and it is worth separating, because it hides the gap.** The
*decode* side of a pair claim IS expressible — two cases sharing one `bytes` with
different expected nodes, judged under `≈`. What cannot be written is the *encode*
side: encoding two values and comparing the octets. So a corpus can look like it
covers canonicality while testing only the half that needs no pair.

⛔ **AND A HALF-CASE IS THE MILDEST CARRIER — THE CHEAPEST ONE IS THE CASE *NAME*.**
ontos's maintainers took the question back to their own corpus and found a worse form
than the one above:

```
pair_ordered                        {tuple:[atom 01, atom 02]}
pair_swapped_is_a_different_value   {tuple:[atom 02, atom 01]}
  the nodes DO differ (measured) — and NO FIELD IN EITHER CASE SAYS SO
```

⇒ **A reviewer asking "is the pair law covered" greps, finds a vector named
`pair_swapped_is_a_different_value`, and stops.** The name asserts a comparison the
schema has no field to hold. My prediction that *"the prose is where to look"* also
fired, on their `note` field — a note reading *"deixis identity ignores entry order,
and `entries_authored_out_of_order` exercises exactly that"*, attached to one vector
with no partner.

**So "reads as covered" has three carriers, in increasing order of cheapness:**

| carrier | what it costs to create | what it asserts |
| --- | --- | --- |
| a half-case | a real case that tests one direction | half the law, honestly |
| a `note` | one sentence of prose | the whole law, unbacked |
| **a case NAME** | **nothing — it is free text** | **the whole law, unbacked, and it is what a grep returns** |

⇒ **Their correction, adopted: the gap does not merely fail to express the law, it
ADVERTISES itself as covered.** A gap that announces coverage is a different defect
from a silent one, and only the first survives a reviewer who checks.

⭐ **THE DEFENCE IS A LINT, AND THIS PLAN ALREADY HAS A HOME FOR IT.**
[CODEC-PLAN.md](../../vectors/CODEC-PLAN.md) makes case names load-bearing
identifiers and already resolves *"names across all files first, failing loudly on a
dangling or duplicate name"*. **Extend that pass:** a name or `note` that asserts a
relation — *differs*, *same*, *equal*, *swapped*, *identical*, *distinct* — MUST
belong to a case kind carrying the fields that relation needs. Cheap, mechanical, and
it fires at authoring time rather than at witness time.


⭐ **The shape already exists in this repo and simply was not carried forward**:
`identity.json` uses `{ name, left, right, equal, note }`. The repair is a second
case kind of that shape in each codec file — `{ name, bundle, left, right,
same_bytes }` and its address analogue — not a new mechanism.

**Left to the vectors lane to word**, per the same disposition as the withholding
notice: `CODEC-PLAN.md` is the vectors lane's design and the corpus is unauthored, so the cost of
fixing the schema now is zero and rises the moment cases are written against it.


## 5.6 — the L5 discharge: §10 has one group of real precedence, and a gap before it

**Run 2026-08-29 by the method L5 prescribes — enumerate the realizable pairs, not
the table.** Three results, one of them a defect now repaired.

**B1 — most of §10 is a disjoint case analysis, not a precedence.** Sorting the
table's groups by whether their rows can actually co-occur:

| group | rows | can two hold at once? |
| --- | --- | --- |
| artifact start | 1 (2 after B3) | n/a |
| any `uvarint` | 3 | **no** — the guards (*"well-formed, value ≥ 2^64"*, *"well-formed, in range, not shortest"*) make them disjoint by construction |
| tag octet | 1 | n/a |
| entry boundary | 2 | **no** — a key cannot both equal and precede its predecessor (trichotomy) |
| **links header** | **4** | **yes — all six pairs are realizable** |
| end of input | 2 | **no** — input cannot both end early and leave octets over |
| child chunk | 1 | n/a |

⇒ **The entire precedence content of §10 is the four links-header rows.** Everywhere
else the ordering resolves pairs that cannot occur, which is exactly the shape L5
warns about — *"a table that is total on pairs which cannot co-occur is still
incomplete on one that can"*. **Not a defect**: the rows still assign codes, and
stating them in one table is right. But a reader should know that only one group is
carrying precedence, and it is the group to check hardest.

*Checked:* the four links rows form a total order (`duplicate_link_hash` <
`bad_link_index` < `links_out_of_order` < `unused_link`), so all six pairs are
decided. **Complete.**

**B2 — two of those four are not single-step conditions, and the section is titled
"at one step".** `duplicate_link_hash` and `bad_link_index` are detectable at the
octet that carries them. `links_out_of_order` and `unused_link` are **whole-chunk
properties** — first-use order is determined by the body's scan, and an unused link
cannot be known until the body ends. So §10's premise does not hold for half its only
real group.

*It happens not to bite*: the two single-step conditions are listed before the two
post-scan ones, so §10's order and law 4's scan order agree wherever they both apply.
**Recorded rather than repaired** — the agreement is currently an accident of row
order, and a future row inserted without noticing this could break it. A reader
amending §10 should know the table's order is doing two jobs.

**B3 — a realizable pair that §10 did NOT decide: an artifact shorter than the magic.
REPAIRED 2026-08-29.** For a two-octet input `64 78`, two readings were both
defensible: §5.1's *"the magic is exactly `dxf1`; anything else is `unknown_magic`"*,
or §5.6's *"input ending mid-structure is `unexpected_eof`"*. Nothing chose, and
**law 3 promises the same code across every conforming implementation.**

⇒ **§14 forces the answer, so this was not a taste call.** `need_more_input` is
**non-terminal**, becoming `unexpected_eof` only when the caller declares end of
input. A decoder that answered `unknown_magic` on a three-octet prefix would reject a
valid artifact mid-transmission — and a streaming decoder and a whole-buffer decoder
would return different codes for the same octets, which is the disagreement law 3
exists to forbid. `unknown_magic` therefore **presupposes four octets were read**;
fewer is `unexpected_eof`. Now stated at both sites.

⚠ **This is the first thing a clean-room implementer tries** — the empty input and
the truncated input are where anyone starts — so [0007](0007-clean-room-commission.md)
would have collected it as an ambiguity in its first hour. Cheaper to have found it
here, and it is evidence the commission is aimed at the right kind of gap.


## 5.7 — the L4 discharge: disjoint yes, exhaustive only once "input" is pinned

**Run 2026-08-29.** L4 asks two things and warns that the second is the one that gets
skipped. Both were worth asking.

**DISJOINT — yes, and the ordering already existed where I did not look.** The
realizable collision is an artifact whose leaf-codec id is unknown or reserved *and*
whose framing is bad — a reserved id with unsorted keys in the body. Both are
observable, and the classes license **opposite** conclusions: *invalid* says "not a
value, now or ever"; *unsupported* says "may be a value; I cannot say".

I derived the ruling from §9's own note — *"a later registry addition MUST NOT change
the historical judgment that the octets were well framed"*. If such an artifact were
`unsupported`, then assigning that id later would flip it to `invalid`, which the note
forbids. So codec-independent invalidity must outrank unsupported. **§11 already says
exactly that**, in three numbered obligations. The derivation and the spec agree, and
nothing needed changing.

**C1 — but §10 does not point there, and §10 is where an implementer builds fault
dispatch. REPAIRED.** `unsupported_leaf_codec` appears **zero times** in §10's table
(control: fourteen codes that do appear). `limit_exceeded` likewise. So the table
reads as the complete precedence and orders one class of three. §10 now says which
codes it orders and where the other two are ruled — a cross-reference, not a
re-ruling, because §11's ordering is right.

**EXHAUSTIVE — only after fixing what "input" means. C2, REPAIRED.** Law 3 said *"every
input that is not accepted receives a verdict in exactly one class of §9"* and never
said what an input is. For the flat form it cannot matter. For the linked form there
are two candidates and they disagree:

| "input" = | outcome set | §9 exhaustive? |
| --- | --- | --- |
| one artifact's octets (one flat artifact, one chunk) | the five classes | **yes** |
| a closure | the five **plus** `missing_chunk`, `hash_mismatch`, `address_conflict` | **no** — §9 explicitly excludes those as store-layer, not decoder verdicts |

⇒ Under the closure reading **law 3 is simply false**, and §14 invites that reading by
listing *"validate the closure"* as a decode-surface operation whose obligation
includes chunks being *present*. Now scoped: an input is one artifact's octets, and
closure validation composes per-chunk verdicts with store-layer outcomes.

**C3 — and the cross-implementation clause was true only inside the envelope.
REPAIRED.** Law 3 promised *"the same code across every conforming implementation"*.
§12 permits local limits far below the MUST-accept floors and calls the result a
resource judgment, never a validity one. So for an artifact **above** the floors, one
decoder returns `limit_exceeded` where another with a larger budget parses on and
returns an invalid code. Both conform. The promise is about the envelope, not about
all octets, and now says so.

⭐ **All three are the same shape as 5.2 and A1, which is now four instances and worth
naming as a pattern: a law or a table that is correct about its own subject and silent
about its scope.** §10 orders the codes it lists and does not say those are the only
ones it orders; law 3 quantified over "input" and over "every conforming
implementation" without bounding either. **None of the four was a wrong ruling — every
one was a right ruling stated more widely than it holds.** That is a defect class the
clean-room commission is well shaped to find, since an implementer must pick a scope
in order to write anything.


## 5.8 — the worklist review: 10 universals, 2 defects

**The systematic version of what 5.6 and 5.7 found incidentally.** `tools/speccheck.py`
extracts every `MUST`/`SHALL` sentence carrying a universal quantifier: **60 universals
in the spec, 10 of them normative.** Ten is small enough to read in one sitting, which
is the whole argument for the finder — the pattern had been producing defects at a rate
worth spending an hour on.

Six were sound on inspection (three are 5.1/C2/C3's own repairs; three are `MUST`s on
downstream parties — profile authors, applications — whose scope is explicit). **Two
were not.**

**D1 — §12 used `accept`, which is §9's word for a verdict. REPAIRED.** The envelope
read *"a conforming implementation MUST accept inputs up to each floor, MUST NOT refuse
below it."* §9 defines **accepted** as the successful verdict class. Under that reading
the sentence requires **returning `accepted` for invalid octets that happen to be
small**, and forbids refusing them.

⇒ The intent is obvious from context and the text does not say it. §12 constrains when
an implementation may decline to **look**; it never constrains what it **finds**. Now
phrased as resource refusal throughout, with the collision named so the next reader
does not have to re-derive that `accept` is doing double duty.

**D2 — §14 exempted the root chunk from hash verification. REPAIRED, and this one is
security-relevant.** The rule read *"every chunk fetched during traversal MUST be
verified against the hash that referenced it."*

⇒ **Nothing references the root.** You fetch it by address. So the phrase has no
referent for exactly one chunk — and it is the chunk whose verification establishes
that the closure you received is the value you asked for. A store could return any
well-formed closure for a requested address and satisfy §14 as written.

*Checked before claiming:* §15's five bullets cover collision policy, header-only
scope, opacity, hostile input and signatures — **none covers this**, and a search for
root-plus-verification across the document returns only §7's definition of the address.
Now stated as *"the hash by which it was reached"*, with the root case named.

⭐ **Six instances of one shape now — 5.2, A1, C1, C2, C3, D1, D2 — and the review that
found the last two took an hour because a machine produced the list.** That is the
argument for `speccheck`'s worklist half: it cannot judge scope, and it does not need
to. Narrowing 60 universals to 10 normative ones is most of the work, and the judgement
that remains is a human's by construction.

⚠ **And D1 is a subclass worth naming separately: a normative term colliding with its
own definition elsewhere in the same document.** That one *is* mechanically findable —
§9 defines `accepted`, and any other section using "accept" in a different sense is a
candidate. Not implemented; recorded as the obvious next check if this pattern recurs.


## 6. The non-obligations

Recorded because a proof or a vector that pins these would **over-constrain a frozen
spec**, and over-constraint is unrecoverable in the direction that matters:

- **Global fault ordering across a malformed multi-chunk closure.** Law 4 marks it
  explicitly *not frozen*; a closure validator MAY report any discovered fault or a
  set of them. ⚠ **This is a live hazard for the corpus, not only for the paper:** a
  multi-chunk invalid-case vector asserting one specific code, where several are
  permitted, silently freezes a choice the spec deliberately left open — and it would
  pass every implementation we happen to have. Vectors in this area must assert *set
  membership*, never equality.
- **Chunk packing and storage layout.** §6: packing is representation, and
  representation is unobservable.
- **Insertion order of struct entries at construction.** Unobservable by design; the
  floor's property, already pinned by the core vectors.
- **Cross-version address equivalence.** §7 says it does not exist and will not be
  defined. There is nothing to prove and nothing to pin.

## 7. What discharges this ledger

Step 2 is done when: L1–L7 are proved in the paper; O1.1–O1.5, O2.1–O2.6, O3.1–O3.2
and O4.1–O4.2 are discharged or explicitly reduced to a lemma that is; the four
findings in §5 are ruled — **5.1 and 5.2 require normative changes to CODEC.md and
therefore restart the affected vectors and implementations** per 0006's iteration
rule; and the assumption inventory (§2) appears verbatim in the freeze manifest, so a
reader years from now can see what the freeze rests on without reconstructing it from
proofs.

**5.1 is the one to rule first.** It is the only finding that makes a stated law
*false* rather than imprecisely scoped, and it lands on §4 — the clause the
clean-room implementer reads before they write a line.
