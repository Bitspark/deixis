# Codec

**Status: CANDIDATE CONTRACT — draft, not frozen.** This is the normative
specification of `deixis-codec-v2`: what a conforming implementation must accept,
must refuse, and may claim. The decision record is
[design/0011](design/0011-codec-for-mandatory-nodes.md); the design rationale that
carries over from v1 lives in [design/0006](design/0006-canonical-codec.md) and the two
external-advice ledgers (`research-docs/0001`, `research-docs/0002`). This document
states obligations and does not re-argue them. Nothing here is frozen until the freeze
manifest is signed — see §16 and the freeze process in 0006.

**Node model.** The codec encodes [ADR 0010](design/0010-mandatory-node-values.md)'s
`Node[T] = Node(T, FinMap[Key, Node[T]])`: every node carries exactly one payload of
the slot's type and a complete map from byte keys to child nodes. The predecessor
candidate, `deixis-codec-v1`, encoded the earlier `Leaf | Struct` model and was
withdrawn before any freeze, implementation or commission; its text is kept in
[CODEC-v1.md](CODEC-v1.md) and is not normative.

The key words MUST, MUST NOT, SHOULD, MAY are to be read as in RFC 2119.

## 1. Scope

`deixis-codec-v2` is a **combinator**, not a serializer. Given a lawful slot codec for
the whole payload type `T` (§4), it yields canonical bytes and an exact decoder for
every `Node[T]`: each node's own payload and its complete child map, recursively.

It defines **two byte forms over one value semantics**:

| form | magic | for |
| --- | --- | --- |
| **flat** | `dxf2` | one contiguous octet string per tree — interchange, signing, small values |
| **linked** | `dxl2` | one chunk per node, children by hash — stores, wires, Merkle sync, structural sharing |

Each form is separately a complete invariant: within a form, equal octets iff
`=_≈`-equal values. Across forms, decoding agrees up to `=_≈`. **The two forms' octets
and digests do not correspond, by design.** The forms are one suite: they share a
version digit, freeze together, and are governed together. An implementation MUST NOT
version, extend, or give one form a capability or variant reading independently of
the other.

