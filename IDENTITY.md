# deixis's identity

**What deixis is, the invariants that make it that, and the only way they change.** This page
is about deixis as a whole. It is not [docs/IDENTITY-SURFACE.md](docs/IDENTITY-SURFACE.md),
which lists the parts of the codec that decide octets and content addresses.

**Status: frozen** by [ADR 0015](docs/design/0015-deixis-identity.md). An invariant here
changes only through [the change rule](#how-an-invariant-changes). No consumer's release, no
downstream record and no consultation supersedes one. This page does not freeze the codec:
`deixis-codec-v2` stays a candidate on its own freeze track ([CODEC.md](docs/CODEC.md),
[issue #1](https://github.com/Bitspark/deixis/issues/1)).

## What deixis is

**deixis is the structure of pointing.** It is two things and nothing else:

- a finite tree whose keys are exact byte strings, `Node(T) = T × (Bytes ⇀fin Node(T))`;
- the one law by which a path reaches a position in that tree, and an operation reaches the
  value held there.

deixis selects. It never routes, invokes, binds, stores, connects or keeps time. Everything
else in the family is built above it: capabilities, binding, transport, mutable state and
services. They respect its laws, and nothing above it amends them.

Its dependencies point floor-ward. The test for anything proposed here is the one deixis's
vision document calls the second-party criterion: *would this survive the first consumer never
existing?* If a deixis record changes because a consumer changed, the dependency points the
wrong way.

## How to read an invariant

Each invariant has a number, a **statement**, a **reason**, what would **falsify** it, and a
**status** with its sources. The statement is the quoted block. [tools/identity_check.py](tools/identity_check.py)
pins it, so CI fails when it changes outside the change rule. The reason is part of the record
on purpose: a reason that lives only in an issue, a draft or a paper is invisible to the next
reader, and that is how this page came to be needed ([ADR 0015](docs/design/0015-deixis-identity.md)).

Statuses:
- **owner**: decided by the owner, in the record named, quoted as that record gives it;
- **owner sessions**: settled in design sessions with the owner, recorded in deixis's internal
  design notes and quoted here, because those notes are not public;
- **agents**: decided by this repository's agents;
- **recorded**: marked decided in a record that names no decider;
- **proved**: a result of [the paper](docs/paper/deixis.tex), named by its label;
- **checked**: replayed by corpus vectors against all four cores on every change;
- **stated**: doctrine that no vector or battery checks yet.

The numbers start at `ID` because `I1` to `I3` and `D1`, `D2` already name other things
([ADR 0008](docs/design/0008-proof-obligations.md)). The charter of
[ADR 0014](docs/design/0014-structural-identity-and-lifted-access.md), whose `D1` to `D8` are
folded in here, collided with the second; [ADR 0015](docs/design/0015-deixis-identity.md) §2a maps
them.

## The floor

### ID1. Shape

> Every node has exactly one own value of the slot type `T` and a finite map from byte-string
> keys to child nodes. Every tree is finite and well-founded. There are no node kinds:
> optionality is the slot choice `T = Option[U]`.

**Why.** One constructor keeps every law a single induction and every encoding a single
grammar. A node kind would put a meaning into the structure, and two kinds can disagree about
the same shape.

**Falsified by:** a parent value invented by default; a node with no own value or two; a cyclic or
infinite structure presented as a tree; a separate leaf kind.

**Status.** owner: [ADR 0010](docs/design/0010-mandatory-node-values.md), "Let's use mandatory
T." (2026-09-23). proved: `def:node`, `stip:structural`. checked: `mnode-invalid`,
`mnode-instantiation`.

### ID2. Keys and paths

> Keys are exact byte strings, compared octet by octet. They are never text, never normalized
> and never split on a separator, and the empty key is a key. A path is a sequence of keys,
> never their concatenation, and the empty path is not the empty key. Sibling order is not part
> of a node.

**Why.** Any reading of a key (an encoding, a separator, a case rule, an order) is a meaning.
Built into the floor, it would make two readers disagree about which tree they hold. Meaning
belongs to whoever reads the key.

**Falsified by:** keys normalized as text; `a/b` read as two keys, or the empty path read as an
empty-key child; segments joined lossily; sibling order changing equality.

**Status.** recorded: [ADR 0001](docs/design/0001-keys-are-bytes.md), whose status reads
"decided" and names no decider. stated:
[TREE.md](docs/TREE.md), [PATH.md](docs/PATH.md), and the paper's `rem:prefixfree` on why
paths do not flatten. checked: `mnode-navigation` (`m-nav-empty-key-path`,
`m-nav-non-utf8-key-exact`).

### ID3. Selection

> `at(N, ε) = N`, and `at(at(N, p), q) ≃ at(N, p ++ q)`, where both sides are defined together.
> Selection is partial: a miss is undefined. It never creates, defaults or searches. It never
> enters or invokes an own value, so it never follows a mount. A miss is distinct from every own
> value, including one that fails or refuses.

**Why.** This is the one law every "where" in the family reuses: a key path inside a value, a
cell name, a path across a connection. A default or a search would let two paths reach one node
with no rule for which wins. Entering an own value would make selection depend on what values
mean. Keeping a miss apart from a refusing value is what lets a caller tell "nothing there"
from "something there said no".

**Falsified by:** a lookup that creates a missing child; a fallback to an ancestor or a default
handler; following a name or a mount inside an own value; a miss reported as a refusal, or a refusal
as a miss; a cut of the path that changes which node is selected, or whether one is.

**Status.** owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md), "A missing path is
resolved before any payload operation; it must remain distinguishable from a present node whose
read fails or whose send is refused." stated: [PATH.md](docs/PATH.md), resolution never enters a
value. proved: `prop:action`. checked: `mnode-navigation`, including
`m-nav-json-payload-spelling-a-node-is-not-entered`.

### ID4. Complete parts

> A node is exactly its own value and its children: `compose(parts(N)) = N` and
> `parts(compose(t, m)) = (t, m)`. A parent's own value is an input, never inferred from its
> children. Attaching a child at a fresh key changes nothing else. Anything that claims the
> tree contract exposes this complete structure; path-addressed access alone, such as an opaque
> router, does not claim it.

**Why.** A holder of the parts must be able to rebuild exactly the node, or identity and
encoding drift apart. Growth that touches nothing else is what makes a tree extensible without
renegotiating what it already holds. Addressed access alone cannot be a tree, because send
behaviour cannot tell an absent path from a present participant that refuses.

**Falsified by:** a parent's value rebuilt from its children; an interior own value dropped; an
attach that changes an existing value; an opaque router presented as a `WireTree`; an unfetched
remote subtree presented as a complete node; a live participant cloned by reconstruction.

**Status.** owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md), "An addressed-only
access facade is not a `WireTree` or `DataTree`: it omits the complete structure." stated:
[TREE.md](docs/TREE.md), § Growth. proved: `prop:parts`. checked: `mnode-parts`,
`mnode-attach`.

### ID5. Carrier independence

> ID1 to ID4 hold for every slot type `T`, without inspecting, comparing, serializing or
> invoking own values. `map` is a functor: it preserves paths, and
> `at(map f N, p) ≃ map f (at(N, p))`.

**Why.** This is what lets one structure carry data, capabilities, names or anything else, and
what makes the floor's laws theorems rather than assumptions about `T`. It also means the floor
can forbid no `T`. Requirements on what a node holds, such as ID12's, are the family's, not the
floor's.

**Falsified by:** a law that holds only for some `T`; a `map` that rekeys, prunes, resolves or
interprets values.

**Status.** proved: `prop:functor`. checked: `mnode-map`.

### ID6. Supplied identity

> Equality of trees is lifted from an equivalence `≈` supplied for the slot. deixis chooses
> none, and no layer above redefines tree equality. Sharing of equal subtrees is unobservable.

**Why.** What makes two values the same is a meaning, so it is supplied with the meaning.
The floor's part is to lift it lawfully to whole trees.

**Falsified by:** byte equality imposed on a slot whose supplied `≈` identifies different
representations; equality that can observe sharing; behavioural equivalence inferred from equal
bytes.

**Status.** stated: [SLOTS.md](docs/SLOTS.md), [TREE.md](docs/TREE.md). proved: `thm:equiv`,
`thm:congruence`. checked: `mnode-identity`.

### ID7. Values, not behaviour

> A snapshot is a value, and a capability is not. The codec encodes values only: never a
> reader, a sender, a credential or executable behaviour. A content address is a hash of
> encoded bytes, and a path is a position under a root; the two are never conflated. A
> published byte-profile name always denotes the same bytes.

**Why.** Behaviour has no computable lawful bytes (the paper's existence boundary and its
computability gap), so encoding it would only encode a name for it, and binding a name to
behaviour is a consumer's act under its own authority. A content address names content and a path names a place; a record that confused
them would treat a position as an identity. A name that changed its bytes would silently change
every content address computed under it.

**Falsified by:** an encoded closure, reader or credential; a content address used as a path, or a
path as a content address; a published byte-profile name pointed at different bytes.

**Status.** owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md), "Encoding bytes
does not serialize a reader, its ambient credentials, or a live sending capability." stated:
[CODEC.md](docs/CODEC.md), "Values, not behavior" and § Consumer byte-profile names. proved:
`thm:countable`, `prop:gap`. checked: the codec families in [vectors/](vectors/).

