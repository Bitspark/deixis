# The identity-affecting surface of `deixis-codec-v1`

**Status: inventory, not normative.** [CODEC.md](CODEC.md) states the obligations; this
page enumerates the subset of them that decides **octets and addresses**, so that a freeze
can be checked against a list rather than against a reading. Nothing here adds, weakens or
reinterprets a requirement. Where this page and `CODEC.md` disagree, `CODEC.md` is right
and this page has a defect.

It exists because a measurement made on 2026-09-03 had nowhere to live: the surface was
enumerated in board mail between two lanes, scored, and closed, and the *score* reached
[EVIDENCE.md](EVIDENCE.md) while the *list it was scored against* did not. A coverage
number whose surface is unrecorded cannot be recomputed by anyone.

## The criterion

> A site is identity-affecting **iff** changing it changes, for at least one value, either
> the octets a conforming encoder emits or the 32-octet address computed.

Deliberately narrower than "normative". §9's result classes, §10's fault precedence, §11,
§12's floors, §14's API states and §16's governance are all **out**: two implementations
that disagree on any of them still emit identical octets for the same value.

⚠ **The criterion was applied wrongly once, in a way worth recording.** Site 35 (§4's
lawfulness) was first excluded on the grounds that it *"cannot be broken by editing this
file"* — which is a second criterion, about the mutability of `CODEC.md`, silently
substituted for the published one. A slot whose `e` is unlawful emits different octets, so
the stated criterion always included it. ⇒ **The exclusion was not a judgment call under
the criterion; it was a different criterion applied without noticing.** Caught by the
vectors lane, whose reading was: *"cannot be broken by editing this file" is a statement
about the file rather than about identity.*

⛔ **And the substituted predicate returned the wrong answer on its own terms.** §4's line
is as editable as any other: weakening `x ≈ y ⟺ e(x) = e(y)` to `⟹` lets two
non-equivalent values share octets, so **one address then denotes two values.** The
exclusion was not a defensible call under a defensible-but-different rule — it was false
under both. Site 35 was measured **uncovered** and is now closed.

## The sites

`[K]` / `[B]` record what the **2026-09-03** measurement could use. `[K]` sites had already
been named to the enumerating lane in a prior message, so scoring pins against them would
have returned the same answer key with additions on top; only the 25 `[B]` sites carried
information. The marks are preserved because they are what makes that number reproducible —
they are historical, and have no meaning for any later measurement.

### A. The integer production — every length, count and index in both grammars

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 1 | `[K]` | §3 | LEB128: seven bits per octet, **least-significant group first**, high bit set on all but the last |
| 2 | `[B]` | §3 rule 3 | Shortest form. A second spelling of a value is a second address |
| 3 | `[B]` | §3 rule 1 | Domain `[0, 2^64 − 1]` |
| 4 | `[B]` | §3 rule 2 | At most ten octets |
| 5 | `[B]` | §3 | ⭐ *"Every grammar in this specification writes `cuvarint`, never `uvarint`"* — **the binding, not the rules.** With all three rules intact, one grammar position saying `uvarint` admits two spellings and therefore two addresses |

### B. The flat grammar

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 6 | `[B]` | §5 | `flat := header ‖ node` — the **order**. See *obligation without a mark* below |
| 7 | `[K]` | §5 | `header := "dxf1" ‖ cuvarint(len(id)) ‖ id` |
| 8 | `[B]` | §5 | Leaf tag is `0x00`; the length prefix precedes the payload |
| 9 | `[B]` | §5 | Struct tag is `0x01`; the count prefix precedes the entries |
| 10 | `[B]` | §5 | `entry := cuvarint(len(key)) ‖ key ‖ node` — key before node |
| 11 | `[B]` | §5 | **No reference production.** An encoder emitting a back-reference for a repeated subtree changes the octets of a value. An absence cannot be mutated, so a vector here must assert the positive: the subtree spelled in full, twice |
| 12 | `[B]` | §5.4 | Entry keys in strictly ascending lexicographic order |
| 13 | `[B]` | §2 | ⭐ **The definition of that order**, including *"the shorter string orders first"*. 12 says entries are sorted; 13 says what sorted **means**. Reverse the tie-break and every struct holding a key that is a prefix of another re-orders — while 12 still reads as satisfied |
| 14 | `[B]` | §5 | The empty struct is exactly `0x01 ‖ 0x00` |
| 15 | `[K]` | §5 rule 3 | `count` equals the number of entries that follow |

