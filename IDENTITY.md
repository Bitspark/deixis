# deixis's identity

**What deixis is, the contracts that make it that, and the only way they change.** This page is
about deixis as a whole. It is not [docs/IDENTITY-SURFACE.md](docs/IDENTITY-SURFACE.md), which
lists the parts of the codec that decide octets and content addresses.

**Status:** the structural contract and the derived constructions are **accepted** by
[ADR 0015](docs/design/0015-deixis-identity.md), after an openly framed expert consultation
(research 0006). The family policy is **proposed** there, and adopted by its own record with
every affected component's acceptance. An entry here changes only through
[a supersession record](#how-a-contract-changes). Consumers cannot amend a depended-on contract
by implication. This page does not freeze the codec: `deixis-codec-v2` stays a candidate on its
own freeze track ([CODEC.md](docs/CODEC.md), [issue #1](https://github.com/Bitspark/deixis/issues/1)).

## What deixis is

**deixis is the structure of pointing:** a finite tree whose keys are exact byte strings,
`Node(T) = T × (Bytes ⇀fin Node(T))`, and selection, by which a path reaches a position in it.
An operation reaches the value held there by selecting first, and nothing else is added.

deixis selects. It never routes, invokes, binds, stores, connects or keeps time. Capabilities,
binding, transport, mutable state and services are built above it, and they respect its
contracts.

The test for anything proposed here is the one deixis's vision document calls the second-party
criterion: *would this survive the first consumer never existing?* If a deixis contract changes
because a consumer changed, and nothing records that the contract was superseded, the
dependency points the wrong way.

## How to read this page

The page has three parts, governed separately, because they have different owners
([ADR 0015](docs/design/0015-deixis-identity.md) §1):

| part | entries | changed by |
| --- | --- | --- |
| **Structural contract** | ID1 to ID8 | deixis's agents |
| **Derived constructions** | ID9 to ID11 | deixis's agents, for the structural argument; the implementing libraries own their effectful helpers |
| **Family policy** | ID12, ID13 | the agents of every affected component, together |

Each entry has a stable identifier, a **statement** (the quoted block), the reason for it, what
would falsify it, and four attributes:
- **Contract status:** proposed, accepted, deprecated, superseded or retired;
- **Authority:** who may change it, and the decisions it rests on (*provenance*), quoted
  verbatim;
- **Evidence:** proof, derivation and assumptions. The *paper* is
  [docs/paper/deixis.tex](docs/paper/deixis.tex), cited by label;
- **Coverage:** vector families, batteries and cores that check it.

A law can be accepted before anything checks it. A passing battery does not decide who may
change a contract. [tools/identity_check.py](tools/identity_check.py) pins each statement
together with its reason and authority, so CI fails when any of them changes outside the change
rule.

Identifiers start at `ID` because `I1` to `I3` and `D1`, `D2` already name other things
([ADR 0008](docs/design/0008-proof-obligations.md)). They are stable: a retired identifier is
never reused. The charter of [ADR 0014](docs/design/0014-structural-identity-and-lifted-access.md),
whose `D1` to `D8` are folded in here, is mapped in ADR 0015 §2a.

## Structural contract

<!-- identity:pin completeness -->
**Completeness criterion.** A tree is determined by a finite, prefix-closed set of paths `P`
containing the empty path, and a valuation `v : P → T`. Every position has one own value.
Selection at `p` exists exactly when `p` is in `P`, and the subtree there holds the suffixes `q`
with `p ++ q` in `P`. ID1 to ID8 are complete in this sense: they determine every structural
observation (positions, exact keys, own slots, complete children, reconstruction and
selection) without consulting what the slots mean. They are minimal in the sense that anything
further is derivable or outside the contract, not in the sense that each law is independent of
the others.
<!-- identity:end -->

### ID1. Shape

> A node has one own value and a finite map from exact byte keys to child nodes. The child
> relation is finite and well-founded. These restrictions do not inspect references or
> structure inside `T`. There are no node kinds: optionality is the slot choice `T = Option[U]`.

**Why.** One constructor keeps every law a single induction and every encoding a single grammar.
A node kind would put a meaning into the structure. The restrictions stop at the slot, so an
opaque value may refer to anything without making the tree cyclic.

**Falsified by:** a parent value invented by default; a node with no own value or two; a
structural child cycle; an infinite structure presented as a tree; a separate leaf kind.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: owner: [ADR 0010](docs/design/0010-mandatory-node-values.md),
  "Let's use mandatory T." (2026-09-23).
- **Evidence:** proved: `def:node`, `stip:structural`.
- **Coverage:** `mnode-invalid`, `mnode-instantiation`.

### ID2. Keys and paths

> Keys have immutable byte-string meaning. Paths are sequences of keys; the empty path differs
> from a one-element path containing the empty key. No text normalization, separator
> interpretation, or sibling order belongs to structural identity.

**Why.** Any built-in reading of a key (an encoding, a separator, a case rule, an order) is a
meaning, and two readers holding the same tree would then disagree about it. Meaning belongs
to whoever reads the key.

**Falsified by:** keys normalized as text; a key containing a separator read as two keys; the
empty path read as an empty-key child; segments joined lossily; sibling order changing
equality; a caller's key buffer mutated after binding that changes what was bound.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: recorded: [ADR 0001](docs/design/0001-keys-are-bytes.md),
  whose status reads "decided" and names no decider.
- **Evidence:** stated: [TREE.md](docs/TREE.md), [PATH.md](docs/PATH.md), and the paper's
  `rem:prefixfree` on why paths do not flatten.
- **Coverage:** `mnode-navigation` (`m-nav-empty-key-path`, `m-nav-non-utf8-key-exact`).

### ID3. Selection

> `at(N, ε) = N`. For `N = (t, c)`, `at(N, k·p) = at(c[k], p)` exactly when `k` is a child key;
> otherwise selection is absent. Concatenation obeys Kleene equality:
> `at(at(N, p), q) ≃ at(N, p ++ q)`. Selection performs no slot operation: it never creates,
> defaults or searches, and never enters an own value, so it never follows a mount. Absence is
> distinct from every own value, including one that fails or refuses.

**Why.** This is the one law every "where" in the family reuses: a key path inside a value, a
cell name, a path across a connection. The one-key recursion ties selection to the child map.
A default or a search would let two paths reach one node with no rule for which wins, and
keeping absence apart from refusal is what lets a caller tell "nothing there" from "something
there said no".

**Falsified by:** a lookup that creates a missing child; a fallback to an ancestor or a default
handler; following a name or a mount inside an own value; absence reported as a refusal, or a
refusal as absence; a cut of the path that changes which node is selected, or whether one is.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md),
  "A missing path is resolved before any payload operation; it must remain distinguishable from
  a present node whose read fails or whose send is refused."
- **Evidence:** proved: `prop:action`. stated: [PATH.md](docs/PATH.md), resolution never enters a
  value.
- **Coverage:** `mnode-navigation`, including `m-nav-json-payload-spelling-a-node-is-not-entered`.

### ID4. Complete parts

> Own value and complete children determine a node, and composition and decomposition are
> inverse structural observations. A parent's own value is an input, never inferred from its
> children. Reconstruction preserves slot handles and their aliasing. Attaching a child at a
> fresh key changes nothing else. An addressed facade is not a complete node.

**Why.** A holder of the parts must be able to rebuild exactly the node, or identity and
encoding drift apart. Structural equality is not language object identity, so reconstruction
keeps the handles it was given. Growth that touches nothing else is what makes a tree
extensible. Addressed access alone cannot be a tree, because send behaviour cannot tell an
absent path from a present participant that refuses.

**Falsified by:** a parent's value rebuilt from its children; an omitted child or interior own
value; an attach that changes an existing value; a changed own handle or a cloned live
participant after reconstruction; an unfetched remote placeholder or an opaque router presented
as a complete node.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md),
  "An addressed-only access facade is not a `WireTree` or `DataTree`: it omits the complete
  structure."
- **Evidence:** proved: `prop:parts`. stated: [TREE.md](docs/TREE.md), § Growth.
- **Coverage:** `mnode-parts`, `mnode-attach`.

### ID5. Slot independence

> Structural operations do not interpret `T`. For total pure functions `f`, `map` preserves shape
> and satisfies identity, composition and selection naturality:
> `at(map f N, p) ≃ map f (at(N, p))`. Effectful traversal has a separate contract.

**Why.** This is what lets one structure carry data, capabilities, names or anything else, and
what makes the structural laws theorems rather than assumptions about `T`. It also means the
structural contract can forbid no `T`: requirements on what a node holds are family policy, not
structure. Purity matters: a logging `f` visits the whole tree under `map f N` but only the
selected subtree under `map f (at(N, p))`.

**Falsified by:** a law that holds only for some `T`; a `map` that rekeys, prunes, resolves or
interprets values; a naturality claim made for an effectful `f`.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract.
- **Evidence:** proved: `prop:functor`, for total pure `f`.
- **Coverage:** `mnode-map`.

### ID6. Supplied identity

> For each declared slot equivalence `R`, tree equivalence is its pointwise lifting over
> identical path domains. deixis chooses no equivalence, and no layer above redefines tree
> equivalence. Structural representation sharing is not part of abstract identity, but must not
> change slot identity or aliasing observable under the slot contract.

**Why.** What makes two values the same is a meaning, so it is supplied with the meaning. The
structural part is to lift it lawfully to whole trees. Sharing is an implementation choice,
except that it must not merge two live values that the slot contract keeps apart.

**Falsified by:** byte equality imposed on a slot whose supplied equivalence identifies different
representations; equality that can observe sharing; two initially equal mutable values merged
by sharing; behavioural equivalence inferred from equal bytes.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract.
- **Evidence:** proved: `thm:equiv`, `thm:congruence`. stated: [SLOTS.md](docs/SLOTS.md),
  [TREE.md](docs/TREE.md).
- **Coverage:** `mnode-identity`.

### ID7. Values, not live resources

> Codec profiles encode declared ground representations. Encoding and decoding do not export,
> invoke or resolve live resources. Content addresses and structural paths remain distinct.

**Why.** A codec that reconstructed live resources would bind behaviour as a side effect of
reading bytes; binding a name to behaviour is a consumer's act under its own authority. A
content address names content and a path names a place, and a record that confused them would
treat a position as an identity. Code descriptions and credential bytes can still be data:
whether bytes confer authority is decided by whatever protocol recognizes them. That a published
byte profile keeps its meaning belongs to the codec's own track ([CODEC.md](docs/CODEC.md)).

**Falsified by:** a decoder that opens a connection, resolves a name or rebuilds a reader; a
content address used as a path, or a path as a content address.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md),
  "Encoding bytes does not serialize a reader, its ambient credentials, or a live sending
  capability."