### ID8. The floor stays empty

> The floor has no I/O, no names in the binding sense, no time, no routing, no invocation and
> no default. Structural operations never bind, invoke, acquire or release what an own value
> holds. The floor carries no meaning: no reserved keys and no blessed envelope.

**Why.** Each of these is a meaning or an effect, and the floor stays eternal by refusing
them. The design notes of 7 August 2026: "Floor: nothing, ever. No reserved tag keys, no
blessed envelope. A floor tag would leak semantics into identity (identical shapes, different
tags → different nodes) and is a repair magnet (tag vs shape disagreement)", and "insertion
order = **time**, sharing = **place** — expelled from values so the floor stays eternal". The notes of 8 August: "deixis
never routes and never invokes — it selects", and "The invariant to preserve forever:
invocation adds zero interface to deixis."

**Falsified by:** selection or enumeration that sends a message, opens a connection or waits on I/O;
reconstruction that closes a borrowed endpoint; a reserved key with a meaning; a default route.

**Status.** owner sessions: design notes of 2026-08-07 (§2, §4) and 2026-08-08 (§2, §5), both
recorded from sessions with the owner.

## Pointing

The floor's one contribution to behaviour is derived, not added. An operation of a node's own
value becomes an operation of the tree by selecting first.

### ID9. The projection

