# deixis — keys are bytes

**Status:** decided. Fixes the key type of the floor defined in
[TREE.md](../TREE.md), and records what follows for the codec axis and for
ontos.

## The decision

`Key` is a fixed sort — finite byte strings. It is not a slot.

```
Node(.) = Leaf(.) | Key ⇀ Node(.)
Key     = Bytes
```

deixis has exactly one parameter, and it is the leaf.

## What it settles

Whether `Key` should be a second slot was the open question blocking the floor. It is
closed: one parameter, and the `(.)` notation survives, which it would not have under
`Node[K, T]` — two holes cannot be told apart positionally.

## What it buys

Bytes discharge both obligations a key type carries, and neither becomes a requirement on
anyone:

- **Equality**, for identity. Octet equality is exact and decidable.
- **A total order**, for canonicalization. Lexicographic byte order is canonical and needs
  no vocabulary.

[TREE.md](../TREE.md)'s identity section had to hold these apart — equality at the
floor, a total order at the codec axis — because deixis could not discharge the second for
an arbitrary key type. Bytes supply both at once.

ontos validated the same choice independently one layer up: `ontos/data` orders `map` and
`set` entries by canonical codec byte order. The general case had already been solved with
bytes. This decision only moves it to the floor, where it costs nothing.

## Alternatives rejected

**`Key` as a second slot.** Would have made deixis `Node[K, T]`, with the level ladder
(`ℕ` sequences, `Name` records, `Value` relations) recovered as instantiations. Rejected
on three counts: it costs the notation; it adds a second setoid obligation; and — the
deciding economy, though not an impossibility — it reintroduces the obligation it was
meant to generalize past. A key slot *could* canonicalize the way the leaf slot does: an
equality at the identity tier, a lawful encoder at the codec tier, the encoder's bytes
then furnishing the total order. But that levies the supply on every consumer of every
instantiation, forever; bytes discharge both obligations once, at the type, for everyone.
(Wording refined per the paper's review 01: the original "cannot canonicalize without
being required to supply a total order" overstated a cost argument into an
impossibility.)

**`Key = ℕ`.** Positional only. Rejected because it forecloses named keys, and pointing by
name is what the project is named after. Byte keys subsume both: a position is an encoded
integer, a name is its bytes.

**"Encoded" is a promise, not a spelling.** This decision fixes no encoding of ℕ into
bytes, and deliberately: a positional reading becomes exact only when a named, versioned
profile pins one — preferably order-preserving, so lexicographic key order and numeric
order agree and canonical entry order needs no second sort. That profile is a reading
above the floor, not part of it — [0002](0002-positional-keys.md) pins it as
`deixis-pos-v1`.

## Consequence: positional and named are readings, not instances

ontos's consumer note originally argued that ontos is deixis *at* `Key = ℕ`, treating
the positional convention as one instantiation among alternatives. With `Key` fixed that
mechanism is gone, and the conclusion comes out stronger.

Positional keys and named keys are not different instances of deixis. They are different
**readings of the same key bytes** — one floor, one key space, consumers differing only in
what they write into it.

ontos's position within that space is the degenerate one: it never writes keys at all.
They are implicit, recovered from order, and carry no chosen vocabulary. That is a sharper
form of that note's "requires no vocabulary" argument than the original. ontos does not
select the minimal key type; it declines to use the key space as a carrier.

## deixis can only own half a codec

An encoding of `Node(T)` splits in two, and only one half is deixis's:

- **The structural half** — tag, entry count, key lengths, key bytes, entry order. Entirely
  deixis's, and this decision is what makes it expressible: keys are bytes, so they have a
  length and a canonical order without anything being supplied.
- **The slot half** — `T → Bytes`. Never deixis's. It does not know what `T` is and holds
  no bound that would let it find out.

So what deixis can define is a *combinator*, `encode : (T → Bytes) → Node(T) → Bytes`,
which emits no bytes on its own. ontos has a complete codec only because it fixed the slot
to bytes, where the slot encoder is the identity function.

`core/rs` already shows this from the other side: there is no `encode` on `Node<T>`, and
there could not be, because `T` carries no bounds.

What the combinator demands of an instantiation is exactly the codec law
`x ≈ y ⟺ e(x) = e(y)`, which says `e` is injective on the quotient `T/≈`. That requires the
quotient to be **countable** for an encoder to exist at all, and separately requires the
injection to be **computable** for one to be writable. Neither is a demand that the slot be
*data*: a handler identified by name satisfies both, while the reals under exact equality
satisfy neither. See [SLOTS.md](../SLOTS.md).

## The bytes do not move, and neither does the codec

Three reasons, in increasing order of finality.

**It is a different artifact.** `ontos-codec-v1` encodes a tuple as
`0x01 ‖ uvarint(n) ‖ children` — there are no keys in it at all. A deixis codec must write
keys, because keys are part of a node; ontos reconstructs them from position. That is not
a version gap between two spellings of one encoding. It is an encoding of a different
structure.

**Elision is the whole optimization.** ontos's keys are derivable from arity, so a general
codec would spend bytes on information ontos can reconstruct for free. ontos should not
take that trade, and a floor that asked it to would be wrong to.

**It is security-critical, not merely frozen.** `ontos/codec` §1 is explicit: arche signs
Ed25519 over these exact bytes, and logos hashes them for clause identity and proof-DAG
citations. A byte change is not a migration with a deprecation window — it invalidates
every signature and every hash above it simultaneously.

## It composes upward instead

The useful direction is the reverse of migration. Once deixis has a codec combinator,
`ontos-codec-v1` is precisely the sort of thing that plugs *into* it as a leaf profile:
`Deixis(Ontos.Value)` encodes as deixis framing with ontos's codec doing the leaves.

That is additive, unfreezes nothing, and gives the frozen codec a second life as a
component rather than an obligation. ontos's codec does not come down to deixis. It
becomes something deixis codecs consume.

## What this implies for ontos

| | |
| --- | --- |
| **L0 `ontos/core`** | Absorbed in principle. Becomes deixis at the bytes slot, plus a contiguity rule on keys. Two sentences, not a spec. |
| **`ontos/codec`** | Stays. Frozen bytes, as above. |
| **L1 `ontos/compound`** | Stays. Where the label sits is a naming convention deixis has no view on. |
| **L2 `ontos/data`** | Stays entirely. deixis has nothing to say about what bytes mean. |
| **vectors · CLI · conformance · implementations** | Stay. |

ontos's own summary of itself splits along the seam exactly — *"here is a thing, and here
is the kind of thing it is."* deixis takes the first clause; ontos keeps the second, which
is where the content always was.

Worth stating plainly: the two constructors were never ontos's contribution. They are the
obvious minimal answer, which is why a convergence panel converged on them. ontos's work
is the asymmetry principle, the layering discipline, the frozen canonical encoding, and
the embedding registry. Only the substrate under the first of those moves, and the
principle itself stays ontos's, delegated onward. **ontos loses a definition and keeps a
doctrine.**

## Nothing moves yet

`ontos/core` is frozen and pinned by conformance vectors across four languages. Unfreezing
it to re-derive from deixis spends the credibility of *frozen* on a refactor with no user.

The trigger to revisit is concrete: **a second real instance.** One non-bytes slot in
actual use — `Deixis(Handler)` as a router, `Deixis(Definition)` as a namespace — proves
the abstraction generalizes. One instance does not; it is a coincidence with extra steps,
and a documented correspondence is the right weight of commitment for the evidence
currently available.
