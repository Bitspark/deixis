# deixis — set keys

**Mandatory-value target, 2026-09-23:** [0010](0010-mandatory-node-values.md)
supersedes 0009's core optionality. The optional representation described below
is explicitly implemented through `Node[Option[T]]` in all four languages;
the current specialization section states its image and recognizer. Historical
judgments exercise that specialization and do not require retaining earlier
core APIs or codec bytes.

**Status:** slot-member form **decided** (2026-08-07); node-member form's original
self-keying scheme **superseded** (2026-08-08, external advice — see its section):
whole-node bytes as keys grow exponentially under nesting; the replacement candidate
is a sorted positional shape, still gated on the codec axis. Defines `deixis-set-v1` — the finite-set container as a structure
profile ([0004](0004-structure-slot.md)). The name is frozen. The slot-member form is
ratified below with its framing, its recognizer precision, and hand-authored vectors
([vectors/set.json](../../vectors/set.json)); the node-member form still waits on the
one thing it always waited on — the codec combinator, whose bytes
[0001](0001-keys-are-bytes.md) deliberately deferred — and ratifies with it.

## The idea: self-keying

A set is a struct whose keys are the canonical bytes of its members:

```text
set(S) = Struct({ e(x) ↦ member(x) | x ∈ S })
```

where `e` is a lawful encoder for the member sort — `x ≈ y ⟺ e(x) = e(y)`, canonical,
decodable ([SLOTS.md](../SLOTS.md)) — and `member(x)` is the member's own node form.
The codec law then does every job a set semantics needs, with nothing invented:

- **Membership transports.** `x ∈ S` iff `e(x) ∈ dom m` — value membership *is* key
  membership, one `get` away, decidable without enumeration.
- **Idempotence is inherited, not implemented.** Inserting a member twice would spell the
  same key twice, and the floor already refuses duplicate keys. A set container never has
  to say "ignore the second insert"; the tree cannot express the second insert.
- **Identity transports.** Two sets are equal iff they are the same node: `e` is injective
  on the member quotient, so `dom m` determines the member set exactly, and set equality
  *reduces* to node identity — transport law 3 of [0004](0004-structure-slot.md), no new
  equality.
- **Enumeration is canonical.** Iteration order is lexicographic on `e(x)` — the same
  solution `ontos/data` reached for its `map`/`set` entries one layer up. It is spelling
  order, deterministic and byte-stable; the profile claims no semantic order, because sets
  carry none.

## The two member sorts

**Slot members.** `member(x) = Leaf(x)` and `e` is the slot's leaf encoder. Definable
per-slot today; a set of byte strings, of decimals under numeric equality, of handler
names — each needs only its slot's codec-tier supply. Scale note (external advice):
the key bytes duplicate the leaf bytes by construction, so this is a **compact**
profile intended for bounded, small members — a general set profile must not assume
`e(x)` is small.