⚠ **This clause governs the FORMS; §2.1's conformance profiles govern
IMPLEMENTATIONS.** The two do not conflict: `flat-decoder` existing does not give
`dxf2` a life of its own, and §16 requires exactly that partition ("software
implementing a subset MUST claim the subset").

The codec defines no reading of a tree and no reading of a payload. Sequences, sets,
records, and every other container semantics are **structure profiles**
([design/0004](design/0004-structure-slot.md)), carried beside values, never inside
them. The codec MUST NOT be extended to recognize, tag, or validate any structure
profile, and the node grammar MUST NOT branch on a payload's content.

## 2. Notation

- `‖` is octet concatenation. `x{n}` is exactly `n` octets of `x`.
- Literal octet strings are written as ASCII in quotes (`"dxf2"` = `64 78 66 32`) or
  as hex pairs (`0x00`).
- `e` is the slot codec's encoder, `D` its decoder (§4).
- `=_≈` is node identity as lifted in [TREE.md](TREE.md) from the slot's `≈`:
  `Node(t, m) =_≈ Node(t', m')` iff `t ≈ t'`, `dom m = dom m'`, and
  `m(k) =_≈ m'(k)` for every key `k` of `dom m`.
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
| **flat-encoder** | value → `dxf2` octets | nothing; it emits or it fails locally |
| **flat-decoder** | `dxf2` octets → value, full validation | every §9 decoder verdict |
| **flat-header-validator** | the header of `dxf2` only (§5 magic and id) | `unknown_magic`, `unexpected_eof`, `need_more_input`, the §3 uvarint faults **on the id length and inside the id**, `malformed_slot_codec_id`, `unsupported_slot_codec` |
| **linked-resolver** | a `dxl2` closure → value | every §9 decoder verdict |
| **closure-checker** | chunk framing, link structure and digests, **without decoding payloads** | framing and link faults; never `non_canonical_payload` |
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

⇒ **Slot-codec knowledge is a MODIFIER, not a profile**, because it cuts across them.
For a given slot-codec-id an implementation is **codec-holding** or **codec-blind**,
and §5 and §11 turn on exactly this distinction ("a decoder holding the slot codec",
"a decoder not holding it"). A codec-blind `flat-decoder` is a conforming
`flat-decoder`; it reports `unsupported_slot_codec` and, per §9, its judgment that the
framing was well formed stands permanently.

**The store is not a decoder.** §9 marks `missing_chunk`, `hash_mismatch` and
`address_conflict` as *"not decoder verdicts"*; §2.1 names the actor whose verdicts
they are. No decoder profile may report them, and `chunk-store` reports nothing else.

⚠ **And `chunk-store` differs from the other five in kind.** Every other profile's
obligations are about **one artifact's well-formedness**, decidable from octets it was
handed. `chunk-store`'s are about a **relation** — address ↔ octets — and it is the
only **stateful** profile: `missing_chunk` and `address_conflict` are properties of its
own contents over time, not of any input. ⇒ **So it is the only profile that can be in
breach without ever having been given a malformed artifact.**

**Why the header validator's report set is wider than its read set looks.** Reading
the id means reading the id-**length** `uvarint`, which §3 binds in full — so a
truncated, non-shortest or overflowing length is observable here — and an unknown or
reserved id is `unsupported_slot_codec` by §9. ⇒ A profile must be permitted to NAME
every fault it can OBSERVE. That is the mirror of this section's own rule: §2.1 stops
a profile being *bound* by what it cannot observe, and a report set narrower than the
read set would leave one unable to *report* what it can.

## 3. The integer domain

`uvarint` is unsigned LEB128: seven bits per octet, least-significant group first,
the high bit of each octet set on all but the last. That is the **syntax** and it is
not what this codec transmits.

**`cuvarint` is the canonical production: a `uvarint` satisfying all three rules
below.** Every grammar in this specification writes `cuvarint`, never `uvarint` — so
an integer position that is bound by the rules is one the grammar has already named,
and a parser written from a grammar block cannot be non-canonical by omission. The
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
limits — those are resource judgments (§12), never validity judgments.

## 4. What the slot supplies

The codec is defined only for slots admitted at the **canonical-bytes tier** of
[SLOTS.md](SLOTS.md). A slot codec for `T` supplies four things, and they travel as
one unit:

```
SlotCodec(T) = { id, ≈, e, D }
```

- `id` — the slot-codec-id (§13), which appears in the octets.
- `≈` — the slot's equivalence, which the floor lifts to `=_≈`.
- `e : T → Bytes` — total, computable, and **lawful**: `x ≈ y ⟺ e(x) = e(y)`.
  Lawfulness is the entire obligation. How `e` is computed is the supplier's business.
- `D : Bytes ⇀ T` — an exact partial inverse: `D(e(x)) ≈ x`, and `D(b)` is defined
  only where `b ∈ im(e)`. `D` MUST be **computable**, and membership in `im(e)` MUST
  be **decidable**. `D` MUST refuse a non-canonical spelling rather than repair it.

  Decidability is a slot admission requirement at this tier, not a quality note: §5.5
  makes `payload ∈ im(e)` a MUST-check and §8 law 3 promises every input a verdict,
  so an undecidable `im(e)` does not make validation slow — it makes law 3 false.

**The slot codec covers the whole payload type.** Every node carries one payload and
the node grammar interprets none of them, so `e` and `D` are applied to the complete
value of `T` at every node — not to a projection, and not only at childless nodes. A
slot whose `T` is `Option[U]` is served by a codec for `Option[U]` (§13's option-of
form), not by a codec for `U` plus a presence convention in the tree. A slot whose `T`
names behavior — a handler name, a definition reference — is served by a codec for
the **name**; it never serializes executable behavior.

The four MUST be supplied together and MUST be used together. An implementation MUST
NOT accept an equality and an encoder from separate sources for one artifact, and a
decoded artifact SHOULD retain a reference to the codec context it was decoded under.

**One artifact, one slot codec.** Every chunk of one linked closure, and the whole of
one flat artifact, carries the same `id`. A child whose id differs from its parent's
MUST be refused as `slot_codec_mismatch`. Heterogeneous payloads are expressed as one
explicitly tagged-union slot codec — never as a mid-tree codec change.

## 5. The flat form

```text
flat   := header ‖ node
header := "dxf2" ‖ cuvarint(len(id)) ‖ id
node   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*   # payload = e(own value); count = |entries|
entry  := cuvarint(len(key)) ‖ key ‖ node
```

Every node is one production: its own payload, framed by its length, then its child
count and exactly that many entries. There is no node tag and no node kind; a
childless node is an ordinary node whose count is zero.

**The flat form has no sharing, and that is a requirement rather than an omission.**
`node` has no reference production: every child is spelled inline, so a value whose
subtrees are identical spells them **in full, each time**, and those octets are the
canonical ones. An encoder that noticed the repetition and emitted a back-reference
would produce different octets for one value and break law 1 — so the absence of a
reference construct above is load-bearing, and **no flat encoder may introduce one.**

⇒ This is also what makes L1 (unique decodability) direct for the flat form, and what
makes law 2 say something: the linked form stores that shared subtree **once**, so
*"the chunk set is a function of the value"* is a claim precisely because the flat form
does not dedupe. The two forms disagree about repetition by design, and agree about the
value.

Canonicality rules, each a MUST. They are numbered as in v1 so that cross-references
keep their meaning; rule 2 is retired.

1. The magic is exactly `"dxf2"`. Anything else is `unknown_magic` — **which
   presupposes four octets were read.** Fewer than four is `unexpected_eof`
   (streaming: `need_more_input`), never `unknown_magic`: §14 makes
   `need_more_input` non-terminal, so a decoder that rejected a three-octet prefix as
   bad magic would refuse a valid artifact mid-transmission, and a streaming and a
   whole-buffer decoder would return different codes for the same octets.
2. *Retired in v2.* v1 dispatched on a node kind; v2 has one production (§1 of
   [design/0011](design/0011-codec-for-mandatory-nodes.md)).
3. `count` equals the number of entries that follow; entries are read sequentially
   and the node closes when `count` of them have been read.
4. Entry keys are in **strictly ascending lexicographic order** (§2). An entry key
   equal to its predecessor is `duplicate_key`; one preceding its predecessor is
   `unsorted_keys`. **Any profile that reads entries** MUST NOT sort on read and MUST NOT
   deduplicate — `closure-checker` included, which reads entry keys and reports both
   ordering faults (§2.1).
5. **Every** node's `payload` MUST be in `im(e)` — i.e. `D(payload)` is defined. A
   decoder holding the slot codec MUST check this at every node, including nodes with
   children. A decoder not holding it MUST NOT claim the value validated (§11).
6. After the root node is read, no octets may remain: any remainder is
   `trailing_bytes`. Input ending mid-structure is `unexpected_eof`. The one exception
   is input ending inside a `cuvarint` already begun, which is `malformed_uvarint`
   (§3 rule 2, and below).

**A length-framed field is judged only once its stated extent has been read.** The id,
a payload and a key each state their length before their octets. If input ends before
that many octets have arrived, the verdict is `unexpected_eof` (streaming:
`need_more_input`), whatever the octets already present would show: an id whose two
present octets already spell `n = 0`, or a key whose first octet already sorts before
its predecessor, is still `unexpected_eof` when its stated extent is cut off. A
`cuvarint` states no length and is §3's: cut off by the end of input after one or more
octets with the continuation bit set, it is `malformed_uvarint`; absent altogether, it
is `unexpected_eof`. Inside an id, the id's own stated end plays the end of input for
a `cuvarint` already begun, which is therefore `malformed_uvarint`. A field that would
begin at or past the id's end is missing, which is `malformed_slot_codec_id` (§13),
not `unexpected_eof`. Neither is ever `need_more_input`.

A childless node is its framed payload followed by `0x00`. Under a slot codec whose
`e` can produce the empty string, `0x00 ‖ 0x00` is a legal node: the childless node
whose payload encodes to nothing.

## 6. The linked form

```text
chunk  := "dxl2" ‖ cuvarint(len(id)) ‖ id
        ‖ cuvarint(nlinks) ‖ hash{32}*                 # ← the LINKS HEADER
        ‖ body
body   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ lentry*
lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)
```

Each hash in the links header is the SHA-256 (§7) of the referenced child's **entire
chunk octets** under this same layout. Bodies reference children only by index into
that header; a body MUST NOT contain a raw hash. Every chunk carries its node's own
payload in its body.

**First-use order, normatively.** Scan the body's entries in canonical key order
(§5.4). Each distinct child hash is appended to the links header at the moment it is
first referenced. Therefore the header contains each distinct child hash exactly once,
in order of first reference. This makes the header a function of the value.

Canonicality rules, each a MUST:

1. The magic is exactly `"dxl2"`.
2. `nlinks` equals the number of hashes present.
3. The same hash MUST NOT appear twice: `duplicate_link_hash`.
4. Every `link-index` is `< nlinks`: otherwise `bad_link_index`.
5. Every listed hash MUST be referenced by at least one `lentry`: an unreferenced
   hash is `unused_link`.
6. The header order MUST equal first-use order: otherwise `links_out_of_order`.
   Precisely: scanning the `lentry`s in key order, the link indices that appear for the
   first time MUST appear as `0, 1, 2, …` in that order. An index that is new but not the
   next unused position is `links_out_of_order`. A position that no `lentry` ever
   references is `unused_link` (rule 5), and is not also out of order. Under this reading
   a header `[h1, h2]` whose only entry references `1` is `links_out_of_order` (§10 ranks
   it above `unused_link`), and one whose only entry references `0` is `unused_link`.
7. Key ordering, count, payload and trailing rules are as in §5.

A childless node's chunk has `nlinks = 0`. **One node, one chunk**: a `chunk-store`
(§2.1) MAY pack chunks privately in any way it likes, with no effect on addresses —
packing is representation, and representation is unobservable. The canonical form is
not a storage mandate.

**Consequence, stated so it is not discovered:** the linked form gives no sub-node
incrementality. Changing any key, child or the own payload of a wide node retransmits
that whole node chunk. Every collection profile MUST document its worst-case node
width, update amplification, and intended scale.

## 7. Hash, addressing, and domain separation

- v2 pins **SHA-256**. Hash agility is a new codec version, never a parameter.
- A hash is computed over the chunk's entire octets as laid out in §6. The magic and
  the `id` are therefore *inside* the hashed octets: an address commits to codec
  version, form, and slot interpretation — not merely to a naked node.
- **The content address of a value is the SHA-256 of its linked-form root chunk, and
  nothing else, ever.** The flat form's digest is a lawful invariant but is never an
  address, and MAY appear as a checksum in transport but MUST NOT name a value.
- Addressing composes: every subtree of a linked value has an address.
- **Addresses are version-qualified outside chunk octets.** Everywhere an address
  leaves a chunk — APIs, name bindings, signature envelopes, logs, mapping artifacts,
  wire messages — it MUST travel as the pair `(address-space = "dxl2", digest{32})`.
  A bare 32-octet digest is not an address. Raw digests appear only *inside* chunks,
  where the enclosing chunk fixes version and hash. **Any profile that exposes
  addresses** — `linked-resolver` and `chunk-store` (§2.1); the flat profiles have no
  addresses to expose — MUST NOT expose a public address type that is merely a
  32-octet array.
- Address equality implies value equality **within one slot-codec-id, computationally,
  under SHA-256 collision resistance**. One value under two slot codecs has two
  addresses. Cross-version address equivalence does not exist and will not be defined;
  a successor is a new address space plus explicit conversion artifacts (§16).

## 8. Laws

Laws 1–4 are propositions, to be proved in the freeze bundle and pinned by vectors;
their obligations are enumerated in [0008](design/0008-proof-obligations.md). Law 5 is
not a proposition — it is a governance commitment, ratified by §16's version policy
and enforced by §14 offering no such option. It is stated here because it belongs with
the laws it protects.

1. **Flat canonicality.** For all nodes `n`, `m` and octet strings `b`:
   `encF(n) = encF(m) ⟺ n =_≈ m`; `decF(encF(n)) =_≈ n`; and for every `b` accepted
   **under full validation** (§11), `encF(decF(b)) = b` — accepted input re-encodes
   octet-identically.

   The scope is load-bearing. A decoder not holding the slot codec cannot check
   §5.5's `payload ∈ im(e)`, so its accept set is strictly larger than `im(encF)` and
   this clause does **not** hold for it. Under header-only validation the guarantee
   is framing and structure only, with payload membership uncertified — which is
   exactly what §11's *opaque closure present* state means, and why a store may
   certify that state without ever holding a slot codec.
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
   any global ordering of faults across a malformed multi-chunk closure. A
   `closure-checker` (§2.1) MAY report any discovered fault or a set of them.

   The parse this law speaks of is the framing parse. Payloads are length-framed, so a
   payload the slot codec would refuse does not stop it: the capability judgment and
   then the payload judgments follow the whole framing parse, in §11's order.
5. **No lenient mode, ever.** There is no accept-noncanonical/emit-canonical option,
   and none will be added under any future compatibility pressure.

## 9. Result classes

A decoder's verdict is **accepted**, or exactly one of four non-acceptance classes.
An implementation MUST distinguish the four; collapsing them is a conformance failure,
because they license different actions.

| class | meaning | the caller may conclude |
| --- | --- | --- |
| **invalid** | the octets are not canonical `deixis-codec-v2` | these octets are not a value, now or ever |
| **unsupported** | well-formed framing, absent capability | the octets may be a value; *I* cannot say |
| **incomplete** | streaming: more input may arrive | nothing yet |
| **resource-refused** | valid so far, beyond a local limit | the octets may be a value; I decline to spend |

**invalid:** `malformed_uvarint` · `non_shortest_uvarint` · `uvarint_overflow` ·
`unknown_magic` · `duplicate_key` · `unsorted_keys` · `trailing_bytes` ·
`unexpected_eof` · `bad_link_index` · `unused_link` · `duplicate_link_hash` ·
`links_out_of_order` · `slot_codec_mismatch` · `malformed_slot_codec_id` (an id that
cannot be one id of its form, §13) · `non_canonical_payload` (a node payload outside
`im(e)`).

**unsupported:** `unsupported_slot_codec`. An unknown or reserved id is a **missing
capability, not malformed octets**: framing and hashes may still be judged, and a
later registry addition MUST NOT change the historical judgment that the octets were
well framed.

**store / traversal layer** (not decoder verdicts): `missing_chunk` · `hash_mismatch` ·
`address_conflict`.

**resource-refused:** `limit_exceeded`, naming the dimension of §12 that was exceeded by
its token.
`limit_exceeded` MUST NOT be reported as invalidity.

Codes are stable identifiers, pinned across implementations by vectors. Adding a code
is a version act. At the version boundary v2 renamed v1's two codec codes, retired v1's
node-kind code ([design/0011](design/0011-codec-for-mandatory-nodes.md) §4), and added
`malformed_slot_codec_id`: v1 declared impossible ids invalid but named no code for
them, so law 3 could not pin one (found by the vectors lane). The names above are the
only v2 codes.

## 10. Fault precedence at one step

Where two conditions are genuinely observable at one parser step, the first listed
wins:

⭐ **READ FIRST, RULED LAST.** An identifier being *readable* early does not make the
judgment that turns on it *early in precedence*. A slot-codec-id is read before the
body it governs — the artifact's id before its root node, a child chunk's id before
that child's body — so the natural implementation resolves the codec table on sight
of the id and returns `unsupported_slot_codec` or `slot_codec_mismatch` for octets that
are simply malformed. The table below says the framing fault wins in both cases. **It
is one mistake at two scales**, and the corpus is to carry a case for each, recording
the code the natural strategy produces instead.

**This table orders the codes reachable from framing alone.** Three others are ruled
elsewhere, so a reader building fault dispatch from this table alone would omit them:
`unsupported_slot_codec` sits **below** every framing fault and **above** every
payload-level judgment (§11); `non_canonical_payload` is that payload-level judgment
and is therefore reachable only by a decoder holding the slot codec, ordered last of
the three; and `limit_exceeded` is never invalidity (§9, §12).

| at | conditions seen together | code |
| --- | --- | --- |
| artifact start | fewer than four octets available | `unexpected_eof` (streaming: `need_more_input`) |
| | four octets read, not `dxf2` / `dxl2` | `unknown_magic` |
| any `uvarint` | ill-formed continuation, or > 10 octets | `malformed_uvarint` |
| | well-formed, value ≥ `2^64` | `uvarint_overflow` |
| | well-formed, in range, not shortest | `non_shortest_uvarint` |
| slot-codec-id | length outside 2..32, `n = 0`, or octets not exactly one id of its form (§13) | `malformed_slot_codec_id` |
| entry boundary | key **equals** its predecessor | `duplicate_key` |
| | key **precedes** its predecessor | `unsorted_keys` |
| links header | the same hash listed twice | `duplicate_link_hash` |
| | index ≥ `nlinks` | `bad_link_index` |
| | first-use order violated | `links_out_of_order` |
| | a listed hash no `lentry` uses | `unused_link` |
| end of input | ends mid-structure, outside a `cuvarint` already begun (§5) | `unexpected_eof` (streaming: `need_more_input`) |
| | octets remain after the root | `trailing_bytes` |
| child chunk | its id differs from the parent's | `slot_codec_mismatch` |

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
cannot be violated is documentation of a boundary rather than a requirement.** This is
the vacuity rule the corpus runs, applied to the spec itself: *for each area, name the
case that would FAIL if the rule were broken; if there is none, the area is not
covered whatever the row count says.*

## 11. Codec-independent framing

Node payloads are length-prefixed opaque octets. Therefore **every framing question in
§§5–6 is decidable without the slot codec**, and three obligations follow:

1. Framing faults **outrank** `unsupported_slot_codec`. A **codec-blind** profile
   (§2.1) MUST still be able to report malformed octets, and that is the whole point of
   the modifier: not holding the codec costs you the payload judgment and nothing else.
2. `unsupported_slot_codec` outranks any payload-level judgment.
3. A **codec-blind** profile (§2.1) MUST report **unsupported**, and MUST NOT report
   the value as validated. It MAY report that framing was well formed, stating that
   scope.

This is the header-only store's scope rule (§15) applied one layer down.

## 12. The resource envelope

A **portable conformance floor**, never a maximum. A conforming implementation MUST
NOT refuse **on resource grounds** below each floor, MAY refuse on those grounds
beyond it, and when it does, refuses with `limit_exceeded` naming the dimension by the
token in the table below. When one input exceeds several dimensions, naming any one of
the exceeded dimensions conforms: the envelope orders no dimension above another.

⚠ **"Accept" is §9's word for a verdict, and this section is not about verdicts.**
§12 constrains only when an implementation may decline to **look**; it never
constrains what it **finds**. An input below every floor may still be `invalid` on its
own merits.

| dimension | token | MUST-accept floor |
| --- | --- | --- |
| varint value | `varint_value` | `2^64 − 1` |
| slot-codec-id length | `slot_codec_id_length` | 32 octets |
| key length | `key_length` | 4 096 octets |
| payload length (per node) | `payload_length` | 16 MiB |
| entries per node | `entries_per_node` | 65 536 |
| links per chunk | `links_per_chunk` | 65 536 |
| flat artifact octets | `flat_artifact_octets` | 64 MiB |
| single chunk octets | `chunk_octets` | 32 MiB |
| unique reachable chunks | `unique_chunks` | 1 000 000 |
| unique reachable octets | `unique_octets` | 1 GiB |
| logical depth | `logical_depth` | 256 |
| unfolded node count | `unfolded_node_count` | 16 777 216 |
| unfolded flat octets | `unfolded_flat_octets` | 1 GiB |

The tokens are stable identifiers, like §9's codes; adding one is a version act. The
`varint_value` floor is the whole integer domain, so no conforming implementation ever
refuses on it; a value beyond the domain is `uvarint_overflow` (§3). Likewise the
`slot_codec_id_length` floor is §13's validity bound: a longer id is
`malformed_slot_codec_id`, so no conforming implementation refuses on that dimension
either.

**Logical depth counts edges.** The root is at depth 0, and a child is one deeper than
its parent, measured in the tree the artifact or closure denotes. At the floor, a node
with 256 ancestors is within the envelope and a node with 257 is beyond it. A walk that
reaches one of the current chunk's own ancestors again has found a hash cycle. SHA-256
makes one infeasible to build, and this section forbids relying on that. Such a
closure denotes no finite tree, so it exceeds every depth limit and is refused as
`limit_exceeded` naming `logical_depth`. It is the one resource refusal whose input
denotes no value, although §9 describes that class as octets that may be one. It is
filed there because the depth limit is what a walk meets first, and SHA-256 makes the
difference unobservable.

**Limits are met in parse order.** A reader meets a limit at the first field or octet
that exceeds it, and a fault earlier in the parse wins. A declared length or count
above its limit is met at that field, before the octets it announces: a key length
above `key_length` is `limit_exceeded` even when the input ends before the key. A
remainder is noticed without being read: after a root that ends exactly at
`flat_artifact_octets`, a further octet is `trailing_bytes`, not `limit_exceeded`. A
whole-buffer flat decoder does not refuse up front on its buffer's length: a
streaming decoder cannot know that length, and §14 requires the two to agree.

**A chunk is verified before it is parsed.** Chunks are never streamed. A chunk is
checked against the hash that referenced it (§14) before its octets are trusted, and
that check reads every octet. So a chunk's size is met when it is fetched, before the
hash check and before its parse: `chunk_octets`, and the chunk's share of
`unique_octets`, are judged on the fetched length, and no fault inside the chunk
precedes them. Within a verified chunk, parse order governs as it does in a flat
artifact.

**The unfolded measures describe the denoted tree.** `unfolded_node_count` and
`unfolded_flat_octets` measure the tree a closure or a flat artifact denotes, so for a
flat artifact they are its own node count and length, and a flat decoder may refuse
on them beyond their floors like any other reader. For a closure, `unfolded_flat_octets`
measures the whole flat artifact the closure flattens to, header included.

**The linked form is a compressed DAG.** A closure of `i + 1` chunks can denote a tree
with `2^i` childless-node occurrences. Therefore:

- Traversal MUST maintain a visited-hash set. Termination MUST NOT rest on the
  presumed difficulty of hash cycles; sharing is ordinary, not adversarial.
- Unfolded measures MUST be computed with **saturating** arithmetic over the DAG,
  before materialization — never by materializing to find out.
- Materialization and flattening MUST take an explicit caller-supplied budget and
  refuse rather than exceed it.
- **That budget guards the build, not the judgments.** It is checked after the
  closure has been judged (its framing, links and digests, then the capability
  judgment, then the payloads) and before anything is built or written. An over-budget closure that is invalid or
  unsupported gets that verdict; only a closure that passes those judgments is
  refused on its unfolded measures. Those judgments are bounded by the dimensions
  the closure walk itself meets (`chunk_octets`, `links_per_chunk`,
  `unique_chunks`, `unique_octets`, `logical_depth` and the per-field ones), which
  are checked as the walk meets them.
- A decoder MAY represent a decoded linked value with internal sharing, provided
  aliasing is unobservable: no pointer identity, no mutation, no observable
  difference from the fully materialized tree.

Service policy limits are not codec validity limits, and MUST NOT be described as
such.

## 13. The slot-codec-id and its registry

```text
id := 0x00 ‖ cuvarint(n)              # PUBLIC — registry-assigned, n ≥ 1
    | 0x01 ‖ ns{16} ‖ cuvarint(k)     # PRIVATE / EXPERIMENTAL — self-scoped
    | 0x02 ‖ id                       # OPTION-OF — Option over the codec the inner id names
                                     # 0x03..0xff RESERVED for future id forms
```

- Total length is 2..32 octets. A length outside that range is
  `malformed_slot_codec_id`, judged when the length is read. The bound is on the
  **whole** id, so it also bounds option-of nesting. An inner id has no separate
  minimum beyond what its own form requires: `02 03` is option-of over a reserved
  form, and therefore **unsupported**.
- The id's octets MUST be exactly one id of its form: a public id is `0x00` and one
  `cuvarint`; a private id is `0x01`, sixteen namespace octets and one `cuvarint`; an
  option-of id is `0x02` and one whole inner id. Octets missing or left over within the
  stated length are `malformed_slot_codec_id`. Integer faults inside the id keep their
  §3 codes. A reserved first octet ends the structural judgment: the octets after it
  belong to a form not yet defined.
- **The id is a bounded input.** Its stated length is where its octets end, and no
  field inside it is read past that end. A `cuvarint` that reaches the id's end with
  its continuation bit set is `malformed_uvarint`, as at the end of any input (§3); a
  form whose next required field would begin at or past the id's end (`00` alone,
  `02` with nothing after it) is `malformed_slot_codec_id`. A reader that continues
  past the id into the node, and reports what it finds there, is non-conforming.