> For a carrier with an operation `m`, the tree's addressed operation is
> `A.m(p, …args) = at(A, p).own().m(…args)`. It is defined exactly where `at(A, p)` is, passes
> the arguments unchanged, and invokes `m` once, on the selected own value.

**Why.** It gives every carrier addressed operations while adding no operation to deixis
(ID8). Data and interaction get theirs the same way, so the rules for paths are written once.

**Falsified by:** invoking before the path is resolved; invoking on a miss; invoking twice; passing
the path to the own value's operation.

**Status.** owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md),
`read(tree, path) = select(tree, path).own().read()` and
`send(tree, path, message) = select(tree, path).own().send(message)`, "derivations, not
alternate routing laws". stated: [WIRES.md](docs/WIRES.md).

### ID10. Composition inside one tree

> If `B = at(A, p1)`, then `B.m(p, …) ≃ A.m(p1 ++ p, …)`. Both sides select the same own value,
> pass the same arguments and invoke once, and a miss is a miss on both sides. Composition
> concatenates paths; it never feeds one call's result into another. The equation compares the
> two sides from the same state; it does not claim that running both, one after the other,
> gives equal results.

**Why.** It lets a holder hand out a part of what it holds by selecting, and lets anyone compose
by prefix, with no new law to check.

**Falsified by:** a sender bound at `p1` that reaches a different target for `p` than the root does
for `p1 ++ p`; a miss on one side and a call on the other.

**Status.** proved: immediate from ID3 (`prop:action`). The projection it composes is owner
(ID9). checked: not yet; ADR 0015 plans a projection vector family.

### ID11. Crossing, per relay profile

> Across a connection, `connect(a) / p ≈ connect(a ++ p)`. Both sides are defined together,
> and undefined refuses: it never default-routes. The `≈` is the relation the relay profile
> declares. The law promises agreement per path and nothing about order across paths.
> Multi-hop routing is iterated application, so a relay chain is a relay. Where `connect(a)`
> yields a complete structural view, `/` is selection (ID3). Through an opaque addressed facade,
> `/` is prefix binding: the law then says only that prefixes compose, and claims nothing about
> whether a path exists or what lies below it.