**Framing (ratified for slot members).** A profile *instance* is the pair
(`deixis-set-v1`, the member encoder's stable identifier): the profile fixes the
mechanism, the encoder id fixes which `e` coheres the keys, and neither means anything
alone. The identifier is owed by whatever supplies `e` — a slot codec profile's `id`
([SLOTS.md](../SLOTS.md)'s codec tier), or a vector fixture's declared name — and is
named out-of-band. Whether an identifier is ever carried in-band is the codec axis's
question (proposal Q5), not this form's: a slot-member set node has no canonical bytes
to frame until the combinator exists.

**Node members.** `member(n) = n` itself — the member is any node, and `e` is the deixis
codec combinator of [0001](0001-keys-are-bytes.md) at that slot. This is the general
case, and the reason sets compose with every other reading: a set of sequences of
records is one tree, three structure profiles deep, one identity. It is also why the
profile is *sketched* rather than decided: the combinator is specified in prose and
[0001](0001-keys-are-bytes.md) deliberately deferred fixing its bytes. **`deixis-set-v1`
is the codec axis's first concrete consumer** — the trigger that section has been waiting
for.

**Superseded (2026-08-08, external advice — research-docs/0001).** Direct self-keying
of node members — the member's complete flat bytes as its key — must **not** freeze.
It duplicates every member's serialization in the parent key beside the child, and
under ordinary nesting it is exponential: for singleton nestings `Sᵢ₊₁ = {Sᵢ}`,
`size(Sᵢ₊₁) ≈ 2 × size(Sᵢ)`, and the linked form does not rescue it, because the
parent key still embeds the complete flat encoding. This is intrinsic, not a framing
detail: an injective key for an arbitrary member must carry enough to distinguish it,
so worst-case duplication comes with exact direct self-keying. The replacement
candidate is a **sorted positional shape**: a dense κ-keyed struct whose children sit
in strictly increasing order under a profile-owned total order induced by a complete
invariant of member identity. Recognition checks exactly the dense positional key
set, strict member order, and thereby no duplicate identity — still a lawful
embedding of finite sets, one occurrence per member; membership costs a search
instead of one `get`, and a scalable profile can later canonicalize a hierarchy. The
order is defined at the profile layer — recursively over constructor, leaf canonical
bytes, keys, children — **never** by importing the flat codec's physical `node`
production, which would couple the profile to `dxf1` forever (a future physical codec
would need the old encoder just to implement the profile).

## Coherence, and what recognition refuses

An entry is coherent iff its key equals its member's canonical bytes: `k = e(member)`.
Recognition checks exactly that, entry by entry, and is exact or it is refusal:

- **A mis-keyed member** — `k ≠ e(member)` — is refused, never re-keyed. Re-keying is the
  repair a lax reader would perform, and a repair pass coarsens identity.
- **A non-canonical member spelling** — a `member` whose bytes decode to a value whose
  canonical encoding differs — is refused, the mirror of `deixis-pos-v1` rejecting
  `ff000001` for position 1.
- **Alternate spellings of one member** cannot collide silently: two entries whose members
  are `≈`-equal but non-canonically spelled would carry *distinct* keys and both fail the
  coherence check individually. The profile never discovers "duplicates" late; each entry
  is judged alone.

A struct failing any check is well-formed deixis and simply not a `deixis-set-v1` node —
the same relationship every profile has to the floor.

**Slot-member precision (ratified).** For slot members the member is a live leaf, not
bytes, so the non-canonical-member refusal above is **node-member-only** — there is no
member spelling to be non-canonical. What remains, exactly:

- **Mis-keying is the only key refusal.** `k ≠ e(leaf)` refuses; and a key outside
  `im(e)` cannot cohere with any member, so "unrecognized key" *reduces* to mis-keying
  rather than being a second check.
- **Every child must be a leaf.** `member(x) = Leaf(x)`, so a struct child sits outside
  the form's image and refuses.
- **Representatives are free.** Two `≈`-equal members spell one key, and either may sit
  under it: the leaves are already equal under the lifted identity, so recognition does
  not — and must not — prefer a representative. Preferring one would be a repair pass.

## Current optional specialization (ADR 0010, 2026-09-23)

[ADR 0010](0010-mandatory-node-values.md) makes the core payload a required `T`.
This profile explicitly chooses `Node(Option(S))` for member type `S`: `None`
is the set-root payload, and `Some(x)` is a member payload. Set identity uses
the conventional tag-respecting lift of the member equivalence. The four
implementations expose this specialization in their return and argument types.
No optionality is imposed on other uses of the core, and the choice does not
require preserving earlier core APIs or codec bytes.

## Under ADR 0009: the slot-member image is preserved exactly (2026-09-23)

The following records the earlier profile derivation; its image and refusal
rules now apply to the explicit optional specialization above.

[ADR 0009](0009-optional-node-values.md) made `Node(T) = Option(T) × (Key ⇀ Node(T))` the
floor. `Leaf` and `Struct` are no longer constructors
([TREE.md](../TREE.md#the-previous-model)). Its §14.3 requires each profile to preserve
its declared identity or record an explicit migration, and warns that *"admitting a new
core shape does not automatically extend a profile's accepted image."*

**This profile preserves.** The slot-member form's image is exactly the embedding of its
previous image:

```text
set(S) = Node(None, { e(x) ↦ Node(Some(x), ∅) | x ∈ S })
```

Recognition is unchanged in substance. Restated in the new vocabulary, the three reasons
of [vectors/set.json](../../vectors/set.json) are:

- **`mis_keyed`**: `k ≠ e(x)`. Unchanged.
- **`struct_member`**: a child whose own value is `None`. That is the image of a `Struct`
  child, so it refuses as before.
- **`leaf_node`**: the set node itself is `Node(Some(x), ∅)`. That is the image of a bare
  `Leaf`, so it refuses as before.

**Two shapes are new in N, and the previous text never had to decide them.** Both refuse.
The refusal is *forced*, not a preference:

- **`valued_set_node`**: a set node **with at least one member** that carries its own value,
  `Node(Some(t), m)` with `m ≠ ∅`. The childless case `Node(Some(t), ∅)` is `leaf_node`'s, as
  above. *(Corrected 2026-09-23 on the fixture author's finding: the first wording, "coherent
  members", was vacuously true of an empty map, so it overlapped `leaf_node` and gave that node
  two reasons.)*
- **`member_with_children`**: a member `Node(Some(x), m)` with `m ≠ ∅`.

Accepting either would read two *different* nodes (differing only in the parent's own
value, or in a member's children) as the same set. That makes set identity coarser than
node identity, which the "Not a new equality" rule below forbids, and it breaks
[0004](0004-structure-slot.md)'s transport law 3 (set identity reduces to node identity).
A container that wants a labelled set, or members with structure, is a different profile
with its own name. `deixis-set-v1` is frozen.

**Several defects, one node.** This section, like the previous text, fixes the verdict and
not the order among reasons. When a node has more than one defect, a recognizer may report
any reason that applies. Fixtures therefore pin a reason only on nodes with exactly one
defect. That records what was already true; it does not add a precedence rule.

**Vectors.** The preserved half adds no judgment: it is exactly `set.json`'s verdicts
carried through the embedding. The two new refusals are new judgments. Under the
independence rule the ADR 0009 delivery was split on (whoever writes the spec does not
also write its expected results), their vectors are routed to the other lane rather than
written by the author of this section.

## What it is not

- **Not a multiset.** Multiplicity is a different container: count-valued maps (self-keyed
  members, integer leaves) or a positional embedding. Either is its own profile.
- **Not ordered.** Canonical enumeration order is spelling, not semantics; a consumer that
  reads rank into it is inventing a reading the profile does not make.
- **Not a new equality.** Nothing here merges values the slot's `≈` distinguishes or
  separates values it merges — the codec law forbids both directions at once.

## Ratification

**Slot-member form (done, 2026-08-07).** The name `deixis-set-v1` is frozen; the framing
is fixed above; the reference implementation is [set/rs](../../set/rs/); and
[vectors/set.json](../../vectors/set.json) pins, per
[vectors/README.md](../../vectors/README.md): membership across boundary encodings
(including by-class membership under a coarse `≈`), idempotence-by-construction, the
mis-keyed and struct-member refusals, and identity across authored entry orders — over
two member encoders, `e = id` on bytes and a coarse fixture encoder, so an
implementation that skips coherence or reads representations fails visibly.

**Node-member form (re-sketched, still gated).** The original direct self-keying is
superseded above; the sorted-positional shape ratifies with the codec combinator,
which it still pulls as that axis's first concrete consumer. Its vectors add what
only it can exercise: the member-order refusals (out-of-order members, duplicate
member identity), and composite members under the profile-owned order.