- `n` and `k` are `uvarint` and are bound by §3 in full — domain, length, and
  **shortest form**. A longer spelling of the same ordinal is `non_shortest_uvarint`,
  not a second way to name the codec: the id is inside the hashed octets (§7), so
  admitting two spellings would admit two addresses for one value.
- `n = 0` is permanently reserved and is `malformed_slot_codec_id` — it can never
  name a codec.
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

**Option-of.** For a slot codec `c`, the id `0x02 ‖ id(c)` names `option-of(c)`:

| part | definition |
| --- | --- |
| carrier | `Option[T_c]` |
| `≈` | `None ≈ None`; `Some(x) ≈ Some(y)` iff `x ≈_c y`; `None` is never `≈` to any `Some` |
| `e` | `e(None) = 0x00`; `e(Some(x)) = 0x01 ‖ e_c(x)` |
| `D` | defined exactly on `0x00` and on `0x01 ‖ b` with `b ∈ im(e_c)`, inverting `e` there |

`option-of(c)` is lawful, and its `im(e)` is decidable, whenever `c`'s are: the first
octet separates `None` from `Some`, and `Some` inherits `c`'s lawfulness. No
self-delimitation is required of the inner codec's encoder, because §5 frames every
payload by its length. An option-of id is **unsupported** exactly when its inner id is
unsupported, and `malformed_slot_codec_id` exactly when its inner id is, or when the
whole id breaks the length bound. A malformed id outranks an unsupported one, as
every framing fault does (§11). A payload outside `im(e)` is `non_canonical_payload`, as for any codec.

