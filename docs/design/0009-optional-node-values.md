# Optional node values and exact hierarchical composition

**Status:** superseded, 2026-09-23, by
[ADR 0010 — mandatory node values](0010-mandatory-node-values.md).
The user subsequently chose `Node[T] = T × FinMap[Key, Node[T]]`, with optional
values available through `Node[Option[T]]`. This record retains the original
decision and complete theoretical exploration. Its `L`, `N` and `All` notation
and status descriptions below refer to that historical discussion, not the
current generic contract. [#1](https://github.com/Bitspark/deixis/issues/1)
tracks migration; the optional-model implementation landed before this repository was
published.

**Decision:** deixis's standard hierarchical model is a finite, well-founded tree
whose nodes have an optional opaque own value and an independent finite map of
named children:

```text
Node[T] = Node(Option[T], FinMap[Key, Node[T]])
Key = Bytes
Option[T] = None ⊎ Some(T)
```

Every existing node admits exact attachment under a fresh child key while
retaining its own value at the same path. Complete reconstruction consumes both
the optional own value and the complete immediate-child map. Consumers supply
the meaning of values and the behavior of their combination.

## 1. The question that led to the decision

The discussion began with Wire as a possible deixis implementation. A sending
capability, informally `T = { send(Data) }`, can occur at an address that also
has addressable descendants. Hierarchical composition should let consumers
select, detach, assemble and reconstruct parts through one common structural
agreement. It should not require deixis to understand sending, syntax, state or
any other payload behavior.

The delivered model at the decision baseline,
[`ca25214`](https://github.com/Bitspark/deixis/tree/ca252147f6950b70c8ce71a0922cc18d0e774c95),
instead separates values from branching:

```text
L[T] = Leaf(T) ⊎ Struct(FinMap[K, L[T]])
```

Here a value-bearing node is necessarily terminal. A suggestion to retain parent
information under a profile-defined child key exposed the decisive example:

```text
Before: valueAt(tree, x) = Some(t)       t is opaque
Request: attach a child under x
After:  retain t at x, retain all old paths, add exactly that child subtree
```

Replacing `Leaf(t)` with a struct drops `t`. Placing `t` under a new `head` child
moves it to another native address. Representing it that way from the outset can
support a logical profile interface, but its raw path/value interface was
different from the outset. These distinctions led to two separate questions:

1. Can the information and operations be represented through a profile?
2. Should the same operations and path/value distinction be deixis's standard
   public semantics, without requiring a consumer-specific profile?

The answer to both is yes. The second is an architectural requirement beyond
lossless representability. The accepted decision makes it explicit.

## 2. Scope and ownership

deixis owns hierarchical composition, addressing and navigation, together with
the structural identity, decomposition/reconstruction and preservation laws
directly needed by that hierarchy. It treats `T` as opaque.

Operations such as `attach`, `split`, `plug`, restriction and overlay below are
mathematical descriptions or derived operations. Recording their laws does not
require a public method for each name, prescribe mutation, or turn deixis into
an editing, history or undo service. Implementations may choose their storage
and idiomatic interfaces while exposing the accepted structural semantics.

Consumers own payload behavior, runtime state, aliases, ownership, effects,
source grammar and printing. A send-only capability does not acquire topology
enumeration or permission to expose hidden capabilities merely because a
structural decomposition can be described. A composition declaration or
retained witness may supply structure that behavior alone cannot reveal.

## 3. Models considered

Use tagged sums throughout; the alternatives are distinguishable.

```text
L[T]   = Leaf(T) ⊎ Struct(FinMap[K, L[T]])
N[T]   = Node(Option[T], FinMap[K, N[T]])
All[T] = Node(T, FinMap[K, All[T]])

Path = K*                  empty path ε; concatenation ++
K = Bytes
```

`N` is the accepted model. `All`, the earlier value-at-every-node proposal, is
its restriction to trees with a value at every position. Mandatory values would
require a caller to invent a `T` for a purely structural branch. An arbitrary
opaque carrier need not have a default inhabitant; it may even be empty.

An alternative raised while discussing decomposition was:

```text
Node[S,U] = Leaf(S) ⊎ Branch(U, FinMap[K, Node[S,U]])
```

There is no mathematical requirement that `S` and `U` be identical to each
other or to a previously named `T`. `S = T, U = Unit` recovers the old split;
`S = U = T` permits payloads at both forms. However, retaining the same opaque
value while changing form needs an explicit common value observation or
conversion law. A conversion `S → U` alone does not establish identity
preservation. A tagged leaf versus childless branch also adds a distinction
that `N` does not need. With optional own values and no independent branch tag,
childlessness is simply an empty child map.

The informal proposals `T | { Segment: Node[T] }` and
`T | (T & { Segment: Node[T] })` helped separate terminal values from values
that can coexist with descendants. The explicit `Option[T] × FinMap` model
resolves their remaining questions about unvalued branches, empty structures
and complete reconstruction inputs.

Child keys are unique exact byte strings. Empty key and empty path differ.
Sibling order is not a native property beyond keys; consumers needing an order
declare a key discipline. Trees here are finite and well-founded, not cyclic
object graphs. These equations describe values or snapshots, not allocation
identity or an in-place update protocol.

## 4. A common path/value account

For either `L` or `N`, write:

```text
D_n ⊆ Path                  finite, nonempty, prefix-closed existing paths
v_n : D_n ⇀ T               partial assignment of own values
V_n = dom(v_n)
```

Prefix closure means every ancestor of an existing node also exists. The
model-specific restriction is precise:

```text
L: every path in V_n is terminal in D_n.
N: a path in V_n may also have descendants.
```

`None` denotes absence of an assigned value. It differs from every `Some(t)`,
including a payload's own empty value. An absent node differs from an existing
node with `None`. In particular:

```text
Leaf(t)    corresponds to Node(Some(t), {})
Struct({}) corresponds to Node(None, {})
```

When a slot equivalence `≈` is supplied, structural equality is:

```text
n ≡ m  iff
  D_n = D_m
  and V_n = V_m
  and ∀p ∈ V_n: v_n(p) ≈ v_m(p)
```

Construction and navigation require no comparison procedure for `T`. Equality
claims use the supplied relation, as distinguished from the carrier-only tier
in [SLOTS.md](../SLOTS.md). Neither decidable equality nor a codec for arbitrary
`T` follows from the model. Functions and equations respect the declared
equivalences; quotient language below does not require selecting canonical
in-memory representatives.

## 5. Navigation and payload mapping

For the accepted model, with the same path laws available in `L`:

```text
at      : N[T] × Path ⇀ N[T]
valueAt : N[T] × Path ⇀ Option[T]
own     : N[T] → Option[T]
children: N[T] → FinMap[K, N[T]]

own(Node(o,m))      = o
children(Node(o,m)) = m
valueAt(n,p)        = own(at(n,p))

(S0) at(n, ε) ≡ n
(S1) at(at(n,p),q) ≡ at(n,p ++ q)
(S2) at(n,[k]) is defined iff k ∈ dom(children(n))
```

All partial equations in this record require equal definedness. Missing paths
refuse; they neither create nodes nor choose a fallback. `valueAt` is undefined
for a missing node and returns `None` for an existing unvalued node.

For `f : T → U` and `g : U → W`, `map(f,−)` applies `f` to each present own value and preserves
all option tags, keys and paths. It does not inspect a payload itself; the
caller-supplied function provides any transformation. In either model:

```text
map : (T → U) × M[T] → M[U]             for M ∈ {L,N}

map(id,n) ≡ n
map(g,map(f,n)) ≡ map(g ∘ f,n)
at(map(f,n),p) ≡ map(f,at(n,p))
D_map(f,n) = D_n
V_map(f,n) = V_n
```

To make mapping a function on identified trees, `f` must respect the source and
target slot equivalences. Payload transformation is distinct from moving
structural positions.

## 6. Complete compose/decompose signatures

The accepted pair has these complete input and output types:

```text
decompose_N : N[T] → Option[T] × FinMap[K, N[T]]
compose_N   : (Option[T] × FinMap[K, N[T]]) → N[T]

decompose_N(Node(o,m)) = (o,m)
compose_N((o,m))       = Node(o,m)

(R0) ∀n : N[T]:
     compose_N(decompose_N(n)) ≡ n

(R1) ∀o : Option[T], m : FinMap[K, N[T]]:
     decompose_N(compose_N((o,m))) ≡ (o,m)
```

The finite map contains **whole immediate child subtrees**, not just their own
payloads. It contains every immediate child with its exact key. A childless
node returns an empty map. Parts equality includes the option tag, payload
equivalence where present, the key domain and recursive subtree equality.

For comparison, the old model has an equally exact, differently typed pair:

```text
Parts_L[T] = LeafPart(T) ⊎ ChildrenPart(FinMap[K, L[T]])

decompose_L : L[T] → Parts_L[T]
compose_L   : Parts_L[T] → L[T]

decompose_L(Leaf(t))   = LeafPart(t)
decompose_L(Struct(m)) = ChildrenPart(m)
compose_L(LeafPart(t)) = Leaf(t)
compose_L(ChildrenPart(m)) = Struct(m)
```

Both directions of the inverse laws hold on those explicit domains too.
Consequently, reconstruction alone does not distinguish the models. Neither
can reconstruct every node from children alone: old leaves already contain
independent information. In `N`, child-only reconstruction is the restricted
case `o = None`, or an interpretation-specific claim that parent information
is derivable.

If `at(tree,x)` has own value `a`, selecting children at `x ++ [k0]` and
`x ++ [k1]` cannot reveal an independent `a`. Two parents with identical child
maps and different own values are the counterexample. Correct reconstruction
supplies the optional parent value and **all** child entries. Reconstruction
from only selected descendants also needs the surrounding structure described
next. This makes explicit what the abbreviated equation
`compose(decompose(n)) = n` can otherwise conceal.

## 7. Contexts, replacement and complete cuts

For a fixed path `p`, `Context_N(p,T)` is a tree with exactly one hole at `p`.
It retains every ancestor's optional own value, the keys leading to the hole,
and every sibling subtree. At `ε`, the context is just the hole.

```text
split_p : N[T] ⇀ Context_N(p,T) × N[T]
plug_p  : (Context_N(p,T) × N[T]) → N[T]

plug_p(split_p(n)) ≡ n                  when p ∈ D_n
split_p(plug_p((C,s))) ≡ (C,s)          for every admitted C,s
```

Define replacement at an existing path by retaining the split context and
plugging the replacement subtree. Then:

```text
at(n[p := s],p) ≡ s
n[p := at(n,p)] ≡ n
n[p := s][p := t] ≡ n[p := t]
s ≡ t ⇒ n[p := s] ≡ n[p := t]
```

These follow by induction on `p`. At each step the untouched parent own value
and siblings are retained. The converse split/plug law matters: recovering
context from a result must return the same context, not just some context that
could have produced that result. The same laws hold for `L`, whose ancestors
on a nonempty path are structs without own values.

More generally, for a finite prefix-free set `F ⊆ D_n`, define
`Skeleton_N(F,T)` to contain exactly holes at `F` and all surrounding values,
keys and subtrees. Write `Subtrees_N(F,T)` for maps with domain exactly `F` and
values in `N[T]`. Then:

```text
cut_F     : N[T] ⇀ Skeleton_N(F,T) × Subtrees_N(F,T)
rebuild_F : (Skeleton_N(F,T) × Subtrees_N(F,T)) → N[T]

cut_F(n) = (skeleton_F(n), {p ↦ at(n,p) | p ∈ F})
rebuild_F(cut_F(n)) ≡ n
cut_F(rebuild_F((C,m))) ≡ (C,m)
```

Every distinction must occur in the skeleton or one of the supplied subtrees.
This includes empty nodes and own values above holes. Different complete cuts
of the same tree reconstruct the same tree; arbitrary reparenting or changed
key paths need not preserve identity.

## 8. Containment and exact conservative extension

The user's requirement that an original tree remain contained in a larger tree
means preservation of positions, edges and assigned values, not mere inclusion
of a set of payloads with topology forgotten. At a common root, define:

```text
A ⊑ B  iff
  D_A ⊆ D_B
  and V_A ⊆ V_B
  and ∀p ∈ V_A: v_A(p) ≈ v_B(p)
```

This is a partial order modulo `≡`. It permits an unvalued existing position to
gain a value. Rooted containment at `r` in another tree is `A ⊑ at(B,r)` with
`r ∈ D_B`. Selection is monotone:

```text
A ⊑ B and p ∈ D_A ⇒ at(A,p) ⊑ at(B,p)
```

Exact fresh attachment is stronger than containment:

```text
attach : N[T] × Path × K × N[T] ⇀ N[T]

C = attach(A,p,k,B)
r = p ++ [k]

Preconditions, exactly:
  p ∈ D_A
  r ∉ D_A

(E0) D_C = D_A ∪ {r ++ q | q ∈ D_B}
(E1) v_C = v_A ∪ {r ++ q ↦ v_B(q) | q ∈ V_B}
(E2) attach(A,p,k,B) is defined whenever the preconditions hold.
```

It is undefined when the parent is missing or the child key is occupied.
Using complete parts and the replacement notation from section 7, attachment
is exactly local reconstruction under those preconditions:

```text
decompose_N(at(A,p)) = (o,m)
attach(A,p,k,B) ≡ A[p := compose_N((o, m ∪ {k ↦ B}))]
```

Assignments in `(E1)` are compared under the slot relation. The added path set
is disjoint from `D_A`: if an old path extended `r`, prefix closure would make
`r` old too. Thus the operation needs no payload conflict comparison. It retains
every old value **and absence**, preserves the inserted subtree and introduces
no unrelated changes.

Availability is essential. A law saying only that successful attachment
preserves the input could refuse all valued parents. Availability plus
`A ⊑ result` alone is also insufficient: returning `A` unchanged would satisfy
it. `(E0)` and `(E1)` specify the requested insertion itself.

The consequences follow from the exact domains and assignments:

```text
A ⊑ C
at(C,r) ≡ B
restrict(C,D_A) ≡ A
valueAt(C,p) ≡ valueAt(A,p)
at(A,p) ⊑ at(C,p)

attach(attach(n,p,k,a),p,j,b)
  ≡ attach(attach(n,p,j,b),p,k,a)       for distinct fresh k,j
```

Restriction keeps exactly the specified prefix-closed path set and its partial
value assignment. Independent additions commute because their new domains are
disjoint. The whole subtree at `p` has grown, so requiring
`at(C,p) ≡ at(A,p)` would contradict a nontrivial attachment.

`N` admits the operation at every existing node: update the fresh entry of the
parent's child map while retaining its own value, then rebuild the ancestor
context. `L` admits the exact operation only at a `Struct`. For inhabited `T`,
`Leaf(t)` at `ε` and a fresh key give a direct contradiction between universal
attachment and valued-node terminality. This is the decisive semantic
difference; it is not a difference in printing notation.

## 9. Assembly, overlay and substitution

### 9.1 Heterogeneous assembly

Let `M` be either model, `a : M[A]`, and `b : M[B]`. Mapping the tagged
injections gives:

```text
map(in_A,a) : M[A ⊎ B]
map(in_B,b) : M[A ⊎ B]
```

Both models can always assemble these below distinct keys of a new unvalued
parent. Selection at those keys and untagging recover the inputs. This is a
total construction of `M[A ⊎ B]`; it does not overlay the original roots.

### 9.2 Overlay at matching paths

For two trees over a common carrier, define compatibility and the candidate
union modulo `≈`:

```text
compatible(A,B) iff
  ∀p ∈ V_A ∩ V_B: v_A(p) ≈ v_B(p)

D_U = D_A ∪ D_B
v_U = v_A ∪ v_B
```

For `N`, compatibility suffices, and the union is the least upper bound under
`⊑`. For `L`, the union must additionally leave every valued path terminal.
A value at `x` in one operand and a descendant at `x ++ [k]` in the other are
compatible in `N` and inadmissible in `L` at unchanged native paths.

On their respective domains these partial joins obey:

```text
A ⊔ B ≡ B ⊔ A
(A ⊔ B) ⊔ C ≡ A ⊔ (B ⊔ C)             with equal definedness
A ⊔ A ≡ A
e ⊔ A ≡ A
```

`e` is the single unvalued root. Either association is defined exactly when the
complete union is value-compatible and admissible in the chosen model. A
compatible union contains both inputs; any upper bound must contain its paths
and assignments, which establishes leastness. These give the algebraic laws;
an implementation and an executable comparison procedure remain separate.

`A ⊎ B` does not make two incompatible values fit into one own-value slot.
Opposite tagged values at the same path remain different. Retaining both could
use a consumer-supplied carrier:

```text
Combined[A,B] = OnlyA(A) ⊎ OnlyB(B) ⊎ Both(A × B)
```

Here projections retain the original payloads; `OnlyA(a)` is not equal to
`Both(a,b)`. Another consumer might supply a payload information order and
label join. Neither contract follows from opaque `T`. Even paired labels do
not by themselves record which input owned an unvalued or shared structural
position. Exact executable refusal of conflicts requires decidable comparison
at the chosen slot tier; mathematical partial union alone does not provide it.

Overlay is not generally invertible. For
`e = Node(None,{})` and `s = Node(None,{k ↦ e})`:

```text
e ⊔ s ≡ s ⊔ e ≡ s ⊔ s ≡ s
```

The result cannot identify which operand pair produced it. This does not weaken
compose/decompose, whose input includes precisely the parts needed to recover
them. Retaining operand provenance would be an additional consumer contract.

### 9.3 Leaf substitution is another operation

The old free-monad discussion concerns total substitution of leaf-held trees:

```text
η_T : T → L[T]
η_T(t) = Leaf(t)

μ_T : L[L[T]] → L[T]
μ_T(Leaf(n))   = n
μ_T(Struct(m)) = Struct({k ↦ μ_T(m[k])})

μ_T ∘ η_L[T] = id
μ_T ∘ map(η_T) = id
μ_T ∘ map(μ_T) = μ_T ∘ μ_L[T]
```

There are no existing descendants at a leaf substitution site to reconcile.
This is not the partial union above. Calling both operations "graft" hides
different types, domains and laws; associativity of union does not prove a
substitution theorem for `N`.

The converse blanket claim that branch values destroy every canonical graft
was too strong. For fixed `U`, the datatype
`Leaf(S) ⊎ Branch(U, FinMap[K, Node_U[S]])` still supports leaf substitution
in `S` while retaining branch labels `U`. The accepted homogeneous model raises
its own substitution questions; any proposed operation requires its own
signature and laws. This ADR neither rules out lawful alternatives nor adds a
merge or substitution API to the implementation scope.

## 10. Embeddings, profiles and the native interface

### 10.1 Direct embedding of the old trees

```text
E : L[T] → N[T]
E(Leaf(t))   = Node(Some(t), {})
E(Struct(m)) = Node(None, {k ↦ E(m[k])})

D_E(n) = D_n
v_E(n) = v_n
E(at(n,p)) ≡ at(E(n),p)
n ≡ m iff E(n) ≡ E(m)
E(map(f,n)) ≡ map(f,E(n))
```

Its inverse is defined exactly on the subset of `N` with terminal valued
positions. That image is not closed under universal attachment: adding a child
under an embedded valued leaf leaves it. Abstract embedding says nothing by
itself about preserving serialized bytes or content addresses.

### 10.2 A lossless profile in the other direction

Choose distinct fixed profile keys `c` and `v`. They are illustrative keys, not
new reserved core names or a ratified profile. Encode each logical node as:

```text
P : N[T] → L[T]

P(Node(None,m)) =
  Struct({c ↦ Struct({k ↦ P(m[k])})})

P(Node(Some(t),m)) =
  Struct({v ↦ Leaf(t), c ↦ Struct({k ↦ P(m[k])})})
```

A recognizer `R : L[T] ⇀ N[T]` accepts exactly this recursive image: one
required `c` field holding a struct, an optional `v` field holding a leaf, no
extra outer fields, and recursively accepted children. It refuses other shapes
without repairing them. Then:

```text
R(P(n)) ≡ n
P(R(l)) ≡ l                         whenever R accepts l
n ≡ m iff P(n) ≡ P(m)
```

Every application child key, including bytes equal to `c` or `v`, remains
available inside the child container. The encoding therefore does not consume
application key space. Parent values are reachable as raw leaves and can be
included by a suitable structural codec; they are not inherently unaddressable
or unhashable.

Define the path translation:

```text
φ(ε) = ε
φ(p ++ [k]) = φ(p) ++ [c,k]

P(at(n,p)) ≡ at(P(n),φ(p))
```

At logical node `p`, its optional value occupies the raw leaf at
`φ(p) ++ [v]`. A logical accessor must distinguish a missing node from an
existing node with no `v` field. Logical attachment extends the raw child map
at `φ(p) ++ [c]`:

```text
attachProfile(P(A),p,k,P(B)) ≡ P(attach_N(A,p,k,B))
```

Reconstruction, mapping, attachment and compatible union can all be transported
through this profile. Compatible `N` overlay even corresponds to raw `L` union
on the image: value leaves and child containers occupy separate fields, so
value/descendant collisions do not arise there. These are operation laws to
establish, not automatic consequences of claiming a serialization round trip.

Thus `N[T]` is isomorphic to `image(P)` as represented values, and as a logical
tree interface when using the translated operations. `E` and `P` are different
embeddings, not inverse maps; generally `P(E(l))` differs from `l`.

### 10.3 Why the models remain meaningfully different

For inhabited `T`, no isomorphism of the full models can preserve unchanged
native paths and own values: a valued parent with a child in `N` would need
those same observations in `L`, which forbids them. This is a claim about the
required interface, not about arbitrary bijections between underlying sets.

The explicit profile above maps `n` logical nodes with `a` assigned values to
`2n + a` raw nodes: one wrapper and one child container per node, plus one leaf
per assigned value. Raw paths to logical nodes have twice the segment count;
own-value paths add one more segment. Raw operations expose representation
fields and may leave the profile image. Physical implementations may optimize
this layout, but recognition and logical access remain part of the agreement.

The decision chooses `N` for the standard interface. An implementation may
still use a lawful encoded layout internally. Profiles continue to express
domain-specific key and payload conventions.

### 10.4 Relationship to ADR 0004

[ADR 0004](0004-structure-slot.md) refuses a generic branching-container
parameter `C` and instead uses a single finite byte-keyed map with named,
versioned structure profiles. This decision retains that choice. It changes
which combinations of own values and descendants are admissible within that
one hierarchy; it does not introduce a family of branching containers.

The earlier discussion applied 0004's nonembeddability reopening criterion too
broadly. A lossless profile can exist while a different standard interface is
desired for its structural operations. The accepted universal native extension
requirement is such a reason. The profile transport and exact-recognition laws
remain useful; representability alone does not decide the public model.

## 11. What composition promises to interpretations

The common structural contract lets a consumer expose a subtree, assemble it
under named positions, reconstruct complete cuts and translate between
conforming representations without each consumer inventing a different tree
law. This enables reusable adapters, routing, structural tooling and evidence
about components. Behavioral interchangeability needs additional, explicit
interpretation obligations; it cannot follow from the shape of `Node[T]`.

Distinguish three relations:

- **Structural identity:** same paths, value presence and equivalent own values.
- **Own-value preservation:** a particular opaque value remains at its position.
- **Observational equivalence:** a declared consumer cannot distinguish behaviors
  through its allowed observations.

For interpretation `Q`, let `B_Q` be its behavior carrier, `Γ_Q` its binding
contexts, and `I_Q : N[T] × Γ_Q → B_Q` on its declared admissible domain.
Where position affects interpretation, declare a context action:

```text
γ · ε = γ
(γ · p) · q = γ · (p ++ q)

Comp_Q : Γ_Q × Option[T] × FinMap[K,B_Q] → B_Q

(H) I_Q(compose_N((o,m)),γ)
      ≈_Q Comp_Q(γ,o,{k ↦ I_Q(m[k],γ·[k])})
```

Context-independent interpretations may use the trivial action. Partial
interpretations must state their admitted domains and matching definedness.
The parent payload is explicitly an input to `Comp_Q`; its meaning remains
the consumer's responsibility. For `L`, the corresponding signature has
separate leaf interpretation and child-only struct composition.

Binding context is an argument. Observing contexts are instead quantified by
the promised equivalence, for example:

```text
b ≈_Q b' iff
  ∀ allowed observing contexts O:
    Obs_Q(O[b]) = Obs_Q(O[b'])
```

Both roles may be needed. Neither is supplied simply by mentioning "context."
The accompanying obligations are:

```text
(G) b ≈_Q b' ⇒ C[b] ≈_Q C[b']
    for admitted assembly contexts C

(A) At_Q(I_Q(n,γ),p) ≈_Q I_Q(at(n,p),γ·p)
    for interpretations claiming corresponding selection

(V) I_Q,r(n,γ) ≈_Q I_Q,s(n,γ)
    for admitted realizations r,s of the same logical tree
```

`At_Q` is the interpretation's partial selection operation. Realizations may
use different complete cuts, internal groupings or conforming relays while
preserving the logical hierarchy. They must match the promised binding
context, state, aliases, environment and capabilities.

Homomorphism `(H)` and contextual congruence `(G)` are different assertions.
Failure of `(H)` does not imply failure of `(G)`. If `≈_Q` is full contextual
equivalence and the observing contexts are closed under assembly, `(G)` follows
from that definition. For a weaker relation it requires a separate argument.
Similarly, structural reconstruction does not prove `(H)`, `(A)` or `(V)` for
a particular implementation.

One might additionally ask for preservation of some old observations after
extension:

```text
Obs_old(I_Q(attach(A,p,k,B),γ)) = Obs_old(I_Q(A,γ))
```

This needs an explicit scope and a consumer proof. Listing, printing or
aggregating children legitimately changes when a child is added, even though
all old own values survive unchanged. No unrestricted behavioral invariance
under growth is accepted here.

## 12. Lossless printing, codecs and inverse operations

A structural codec in either model can provide, with an appropriate slot codec:

```text
encode : M[T] → Bytes
decode : Bytes ⇀ M[T]

decode(encode(n)) ≡ n
encode(decode(b)) = b                   whenever decode accepts b
```

Canonical encoding additionally assigns identical bytes to equal trees. It
must retain option presence, keys, empty structure and payload distinctions
within the declared identity. An arbitrary opaque `T` does not automatically
have such a codec. Adding own values to branches does not itself make them
unhashable: a defined complete encoding can include them.

Source printing makes another claim. For grammar/context `g`, admitted source
bytes `B_g` and admitted trees `V_g`, write:

```text
Parse_g : B_g → V_g
Print_g : V_g → B_g

Print_g(Parse_g(b)) = b                  for b ∈ B_g
Parse_g(Print_g(t)) ≡ t                 for t ∈ V_g
```

Ordinary concatenating print functions can discard grouping, key names,
metadata or source trivia. Two trees may print the same bytes in either model.
The one-layer structural inverse therefore does not establish an inverse to
ordinary printing. Source order and every required byte distinction must be
retained and respected by the parser/printer pair.

If `V_g` is exactly the parser's image, the second equation follows from the
first. A larger edited-tree domain needs a further reparse-stability condition
or explicit refusal outside the admitted domain. Both the grammar and the
observation boundary belong to the consumer.

For any claimed inverse `g(f(n)) ≡ n`, `f` must be injective on the claimed
domain modulo the declared identities. Structural contexts make it possible to
retain surrounding information while replacing and reconstructing a subtree;
they do not recover information discarded by `f`. Editing history, undo
receipts and reversal of external effects remain consumer concerns. This is
why the earlier proposal for a general inverse/undo interface was removed from
deixis's scope.

## 13. Comparison and decision consequences

| Property | Leaf/struct model `L` | Accepted optional-value model `N` |
| --- | --- | --- |
| Relative navigation, structural identity and payload mapping | Supported | Supported |
| Exact complete compose/decompose | Tagged leaf or child-map parts | Optional own value and child map |
| Child-only reconstruction | Structs | Nodes with own value `None` |
| Value implies terminality | Enforced | Not enforced |
| Exact fresh-child attachment | At structs | At every existing node |
| Compatible overlay | Requires value agreement and terminality of the union | Requires value agreement |
| Total assembly under distinct keys | Supported | Supported |
| Incompatible same-path payloads | Needs an extra slot contract | Needs an extra slot contract |
| Lossless structural coding | Requires a suitable slot codec | Requires a suitable slot codec |
| Behavioral composition and realization invariance | Consumer obligations | Consumer obligations |
| Generic inverse to lossy edits | Not supplied | Not supplied |

`L` remains useful when values are intended to be terminal. Its structs need no
own-value component, and total leaf substitution has no pre-existing children
at a substitution site. `N` preserves those forms as a subset while allowing
values and descendants to coexist, requiring no fabricated default values and
supporting a larger domain of compatible overlay.

The costs of `N` are an explicit option in node/parts interfaces, retention of
ancestor values in contexts, a model migration across languages and profiles,
and review of all affected codec and identity claims. A domain that needs a
terminality rule must express and validate it. The abstract product does not
mandate an empty-map allocation at every leaf or another particular layout.

Some laws are consequences rather than independent choices: recursive selection
gives the path action; complete parts give one-layer round trips; recursive
reconstruction gives complete cuts; exact attachment gives containment,
restriction recovery and commuting independent additions; admissible union
gives the partial-join laws. The decisive choice is permitting valued positions
with descendants and making exact extension available through the standard
hierarchical interface.

The arguments in this ADR are definitions and proof sketches. They are not a
substitute for the revised paper's proofs, independent expectations or tested
conformance evidence.

## 14. Migration, evidence and consumer work

The accepted design and delivered implementation must remain distinguishable.
[Issue #1](https://github.com/Bitspark/deixis/issues/1) is the delivery checklist
and remains open until its structural implementation work is verified.

### deixis

1. Align [TREE.md](../TREE.md), [PATH.md](../PATH.md),
   [SLOTS.md](../SLOTS.md), [WIRES.md](../WIRES.md), the README and relevant
   decisions with the new node/parts model. Replace superseded terminality and
   general child-only reconstruction claims without losing the old-model
   comparison.
2. Update the [paper](../paper/deixis.tex), structural proofs and
   [evidence ledger](../EVIDENCE.md). Review substitution claims separately from
   partial union. The old constructor-disjointness and induction assumptions
   in [0008](0008-proof-obligations.md) require revision, not a silent carryover.
3. Review positional/set profiles, exact recognition and the old-tree embedding.
   Preserve each declared identity or record an explicit migration. Admitting a
   new core shape does not automatically extend a profile's accepted image.
4. Decide codec grammar, version/domain separation, content-address
   compatibility and publication consequences. Abstract preservation of old
   trees is not byte preservation. This decision selects no new tag, magic
   string, package version or release, and does not freeze the codec.
5. Author independent structural expectations before implementations: own value
   with children; unvalued nodes; `None` versus `Some(empty)`; absent nodes;
   opaque and empty keys; nested paths; full one-layer and cut round trips;
   ancestor values; empty subtrees; root/deep valued-parent attachment;
   old-tree embedding; independent additions; and a coarse supplied equality.
6. Include negative controls for dropped or relocated parent values, missing,
   renamed or extra children, refusal at a valued parent, occupied-key
   overwrite, accidental payload interpretation and unrelated changes during
   attachment. Expected judgments come from the specification, not generated
   implementation output.
7. Update Rust, Go, TypeScript and Python cores, conformance CLIs, fixture
   spelling and the [black-box harness](../../tools/conformance/README.md).
   Record tested revisions, actual coverage, unsupported requirements and the
   codec disposition. Indexed-only cases are not passing executions.
8. Deliver API/migration guidance, link implementation PRs and update evidence
   before closing the issue. Consumer adoption remains separately tracked.

Codec work follows [0006](0006-canonical-codec.md),
[0008](0008-proof-obligations.md),
freeze readiness and the
[vector process](../../vectors/README.md), including independent review and
clean-room corpus-distribution requirements. Historical vector judgments change
only through the established explicit migration/erratum process. Model
acceptance does not bypass those requirements.

### bitwire and nightseam

[bitwire #29](https://github.com/Bitspark/bitwire/issues/29) owns the concrete
sending/routing interpretation, typed reconstruction description and observable
invariance claims. It must state the relevant destination/path/message meaning,
origin behavior, refusal, replies/events/lifecycle, return capabilities,
captured targets, ordering, authority and ownership/lifetime assumptions within
the scope its contract promises. Evidence must reach the actual public driver.
nightseam owns runtime and carrier implementation and evidence.

An own value of `None` does not itself imply refusal at a composite origin;
refusal is a declared Wire interpretation rule. Structural recomposition does
not grant permission to clone/reset state, retarget admitted work or acquire
ownership of borrowed endpoints. Binding a subtree to an origin and navigating
a relative path must commute under the declared context action.

### bittree

bittree owns its metadata/payload mapping, ordered children, repeated-field key
discipline, lazy/deferred observations and parse/print domains. A field name
repeated among siblings needs a declared position/key representation. Metadata
such as kind and name may be its own payload information; deixis does not
interpret it.

bittree is related access
work, not proof of deixis adoption. A Wire route selecting an operation is not
automatically a path selecting a bittree data subtree; a tree path carried in a
request is a different interface. Each mapping and its observation laws need
their own declaration and evidence.

## 15. Discussion history and corrected claims

The record below preserves the reasoning sequence. Earlier comments are
historical proposals, not additional accepted requirements where they conflict
with this decision.

| Discussion | Contribution and disposition |
| --- | --- |
| Initial review, 2026-09-22 | Separated retained parent information from a composition rule; identified binding context and the missing converse context law. Proposed retaining parent values through profiles and keeping the old core. The latter recommendation was superseded. |
| Conservative extension, 2026-09-22 | Formalized exact insertion and availability, initially with a total value map. Allowed an implementation of the logical interface through a profile; did not yet require native core adoption. |
| Model correction, 2026-09-22 | Withdrew the leaf-only recommendation, proposed optional own values, and identified terminality as the obstacle to native growth. Its weaker containment-only insertion law needed the exact-result equations. |
| Model/merge comparison, 2026-09-22 | Separated assembly, overlay and substitution; made the reconstruction parts explicit; distinguished a sum carrier from collision resolution and reconstruction from undo. |
| Consolidated analysis, 2026-09-22 | Generalized to partial values, compared common and distinguishing laws, supplied profile/path translation and separated structural, codec and interpretation obligations. |
| Acceptance, 2026-09-23 | Recorded the user's decision, exact node/parts types and implementation checklist. Issue remains open for delivery. |

Several corrections are material to future readers:

- A head is not inherently unaddressable or unhashable. An addressed node can
  expose its own payload; a complete encoding can include it. A profile can
  also place it at a translated raw address.
- A lossless profile is possible and need not consume application child keys.
  Its existence does not make the unchanged native interfaces identical.
- Nonterminal values do not rule out every lawful substitution algebra. Partial
  overlay and old leaf substitution nevertheless have different contracts.
- Failure of a particular interpretation homomorphism does not entail failure
  of contextual congruence.
- The statement "semantic equality implies encoded equality" has contrapositive
  "encoded inequality implies semantic inequality." The reverse reflection
  direction needs the full identity-transport equivalence, not that
  one-directional statement alone.
- Exact structural reconstruction neither reconstructs an omitted parent value
  nor establishes lossless source printing, behavioral invariance under growth
  or a generic inverse to information-losing edits.

These corrections explain the accepted model without replacing one overly
broad impossibility claim with another. The decision preserves a single shared
hierarchy, makes own values independent of descendants, and leaves every
consumer's semantic commitments explicit.