**Why.** It states what any realization must preserve without fixing wire anatomy, so any
transport can carry the same addressing. Naming the relation per profile is what keeps it
honest: "behaviourally equal" with no relation named is not a law. Path associativity does
not prove a relay transparent. That needs a relay law of its own, such as research 0002's
safety law ([WIRES.md](docs/WIRES.md) §4).

**Falsified by:** a relay that default-routes an undefined path; a cut at a different hop that
reaches a different target; existence or enumeration claimed through an opaque facade.

**Status.** owner: [WIRES.md](docs/WIRES.md) §4, 2026-08-08: "The conveyance criterion and the
routing law are DECIDED (operator)." Its
structural half is proved from ID3. Its crossing half is an obligation of each relay profile.
No battery exists yet, so WIRES.md's own rule applies: it is a stated law, not yet a checked
one.

## The family's layering

deixis anchors this; it is not a floor law. By ID5 the floor holds for every `T`, so the
requirement that primitives be addressless belongs to the family that builds on deixis.

### ID12. Addressless primitives, one shared path layer

> The primitives are addressless: `Data.read()` and `Wire.send(message)` take no tree path, and
> the full trees are `DataTree = DeixisNode<Data>` and `WireTree = DeixisNode<Wire>`. Every
> transport implements only the addressless contract. Paths are handled once, in one shared
> layer that realizes `X1 = Deixis[X0]` for every transport and for both wings:
> `A1 = Deixis[A0]` for `Wire` and `B1 = Deixis[B0]` for `Data`. A path inside a message is
> that layer's encoding; a path parameter on the primitive is addressing duplicated.

"Addressless" means that the primitive and its relay interpret no application path. It does
not mean the absence of identifiers, endpoints or resource management.

**Why.** A primitive that interprets tree paths duplicates selection, and its composition is
then unconstrained by the selection law, so the projection law can silently fail. With the
layering:
- transports stay minimal: each implements framing, order, admission and termination, never
  paths, so any conduit fits, from an in-process call to a journal or a relay;
- path semantics (exact keys, misses that refuse, prefix composition, mounts) are implemented
  once, for every transport and both wings;
- a relay stays application-blind, and forwards bytes it does not read;
- holders compose sub-capabilities by prefix (ID10).

**Falsified by:** a transport that parses application paths; path rules implemented again per
transport; a primitive whose send takes a tree path.

**Status.** owner: [ADR 0012](docs/design/0012-data-wire-tree-symmetry.md) (2026-09-26), "Use
Data / DataTree and Wire / WireTree", whose primitives are addressless. owner: the first version
of bitwire#42, recorded there as "Operator direction recorded on 2026-09-25":

> Separate the addressless Wire primitive (A0) from the addressed composition (A1), with
> `A1 = Deixis[A0]`. The service architecture uses a Bitwire A0 relay behind a generic Deixis
> service; the same Deixis service implementation also lifts raw Bytes B0 to B1.

owner: [WIRES.md](docs/WIRES.md) §1, within the operator-decided conveyance criterion: a relay's
contract is "messages in, messages out, per-end order — with the protocol nowhere in it". On 2026-10-05 the owner recalled this layering and asked for a re-derivation; [ADR
0015](docs/design/0015-deixis-identity.md) records it.

**What follows from it.** These are readings of ID9 to ID12 recorded in
[ADR 0013](docs/design/0013-binding-views-and-the-service-line.md) and ADR 0015. They are not
pinned.
- A receiver's tree of handlers is a `WireTree`, because a handler is a send end on the
  identity wire ([WIRES.md](docs/WIRES.md) §2). Routing an incoming message is selection, then
  invocation: ID9 applied at the receiver.
- A sender across a connection holds the projection without the structure. That is lawful under
  ID11, and it does not claim the tree (ID4).
- Names and ends are different carriers. A name is bytes and crosses places. An end is a live
  capability and stays where it was bound. Binding maps one to the other
  ([ADR 0013](docs/design/0013-binding-views-and-the-service-line.md) §2).