- **Evidence:** stated: [CODEC.md](docs/CODEC.md), "Values, not behavior". proved: `thm:countable`,
  `prop:gap`, which bound what behaviour can be encoded.
- **Coverage:** the codec families in [vectors/](vectors/).

### ID8. The floor stays empty

> Structural operations assign no application meaning to keys or slots, and perform no
> application I/O, routing, binding, invocation, or explicit resource acquisition or release.
> Language ownership rules specify retention and destruction separately. The floor has no
> names in the binding sense, no time, no reserved keys and no blessed envelope.

**Why.** Each of these is a meaning or an effect, and the floor stays eternal by refusing them.
The design notes of 7 August 2026: "Floor: nothing, ever. No reserved tag keys, no blessed
envelope. A floor tag would leak semantics into identity (identical shapes, different tags →
different nodes) and is a repair magnet (tag vs shape disagreement)", and "insertion order =
**time**, sharing = **place** — expelled from values so the floor stays eternal". The notes of
8 August: "deixis never routes and never invokes — it selects", and "The invariant to preserve
forever: invocation adds zero interface to deixis." A generic container cannot promise that no
destructor ever runs, so ordinary ownership is specified per language rather than denied.

**Falsified by:** selection or enumeration that sends a message, opens a connection or waits on
I/O; reconstruction that closes a borrowed endpoint; a reserved key with a meaning; a default
route.