**Registry governance** is RFC 8126 *Specification Required*: permanent public
documentation, expert review against stated criteria, immutable meanings, a named
change controller. An entry pins carrier, equivalence, canonical encoder, exact
decoder acceptance language, edge-case treatment, resource properties, complete
vectors, specification and vector-bundle hashes, status, and successor id.
**Incompatible correction always means a new id**; deprecation changes metadata,
never meaning. Applications MUST pin the slot codecs they accept: *registered* is
never *authorized*.

Assigned:

| id | name | carrier / equality / encoder |
| --- | --- | --- |
| `00 01` | `deixis/identity-bytes` | `Bytes`, octet equality, `e = id` |
| `00 02` | `ontos-codec-v1` | `ontos.Value` under the frozen upstream codec |

## 14. Public API result states

**Every decoding profile's** surface — `flat-decoder`, `linked-resolver`,
`closure-checker`, `flat-header-validator` for the classes it can reach (§2.1) — MUST
expose the four non-acceptance classes of §9 distinctly, and MUST NOT collapse them
into a single error type. Streaming decoders MUST expose `need_more_input` as the one
**non-terminal** state: the decoder cannot yet give a final verdict. That covers both an
incomplete root and a complete root while the stream is still open, since octets
arriving after a complete root make it `trailing_bytes` and acceptance is terminal.
When the caller declares end of input, `need_more_input` resolves: to the accepted
value (or the §9 verdict the remaining checks reach) if the root is complete. If it is
not, it resolves to §5's end-of-input verdict: `malformed_uvarint` when input ends
inside a `cuvarint` already begun, and `unexpected_eof` anywhere else.
A streaming decoder fed any split of an artifact's octets MUST reach the same verdict
as a whole-buffer decoder given the whole artifact.

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
CONSTRUCTORS, not one call taking an address.** The two retrievals differ in where
their hash comes from and therefore in what they can anchor:

| constructor | its hash comes from | what it establishes |
| --- | --- | --- |
| **resolve-root** | the CALLER, from outside the closure | that this closure is the value that was asked for |
| **resolve-child** | a links header in an ALREADY-VERIFIED parent | that this chunk is the one that parent references |

⇒ **Neither can do the other's job.** `resolve-child` cannot anchor a closure: every
hash it consumes came from a chunk already inside the closure, so a self-consistent
closure of the wrong value satisfies every child check there is. `resolve-root` is the
only place a caller's question enters, and it is reachable exactly once per traversal.
**A single `get(address)` loses that by construction**; the separation is what makes
the anchor unforgeable rather than remembered, and it costs one name.

**What a navigation judges.** A navigation is resolve-root once, then resolve-child
once for each key of a path, and it fetches only the chunks on that path. Neither
retrieval takes a slot codec; the codec enters only at the answer. A navigation owes
the judgments of what it reads:

1. **Every fetched chunk's whole framing, before the chunk is used.** The chunk's size
   at fetch (§12), then the hash it was reached by, then its complete §6 framing, every
   entry included. The lookup reads that structure, and a key found early does not
   excuse a fault later in the same chunk. A child whose id differs from its parent's
   is `slot_codec_mismatch`, judged after the child's own framing.
2. **The slot codec only at the chunk it answers with.** That chunk's capability
   (`unsupported_slot_codec`) and then its payload (§5 rule 5) are judged last, in §11's
   order. The payload of a chunk it passes through is never decoded and never judged.
   A navigation certifies the framing of every chunk on its path and the value of the
   last one, and nothing about a chunk it did not fetch. It unfolds nothing, so it never
   meets an `unfolded_*` measure.