### C. The linked grammar

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 16 | `[K]` | §6 | `chunk := "dxl1" ‖ cuvarint(len(id)) ‖ id ‖ …` |
| 17 | `[B]` | §6 | **The links header's position** — between the id and the body |
| 18 | `[K]` | §6 | `hash{32}` — the width |
| 19 | `[B]` | §6 | `cuvarint(nlinks)` precedes the hash array |
| 20 | `[K]` | §6 | `lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)` |
| 21 | `[B]` | §6 | Each hash is SHA-256 of the child's **entire chunk octets** under this same layout — not of its value, its body, or its flat form |
| 22 | `[B]` | §6 | A body MUST NOT contain a raw hash; children by index only |
| 23 | `[K]` | §6 | **First-use order**: scan in canonical key order, append each distinct child hash when first referenced |
| 24 | `[K]` | §6 rule 2 | `nlinks` equals the number of hashes present |
| 25 | `[B]` | §6 rule 3 | The same hash MUST NOT appear twice. Distinct from 23: **23 fixes order, 25 fixes multiplicity.** A header listing a twice-referenced child twice satisfies first-use order exactly as 23 words it |
| 26 | `[B]` | §6 | A leaf chunk has `nlinks = 0` |
| 27 | `[K]` | §6 | **One node, one chunk** — fixes the chunk set, hence the address set |
| 28 | `[B]` | §6 rule 7 | The inheritance of §5's key ordering, tag, count, payload and trailing rules into the linked form |

### D. Hash and addressing

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 29 | `[B]` | §7 | SHA-256, pinned. Never a parameter |
| 30 | `[B]` | §7 | The hash covers the chunk's **entire** octets — so the magic and the id are *inside* the hashed octets |
| 31 | `[B]` | §7 | The content address is the SHA-256 of the **linked-form root chunk** and nothing else; the flat digest is lawful but is never an address |
| 32 | `[B]` | §7 | One value under two leaf-codec-ids has two addresses |

### E. The id, which travels inside the hashed octets

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 33 | `[B]` | §13 | `id := 0x00 ‖ cuvarint(n)` \| `0x01 ‖ ns{16} ‖ cuvarint(k)`, plus the `0x02..0xff` reservation. The discriminator octets and the `ns{16}` **width** are identity-affecting on exactly §7's argument |
| 34 | `[B]` | §13 | Total id length 2..32 octets |

§13's shortest-form binding on `n` and `k` is **site 2 applied here**, not a separate site.

### F. The slot

| # | | site | what changes if it changes |
| --- | --- | --- | --- |
| 35 | — | §4 | `e` is **lawful**: `x ≈ y ⟺ e(x) = e(y)`. The payload octets themselves. Added after the measurement; see the criterion note above |

## Two exclusions, argued rather than assumed

- **§7's `(address-space, digest{32})` pair** governs addresses *outside* chunk octets. It
  changes what an address looks like in an API, not what it is. Both lanes agree it is out.
- **§8's laws 1 and 2** — `encF(decF(b)) = b`, and *"the chunk set is a function of the
  value"* — are **consequences of A–E, not sites.**

  ⛔ **The test I first offered for this cannot decide it, and was run.** I proposed *a pin
  on the laws earns its place only if it catches something no pin on A–E catches*; law 1
  measured **uncovered both before and after**. That result is consistent with two opposite
  readings — *law 1 is a site and is uncovered*, or *A–E genuinely entail law 1, so silence
  is correct* — and **pins cannot separate them, because pins measure textual dependence
  and the question is entailment.** The vectors lane made this point and declined to report
  the measurement as falsifying anything.

  ⭐ **[0008](design/0008-proof-obligations.md) already settles it, structurally rather than
  by judgment.** Its assumption inventory lists **A2 = lawfulness = site 35** as an
  *assumption*, stated in §4; its obligations table derives law 1 as O1.1–O1.5 *from* A2–A5,
  L1, I2 and §5's rules. ⇒ **Premises and theorems are already partitioned there**, and this
  page's A–E are the premises. Sharper still, O1.2 leans on **`A2 (⟸)`** — precisely the
  direction the vectors lane's site-35 mutation weakens, so the ledger predicted which
  obligation that mutation breaks.

  ⇒ **The discriminator, stated so it can be reused:** a **site** *states* an obligation,
  and mutating it licenses encoder behaviour nothing else forbids. A **consequence** is
  derived, and mutating its statement changes no octet any conforming encoder emits — the
  document merely claims less than it can prove. Whether A–E *in fact* entail law 1 is a
  proof obligation under 0008, not a measurement, and it is not discharged here.