- **Contract status:** accepted, ADR 0015.
- **Authority:** structural contract. Provenance: owner sessions: design notes of 2026-08-07
  (§2, §4) and 2026-08-08 (§2, §5), recorded from sessions with the owner and quoted above,
  because those notes are not public.
- **Evidence:** stated.
- **Coverage:** none yet.

## Derived constructions

The owner's sketch, `Deixis[T] = { m(path, ...) for m(...) in T.methods }`, with
`A.m(path1, B.m(path,...)) ≈ A.m(path1++path,...)`, has two useful readings. One is
**structural projection**: selecting a subtree and then selecting within it is selecting the
concatenated path, so an operation reached either way is the same (ID9, ID10). The other is
**mount forwarding**: a resolver that continues through an explicitly interpreted mount, under
a routing profile (ID11, ID13). The literal nested call is not a law. `A.m(p1, B.m(p, x))`
performs two operations and passes the inner result to the outer one, where its counterpart
performs one. ADR 0015 §2 records the sketch.

### ID9. The projection

> For an operation `m` of `T`, `lift_m(N, p, x)` is `MissingPath` when `at(N, p)` is absent, and
> otherwise `m(t, x)` with `t` the own value of the selected node. On absence it invokes no slot
> operation. Otherwise it initiates exactly one invocation of the selected operation, on the
> selected slot, with unchanged arguments and receiver binding, and preserves that operation's
> outcome. Selection determines whether dispatch is available, not whether execution succeeds.

