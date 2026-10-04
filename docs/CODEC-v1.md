> **HISTORICAL: the withdrawn `deixis-codec-v1` candidate.** This is the text of
> `docs/CODEC.md` as it stood at `190a03d`, kept verbatim so the v1 vector corpus keeps
> the specification it was authored against. v1 encoded the previous `Leaf | Struct`
> model. It was withdrawn before any freeze, implementation or clean-room commission
> ([ADR 0011](design/0011-codec-for-mandatory-nodes.md)). The current contract is
> [`deixis-codec-v2`](CODEC.md). Nothing below is normative.

# Codec

**Status: CANDIDATE CONTRACT — draft, not frozen.** This is the normative
specification of `deixis-codec-v1`: what a conforming implementation must accept,
must refuse, and may claim. Rationale lives in
[design/0006](design/0006-canonical-codec.md) and the two external-advice ledgers
(`research-docs/0001`, `research-docs/0002`); this document states obligations and
does not re-argue them. Nothing here is frozen until the freeze manifest is signed —
see [Conformance](#conformance) and the freeze process in 0006.

**Node model (2026-09-23):** this candidate contract encodes the original
`Leaf | Struct` model ([TREE.md](TREE.md#the-previous-model)). The accepted target
is [ADR 0010](design/0010-mandatory-node-values.md)'s mandatory
`Node(T, Key ⇀ Node(T))`; its node grammar and version disposition remain open
in [#1](https://github.com/Bitspark/deixis/issues/1). The old model can be read as
an image in `Node[Option[T]]` with `Some` only at terminal positions. That
correspondence does not make this a codec for arbitrary mandatory nodes, or
require retaining these bytes and addresses in the successor design.

The key words MUST, MUST NOT, SHOULD, MAY are to be read as in RFC 2119.

## 1. Scope

`deixis-codec-v1` is a **combinator**, not a serializer. Given a lawful leaf codec
for a slot `T` (§4), it yields canonical bytes and an exact decoder for every value
of the original `Leaf(T) | Key ⇀ Node(T)` model identified in the status note above.

It defines **two byte forms over one value semantics**:

| form | magic | for |
| --- | --- | --- |
| **flat** | `dxf1` | one contiguous octet string per tree — interchange, signing, small values |
| **linked** | `dxl1` | one chunk per node, children by hash — stores, wires, Merkle sync, structural sharing |

Each form is separately a complete invariant: within a form, equal octets iff
`=_≈`-equal values. Across forms, decoding agrees up to `=_≈`. **The two forms' octets
and digests do not correspond, by design.** The forms are one suite: they share a
version digit, freeze together, and are governed together. An implementation MUST NOT
version, extend, or give one form a capability or variant reading independently of
the other.

⚠ **This clause governs the FORMS; §2.1's conformance profiles govern
IMPLEMENTATIONS.** The two do not conflict and the distinction is worth keeping in
view: `flat-decoder` existing does not give `dxf1` a life of its own, and §16 requires
exactly that partition ("software implementing a subset MUST claim the subset"). *This
sentence used the word "profile" as a verb until §2.1 gave it a noun sense; it was
reworded rather than annotated, so no reader has to carry a disambiguation forward.*

The codec defines no reading of a tree. Sequences, sets, records, and every other
container semantics are **structure profiles** ([design/0004](design/0004-structure-slot.md)),
carried beside values, never inside them. The codec MUST NOT be extended to recognize,
tag, or validate any structure profile.

## 2. Notation

- `‖` is octet concatenation. `x{n}` is exactly `n` octets of `x`.
- Literal octet strings are written as ASCII in quotes (`"dxf1"` = `64 78 66 31`) or
  as hex pairs (`0x00`).
- `e` is the slot's leaf encoder, `D` its decoder (§4).
- `=_≈` is node identity as lifted in [TREE.md](TREE.md) from the slot's `≈`.
- **Lexicographic order** on octet strings, written `<`, is: compare octet by octet
  as unsigned values at each position; at the first difference the smaller octet
  orders first; if no difference is found before one string ends, the **shorter
  string orders first**. This order is total on octet strings and is the only order
  the codec uses.

### 2.1 Conformance profiles

Every normative requirement below is addressed to a **profile**, not to "an
implementation" at large. The profiles are:

| profile | reads / writes | may report |
| --- | --- | --- |
| **flat-encoder** | value → `dxf1` octets | nothing; it emits or it fails locally |
| **flat-decoder** | `dxf1` octets → value, full validation | every §9 decoder verdict |
| **flat-header-validator** | the header of `dxf1` only (§5 magic and id) | `unknown_magic`, `unexpected_eof`, `need_more_input`, the §3 uvarint faults **on the id length**, `unsupported_leaf_codec` |
| **linked-resolver** | a `dxl1` closure → value | every §9 decoder verdict |
| **closure-checker** | chunk framing, link structure and digests, **without decoding leaves** | framing and link faults; never `non_canonical_payload` |
| **chunk-store** | chunks by address | **only** the store-layer codes of §9 |

**`limit_exceeded` is UNIVERSAL and is deliberately in no row above.** Every profile
that consumes octets may refuse on resource (§12) and report `limit_exceeded` naming
the dimension. It is stated once, here, rather than repeated in six cells — and the
repetition would be the lesser error. The greater one would be reading its absence
from a row as a prohibition.

⇒ **It is not a fault code and the table's shape cannot express it.** Every other code
above is a claim about the artifact, so two conforming implementations must agree on
it. `limit_exceeded` is a claim about **the reader's willingness to spend**: §8's law 3
says in as many words that two conforming implementations with different local limits
return `limit_exceeded` and an invalid code *for the same over-floor artifact*. No
claim about octets can do that.

⚠ **So the `only` in `chunk-store`'s row scopes FAULT codes, not verdicts.** A store
handed an over-floor chunk must be able to decline, §9 forbids dressing that refusal up
as invalidity, and an exclusive reading would leave it nothing to say. It reports the
store-layer codes and no other **fault**; `limit_exceeded` is available to it like any
other consumer of octets. `flat-encoder` is outside this by its own cell — it emits or
fails locally and has no verdict channel to refuse on.

**A profile owes only what it can observe.** A `flat-header-validator` that never
reads a body cannot be in breach of §5's key-ordering rules; a `closure-checker` that
never applies `D` cannot decide `payload ∈ im(e)`. A requirement whose antecedent a
profile cannot reach does not bind it — and stating this is what stops an
unqualified "an implementation MUST …" from being read as binding on every profile
including those structurally incapable of evaluating it.

⇒ **Leaf-codec knowledge is a MODIFIER, not a profile**, because it cuts across them.
For a given leaf-codec-id an implementation is **leaf-holding** or **leaf-blind**, and
§5 and §10 already turn on exactly this distinction ("a decoder holding the leaf
codec", "an implementation without the leaf codec"). A leaf-blind `flat-decoder` is a
conforming `flat-decoder`; it reports `unsupported_leaf_codec` and, per §9, its
judgment that the framing was well formed stands permanently.

**The store is not a decoder.** §9 already marks `missing_chunk`, `hash_mismatch` and
`address_conflict` as *"not decoder verdicts"*; §2.1 names the actor whose verdicts
they are. No decoder profile may report them, and `chunk-store` reports nothing else.

⚠ **And `chunk-store` differs from the other five in kind, which is worth stating
rather than smoothing over.** Every other profile's obligations are about **one
artifact's well-formedness**, decidable from octets it was handed. `chunk-store`'s are
about a **relation** — address ↔ octets — and it is the only **stateful** profile:
`missing_chunk` and `address_conflict` are properties of its own contents over time,
not of any input. ⇒ **So it is the only profile that can be in breach without ever
having been given a malformed artifact.**

**Why the header validator's report set is wider than its read set looks.** Reading the
id means reading the id-**length** `uvarint`, which §3 binds in full — so a truncated,
non-shortest or overflowing length is observable here — and an unknown or reserved id
is `unsupported_leaf_codec` by §9. ⇒ A profile must be permitted to NAME every fault it
can OBSERVE. That is the mirror of this section's own rule: §2.1 stops a profile being
*bound* by what it cannot observe, and a report set narrower than the read set would
leave one unable to *report* what it can. Both asymmetries are defects; they differ
only in sign.

## 3. The integer domain

`uvarint` is unsigned LEB128: seven bits per octet, least-significant group first,
the high bit of each octet set on all but the last. That is the **syntax** and it is
not what this codec transmits.

**`cuvarint` is the canonical production: a `uvarint` satisfying all three rules
below.** Every grammar in this specification writes `cuvarint`, never `uvarint` — so
an integer position that is bound by the rules is one the grammar has already named,
and a parser written from a grammar block cannot be non-canonical by omission.

⇒ **That makes the scope STRUCTURAL rather than a list.** This section previously
scoped the rules by exhaustion — *every length, count, index, and the registry
ordinals `n` and `k` of §13* — because scoping them by ROLE had missed `n` and `k`,
which are none of those things. Exhaustion fixed that instance and kept the defect:
**a list is always one short, and the next integer field added to any grammar would
have needed someone to remember this sentence.** Now nothing needs remembering — the
binding travels with the production, and the set of bound positions is `grep`-able
rather than asserted.

The id travels **inside the hashed octets** (§7), so a second spelling of `n` is a
second address for the same value — the shortest-form rule below is what makes an
address a function of the value, not merely a tidiness.

**Any profile that parses a `cuvarint`** MUST enforce all three of — which includes
`flat-header-validator`, whose only `uvarint` is the id length (§2.1), as well as every
full decoder and `closure-checker`:

1. **Domain.** The value lies in `[0, 2^64 − 1]`. A well-formed spelling denoting a
   larger value MUST be refused as `uvarint_overflow`.
2. **Length.** At most ten octets. An eleventh continuation octet MUST be refused as
   `malformed_uvarint`, as MUST input that ends while the continuation bit is set.
3. **Shortest form.** The spelling MUST be the unique shortest encoding of its value.
   Any longer spelling of the same value MUST be refused as `non_shortest_uvarint`.

Implementation note, normative in effect: a host language whose native integers
cannot represent `2^64 − 1` exactly MUST parse into a type that can (in TypeScript,
`BigInt`, never `Number`). Local allocation and indexing MAY impose far smaller
limits — those are resource judgments (§10), never validity judgments.

## 4. What the slot supplies

The codec is defined only for slots admitted at the **canonical-bytes tier** of
[SLOTS.md](SLOTS.md). A leaf codec for `T` supplies four things, and they travel as
one unit:

```
LeafCodec(T) = { id, ≈, e, D }
```

- `id` — the leaf-codec-id (§13), which appears in the octets.
- `≈` — the slot's equivalence, which the floor lifts to `=_≈`.
- `e : T → Bytes` — total, computable, and **lawful**: `x ≈ y ⟺ e(x) = e(y)`.
  Lawfulness is the entire obligation. How `e` is computed is the supplier's business.
- `D : Bytes ⇀ T` — an exact partial inverse: `D(e(x)) ≈ x`, and `D(b)` is defined
  only where `b ∈ im(e)`. `D` MUST be **computable**, and membership in `im(e)` MUST
  be **decidable**. `D` MUST refuse a non-canonical spelling rather than repair it.

  Decidability is a slot admission requirement at this tier, not a quality note: §5.5
  makes `payload ∈ im(e)` a MUST-check and §8 law 3 promises every input a verdict,
  so an undecidable `im(e)` does not make validation slow — it makes law 3 false.

The four MUST be supplied together and MUST be used together. An implementation MUST
NOT accept an equality and an encoder from separate sources for one artifact, and a
decoded artifact SHOULD retain a reference to the codec context it was decoded under.

**One artifact, one leaf codec.** Every chunk of one linked closure, and the whole of
one flat artifact, carries the same `id`. A child whose id differs from its parent's
MUST be refused as `leaf_codec_mismatch`. Heterogeneous leaves are expressed as one
explicitly tagged-union leaf codec — never as a mid-tree codec change.

## 5. The flat form

```text
flat   := header ‖ node
header := "dxf1" ‖ cuvarint(len(id)) ‖ id
node   := 0x00 ‖ cuvarint(len(payload)) ‖ payload      # Leaf;  payload = e(x)
        | 0x01 ‖ cuvarint(count) ‖ entry*              # Struct; count = |entries|
entry  := cuvarint(len(key)) ‖ key ‖ node
```

**The flat form has no sharing, and that is a requirement rather than an omission.**
`node` has no reference production: every child is spelled inline, so a value whose
subtrees are identical spells them **in full, each time**, and those octets are the
canonical ones. An encoder that noticed the repetition and emitted a back-reference
would produce different octets for one value and break law 1 — so the absence of a
reference construct above is load-bearing, and **no flat encoder may introduce one.**

⇒ This is also what makes L1 (unique decodability) trivial for the flat form, and what
makes law 2 say something: the linked form stores that shared subtree **once**, so
*"the chunk set is a function of the value"* is a claim precisely because the flat form
does not dedupe. The two forms disagree about repetition by design, and agree about the
value.

Canonicality rules, each a MUST:

1. The magic is exactly `"dxf1"`. Anything else is `unknown_magic` — **which
   presupposes four octets were read.** Fewer than four is `unexpected_eof`
   (streaming: `need_more_input`), never `unknown_magic`: §14 makes
   `need_more_input` non-terminal, so a decoder that rejected a three-octet prefix as
   bad magic would refuse a valid artifact mid-transmission, and a streaming and a
   whole-buffer decoder would return different codes for the same octets.
2. The tag octet is `0x00` or `0x01`. Anything else is `unknown_tag`.
3. `count` equals the number of entries that follow; entries are read sequentially
   and the structure closes when `count` of them have been read.
4. Entry keys are in **strictly ascending lexicographic order** (§2). An entry key
   equal to its predecessor is `duplicate_key`; one preceding its predecessor is
   `unsorted_keys`. **Any profile that reads entries** MUST NOT sort on read and MUST NOT
   deduplicate — `closure-checker` included, which reads entry keys and reports both
   ordering faults (§2.1). The word `decoder` would now exclude it.
5. A leaf's `payload` MUST be in `im(e)` — i.e. `D(payload)` is defined. A decoder
   holding the leaf codec MUST check this. A decoder not holding it MUST NOT claim
   the value validated (§11).
6. After the root node is read, no octets may remain: any remainder is
   `trailing_bytes`. Input ending mid-structure is `unexpected_eof`.

An empty struct is `0x01 ‖ 0x00` and is a legal node, distinct from every leaf.

## 6. The linked form

```text
chunk  := "dxl1" ‖ cuvarint(len(id)) ‖ id
        ‖ cuvarint(nlinks) ‖ hash{32}*                 # ← the LINKS HEADER
        ‖ body
body   := 0x00 ‖ cuvarint(len(payload)) ‖ payload      # Leaf
        | 0x01 ‖ cuvarint(count) ‖ lentry*             # Struct
lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)
```

Each hash in the links header is the SHA-256 (§7) of the referenced child's **entire
chunk octets** under this same layout. Bodies reference children only by index into
that header; a body MUST NOT contain a raw hash.

**First-use order, normatively.** Scan the body's entries in canonical key order
(§5.4). Each distinct child hash is appended to the links header at the moment it is
first referenced. Therefore the header contains each distinct child hash exactly once,
in order of first reference. This makes the header a function of the value.

Canonicality rules, each a MUST:

1. The magic is exactly `"dxl1"`.
2. `nlinks` equals the number of hashes present.
3. The same hash MUST NOT appear twice: `duplicate_link_hash`.
4. Every `link-index` is `< nlinks`: otherwise `bad_link_index`.
5. Every listed hash MUST be referenced by at least one `lentry`: an unreferenced
   hash is `unused_link`.
6. The header order MUST equal first-use order: otherwise `links_out_of_order`.
7. Key ordering, tag, count, payload and trailing rules are as in §5.

A leaf chunk has `nlinks = 0`. **One node, one chunk**: a `chunk-store` (§2.1) MAY pack chunks
privately in any way it likes, with no effect on addresses — packing is
representation, and representation is unobservable. The canonical form is not a
storage mandate.

**Consequence, stated so it is not discovered:** the linked form gives no sub-node
incrementality. Changing any key or child of a wide node retransmits that whole node
chunk. Every collection profile MUST document its worst-case node width, update
amplification, and intended scale.

## 7. Hash, addressing, and domain separation

- v1 pins **SHA-256**. Hash agility is a new codec version, never a parameter.
- A hash is computed over the chunk's entire octets as laid out in §6. The magic and
  the `id` are therefore *inside* the hashed octets: an address commits to codec
  version, form, and leaf interpretation — not merely to a naked node.
- **The content address of a value is the SHA-256 of its linked-form root chunk, and
  nothing else, ever.** The flat form's digest is a lawful invariant but is never an
  address, and MAY appear as a checksum in transport but MUST NOT name a value.
- Addressing composes: every subtree of a linked value has an address.
- **Addresses are version-qualified outside chunk octets.** Everywhere an address
  leaves a chunk — APIs, name bindings, signature envelopes, logs, mapping artifacts,
  wire messages — it MUST travel as the pair `(address-space = "dxl1", digest{32})`.
  A bare 32-octet digest is not an address. Raw digests appear only *inside* chunks,
  where the enclosing chunk fixes version and hash. **Any profile that exposes
  addresses** — `linked-resolver` and `chunk-store` (§2.1); the flat profiles have no
  addresses to expose — MUST NOT expose a public address type that is merely a
  32-octet array.
- Address equality implies value equality **within one leaf-codec-id, computationally,
  under SHA-256 collision resistance**. One value under two leaf codecs has two
  addresses. Cross-version address equivalence does not exist and will not be defined;
  a successor is a new address space plus explicit conversion artifacts (§16).

## 8. Laws

Laws 1–4 are propositions, to be proved in the freeze bundle and pinned by vectors;
their obligations are enumerated in
[0008](design/0008-proof-obligations.md). Law 5 is not a proposition — it is a
governance commitment, ratified by §16's version policy and enforced by §14 offering
no such option. It is stated here because it belongs with the laws it protects.

1. **Flat canonicality.** `encF(x) = encF(y) ⟺ x =_≈ y`; `decF(encF(x)) =_≈ x`; and
   for every `b` accepted **under full validation** (§11), `encF(decF(b)) = b` —
   accepted input re-encodes octet-identically.

   The scope is load-bearing. A decoder not holding the leaf codec cannot check
   §5.5's `payload ∈ im(e)`, so its accept set is strictly larger than `im(encF)` and
   this clause does **not** hold for it. Under header-only validation the guarantee
   is framing and structure only, with payload membership uncertified — which is
   exactly what §11's *opaque closure present* state means, and why a store may
   certify that state without ever holding a leaf codec.
2. **Linked canonicality.** Root-address equality iff `=_≈` (computationally, under
   §7's assumption); the chunk set is a function of the value; decoding a closure
   agrees with flat decoding up to `=_≈`. Law 1's validation scoping applies here
   unchanged.

   Only the reading direction is computational: *equal values have equal addresses*
   is unconditional, and it is *equal addresses imply equal values* that rests on
   §7's collision-resistance assumption.
3. **Total, class-stable refusal.** Every input that is not accepted receives a
   verdict in exactly one class of §9, and — for one artifact decoded sequentially,
   **within §12's MUST-accept floors** — the same code across every conforming
   implementation.

   Two scopings, both load-bearing. **"Input" means the octets of one artifact** — one
   flat artifact, or one chunk — never a closure: validating a closure composes
   per-chunk verdicts with store-layer outcomes (`missing_chunk`, `hash_mismatch`,
   `address_conflict`), and §9 excludes those from decoder verdicts precisely because
   they are facts about a store rather than about octets. Read over a closure, §9's
   classes are not exhaustive and this law would be false.

   And **the cross-implementation clause holds only within the floors.** Above them a
   decoder MAY refuse on resource (§12), so two conforming implementations with
   different local limits can return `limit_exceeded` and an invalid code for the same
   over-floor artifact. That is intended — local limits are local — but it means the
   identical-code promise is a promise about the envelope, not about all octets.
4. **Fault determinism, scoped.** For one artifact parsed sequentially, the code is
   determined by where the single-pass parser first cannot continue canonically, with
   §10's priorities where two conditions are observable at one step. **Not frozen:**
   any global ordering of faults across a malformed multi-chunk closure. A `closure-checker`
   (§2.1) MAY report any discovered fault or a set of them.
5. **No lenient mode, ever.** There is no accept-noncanonical/emit-canonical option,
   and none will be added under any future compatibility pressure.

## 9. Result classes

A decoder's verdict is **accepted**, or exactly one of four non-acceptance classes.
An implementation MUST distinguish the four; collapsing them is a conformance failure,
because they license different actions.

| class | meaning | the caller may conclude |
| --- | --- | --- |
| **invalid** | the octets are not canonical `deixis-codec-v1` | these octets are not a value, now or ever |
| **unsupported** | well-formed framing, absent capability | the octets may be a value; *I* cannot say |
| **incomplete** | streaming: more input may arrive | nothing yet |
| **resource-refused** | valid so far, beyond a local limit | the octets may be a value; I decline to spend |

**invalid:** `malformed_uvarint` · `non_shortest_uvarint` · `uvarint_overflow` ·
`unknown_magic` · `unknown_tag` · `duplicate_key` · `unsorted_keys` ·
`trailing_bytes` · `unexpected_eof` · `bad_link_index` · `unused_link` ·
`duplicate_link_hash` · `links_out_of_order` · `leaf_codec_mismatch` ·
`non_canonical_payload` (a leaf payload outside `im(e)`).

**unsupported:** `unsupported_leaf_codec`. An unknown or reserved id is a **missing
capability, not malformed octets**: framing and hashes may still be judged, and a
later registry addition MUST NOT change the historical judgment that the octets were
well framed.

**store / traversal layer** (not decoder verdicts): `missing_chunk` · `hash_mismatch` ·
`address_conflict`.

**resource-refused:** `limit_exceeded`, naming the dimension of §12 that was exceeded.
`limit_exceeded` MUST NOT be reported as invalidity.

Codes are stable identifiers, pinned across implementations by vectors. Adding a code
is a version act.

## 10. Fault precedence at one step

Where two conditions are genuinely observable at one parser step, the first listed
wins:

⭐ **READ FIRST, RULED LAST.** An identifier being *readable* early does not make the
judgment that turns on it *early in precedence*. A leaf-codec-id is read before the body
it governs — the parent's own id before its first tag, a child's id before the child's
body — so the natural implementation resolves the codec table on sight of the id and
returns `unsupported_leaf_codec` or `leaf_codec_mismatch` for octets that are simply
malformed. The table below says the framing fault wins in both cases. **It is one
mistake at two scales**, and the corpus carries a case for each, recording the code the
natural strategy produces instead.

**This table orders the codes reachable from framing alone.** Three others are ruled
elsewhere, so a reader building fault dispatch from this table alone would omit them:
`unsupported_leaf_codec` sits **below** every framing fault and **above** every
payload-level judgment (§11); `non_canonical_payload` is that payload-level judgment
and is therefore reachable only by a decoder holding the leaf codec, ordered last of
the three; and `limit_exceeded` is never invalidity (§9, §12).

| at | conditions seen together | code |
| --- | --- | --- |
| artifact start | fewer than four octets available | `unexpected_eof` (streaming: `need_more_input`) |
| | four octets read, not `dxf1` / `dxl1` | `unknown_magic` |
| any `uvarint` | ill-formed continuation, or > 10 octets | `malformed_uvarint` |
| | well-formed, value ≥ `2^64` | `uvarint_overflow` |
| | well-formed, in range, not shortest | `non_shortest_uvarint` |
| tag octet | not `0x00` / `0x01` | `unknown_tag` |
| entry boundary | key **equals** its predecessor | `duplicate_key` |
| | key **precedes** its predecessor | `unsorted_keys` |
| links header | the same hash listed twice | `duplicate_link_hash` |
| | index ≥ `nlinks` | `bad_link_index` |
| | first-use order violated | `links_out_of_order` |
| | a listed hash no `lentry` uses | `unused_link` |
| end of input | ends mid-structure | `unexpected_eof` (streaming: `need_more_input`) |
| | octets remain after the root | `trailing_bytes` |
| child chunk | its id differs from the parent's | `leaf_codec_mismatch` |

⚠ **THREE OF THE ADJACENCIES ABOVE CANNOT BOTH BE OBSERVED, AND THE TABLE SAYS SO
RATHER THAN LEAVING A READER TO FIND OUT.** This section scopes itself to conditions
*"genuinely observable at one parser step"*, so these rows are outside that scope by
construction — but an ordering sitting in a table whose other rows are testable reads
as a testable requirement, and its silence is then evidence it can be violated.

| pair | why it is unreachable |
| --- | --- |
| `uvarint_overflow` vs `non_shortest_uvarint` | a non-shortest spelling is ≤ 10 octets (rule 2), so its shortest form is ≤ 9 and its value < `2^63`; overflow needs ≥ `2^64`. **Disjoint.** |
| `duplicate_key` vs `unsorted_keys` | a key cannot both **equal** and **precede** its predecessor |
| `unexpected_eof` vs `trailing_bytes` | input cannot both end mid-structure and have octets left over |

⇒ **They are kept, not deleted.** Deleting them loses the fact that the disjointness was
checked, and the next reader re-adds them. What they are NOT is a conformance obligation:
no implementation can violate them, no vector can exercise them, and **an ordering that
cannot be violated is documentation of a boundary rather than a requirement.**

⚠ **This is the vacuity rule the corpus already runs, applied to the spec itself:** *for
each area, name the case that would FAIL if the rule were broken; if there is none, the
area is not covered whatever the row count says.* Nine rows, six exercisable.

## 11. Codec-independent framing

Leaf payloads are length-prefixed opaque octets. Therefore **every framing question
in §§5–6 is decidable without the leaf codec**, and three obligations follow:

1. Framing faults **outrank** `unsupported_leaf_codec`. A **leaf-blind** profile
   (§2.1) MUST still be able to report malformed octets, and that is the whole point of
   the modifier: not holding the codec costs you the payload judgment and nothing else.
2. `unsupported_leaf_codec` outranks any payload-level judgment.
3. A **leaf-blind** profile (§2.1) MUST report **unsupported**, and MUST NOT
   report the value as validated. It MAY report that framing was well formed, stating
   that scope.

This is the header-only store's scope rule (§15) applied one layer down.

## 12. The resource envelope

A **portable conformance floor**, never a maximum. A conforming implementation MUST
NOT refuse **on resource grounds** below each floor, MAY refuse on those grounds
beyond it, and when it does, refuses with `limit_exceeded` naming the dimension.

⚠ **"Accept" is §9's word for a verdict, and this section is not about verdicts.**
Read with §9's meaning, *"MUST accept inputs up to each floor"* would require
returning **accepted** for invalid octets that happen to be small — and *"MUST NOT
refuse below it"* would forbid refusing octets that are invalid. §12 constrains only
when an implementation may decline to **look**; it never constrains what it **finds**.
An input below every floor may still be `invalid` on its own merits.

| dimension | MUST-accept floor |
| --- | --- |
| varint value | `2^64 − 1` |
| leaf-codec-id length | 32 octets |
| key length | 4 096 octets |
| leaf payload length | 16 MiB |
| entries per struct | 65 536 |
| links per chunk | 65 536 |
| flat artifact octets | 64 MiB |
| single chunk octets | 32 MiB |
| unique reachable chunks | 1 000 000 |
| unique reachable octets | 1 GiB |
| logical depth | 256 |
| unfolded node count | 16 777 216 |
| unfolded flat octets | 1 GiB |

**The linked form is a compressed DAG.** A closure of `i + 1` chunks can denote a tree
with `2^i` leaf occurrences. Therefore:

- Traversal MUST maintain a visited-hash set. Termination MUST NOT rest on the
  presumed difficulty of hash cycles; sharing is ordinary, not adversarial.
- Unfolded measures MUST be computed with **saturating** arithmetic over the DAG,
  before materialization — never by materializing to find out.
- Materialization and flattening MUST take an explicit caller-supplied budget and
  refuse rather than exceed it.
- A decoder MAY represent a decoded linked value with internal sharing, provided
  aliasing is unobservable: no pointer identity, no mutation, no observable
  difference from the fully materialized tree.

Service policy limits are not codec validity limits, and MUST NOT be described as
such.

## 13. The leaf-codec-id and its registry

```text
id := 0x00 ‖ cuvarint(n)              # PUBLIC — registry-assigned, n ≥ 1
    | 0x01 ‖ ns{16} ‖ cuvarint(k)     # PRIVATE / EXPERIMENTAL — self-scoped
                                     # 0x02..0xff RESERVED for future id forms
```

- Total length is 2..32 octets; outside that range the artifact is **invalid**.
- `n` and `k` are `uvarint` and are bound by §3 in full — domain, length, and
  **shortest form**. A longer spelling of the same ordinal is `non_shortest_uvarint`,
  not a second way to name the codec: the id is inside the hashed octets (§7), so
  admitting two spellings would admit two addresses for one value.
- `n = 0` is permanently reserved and is **invalid** — it can never name a codec.
  An unassigned `n ≥ 1`, and any reserved first octet, are **unsupported** — not
  invalid. The distinction is structural impossibility versus not-yet-known, and it
  is what lets a registry grow without changing any past verdict.
- `ns` carries an **obligation, not a method**: it MUST be chosen so that independent
  parties do not collide without consulting any registry. A random draw discharges
  this probabilistically; a derivation from a *distinctive* published string
  discharges it and is additionally checkable, which is preferable where the
  namespace is published in a specification artifact. A generic derivation string is
  exactly as collidable as a plain name.
- `k` is namespace-local: a second sort within one namespace takes `k + 1` with no
  registry act.

**Registry governance** is RFC 8126 *Specification Required*: permanent public
documentation, expert review against stated criteria, immutable meanings, a named
change controller. An entry pins carrier, equivalence, canonical encoder, exact
decoder acceptance language, edge-case treatment, resource properties, complete
vectors, specification and vector-bundle hashes, status, and successor id.
**Incompatible correction always means a new id**; deprecation changes metadata,
never meaning. Applications MUST pin the leaf codecs they accept: *registered* is
never *authorized*.

Assigned:

| id | name | carrier / equality / encoder |
| --- | --- | --- |
| `00 01` | `deixis/identity-bytes` | `Bytes`, octet equality, `e = id` |
| `00 02` | `ontos-codec-v1` | `ontos.Value` under the frozen upstream codec |

## 14. Public API result states

**Every decoding profile's** surface — `flat-decoder`, `linked-resolver`,
`closure-checker`, `flat-header-validator` for the classes it can reach (§2.1) — MUST
expose the four non-acceptance classes of §9
distinctly, and MUST NOT collapse them into a single error type. Streaming decoders
MUST expose `need_more_input` as a **non-terminal** state that becomes
`unexpected_eof` only when the caller declares end of input.

For the linked form, the following are distinct operations and MUST NOT be conflated:

| operation | obligation |
| --- | --- |
| open / navigate lazily | no materialization; per-chunk verification against the referencing hash |
| validate the closure | every reachable chunk canonical, present, and hash-matching |
| estimate unfolded size | saturating arithmetic over the DAG, no materialization |
| materialize | explicit budget; refuse rather than exceed |
| flatten | explicit output-size budget; refuse rather than exceed |

Every chunk fetched during traversal MUST be verified against the hash by which it
was reached, even where storage claims to have verified it already: a child against
the hash in its parent's links header, **and the root against the address that was
requested** — nothing referenced the root, so a rule phrased only as *"the hash that
referenced it"* exempts precisely the chunk whose verification establishes that the
closure is the value you asked for.

**And a `linked-resolver` MUST expose those two retrievals as SEPARATE
CONSTRUCTORS, not one call taking an address.** The rule above is correct and it is a
rule a reader must remember at every call site; the shape below is one they cannot get
wrong, because the two retrievals differ in where their hash comes from and therefore
in what they can anchor:

| constructor | its hash comes from | what it establishes |
| --- | --- | --- |
| **resolve-root** | the CALLER, from outside the closure | that this closure is the value that was asked for |
| **resolve-child** | a links header in an ALREADY-VERIFIED parent | that this chunk is the one that parent references |

⇒ **Neither can do the other's job.** `resolve-child` cannot anchor a closure: every
hash it consumes came from a chunk already inside the closure, so a self-consistent
closure of the wrong value satisfies every child check there is. `resolve-root` is the
only place a caller's question enters, and it is reachable exactly once per traversal.

⚠ **A single `get(address)` loses that by construction** — it accepts a hash the
resolver derived and a hash the caller supplied at the same type, so nothing prevents
a traversal that verifies every edge and answers a question nobody asked. **The
separation is what makes the anchor unforgeable rather than remembered**, and it costs
one name.

⇒ *This is §3's `cuvarint` move at the API layer: a rule that had to be applied at
every use becomes a production that cannot be written without applying it.*

## 15. Security considerations

- **Collision incident policy.** On insertion of a digest already present, a store
  MUST compare the exact octets. Unequal octets under one digest MUST NOT be
  overwritten or silently deduplicated: both MUST be quarantined, dependent name
  bindings MUST stop, an `address_conflict` MUST be raised, and the evidence MUST be
  preserved for conversion to a successor address space.
- **Header-only validation has a scope, and it MUST be stated where it is offered.**
  A store reading only the links header validates digest integrity, header framing,
  and presence of claimed links. It does **not** certify that a stored root is a
  canonical value. The layout's conservative property does hold: because bodies
  reference children only by header index, a valid body cannot depend on an
  undisclosed child; extra header links cause over-retention, never hidden edges.
  Consumers therefore distinguish *opaque closure present* from *value validated*,
  and MUST NOT present the first as the second.
- **Opacity is not privacy.** A store observes chunk sizes, graph topology, fanout,
  repeated-subtree hashes, and access timing — and everything, if it chooses to
  decode. Confidentiality is outside v1's guarantees and MUST NOT be claimed for it.
- **Hostile input.** Declared lengths and counts MUST NOT be trusted for allocation
  before the corresponding octets are available. §12's budgets are the defence
  against sharing bombs; §3's domain rules are the defence against length arithmetic
  overflow.
- **Signatures.** A signature over octets authenticates octets. It does not
  authenticate a profile, schema, purpose, audience, or authorization context.
  Consumers MUST bind those explicitly in a typed signing envelope, and MAY sign a
  version-qualified linked root address directly rather than materializing a flat
  artifact.

## 16. Conformance and version policy

**The oracle is joint.** No implementation is the reference. The frozen specification
and its frozen vector corpus **together** define conformance; vectors are the
executable oracle for the cases they cover. On apparent conflict the precedence is:
normative algorithms and grammar, then semantic laws, then vectors, then explanatory
prose. A vector never overrides a clear clause. After the freeze, a behaviour-changing
ambiguity is a recorded v1 defect addressed in a successor — never silently
"clarified" by adding a vector.

**Conformance claims are scoped.** Full `deixis-codec-v1` conformance requires both
forms and the bridge between them. Software implementing a subset MUST claim the
subset **by naming the profiles of §2.1 it implements** — e.g. "flat-encoder +
flat-decoder, leaf-blind for `01 …`" — and MUST NOT claim the whole.

⇒ **A claim naming no profile is not a scoped claim.** This clause previously offered
two illustrative names in quotes and defined no set, so it required a subset claim
while supplying no vocabulary to make one in — every claim was then ad hoc and no
third party could check it against anything. §2.1 is that vocabulary.

⚠ **And a profile list is a claim about OBSERVABLE SURFACE, not about effort.** Naming
fewer profiles is not a weaker promise, it is a *different* one: a `closure-checker`
claims something a `flat-decoder` does not, and neither subsumes the other. The
`leaf-holding`/`leaf-blind` modifier is per leaf-codec-id and MUST be stated with the
ids it ranges over, because it decides which of `non_canonical_payload` and
`unsupported_leaf_codec` the implementation can ever return.

**Version policy.** `dxf1` and `dxl1` are one suite and move together. A successor
takes new magic and a new address space; cross-version address equivalence will never
exist. A conversion between versions is an explicit signed artifact identifying source
address space and exact source closure, target space and address, the conversion
specification's version, any leaf-codec mapping, whether the claim is floor-value
preservation or an application-level transformation, and the signer with its evidence
— capable of expressing one-to-many source cases, because a collision-motivated
transition means one old digest may no longer identify one artifact.
