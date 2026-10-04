# deixis — the structure slot

**Status:** decided. Answers the question the leaf slot begs; records the level beneath
the floor; ratifies **structure profiles** as the genre through which container semantics
enter; and names the one trigger that would reopen any of it.

**Subsequent decisions (2026-09-23):** [0009](0009-optional-node-values.md)
introduced own values alongside children; [0010](0010-mandatory-node-values.md)
supersedes its optional core value with mandatory `T`, leaving optionality to the
slot. Both retain this record's single finite byte-keyed branching container and
profile laws. A lossless profile may still differ from the required native
extension interface, so nonembeddability is not the only reason to revisit a node
model. The original exploration follows.

## The question

[TREE.md](../TREE.md) has one hole, and it is the leaf. The branching form is fixed:
`Key ⇀ Node(.)`, a finite byte-keyed map, closed forever. But the leaf slot begs the
symmetric question: why is the *container* not a slot too?

```
Node(C, T) = Leaf(T) | Branch(C(Node(C, T)))
```

The question is well-posed, and by symmetry with [SLOTS.md](../SLOTS.md) it even answers
what such a slot would owe. The leaf hole asks for a **setoid** — a carrier with an
equality. A structure hole would ask for a **setoid functor**: the container `C`, plus an
equality *lifter* (given `≈` on children, a congruence on `C(children)` — today's
`dom m = dom n` and pointwise **is** the map's lifter), plus, at the codec tier, a
canonicalization lifter (given child bytes, canonical `C` bytes — the job the total key
order does today). The admission tiers come apart exactly as SLOTS.md's do: sequences pass
every tier; multisets pass (canonicalize by sorting member bytes); branching identified up
to isomorphism or bisimulation passes no tier that matters, because its identity is a
theory, and no theory may live at the floor.

## The basement

The parameterized form is not a novelty; it is the theory of **containers and W-types** —
well-founded trees over an arbitrary branching functor — and deixis is one point in it:
the instance at `C = Bytes ⇀ −`. So there is a floor beneath this floor, in principle,
and the relationship is the one this repo already knows how to hold: deixis stands to the
W-type exactly as ontos stands to deixis — an instance whose spec does not
restate the general theory, recorded as a correspondence rather than re-derived. The
basement exists. Nothing needs to move into it.

## The decision: instances embed; the parameter is refused

A literal structure slot would make `Node(Seq, T)` and `Node(Bytes ⇀ −, T)` distinct
types with **incomparable identities** — a family of floors where there was one. Every
consumer becomes generic over `C` (inheriting the setoid-functor obligations everywhere —
[0001](0001-keys-are-bytes.md)'s second-slot rejection, squared) or pins one; and everyone
pinning the same one to interoperate is the present design, rediscovered the long way. The
floor's entire value is its oneness; parameterizing the spine spends it.

What the parameter would buy is instead obtained by **embedding**. `Bytes ⇀ −` is the
universal admissible container — *a slogan, whose honest theorem is scoped* (consult
finding, 2026-08-08): the claim quantifies over **slot-generic** profiles (natural in the
slot), and the real hypotheses are a lawful computable byte encoder *for shapes* with
decidable image, plus position enumerations computable from the shape code; under those,
every such container embeds losslessly into the key space (shape marker + per-shape
spellings in disjoint regions), and countable presentation is *necessary* for
slot-generic embedding — a characterization, not a hope. Quotient-symmetric containers
(sets, bags) enter exactly when their position-symmetry orbits admit a lawful computable
invariant — which is why the set profile had to route through the codec tier while the
sequence profile did not. The proof program lives in the paper; this record carries the
corrected scope so implementers read the true claim. A **reading is an insertion of container semantics into the structure** — the
structure slot realized as data rather than as a type parameter. And insertions compose
where parameters cannot: a set of sequences of records is three container semantics
cohabiting in one node, under one identity, one codec, one hash. As type parameters the
same thing is a tower of functor compositions, each layer a different floor.

Embedding overhead is representational, and representation is unobservable: an
implementation MAY store a recognized dense-positional struct as a flat vector and respell
keys on demand — sibling order is not part of a node, and the spelling is deterministic.
Native-container performance needs no native container.

## Structure profiles

The genre [0002](0002-positional-keys.md) began, named and given its receiving criteria. A
**structure profile** is a named, versioned embedding of one admissible container into the
key space. To be one is to supply:

1. **A spelling with the transport laws its container needs.** Injective always — one
   semantic position, one key. Prefix-free wherever paths must compose
   ([PATH.md](../PATH.md)). Order-preserving **iff** the container carries order — a
   profile that claims order must make its semantic order coincide with canonical byte
   order, as `κ` does; a container without order claims none and canonical order remains
   mere spelling.
2. **Exact-or-refusal recognition.** A node either is in the profile's image or the
   profile refuses it. No sorting into place, no gap-filling, no normalizing an alternate
   spelling — a repair pass coarsens identity, and no layer may.
3. **An identity-transport law.** The container's semantic identity must *reduce* to node
   identity — never extend it. A profile defines forms, not equalities
   ([TREE.md](../TREE.md)); if two of its structures are semantically the same, they must
   already be the same node.
4. **Hand-authored vectors** at ratification, per [vectors/README.md](../../vectors/README.md) —
   including the refusals.

**The interface, formally** *(adopted 2026-08-07 from the paper's review 01, which is
also where an earlier informal set construction was caught being unwell-defined — the
formal shape is the guard)*. A structure profile for a reading with carrier `(A, =_A)`
is a named, versioned pair of extensional maps

```
P : A → Node(T)        total          R : Node(T) ⇀ A        partial
```

satisfying: **retraction** — `R(P(a)) =_A a`; **exactness** — where `R` is defined,
`P(R(n)) =_≈ n`, so `dom R` is, up to node identity, exactly `im P`; **identity
transport** — `a =_A b ⟺ P(a) =_≈ P(b)`; **recognition** — `R` respects `=_≈`
(equidefined, `=_A`-equal results on identified nodes), is decidable relative to the
slot's effective tier, and refuses rather than repairs. Criteria 1–3 above are these
laws' informal reading; criterion 4 pins them.

Two sharpenings from the type-theory consult (2026-08-08). *The gadget has a name*: a
profile is a **split restriction idempotent** — `e = P∘R` satisfies not just
`e∘e =_≈ e` but `e ≤ id` (`e(n) =_≈ n` wherever defined), and that inequality *is* the
categorical content of exact-or-refusal: **a repair pass is precisely a split idempotent
that is not a restriction idempotent** — a retraction that moves points onto the image.
*And the laws are not independent*: identity transport is derivable from retraction plus
extensionality of both maps, and the no-repair clause restates exactness — kept stated
because vectors cannot test extensionality directly, but a minimal conformance suite
should know what it gets for free. One honest scope note: these laws are stated
one-layer; the recursive recognizers (ontos's `R`, the node-member set form, composites)
are partial *folds*, and the once-for-all "algebraic profile" lemma (recognizer = fold of
a partial algebra ⇒ laws compose) is queued paper work before the first composite
profile ships. The ontos bridge's `P`/`R` is the
founding instance of the interface, and a profile that must *produce* raw nodes over a
coarse member equality does so via a chosen strict section, with the
representative-free reading valued in `Node(T)/=_≈` (the shape
[0005](0005-set-keys.md)'s ratified form takes).

**`deixis-pos-v1`** ([0002](0002-positional-keys.md)) is the first structure profile: the
sequence container's embedding, whose order-preservation is transport law 1 in its
strongest form. **`deixis-set-v1`** ([0005](0005-set-keys.md)) is the second, sketched:
the finite-set container by self-keying, the first profile whose transport runs through
the codec tier rather than a bespoke spelling.

Structure profiles are the *container* axis of a two-axis space whose *slot* axis
[0003](0003-instantiations-beyond-ontos.md) surveys: a slot instantiation decides what a
tree holds; a structure profile decides how its keys mean. A real packaged agreement
usually fixes one of each — 0003's capability surface is a handler *slot* under a
path-segment *key discipline* — and the two axes version independently.

## What would reopen this

Not a new container that embeds — that is a new profile, and profiles are the intended
growth. The decision reopens only on **a container that passes the identity tier —
decidable, canonical, choice-free identity — and still cannot lawfully embed** into the
key space. None is known, and the known non-embedders fail earlier: iso- and
bisimulation-identified branching fail the identity tier itself, and enter the family as
they always would — descriptions in the slot, equivalence claims as derivations, theory
where theories live. If the genuine article ever appears, the basement gets reified and
deixis becomes an instance of it the way ontos became an instance of deixis. Until then, a
documented correspondence is the right weight of commitment — the same weight
[0001](0001-keys-are-bytes.md) chose, one floor further down.