**Why.** It gives every slot type addressed operations while adding no operation to deixis
(ID8). Data and interaction get theirs the same way, so the rules for paths are written once.
"Exactly one invocation" concerns the projection. It is not exactly-once network delivery, and
it does not limit how many effects the invoked operation performs.

**Falsified by:** invoking before the path is resolved; invoking on absence; invoking twice;
adding or reinterpreting a routing argument without a declared contract; reporting a selected
operation's refusal as absence.

- **Contract status:** accepted, ADR 0015.
- **Authority:** derived construction. Provenance: owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md),
  `read(tree, path) = select(tree, path).own().read()` and
  `send(tree, path, message) = select(tree, path).own().send(message)`, "derivations, not
  alternate routing laws".
- **Evidence:** derived from ID3. stated: [WIRES.md](docs/WIRES.md).
- **Coverage:** not yet. A projection family is planned (ADR 0015 §7): zero invocations on
  absence, exactly one on presence, unchanged argument and handle identity, at every cut.

### ID10. Composition inside one tree

> For an immutable structural view, `lift_m(at(A, p), q, x) ≃_O lift_m(A, p ++ q, x)`, where the
> left side propagates `MissingPath` if the first selection misses. `≃_O` compares corresponding
> executions under a declared observation model `O`: separately initialised fixtures with the
> same capability identity, aliasing, mutable state, authority, lifetime scope and external
> operations. It is not a claim that two successive executions of one fixture agree.

**Why.** It lets a holder hand out a part of what it holds by selecting, and lets anyone compose
by prefix, with no new law to check. Both sides reach the same slot by pure selection and
initiate the same operation with the same arguments. The observation model says what is
compared (admission outcomes, results, errors, emitted messages, termination and order) and
what is not (promise identity, wall-clock timing, incidental scheduling).

**Falsified by:** a sender bound at `p1` that reaches a different target for `p` than the root
does for `p1 ++ p`; absence on one side and a call on the other; observations that differ
between corresponding fixtures.

- **Contract status:** accepted, ADR 0015.
- **Authority:** derived construction.
- **Evidence:** derived from ID3 and ID9.
- **Coverage:** not yet; with ID9's family, plus an effects-and-aliases family.

### ID11. Prefix composition across a boundary

> Where a connection explicitly supplies a coherent complete view `C(ρ, v)` under scope `ρ` and
> version `v`, `at(C(ρ, v)(a), p) ≃ C(ρ, v)(a ++ p)`, including agreement on absence. For an
> opaque addressed handle, `under(under(A, p), q) ≃ under(A, p ++ q)`: a law of constructing send
> access that says nothing about remote existence. Neither law requires a prefix-closed domain,
> and a mount is continued only by an explicit resolver rule.