- The floor never follows a mount (ID3). The path layer may, explicitly
  ([ADR 0013](docs/design/0013-binding-views-and-the-service-line.md) §8).

## What deixis requires of a consumer

1. Anything that claims `WireTree`, `DataTree` or the tree contract exposes complete structure
   (ID4), and keeps a miss distinguishable from a refusal (ID3). Addressed access alone says
   that it is only that.
2. A consumer that carries paths carries deixis paths: exact byte keys, relative to a binding
   root, never absolute in anything frozen. Their meaning is selection and nothing else: no
   normalization, no fallback, no default route (ID2, ID3, ID11).
3. The primitive every transport implements takes no tree path. Path handling is the shared
   layer's, implemented once (ID12).
4. Any addressed operation a consumer offers is the projection and composes by prefix (ID9 to
   ID11).
5. Consumers do not redefine tree equality (ID6) and do not encode behaviour (ID7).
6. A consumer's decision never amends an invariant here. A contradiction is a conflict, opened
   on deixis with the provenance of both sides.

## Words

- **Content address** is the codec's hash of encoded bytes, and nothing else.
- **Addressless**, **addressed** and **addressing**, in the family sense, are about paths.
- New text never writes a bare "address". The two senses collide, and the collision is
  exactly the confusion ID7 forbids.

## How an invariant changes

Changing an invariant is a versioned break of deixis's identity. It needs all of the following:

1. **An ADR that names it.** A record in [docs/design/](docs/design/) carries the line
   `Identity: breaks ID<n>` for each invariant it changes. It quotes the current statement and
   its reason, says why the reason no longer holds, weighs keeping the invariant unchanged as
   an alternative, and accounts for the consumers that must migrate and the evidence for the
   new law.
2. **Two independent derivations**, written sealed and compared before either author reads the
   other's. This is deixis's freeze method: independent derivations compared against stated
   criteria.
3. **A peer read** by an agent other than the author, before merge.
4. **The owner's words, verbatim**, where the invariant's status is owner or owner sessions.
   This asks the owner to decide nothing. It forbids an agent from overturning a ruling the
   owner made, on a paraphrase or on its own reading.
5. **A change-log entry** below, and the new pin in
   [tools/identity.lock](tools/identity.lock) naming that ADR.
6. **The new statement carries its reason.**

[tools/identity_check.py](tools/identity_check.py) enforces the mechanical parts in CI:
- every statement matches its pin;
- every pin names an ADR that adopts or breaks that invariant;
- the change log names that ADR;
- every quotation in a status occurs verbatim in the record it cites, line breaks and emphasis
  aside;
- no document declares that it supersedes a record an invariant rests on, unless it carries
  the `breaks` line.

## Guards against drift

These are process rules, adopted with the invariants because the failure they prevent was a
process failure ([ADR 0015](docs/design/0015-deixis-identity.md), "What happened").

- **Authority flows floor-ward.** A consumer's decision that contradicts an invariant is a
  conflict to resolve here, with both sides' provenance checked. The floor does not follow it.
- **Consultations are framed fairly.** A consultation that touches an invariant presents each
  design with its authority and its stated reason. It never presents a reversal as settled.
- **A reversal says so.** A plan that reverses a recorded decision says "this reverses X",
  quotes X's reason, and names any guard it overrides. An approval covers only what the plan
  surfaced.
- **The owner is quoted, not paraphrased.** Records quote the owner verbatim or say
  "paraphrase". A recollection or a question is never recorded as a ruling or a confirmation.
- **Downstream text cites, never restates.** Release notes, consumer pages and research
  documents cite the record. They never restate a supersession. A change to a document that an
  invariant cites is read against this page before merge, because no check sees a reworded
  restatement.
- **A grade with one reader gets a peer read** before its record merges.
- **Advice is read against its premises.** Record which boundaries a consultation was allowed
  to question. A premise fixed in the question is not a conclusion the answer established.
- **Tests check promises, not names.** A test exercises the promised observations and the
  falsifiers above. Banning or requiring a type name checks neither.

## Change log

- **ID1 to ID12 adopted**, [ADR 0015](docs/design/0015-deixis-identity.md). The charter of ADR 0014
  (`D1` to `D8`) is folded in; ADR 0015 §2a has the mapping.
