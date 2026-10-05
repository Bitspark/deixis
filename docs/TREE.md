# Tree

```
Node(.) = (.) × (Key ⇀ Node(.))
Key     = Bytes
```

`(.)` is the slot: opaque to deixis, supplied by context. deixis fixes the shape of a
tree and commits to nothing about *what kind of thing* a tree holds. Construction and
navigation need only a carrier. Identity additionally uses a supplied equivalence;
the core does not choose one ([SLOTS.md](SLOTS.md)).

`Key` is not a slot. It is finite byte strings, fixed
([0001](design/0001-keys-are-bytes.md)) — uninterpreted, exactly as a node's own value
is. A key that spells a name and a key that encodes a position are the same kind of
thing; what a key *means* is a reading, never deixis's business.

This is the model accepted on 2026-09-23 in
[ADR 0010](design/0010-mandatory-node-values.md), superseding ADR 0009's optional
core values. All four cores implement the mandatory-value interface, checked by
the shared harness; [API.md](API.md) gives the language signatures. Consumer
adoption and the candidate codec's freeze obligations remain tracked in
[#1](https://github.com/Bitspark/deixis/issues/1). The original
`Leaf | Struct` model embeds into the explicit instantiation `Node[Option[T]]`
([The previous model](#the-previous-model)). ADR 0011 selects the implemented
`deixis-codec-v2` candidate grammar; it remains unfrozen.

[ADR 0012](design/0012-data-wire-tree-symmetry.md) names the common TypeScript
interface `DeixisNode<T>`. `DataTree = DeixisNode<Data>` and
`WireTree = DeixisNode<Wire>` instantiate this same complete structure. The
payloads provide addressless reading and sending, respectively. A byte snapshot
`Node[Bytes]` and a reader tree `Node[Data]` are different instantiations. An
addressed operation alone, without the complete parts below, is not this tree.
[ADR 0014](design/0014-structural-identity-and-lifted-access.md) reaffirms this
distinction. Sender and receiver trees are equally valid instances; an endpoint
connection alone supplies neither tree's complete structure.

## Reading the definition

**`×` is a product: every node has both parts.** A node has one own value `t : T`
and children, a finite partial map from keys to nodes. A childless node still carries
`T`; a node with children retains its own `T`. There are no node kinds. "Leaf" means
no children and says nothing further about the value.

**Optionality is a slot choice.** `Node[Option[T]]` carries an explicit tagged
`None` or `Some(t)` at every node. The core treats either as a value. Its supplier
declares the option equality and any absence-sensitive operations. With the usual
tag-respecting equality, `None` differs from `Some(t)`; neither denotes a missing
node. The generic core does not impose that relation on an arbitrary slot.

In `Node[Node[S]]`, the own value holds another tree as opaque content: it is not
that tree, and resolution never enters the value ([PATH.md](PATH.md)). Missing
navigation results must be represented independently of legal payloads.

**`⇀` is a *finite partial* map.** A node carries finitely many children, each a distinct
`Key` bound to one `Node(.)`. Two consequences, both intended:

- Not a single edge. Multiplicity is part of the definition, not something recovered by
  chaining edges into a spine.
- Not total. Totality over an infinite `Key` would admit infinite nodes, and every node
  is finite.

**Every node is finite and well-founded.** Finitely many nodes, each with finitely many
children, bottoming out in nodes that have none. A node is a finite tree, never a graph,
and never contains itself. Sharing equal subtrees is a representation matter and is
unobservable.

## Identity

deixis does not define identity. It **lifts** one.

```
Node(t, m) = Node(u, m')   iff  t ≈ u  and  dom m = dom m'  and  m(k) = m'(k) for every k ∈ dom m
```

`≈` is the slot's own equivalence relation, used at every node. It is not deixis's
to choose, and it is the entire slot interface needed for identity. The slot
is a carrier; **when identity is in play, it is a setoid** — a carrier together with an
equality. Identity is the first *priced* capability, not a standing requirement: a
carrier-only slot is a legal instantiation with shape, keys, and paths but no `=` to ask
about ([SLOTS.md](SLOTS.md)'s tiers). This resolves a posture split three documents carried
(2026-08-08, flagged by the type-theory consult): the paper's tier table, PATH.md, and
the code already said carrier-only; this sentence now agrees.

Which means every requirement deixis places on a slot is a requirement on the pair
`(T, ≈)`, never on the carrier alone. No carrier is admissible or inadmissible by itself;
the same one can be either, depending on the relation it arrives with. What each choice
buys, and the two things that are genuinely impossible, are in [SLOTS.md](SLOTS.md).

**Key equality is octet equality.** `dom m = dom m'` is decided key-by-key, and because
keys are bytes the relation is exact, decidable, and owed to no one. Canonicalization
needs strictly more than identity does — a *total order* on keys, to fix entry order for
encoding — and lexicographic byte order supplies it. Both obligations are discharged by
the key type itself rather than imposed on a consumer
([0001](design/0001-keys-are-bytes.md)).

**Sibling order is not part of a node.** A deliberate divergence from
ontos, where `Tuple` is ordered and order is part of
the value. A keyed map needs no order, because keys already distinguish the children. Two
nodes written with the same children in different orders are the same node, and deixis
has no notion of a first child.

**The lifting is a congruence, and preserves equivalence.** If `≈` is reflexive,
symmetric, and transitive then so is `=`; and equal subtrees are interchangeable —
substituting an equal node at any position yields an equal node. Both follow by induction
on nodes. Neither needs stipulating.

**deixis can be no finer than `≈`.** ontos's floor uses the finest consumer-agnostic
equality, so layers above may collapse distinctions but can never recover one the floor
erased. The same asymmetry holds here — whatever `≈` merges is merged for everything above
— but deixis is in no position to require anything about it. It has no view into the slot
and no way to tell a considered equality from a lazy one.

So this is a consequence for whoever instantiates the slot, not an obligation deixis
imposes: choose `≈` as fine as any consumer of that instantiation will need, because the
choice is not revisable afterwards. Instantiating with ontos values is the well-behaved
case, since ontos's structural identity is already the finest consumer-agnostic equality
available.

A slot with no good equality is still a legal instantiation. Reference identity, or a
relation that merges everything, satisfies the definition as surely as octet equality
does — every carrier admits one. What varies is not whether the slot is admissible but how
much its node identity is worth.

**No layer above deixis may redefine `=`.** Readings — paths, subtrees, registered
structural embeddings — may define canonical *forms*. They never define an equality. This
is the same anti-rot invariant ontos pins at L0.

### What identity is not

- **Not object identity — none that deixis adds.** No address, no allocation history, no
  sharing, no construction order enters from the structure's side. Two nodes of the same
  shape with pointwise-`≈` values are the same node. What `≈` itself compares is the
  slot's affair: instantiate it with reference identity and node identity becomes
  reference-based, because deixis lifted what it was handed.
- **Not coarser than the lifting.** deixis does not decide that a one-child node equals
  its child, or that a node with descendants equals a childless node. Each would
  erase structural distinctions. Payload distinctions are exactly those supplied by `≈`.
- **Existing versus missing.** `Node(t, ∅)` is an existing childless node for every
  supplied `t`, including a legal null-like payload. No payload denotes a missing path.

### Equivalently, by pointing

Two nodes are equal iff they define the same set of paths and have `≈`-equal
values at every path. Value assignment is total on that set. [PATH.md](PATH.md)
states the characterization and distinguishes optional payloads from missing nodes.

It is the reading the name is about: a node is what it points at, and nothing else.

## The slot is a parameter — Node is a functor

`Node(.)` is not a definition with a blank filled once; it is a **functor**, applied per
instantiation. Every statement in this spec — shape, identity, pointing, the profiles —
is quantified over the slot, so an instantiation costs an application and never a
re-derivation. `Deixis(Bytes)`, `Deixis(Handler)`, `Deixis(Node(S))` are one floor at
three points, not three floors.

The action on maps is the evident one, and keys are untouched by it:

```
map f (Node(t, m)) = Node(f(t), k ↦ map f (m k))

map id       = id
map (g ∘ f)  = map g ∘ map f
```

**Structure is invariant under map.** Keys and paths are preserved:
`paths(map f N) = paths(N)`, every existing node still carries a value, and resolution
commutes — `(map f N) / p` is defined exactly when `N / p` is, and equals
`map f (N / p)`. Only values move; the pointing does not.

Mapping visits every own value. For `Node[Option[T]]`, generic mapping can change
`None`; retaining optional presence requires the explicit lifted function
`Option.map(f)`. The core does not silently skip a payload.

**Setoids ride along.** If `f` carries `≈_T` into `≈_U` — `x ≈_T y ⟹ f x ≈_U f y` —
then `map f` carries the lifted identity into the lifted identity. So the lifting of
[Identity](#identity) is the object half of a functor **Setoid → Setoid**: carriers to
carriers, relations to relations, morphisms to morphisms.

**The two axes are different parameters.** This section is about the *value* parameter.
The branching form is deliberately not one: [0004](design/0004-structure-slot.md)
refuses a container parameter and admits container semantics as readings of the key
space. Vary the slot and it is still deixis; vary the spine and it would not be.

**Profiles declare their transport conditions.** Mapping preserves the positional
key discipline. A complete profile image may also restrict payloads. A profile whose
recognition consults values — `deixis-set-v1` checks `k = e(value)` — transports along
`f` exactly when the encoders agree, `e_U ∘ f = e_T`; a map that re-encodes members
re-keys nothing, so the image is honestly left rather than repaired.

None of the cores ships `map`: it is derivable through the accessors, and the floor's
API stays minimal. The property belongs to the specification, and every instantiation
may rely on it.

## Composition

A node is exactly its parts, and the parts are complete:

```
decompose : Node(T) → T × (Key ⇀ Node(T))      decompose(Node(t, m)) = (t, m)
compose   : (T × (Key ⇀ Node(T))) → Node(T)    compose((t, m))       = Node(t, m)

compose(decompose(n))      = n         for every node n
decompose(compose((t, m))) = (t, m)    for every t : T and child map m
```

The child map holds whole subtrees, not their own values, and holds every child under its
exact key. **A parent's own value is an input to reconstruction, never inferred from its
children**: two nodes with identical children and different own values are different
nodes, and no child-only rule can rebuild both. Creating a new parent needs a
supplied `T`; the core cannot fabricate one. A consumer may derive it by a declared
rule, choose `None` in `Node[Option[T]]`, or use `()` in `Node[Unit]`.
Reconstructing from selected descendants rather than immediate children also
needs their surrounding context ([PATH.md](PATH.md#contexts-and-replacement)).

## Growth

Containment preserves positions, edges and values:

```
A ⊑ B   iff   paths(A) ⊆ paths(B),
              and each value of A is ≈ to B's at the same path
```

It is a partial order up to identity and needs only the slot's equivalence. For an
optional carrier with tag-respecting equality, it preserves an old `None` too.
An order allowing `None` to become `Some(t)` is a separate optional interpretation.

**Every existing node admits a new child, and attaching one changes nothing else.** For a
tree `A`, a path `p` in `paths(A)`, a key `k` with `p · k` not in `paths(A)`, and any tree
`B`, `attach(A, p, k, B)` is **defined**, and yields exactly:

- the paths of `A`, plus `p · k · q` for every path `q` of `B`;
- every own value of `A` at its old path, and every own value of `B` below `p · k`.

It is undefined only when `p` is missing or `p · k` is occupied, and it never compares
values: the new paths cannot overlap the old ones, since an old path below `p · k` would
make `p · k` old as well. Its consequences — `A ⊑ attach(A, p, k, B)`, the subtree at
`p · k` is `B`, the own value at `p` is unchanged, and additions at distinct fresh keys
commute — are derived, not further axioms. The subtree at `p` has grown, so it is *not*
equal to `A / p`; containment is what survives.
[ADR 0010](design/0010-mandatory-node-values.md) section 5 states the exact domains,
assignments and partial-overlay laws. Overlay has no universal empty-root identity
for arbitrary `T`; agreeing root values are required for compatible inputs.

Availability separates both mandatory and optional product models from the original
`Leaf | Struct` model: a valued leaf there could not gain descendants while retaining
its value at the same native path.

## The previous model

The original `L[T] = Leaf(T) | Key ⇀ L[T]` embeds into `Node[Option[T]]`:

```
Leaf(x)    ↦  Node(Some(x), ∅)
Struct(m)  ↦  Node(None, k ↦ the image of m(k))
```

With tag-respecting option equality, the embedding preserves paths, original leaf
values and identity. Its image has `Some` only at terminal nodes. Mapping uses
`Option.map(f)` on the target to preserve that image. The slot changes explicitly
from `T` to `Option[T]`; there is no promise of an embedding at arbitrary unchanged `T`.

The intervening optional model of [ADR 0009](design/0009-optional-node-values.md)
is `Node[Option[T]]` without terminality. The current core can instantiate it
explicitly; it does not impose optionality on other payload types. Embedding does not decide
bytes or addresses ([CODEC.md](CODEC.md), [#1](https://github.com/Bitspark/deixis/issues/1)).

## What is stipulated, and why

Mandatory opaque values, finite byte-keyed child maps and well-foundedness define
the core. Optionality and sentinel meanings belong to the slot's declared
interpretation. These choices retain one shared hierarchy while letting consumers
choose their value domain. The laws here are the accepted target; proof and
implementation status remains separate in [EVIDENCE.md](EVIDENCE.md).