**Why.** The two cases differ materially. A complete view can agree on absence; an opaque handle
can be built for a path where nothing exists, and a later send is admitted locally before remote
dispatch discovers that. The coherent-view condition matters, because two remote observations
around a mutation need not denote one tree. Requiring a prefix-closed domain would force an
ancestor namespace to be exposed merely because a descendant is.

**Falsified by:** existence or enumeration claimed through an opaque handle; a complete view
whose cut at a different point reaches a different node; a mount followed by plain selection.

- **Contract status:** accepted, ADR 0015.
- **Authority:** derived construction. Provenance: owner: [WIRES.md](docs/WIRES.md) §4,
  2026-08-08: "The conveyance criterion and the routing law are DECIDED (operator)."
- **Evidence:** derived from ID3 for complete views; by construction for `under`.
- **Coverage:** not yet.

## Family policy

These entries are not structural law: by ID5 the structural contract holds for every `T`, and
`Node<AddressedWire>` is as lawful a tree as `Node<Wire>`. They record the family's decided
design, which deixis anchors and the affected components own together.

### ID12. Interaction layering

> Raw conveyance does not interpret application paths. Addressed profiles define path
> representation, scope, composition, dispatch and failure independently of the carrier.
> Complete capability trees derive addressed access by structural selection. Opaque addressed
> access does not imply a complete tree. Exchange metadata belongs to an explicitly identified
> profile and need not be required of all messages. Conveyance, addressing and exchange are
> separate contracts; the family's names are `Data.read()` and `Wire.send(message)`, with
> `DataTree = DeixisNode<Data>` and `WireTree = DeixisNode<Wire>`, and one lift serves both
> wings.

"Addressless" means that the primitive and its relay interpret no application path. It does
not mean the absence of identifiers, endpoints or resource management. "One shared layer" means
one authoritative addressing contract with reusable implementations, not one implementation
across languages. An envelope that carries paths and exchange fields is admissible as an
optional combined addressed-exchange profile, carried as an ordinary value.

**Why.** Separation of independently meaningful contracts: a message can be conveyed without
interpreting a destination, addressing can exist without request and reply correlation, and a
complete tree can exist without a connection or an exchange. That is an engineering argument,
not a theorem. For a family with several transports, data and interaction, opaque relays and
future protocols, the narrower primitive is the better default. Its costs are a real layer
boundary, profile-specific validation, and more API concepts. It does not promise less code.

**Would be reconsidered if** representative consumers showed that the same envelope semantics,
not merely the same field names, were universally useful, that the raw surface caused
substantial recurring misuse or maintenance cost, and that a mandatory envelope kept explicit
composition, scope, ownership and transport-seam contracts.

**Falsified by:** a transport that parses application paths; exchange fields required of every
raw message; path rules implemented differently per transport against one contract; an opaque
addressed facade presented as a complete tree.

- **Contract status:** proposed, ADR 0015. It is adopted by ADR 0017, its supersession record of
  bitwire decision 0014's collapsed sending surface, once bitwire and bitruntime have accepted
  it (ADR 0015 §4).
- **Authority:** family policy: deixis, bitwire and bitruntime together. Provenance: owner:
  [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md) (2026-09-26), "Use Data / DataTree and
  Wire / WireTree", whose primitives are addressless. owner: the first version of bitwire#42,
  recorded there as "Operator direction recorded on 2026-09-25":

  > Separate the addressless Wire primitive (A0) from the addressed composition (A1), with
  > `A1 = Deixis[A0]`. The service architecture uses a Bitwire A0 relay behind a generic Deixis
  > service; the same Deixis service implementation also lifts raw Bytes B0 to B1.

  owner: the plan approved on 2026-10-04 for bitwire 0.4.0, which this policy supersedes (ADR
  0015 §4). owner: the standing ruling of 2026-10-04, "Ultimately, it is your call. Never ask
  me.", which delegates the decision to the components' agents.