3. **Faults are met in fetch order.** Chunk *i+1*'s hash is known only once chunk *i*
   has been judged and its key looked up, so along a path the order is forced, not
   chosen: of two faults in different chunks, the one met first is what the navigation
   reports, whether a verdict or a store fault (§9 keeps the two apart). Law 4
   leaves the order across a closure unfrozen because traversing a graph is a choice;
   a path leaves none. A key that names no entry of the chunk reached is an answer, not
   a fault, and the navigation ends there.

**Asynchronous stores** (non-normative). The fetch the constructors take is synchronous, but an
asynchronous store needs no separate verification interface:
1. Fetch the root's octets first, and pass resolve-root a fetch over the octets already held.
2. A verified chunk lists each child's address before anything is fetched. Fetch the child's
   octets, then pass resolve-child the same kind of fetch.

Both provenance anchors stay as above. The caller's address anchors the root, and a verified
parent's links header anchors each child. Octets that do not hash to the address asked for are
still a `hash_mismatch`.

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
  decode. Confidentiality is outside v2's guarantees and MUST NOT be claimed for it.
- **Hostile input.** Declared lengths and counts MUST NOT be trusted for allocation
  before the corresponding octets are available. §12's budgets are the defence
  against sharing bombs; §3's domain rules are the defence against length arithmetic
  overflow.