## ⭐ Obligation without a mark

Site 6, `flat := header ‖ node`, was missed by **two instruments built on different
principles, for structurally analogous reasons**:

```
  a token extractor over grammar blocks   could not see it - it carries NO LITERAL:
  (tools/speccheck.py worklist 1c)        no octet, no magic, no width, no integer

  a hand-written vector corpus            could not see it - it does not READ LIKE
  (the pins)                              a requirement: no MUST, no prose
```

⇒ **The order it fixes is as identity-affecting as any octet in the block.** Neither
instrument was looking for structure that carries an obligation without carrying a mark —
one scans for constants, the other for requirements, and a bare production is neither.

⚠ **This is a defect class, not an artifact of either instrument.** The two were built
independently and failed on the same line of the same code block. Both were repaired:
worklist 1c now treats a bare `:=` as a carrier (11 sites → 12), and the corpus pins the
production. ⭐ **Neither lane could have reached it alone** — it surfaced only because each
measured the other's blind spot.

## What this page does not establish

The 2026-09-03 measurement scored **17/25** against the blind subset and closed to 25/25. <!-- claim recorded 2026-09-03: a one-off exercise against a surface enumerated once, by a reader who then graded pins against it. Nothing re-runs it: the denominator is the 25 sites this page marks BLIND, which is historical by construction. -->
The detail, including the three shapes the eight misses took, is in
[EVIDENCE.md](EVIDENCE.md) and is not repeated here.

⚠ **It is not closure, and this page is not a freeze gate.** Both lanes learned this codec
from `CODEC.md`, and both have now been told that grammar is where the pins were missing —
that correction is a **shared prior**. A defect invisible to both because they read the
same prose is exactly what 0003's Verdicts row 11 describes, and row 11 remains open: it
asks for an enumerator who authored neither the specification nor the corpus, and **neither
lane is that.** ⇒ **It is a GAP AWAITING WORK, not a ceiling awaiting a
decision** — ontos closed that identical structure by operator decision on a
**perishable** seal, and the pricing does not transfer here: the reachable pool replenishes
faster in a day than this board has ever REGISTERED (upper bound 4; the drain itself is
unmeasured, since board registration is not corpus reading). See `EVIDENCE.md`, with the bound
(the RAW pool is measured; the WILLING pool is not). A surface enumerated by a participant, however carefully, bounds every
number computed against it.

⇒ **The honest claim is:** this is the surface two lanes could see, one of them enumerating
it without access to the other's pins. It is strictly better than either lane grading its
own list. It is not an independent enumeration of the codec's identity surface, and it
should not be cited as one.

## How to recompute this page

There is no generator. The list was made by reading `CODEC.md` end to end against the
criterion above — the only method that can find a site the spec states without marking.
`tools/speccheck.py`'s worklist 1c mechanically finds the lines that live **inside grammar
blocks** — the sites in sections B, C and E that are productions rather than prose — and is
a cross-check on that subset only. **Run `python tools/speccheck.py` for the current set;
this page deliberately does not transcribe it.**

⚠ **A count copied into prose is stale the moment the corpus it counts is edited, and this
paragraph invites you to recompute.** It named "the twelve lines" until 2026-09-03, which
would have turned any later widening of the extractor into apparent evidence that *this
page* was wrong. The vectors lane hit the same thing harder in `EVIDENCE.md`, where the
paragraph did not merely quote a number but told the reader to treat a mismatch as an
error — and then their repair was itself falsified inside its own commit, because writing
it added a link to the corpus being counted. ⇒ **The gate is the number; a page names the
gate.** ⚠ **Every other site on this page is prose and is structurally out of its reach**,
including all of §3's rules, §2's ordering definition, §5's absent reference production,
§7 entire, and §4. A clean 1c is therefore evidence about roughly a third of the surface;
reading it as evidence about the whole is the error this page exists to make hard.