- **Evidence:** research 0006's advice, R1 and R2, weighed both designs with their authority.
- **Coverage:** bitwire's and bitruntime's batteries, once bitwire#76 merges (ADR 0015 §7).

**What follows from it.** These readings are recorded in
[ADR 0013](docs/design/0013-binding-views-and-the-service-line.md) and ADR 0015. They are not
pinned.
- "A handler presented through Wire.send realizes a local sending capability; a tree of those
  Wire values is a WireTree. A bare native function tree remains its own generic instantiation"
  (bitwire#76). A handler that sees a whole envelope, destination included, distinguishes a
  path routed within a subtree from the same path routed from the root. Prefix transparency then
  needs a routing cursor beside the unchanged envelope, or an explicit rebasing relation.
- Names and ends are different carriers. A name is bytes and crosses places. An end is a live
  capability and stays where it was bound. Binding maps one to the other
  ([ADR 0013](docs/design/0013-binding-views-and-the-service-line.md) §2).

### ID13. Dispatch coherence, per relay profile

> Across a relay profile `P`, `dispatch_P(under(A, p), q, x) ≈_P dispatch_P(A, p ++ q, x)`, where
> `P` declares its observation boundary, representation, naming and scope, state and authority,
> ordering, failure and flow control, liveness assumptions and composition conditions. Its
> observations distinguish wrong-target dispatch, corruption, prohibited duplication and
> prohibited fallback, and an undefined route refuses. A chain of compatible relays preserves the
> declared safety relation when their interfaces and observation relations compose. End-to-end
> liveness, admission behaviour and resource bounds require additional compatible assumptions.

**Why.** Path associativity does not make a relay transparent. Without a declared observation
relation, a relation that equates every outcome would satisfy the equation and prove nothing.
For a byte-preserving ordered relay, research 0002's safety law is the starting point: for each
direction `d`, `O_d(t) ≼ I_d(t)`, the frames emitted are a byte-identical prefix of those
accepted ([WIRES.md](docs/WIRES.md) §4).

**Falsified by:** a relay that default-routes an undefined path; dispatch to a different target
under a cut; a profile whose relation cannot tell a wrong target from the right one; liveness
claimed for a chain without its assumptions.

- **Contract status:** proposed, ADR 0015; adopted with ID12 by ADR 0017.
- **Authority:** family policy: deixis, bitwire and bitruntime together. Provenance: owner:
  [WIRES.md](docs/WIRES.md) §4, 2026-08-08: "The conveyance criterion and the routing law are
  DECIDED (operator)."
- **Evidence:** research 0002's relay law; research 0006's advice, R13 and R14.
- **Coverage:** none yet. The crossing battery of WIRES.md §8, and bitwire's and bitruntime's
  families (ADR 0015 §7).

## What deixis requires of a consumer

1. Anything that claims `WireTree`, `DataTree` or the tree contract exposes complete structure
   (ID4), and keeps absence distinguishable from refusal (ID3). Addressed access alone says that
   it is only that.
2. A consumer that carries paths carries deixis paths: exact byte keys, relative to a scope,
   never absolute in anything frozen. Their meaning is selection or prefix binding and nothing
   else: no normalization, no fallback, no default route (ID2, ID3, ID11).
3. Any addressed operation a consumer offers is the projection, and composes by prefix (ID9 to
   ID11).
4. Consumers do not redefine tree equivalence (ID6) and do not decode into live resources (ID7).
5. A consumer cannot amend a contract here by implication. A contradiction is a conflict,
   resolved by the authority responsible for the affected contract, with the provenance of both
   sides.

## Words

- **Content address** is the codec's hash of encoded bytes, and nothing else.
- **Addressless**, **addressed** and **addressing**, in the family sense, are about paths.
- New text never writes a bare "address". The two senses collide, and the collision is exactly
  the confusion ID7 keeps apart.

## How a contract changes

Every substantive change is a **supersession record**: an ADR in [docs/design/](docs/design/)
that carries structured lines, `Identity: breaks ID<n>` (or `updates`, `adopts`, `retires`)
and, where it replaces an earlier decision, `Supersedes:` or `Updates:` naming it. Its fields,
each a bold label in the record:

1. **Affected contract:** the contract and its exact clauses, and which part of this page they
   are in.
2. **Supersedes** or **Updates:** the earlier decisions, partly or wholly.
3. **Old rationale and present tradeoff:** a sound reason may still be true and now be
   outweighed. It does not have to be shown false.
4. **Authority and delegation:** who decides, and the source and scope of that authority.
5. **Alternatives and consequences:** including keeping the contract, migration, compatibility
   and operational cost.
6. **Evidence and obligations:** keeping proof, tests, assumptions and unbuilt commitments
   apart.
7. **Approved revision:** which semantic change was reviewed, before it is implemented or
   released.

**Who decides.** The owner's standing ruling of 4 October 2026, "Ultimately, it is your call.
Never ask me.", delegates these decisions to the agents of the affected components. The owner's
earlier words are provenance, quoted verbatim; they are not a test the change must pass, and an
old quotation does not authorize a new reversal.
- The structural contract and the derived constructions are changed by deixis's agents.
- A family policy is changed only by a record that the agents of **every** affected component
  accept, named in its **Accepted-by:** field. No single component's agents can supersede a
  family policy, and a consumer's release is not acceptance.

**How much review.** Review is proportionate:
- **Editorial** (wording, links): none beyond ordinary review.
- **Update** within an existing delegation that supersedes nothing: a peer read, cited in a
  **Peer read:** field.
- **Supersession** of any recorded decision, and above all one the owner made: two derivations
  written sealed and compared, one of which explicitly tries to defeat the favoured design,
  cited in a **Derivations:** field; a peer read; and every field above. Reviewer independence
  is recorded by session, because all sessions share one account.

**Then:** a change-log entry below, and the new pin in [tools/identity.lock](tools/identity.lock)
naming the record.

[tools/identity_check.py](tools/identity_check.py) is a change-detection and provenance aid,
not a decision procedure. In CI it checks that:
- every entry carries its statement, reason and four attributes, and names its part;
- every statement, reason, authority and pinned section matches its pin, and every pin names a
  record that covers it and that the change log names;
- a supersession record carries the fields above, two cited derivations and a peer read; an
  update carries a peer read; a family-policy record carries every component's acceptance;
- a structured `Supersedes:` or `Updates:` line naming a record an entry rests on comes with an
  `Identity:` line for that entry, and prose that supersedes such a record without one fails;
- every quotation in an entry's attributes occurs verbatim in the local record it cites, line
  breaks and emphasis aside.

## Guards against drift

These are process rules, adopted with the contracts because the failure they prevent was a
process failure ([ADR 0015](docs/design/0015-deixis-identity.md), "What happened").

- **Consumers cannot amend a depended-on contract by implication.** Conflicts are resolved by
  the authority responsible for the affected contract.
- **Consultations are framed fairly.** A consultation that touches an entry presents each design
  with its authority and its stated reason. It never presents a reversal as settled.
- **Advice is read against its premises.** Record which boundaries a consultation was allowed to
  question. A premise fixed in the question is not a conclusion the answer established.
- **A reversal says so.** A plan that reverses a recorded decision says "this reverses X",
  quotes X's reason, and names any guard it overrides. An approval covers only what the plan
  surfaced.
- **The owner is quoted, not paraphrased.** Records quote the owner verbatim or say
  "paraphrase". A recollection or a question is never recorded as a ruling or a confirmation.
- **Downstream text links its source.** Release notes, consumer pages and research documents
  may carry a clearly labelled summary linked to the record. A change to a document that an
  entry cites is read against this page before merge, because no check sees a reworded
  restatement.
- **A grade with one reader gets a peer read** before its record merges.
- **Tests check promises, not names.** A test exercises the promised observations and the
  falsifiers above. Banning or requiring a type name checks neither.

## Change log

- **ID1 to ID11 adopted, ID12 and ID13 proposed**, [ADR 0015](docs/design/0015-deixis-identity.md),
  after research 0006. The charter of ADR 0014 (`D1` to `D8`) is folded in; ADR 0015 §2a has the
  mapping.