- **Values, not behavior.** A slot codec encodes values. A codec for handler or
  definition names serializes the names; decoding one yields a name, and binding a
  name to behavior is the consumer's act under its own authorization. The codec never
  makes executable behavior content-addressable or transferable.
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
ambiguity is a recorded v2 defect addressed in a successor — never silently
"clarified" by adding a vector.

**Conformance claims are scoped.** Full `deixis-codec-v2` conformance requires both
forms and the bridge between them. Software implementing a subset MUST claim the
subset **by naming the profiles of §2.1 it implements** — e.g. "flat-encoder +
flat-decoder, codec-blind for `01 …`" — and MUST NOT claim the whole. A claim naming
no profile is not a scoped claim. The `codec-holding`/`codec-blind` modifier is per
slot-codec-id and MUST be stated with the ids it ranges over, because it decides which
of `non_canonical_payload` and `unsupported_slot_codec` the implementation can ever
return.

**Before the freeze.** Until the freeze manifest is signed, an implementation of this
contract is a candidate implementation of a candidate contract. It MAY ship as such.
It MUST NOT claim frozen conformance, and it MUST NOT present a `dxl2` address as a
stable identity: a pre-freeze change to this contract changes addresses
([design/0011](design/0011-codec-for-mandatory-nodes.md) §6). An in-house
implementation is not the clean-room implementation of
[design/0007](design/0007-clean-room-commission.md) and MUST NOT be described as one.

