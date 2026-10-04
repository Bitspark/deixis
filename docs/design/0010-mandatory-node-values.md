# Mandatory node values; optionality belongs to the slot

**Status:** accepted, 2026-09-23, following the user's decision: "Let's use
mandatory T." Supersedes [ADR 0009](0009-optional-node-values.md)'s choice of
core-owned optional values. The exploration in that record remains historical
background. [Issue #1](https://github.com/Bitspark/deixis/issues/1) tracks delivery.

**Delivery at this decision:** specification and decision changed; core/API,
profile, proof and conformance migration remains pending. The implementation
that landed before publication implements ADR 0009's
optional-value model. Its passing checks are evidence for that model, not for
the mandatory-value API accepted here. Codec grammar/version choices remain open.

**Implementation update, 2026-09-23:** all four core APIs now take and return
the complete `T`; comparison delegates that complete payload to the caller.
The set profile explicitly instantiates `Node[Option[T]]`. The shared harness
executes 368 requests per language, including all 121 independently authored
`mnode-*.json` cases. Native tests also exercise direct callable payloads and
full-payload equality. [API.md](../API.md) documents the interfaces;
[EVIDENCE.md](../EVIDENCE.md) separates current checks and paper v4's mandatory
structural proofs from outstanding codec and consumer work. The decision-baseline description above is
historical.

**Release update:** [v0.2.0](../releases/v0.2.0.md) supplies the four bindings,
profile migration and migration guidance. Paper v4 includes explicitly typed
parts, contexts and cuts, total-value mapping, exact attachment and the partial
overlay proof. Its abstract encoder and mathematical ontos projection do not
constitute codec publication or consumer adoption.

## 1. Decision and reason

```text
Key = Bytes
Path = Key*                              empty path ε; concatenation ++

Node[T] = Node(T, FinMap[Key, Node[T]])
```

Every existing node carries exactly one opaque `T` and a finite map of named
children. Having children does not replace, relocate or interpret its value.
The public generic model does not add an `Option` layer or impose a default
value. Missing nodes are a navigation result, not a special value of `T`.

Consumers can instantiate the same core with:

```text
Node[Handler]           a handler at every node
Node[Metadata]          metadata at every node
Node[Option[Metadata]]  explicitly optional metadata
Node[Unit]             pure keyed shape
```

`Node[Void]` is uninhabited: a nonempty tree would need a root value of the
empty carrier. This is not rejection of the carrier. `Node[Unit]`, or
`Node[Option[Void]]`, supplies pure shape without inventing an inhabitant of an
arbitrary `T`.

The choice is which layer owns the absence convention. deixis owns the keyed
hierarchy and its laws. The slot supplies values; a slot may itself include an
absence alternative. This makes "a `T` at every position" the generic type's
guarantee and leaves the interpretation of `T` with its supplier.

The earlier `T | (T & { Segment: Node[T] })` discussion already required `T` at
every node. ADR 0009 introduced core optionality to admit purely structural
branches at the same slot. That convenience is a tradeoff, not a requirement
of navigation, exact reconstruction or conservative child attachment.

The revised disposition in [issue #1](https://github.com/Bitspark/deixis/issues/1)
does not require backward compatibility. Earlier APIs, fixture layouts, bytes
and addresses do not constrain the chosen model. Historical embeddings below
explain the relationship; they are not a requirement to retain old interfaces
or encodings. Published history and past evidence are not retroactively rewritten.

## 2. Relationship to the optional-value alternative and its proposal

Use distinct names when comparing the models:

```text
M[T] = Node(T, FinMap[Key, M[T]])
O[T] = Node(Option[T], FinMap[Key, O[T]])

O[T] ≅ M[Option[T]]
```

`M` is the accepted `Node` of this decision. For a fixed `T`, `M[T]` embeds in
`O[T]` by wrapping each value in `Some`. Across slots, `O[T]` is exactly the
optional instantiation of `M`. Neither representational generality nor the
claim that mandatory values force arbitrary default values decides between
them. A caller can choose `Option[T]` explicitly.

The pull request proposing that alternative correctly identified this
weakness in ADR 0009's original rationale. This decision retains that correction
and chooses the mandatory model. Two stronger arguments in that PR need scope:

- Mandatory nodes already have an information-preserving containment order and
  compatible partial union using only the supplied equality (section 5).
  Optional semantics additionally offer an absence-sensitive order in which
  `None` may gain a value. That order belongs to the optional interpretation;
  an arbitrary opaque carrier's equivalence alone does not identify a bottom.
- Reusing a slot `T` can simplify codec compatibility, but datatype choice alone
  neither guarantees nor prevents preserving old bytes. Serializing
  `Option[T]` with a new codec identifier changes the encoded domain and address
  commitments. A specialized compatibility encoding can instead transport an
  encoding across `O[T] ≅ M[Option[T]]`. Such an encoding must declare its option
  awareness and obey the existing version policy; it is not a property supplied
  by a generic opaque-slot codec. No compatibility outcome is decided here.

There is one hierarchy, not separate mandatory and optional core implementations.
Optional helpers may use `Node[Option[T]]` without installing a hidden option
around every `T` or changing the meaning of the generic operations.

## 3. Identity and complete reconstruction

Trees are finite, nonempty and well-founded. Keys are exact bytes, unique among
siblings. Empty key and empty path differ; ordering a domain's children needs
its declared key discipline. These are value/snapshot laws, not storage or
mutation requirements.

```text
D_n ⊆ Path                  finite, nonempty, prefix-closed paths
v_n : D_n → T               TOTAL assignment on existing paths

n ≡ m iff D_n = D_m and ∀p ∈ D_n: v_n(p) ≈ v_m(p)
```

Construction and navigation need only a carrier. Structural identity uses the
supplied slot equivalence `≈`; decidable comparison and encoding are additional
capabilities. A tree held inside `T` remains opaque and is not traversed.

The complete one-layer inverse pair is:

```text
decompose : Node[T] → T × FinMap[Key, Node[T]]
compose   : (T × FinMap[Key, Node[T]]) → Node[T]

decompose(Node(t,m)) = (t,m)
compose((t,m))       = Node(t,m)

∀n : Node[T]:
  compose(decompose(n)) ≡ n

∀t : T, m : FinMap[Key, Node[T]]:
  decompose(compose((t,m))) ≡ (t,m)
```

The map contains every immediate child under its exact key, as a whole subtree.
Parts equality uses slot equality, equal key domains and recursive tree equality.
The own value is retained, not inferred from children. A childless node still
has a `T` and decomposes to `(t,{})`.

**New-parent composition needs a parent value.** A generic core cannot choose
that value from the children or construct a grouping root for arbitrary `T`
without a supplied `T`. A consumer supplies or derives its parent behavior;
an optional instantiation can choose `None`, and a unit instantiation can choose
`()`. This is the explicit cost of the decision.

## 4. Navigation, mapping and contexts

```text
own     : Node[T] → T
at      : Node[T] × Path ⇀ Node[T]
valueAt : Node[T] × Path ⇀ T

own(Node(t,m)) = t
at(n,ε) ≡ n
at(at(n,p),q) ≡ at(n,p ++ q)
at(Node(t,m),[k]) ≡ m[k]                 exactly when k ∈ dom(m)
valueAt(n,p) = own(at(n,p))
```

Partial equations require equal definedness. Missing paths refuse; no default
value or node is created. A lookup wrapper such as `Result[T,MissingPath]` or
`Option[T]` at the API boundary describes navigation failure, not optional
storage. It must distinguish a missing path from every legal payload, including
`None`, `null` or `undefined` when the chosen `T` admits one.

```text
map : (T → U) × Node[T] → Node[U]
map(f,Node(t,m)) = Node(f(t), {k ↦ map(f,m[k])})

map(id,n) ≡ n
map(g,map(f,n)) ≡ map(g ∘ f,n)
at(map(f,n),p) ≡ map(f,at(n,p))
D_map(f,n) = D_n
```

Mapping visits the own value of **every** node, even a payload an instantiation
interprets as absence. For `T = Option[A]`, generic mapping may transform `None`.
The familiar presence-preserving mapping is the explicit specialization
`map(Option.map(f),n)`. Equality transport requires equality-respecting functions;
the core itself does not interpret payloads.

For a fixed path `p`, `Context_T(p)` retains the ancestor values, keys and
sibling subtrees around exactly one hole at `p`:

```text
split_p : Node[T] ⇀ Context_T(p) × Node[T]
plug_p  : (Context_T(p) × Node[T]) → Node[T]

plug_p(split_p(n)) ≡ n                  when p ∈ D_n
split_p(plug_p((C,s))) ≡ (C,s)

at(n[p := s],p) ≡ s
n[p := at(n,p)] ≡ n
n[p := s][p := u] ≡ n[p := u]
s ≡ u ⇒ n[p := s] ≡ n[p := u]
```

For finite prefix-free `F ⊆ D_n`, let `Skeleton_T(F)` retain everything outside
the holes and `Subtrees_T(F)` be maps with domain exactly `F` into `Node[T]`:

```text
cut_F     : Node[T] ⇀ Skeleton_T(F) × Subtrees_T(F)
rebuild_F : (Skeleton_T(F) × Subtrees_T(F)) → Node[T]

cut_F(n) = (skeleton_F(n), {p ↦ at(n,p) | p ∈ F})
rebuild_F(cut_F(n)) ≡ n
cut_F(rebuild_F((C,m))) ≡ (C,m)
```

Every own value, key and childless node survives in a subtree or the skeleton.
These laws retain the complete-cut reasoning of ADR 0009. They do not equate
changed addresses or arbitrary reparenting, or mandate public editing APIs.

## 5. Containment, attachment and overlay

Generic containment at a common root is:

```text
A ⊑ B iff D_A ⊆ D_B and ∀p ∈ D_A: v_A(p) ≈ v_B(p)
```

It is a partial order modulo structural equality. It needs no slot order beyond
the supplied equivalence. Rooted containment is `A ⊑ at(B,r)` where `r` exists;
selection is monotone. It preserves every old value, including an explicitly
stored `None` in an optional instantiation.

Exact fresh attachment retains its availability and locality laws:

```text
attach : Node[T] × Path × Key × Node[T] ⇀ Node[T]

C = attach(A,p,k,B), r = p ++ [k]
Domain, exactly: p ∈ D_A and r ∉ D_A

D_C = D_A ∪ {r ++ q | q ∈ D_B}
v_C = v_A ∪ {r ++ q ↦ v_B(q) | q ∈ D_B}

decompose(at(A,p)) = (t,m)
attach(A,p,k,B) ≡ A[p := compose((t, m ∪ {k ↦ B}))]
```

The new domain is disjoint from the old domain, so attachment needs no payload
comparison. Missing parents and occupied child keys refuse. Every node admits
a fresh child; its value does not need promotion, replacement or a new wrapper.

```text
A ⊑ C
at(C,r) ≡ B
restrict(C,D_A) ≡ A
valueAt(C,p) ≡ valueAt(A,p)
at(A,p) ⊑ at(C,p)
```

Distinct fresh-key additions at the same parent commute. Equality of the whole
selected subtree is not preserved after growth. These consequences follow from
the exact domains and assignments, as in ADR 0009.

Same-path overlay is the compatible partial union:

```text
compatible(A,B) iff ∀p ∈ D_A ∩ D_B: v_A(p) ≈ v_B(p)

D_(A ⊔ B) = D_A ∪ D_B
v_(A ⊔ B) = v_A ∪ v_B                  modulo ≈
```

It is the least upper bound when defined, and is commutative, idempotent and
associative with equal definedness. Exact executable conflict refusal needs
usable comparison. **There is no generic global empty-root identity for
arbitrary `T`.** A root-only `Node(t,{})` is neutral for trees whose root value
is equivalent to `t`, not for all roots. ADR 0009's unvalued-root identity and
absence-filling order do not transfer to opaque mandatory values.

For `Node[Option[T]]`, an interpretation can define the separate order
`None ≤ Some(t)` with `Some(t) ≤ Some(u)` iff `t ≈ u`, and lift that to trees.
It can thereby recover ADR 0009's optional overlay. Under generic containment
with tag-respecting option equality, however, `None` and `Some(t)` differ and
cannot be silently substituted. State which order an operation uses.

For heterogeneous named assembly, choose a common carrier `C`, maps `A → C`
and `B → C`, and a parent value `c : C`. The children can then be assembled
under distinct keys as `Node[C]`. Taking `C = A ⊎ B` still requires a root
value in that sum; taking `C = Option[A ⊎ B]` permits `None` at the root.
A tagged sum never by itself resolves incompatible overlapping payloads.

Overlay still loses operand provenance. For any supplied `t : T`, put
`e_t = Node(t,{})` and `s_t = Node(t,{k ↦ e_t})`. Then
`e_t ⊔ s_t ≡ s_t ⊔ e_t ≡ s_t ⊔ s_t ≡ s_t`. Exact reconstruction is an inverse
on explicit parts, not an inverse to arbitrary merging. Substitution, history
and operational undo remain separate contracts.

## 6. Historical embeddings and profile migration

The original model is:

```text
L[T] = Leaf(T) ⊎ Struct(FinMap[Key,L[T]])

E : L[T] → Node[Option[T]]
E(Leaf(t))   = Node(Some(t), {})
E(Struct(m)) = Node(None, {k ↦ E(m[k])})
```

This retains native paths and original leaf values through a tagged optional
carrier. With the usual tag-respecting option equivalence it transports
identity exactly. Its image has `Some` only at terminal positions. Mapping
transports as `E(map_L(f,n)) ≡ map(Option.map(f),E(n))`. There is no promised
slot-generic embedding of unvalued branches directly into `Node[T]` for an
arbitrary unchanged `T`.

ADR 0009's full optional trees correspond to `Node[Option[T]]` without that
terminality restriction. Its profile encoding into `L`, path translation,
reconstruction arguments and costs remain background for this explicit
instantiation. Do not conflate its optional-presence observation with the
generic core's mandatory value observation.

The positional key spelling is unchanged. The existing set profile's unvalued
container and valued members can be expressed with an explicit carrier,
naturally `Option[T]`, and an exact image/recognizer declaration. Its migration
must state its chosen carrier and judgments; do not silently treat an arbitrary
root value as an empty set marker or impose old API compatibility by implication.
No second container parameter or new key interpretation is introduced.

## 7. Interpretation laws and consumer boundaries

For a declared interpretation, with behavior carrier `B_Q` and binding contexts
`Γ_Q`, the reconstruction inputs change to mandatory `T`:

```text
I_Q    : Node[T] × Γ_Q → B_Q
Comp_Q : Γ_Q × T × FinMap[Key,B_Q] → B_Q

γ·ε = γ
(γ·p)·q = γ·(p ++ q)

I_Q(compose((t,m)),γ)
  ≈_Q Comp_Q(γ,t,{k ↦ I_Q(m[k],γ·[k])})

At_Q(I_Q(n,γ),p) ≈_Q I_Q(at(n,p),γ·p)
```

Domains and equal definedness are declared where interpretations are partial.
The congruence and realization-invariance obligations in ADR 0009 remain:
equivalent components stay equivalent in admitted assembly contexts, and
admitted realizations of the same logical tree preserve the promised
observations with matching context, state, aliases and capabilities. Binding
context and quantified observing contexts retain their different roles.

Structural value preservation is not behavioral invariance under growth.
Listing or aggregating children may change. Complete structural codecs still
need a slot codec; source printing still needs a declared parser/printer domain.
The typed round trips do not make lossy printing, merging or effects reversible.

For Wire, a mandatory handler or origin behavior can refuse a send. Refusal is
a behavior, not a missing `T`. A mount's declared refusal at the empty path can
supply its root behavior explicitly. [bitwire #29](https://github.com/Bitspark/bitwire/issues/29)
owns that interpretation and evidence, without adding enumeration to send-only
access or transferring ownership of borrowed children. nightseam owns runtime
and carrier implementation.

For bittree, a mandatory metadata carrier makes metadata available at every
node by construction. Optional metadata is a different explicit instantiation.
Ordering, repeated field keys, parsing/printing and domain edits remain its
responsibility. A Wire operation route is still not automatically a bittree
data path. None of these consumers is certified as conforming by this decision.

## 8. Delivery and evidence requirements

This decision/specification change precedes implementation. At baseline
[`b44a97a`](https://github.com/Bitspark/deixis/tree/b44a97a), the four cores,
conformance CLIs and `node-*.json` replay implement the optional model from
ADR 0009. Those checks and historical vector judgments remain valid evidence
for their declared subject. They do not demonstrate mandatory core values.

The delivery sequence in [issue #1](https://github.com/Bitspark/deixis/issues/1) is:

1. Record this superseding decision and align the accepted TREE/PATH/SLOTS/WIRES
   contract, status notices and dependent issue descriptions.
2. Revise the paper/proof program for `T × FinMap`, total value assignments,
   mapping at every position, exact parts, contexts, conservative attachment,
   conditional overlay and the `L[T] → Node[Option[T]]` embedding. Preserve the
   historical proofs' scope; a proof for the optional model needs explicit
   transport or revision before it is cited for the generic mandatory model.
3. Independently author expectations distinguishing the mandatory API from an
   automatic option wrapper: a supplied opaque value at every node; no default
   parent; legal null-like payload versus a missing path; callback/comparison
   handling at every node; complete parts; contexts; attachment; coarse slot
   equality; explicit optional and unit instantiations; and heterogeneous
   assembly with a supplied parent. Expected results must precede implementation
   and must not be copied from its outputs. Existing `node-*.json` expectations
   remain historical; declare their optional interpretation explicitly.
4. Migrate all four core interfaces consistently: construction and decomposition
   take/return `T`, own-value access returns `T`, and navigation failure remains
   independently represented. Adapt profiles and conformance adapters with
   explicitly chosen payload types, without requiring old API compatibility.
   Retaining the former option wrapper as a private layout is acceptable only
   if it exposes the mandatory public contract and cannot leak an unvalued node.
5. Rebuild and run the language checks and black-box harness. Record revisions,
   actual generic coverage and profile coverage separately. A green run against
   only optional fixtures cannot complete this migration. No public method is
   required for every mathematical derived operation in this record.
6. Resolve codec grammar, identifier/version, old-image compatibility and
   publication consequences through [0006](0006-canonical-codec.md),
   [0008](0008-proof-obligations.md) and the existing freeze process. Keep
   independent review and clean-room distribution requirements. Do not rewrite
   historical vector judgments or frozen identities without their explicit
   migration/erratum process when describing historical evidence; earlier
   layouts are not constraints on the new implementation or encoding.
7. Publish migration guidance and update the evidence/adoption ledger before
   closing [issue #1](https://github.com/Bitspark/deixis/issues/1). Core implementation, codec delivery and consumer adoption
   remain distinct status claims.

This record changes no runtime semantics, package version or codec byte grammar.
It supplies the accepted target and the consequences needed to implement it.