**Version policy.** `dxf2` and `dxl2` are one suite and move together. A successor
takes new magic and a new address space; cross-version address equivalence will never
exist. A conversion between versions is an explicit signed artifact identifying source
address space and exact source closure, target space and address, the conversion
specification's version, any slot-codec mapping, whether the claim is floor-value
preservation or an application-level transformation, and the signer with its evidence
— capable of expressing one-to-many source cases, because a collision-motivated
transition means one old digest may no longer identify one artifact.

**Consumer byte-profile names.** Before the freeze, `dxl2` alone does not fix the
bytes, because a pre-freeze change changes addresses without changing magic. So a
consumer that stores roots records beside each one a name for the bytes that wrote it.
Each byte revision of this candidate has exactly one such name per slot codec. The
current revision's name for `00 01` is `deixis-codec-v2/identity-bytes@v0.4.0`: the
bytes are unchanged since v0.3.0, and the name was first used against v0.4.0. The tag
in a name is part of the label. It is not the release a consumer builds against. A
release that changes no byte and no address keeps every name, and a consumer MUST NOT
change a name it has recorded when it adopts such a release. A pre-freeze change that
changes bytes or addresses publishes a new name in its release notes. deixis is the
only publisher of names: a name exists once deixis publishes it in release notes, and a
consumer that needs a name for another slot codec asks for one. A name travels beside the
address pair of §7 and never replaces it, and a decoder still judges the octets.

`deixis-codec-v1` (`dxf1`, `dxl1`) was a candidate for the earlier node model and was
withdrawn before any freeze, implementation or commission
([design/0011](design/0011-codec-for-mandatory-nodes.md)). No v1 artifact or address
exists, so no conversion artifact is owed. Its text remains in
[CODEC-v1.md](CODEC-v1.md) as the specification its historical vectors cite.
