# deixis — wires

**Status:** doctrine record for the **interaction wing**, minted 2026-08-08 from
operator dialogue; the derivation trail is
notes 2026-08-08 §§2–10, whose §10
this document promotes. The conveyance criterion and the routing law are
**DECIDED** (operator). The law's structural half is proved in the
[paper](paper/deixis.tex); its crossing half is battery-shaped and unbuilt —
**nothing here may be cited as an invariant until vectors and a battery exist.**
Companion to [TREE.md](TREE.md) (the value wing) and [SLOTS.md](SLOTS.md) (the
tier discipline). Vocabulary: *wire* here names what earlier notes called a
*channel* — the conduit; an *end* is what a party holds; a *name* is what
travels. Nothing in this document adds an operation to the floor.

*(2026-10-05: this record's layering stands: an addressless `Wire` that every transport carries,
one shared addressing layer above it, and the projection law.
[ADR 0014](design/0014-structural-identity-and-lifted-access.md) reaffirms it, and
[ADR 0013](design/0013-binding-views-and-the-service-line.md) §6 is corrected to restate it.
bitwire 0.4.0 diverged from it, and Bitspark/bitwire#76 restores it there. Binding names is
ADR 0013 §2, and mounts are §8. For a few hours on 2026-10-05, Bitspark/deixis#19 replaced
this document with a shorter exposition. Its doctrine and reasons are restored here, and that
exposition's precise points are the amendments in §4 and §8.)*

**API clarification, accepted 2026-09-26:**
[ADR 0012](design/0012-data-wire-tree-symmetry.md) uses `Wire` for the
addressless `send(message)` capability and `WireTree = DeixisNode[Wire]` for
the full structure. Its storage counterpart is addressless `Data.read()`
and `DataTree = DeixisNode[Data]`. Both trees require complete children,
partial selection, own values, decomposition and recomposition over exact
byte keys. Addressed sending is derived as
`select(tree, path).own().send(message)`; a missing subtree and a present
refusing Wire are different. The older lower-case *conduit*, *end* and *name*
vocabulary below describes transport roles, not public type names. The full
structural contract is [API.md](API.md); the consumer mapping and migration
boundary are [`BITWIRE.md`](consumers/BITWIRE.md).

## 1. The two wings

The floor's obligation is **conveyance without interpretation**: allow any node,
however opaque, understanding exactly as much as conveying it requires. A
floor-grade citizen is therefore anything with a **zero-knowledge conveyance
operation** — an act that moves the thing while the mover understands nothing
about it. Exactly two are known:

- **Data conveys by copy** — hand the bytes.
- **Interaction conveys by relay** — forward the messages.

Both are one physical act — moving opaque bytes — in two modes: copy to a
destination; forward along an end. [TREE.md](TREE.md) governs the first wing;
this document governs the second. Together: any value, because bytes copy
blind; any interaction, because ends relay blind.

**Functions sit on neither wing, by derivation rather than taste.** A function
is not copyable — behavior has no *computable* lawful bytes (the paper's
noncomputability result: countability grants an encoder, computability refuses
it) — and not relayable without interpretation: a forwarding proxy for a
function must intercept `apply` and produce the result, so it must speak the
call semantics (arity, synchrony, blocking, the no-reply case); its contract
cannot be stated without the protocol. A wire relay's contract is one line —
messages in, messages out, per-end order — with the protocol nowhere in it.
Function therefore *demotes, never banishes*: `apply(f, x)` = send
`(x, reply-end)` on `f`'s wire, await the reply — the most common session, one
protocol among many. A closure remains a lawful local realization of a bound
end (the identity wire, §2).

## 2. What a wire is

A wire is the conduit between places. It is individuated by its **surface, not
its identity**: a declared **property set** — the relay laws that hold on it —
never an implementation. Anything satisfying the set may stand in
(substitution, one level down). Core properties and what each declares:

| property | declares |
| --- | --- |
| framed | message identity — where one message ends |
| ordered | per-end order preserved |
| reliable | no loss — with `framed` + `ordered`: identity-bearing on messages |
| bidirectional | both parties hold sending ends |
| persistent, time-shifted | the endpoints need not coexist |

A conduit *lacking* a property is not unlawful — it is a **transforming
conveyance** and holds a claim, never an inheritance: a lossy or reordering
path must re-establish same-message-ness end to end (the admission taxonomy's
post-composition caveat, unchanged). A `watch` — lossy monotone sampling — is
declared as such, and no transparency claim attaches to it.

Two degenerate wires are load-bearing:

- **The identity wire** (in-process): relay = id; an end is the object; a
  closure held and called locally is a send on it. "Functions as local
  realizations" has an address: they live on the identity wire.
- **The time-shifted wire** (a journal, a file): endpoints need not coexist;
  replay is the far end of the crossing. Names re-bind per process — including
  a *future* process — through an ordinary property declaration, no new law.

Establishment — who dialed, who listened — is a wire-arrangement fact,
invisible above: the surface is the ends, not the dialing.

## 3. Names, ends, binders

What sits in a tree is a wire's **name** — bytes held as a node's own value, conveying natively
on the value wing, identity at the registry tier. What a name presents after
binding at a place is an **end** — surface `{send}`, situated, never traveling
(handle locality). The two halves meet at the binder, and the binder is
**recognizer-class**: a miss refuses — never a default handler, never a
fallback route (the exact-or-refusal clause, adopted into the topos record).
Receiving is the provider's side; *who may bind as provider* is authority —
thesmos-shaped, mirroring "anyone compares bytes; only codec-holders decode."
PROPOSED at topos M1: the binder's codomain is an **end — a send capability —
never "the live object."**

## 4. The routing law

The crossing law is:

```text
connect(a) / p  ≈  connect(a ++ p)
```

`++` is concatenation in the free monoid of keys; `/` is the floor's
resolution; `connect` is supplied by the place layer. **Reading:** the key
monoid acts twice — on addresses by concatenation (the free action: syntax)
and on entities by resolution (the paper's proved partial action: semantics) —
and `connect` intertwines the two. Paths are syntax, resolution is semantics,
`connect` is evaluation; the law is the homomorphism condition
`eval(x·y) = eval(x)·y`. It is stated over observables only — no wire anatomy,
no export tables, no demultiplexing scheme — so any realization satisfying it
conforms to this crossing law, and how transport realizes that crossing is an
implementation liberty. The complete deixis structure has its own obligations:
an opaque addressed handle alone does not supply the child map, partial
selection and decomposition required of a `WireTree`.

Three clauses make the equation honest:

1. **The `≈` is Kleene equality.** Both sides are partial; the law holds where
   defined, and **undefined refuses — never default-routes**. Spelling
   `a ++ p` is free (the caller mints it locally); definedness is the binder's
   fact. Exact-or-refusal is the equation's definedness discipline, enforced
   at one place: dispatch.
2. **The `≈` declares its relation**: battery equivalence, wing-typed — a
   value subtree answers by snapshot under the codec's laws; a live subtree
   answers by interaction under this document's.
3. **The law is silent on cross-path order, and the silence is the ruling.**
   It promises per-path agreement only; sibling ordering is a wire *property*
   (§2), never an abstraction guarantee.

**The node at an address has an own value and children**
([TREE.md](TREE.md), [ADR 0010](design/0010-mandatory-node-values.md)). Every
node has a mandatory `T`; a send to the address itself is the wire reading of
that value. A refusing handler is still a value. An optional interpretation can
choose `T = Option[Handler]` and declare what `None` means, but the core supplies
no implicit absence or refusal behavior. The law remains about resolution,
which walks children. This is the accepted target, not a claim that a runtime
has completed its migration or behavioral conformance.

Corollaries, each by re-applying the equation:

- **Cut anywhere**: `connect(a ++ p ++ q)` agrees under every cut; each cut
  point is a hop, so **multi-hop routing is iterated application** and a relay
  chain is a relay.
- **Mounts compose**: a position whose own value names a bound `connect`
  extends the law by transitivity of `≈`. Floor resolution never enters a
  value ([PATH.md](PATH.md)), so continuing a path through a mount is the
  wire reading's act, not the floor's; and a position that carries a mount
  *and* children of its own must declare which answers a path below it —
  an interpretation rule, never a default.
- **Pipelining is free spelling**: the right-hand side may be *uttered* before
  the left side's intermediate exists; refusal is the failure mode.
- **The address is a URI**: the right-hand side read as text is a URL; a REST
  endpoint is this law with the path serialized — the web's URL space is the
  degenerate read-only instance.

**Proof status, split honestly:** the structural half — resolution as a
partial action of the free monoid, commuting with `map` — is proved in the
paper. The crossing half is the transparency claim of each wire profile,
certified by a battery when one exists. The law is spec and battery jointly,
the same shape as the vectors doctrine — and until routing vectors and the
two-nodes-one-process rig exist, it is a stated law, not an invariant.

*(Amended 2026-10-05; the law above stands, and is [IDENTITY.md](../IDENTITY.md)'s ID11. These
precisions come from Bitspark/deixis#19 and research 0002's advice.)*
- **What `/` is.** `/` is the floor's resolution only where `connect(a)` yields a complete
  structural view. Through an opaque addressed facade it is prefix binding, and the law then says
  only that prefixes compose. It claims nothing about whether a path exists or what lies below
  it, since an addressed-only facade is not a tree ([ADR 0012](design/0012-data-wire-tree-symmetry.md)).
- **What a profile that states the law defines:** `connect`, its root scope, the admitted
  observations, failure, and definedness on both sides.
- **The relay law the crossing half needs.** Path associativity does not prove a relay
  transparent. Research 0002's advice (§5.4) gives the safety law: for each direction `d`, with
  `I_d(t)` the complete frames accepted by time `t` and `O_d(t)` those emitted,
  `O_d(t) ≼ I_d(t)`, a byte-identical prefix. That one condition excludes invention, corruption,
  duplication, reordering, and skipping followed by later delivery, in each direction
  independently. Liveness holds only within the profile's stated assumptions. "The composition
  of safety-transparent relays is safety-transparent."

## 5. Sessions — the codec's behavioral sibling

Bare wires are as lawless as bare bytes. The reading layer is the session: a
protocol is to a wire what a codec is to bytes — a lawful reading with
recognition and refusal (a non-conforming message refuses). Descriptors are
horos-shaped and enter with the first protocol, after the codec freezes.

**Canonicity does not transfer wing-wide.** One legislated spelling per value
exists; no legislated interaction-form per call does. A restricted fragment
may have canonical minimal forms, and a session profile may legislate exactly
that for its fragment — but wing-wide there is nothing to legislate over, and
identity of behaviors rests on the **type/token split**: protocol
*descriptors* are value-wing citizens (canonical bytes available);
*implementations* fall to the noncomputability result; running *particulars*
are name-constituted at places. Laws — conformance, refusal, linearity — yes;
wing-wide canonical forms, no.

**The minimal primitive is OPEN** (one-shot vs multi-shot): multi-shot wires
derive from one-shot sends plus carried continuation names; one-shot ends are
the candidate to beat, with linearity stated honestly: a name's bytes copy
freely, so one-shot is authority-enforced single **redemption** at the binder —
affine, not strict (external advice, research 0002; minimum laws in its
integration ledger).
*(Closed 2026-10-05, [ADR 0015](design/0015-deixis-identity.md) §4, an agents' decision:
research 0002's integration ledger adopted affine one-shot endpoint transitions as normative
and persistent or multiplexed transports as permitted refinements. ADR 0012's
`send(message): void` on a persistent wire is such a refinement.)*

## 6. Realization sketch — non-normative

One conforming shape, recorded so the first builder does not re-derive it: an
envelope to a node carries `(relative path, verb, payload)` — the path
relative to the wire's binding root, so rebasing across mounts is prefix
arithmetic in the free monoid. The path's byte spelling already exists: the
codec's length-prefixed key framing, with κ
([deixis-pos-v1](design/0002-positional-keys.md)) for positional
multiplexing. **Review rule (2026-08-09): no absolute place-paths in anything
frozen** — a place-address travels as (root-context, relative path), the same
shape as the version-qualified valueRef rule; rootedness, if ever wanted, is a
convention above, never a spelling here. The multiplex key space, the composition key space, and the
address space are one space, one proved algebra, one spelling. Any other
realization satisfying §4 conforms equally; this sketch binds nothing.

## 7. What this is not

deixis routes nothing. The floor gains no operation from this document: keys
and names convey natively because they are bytes; every other conveyance is a
purchased tier — identity costs `≈`, wire-ability costs `e`, invocability
costs the binder, **reachability across places costs a relay profile and its
assumptions** (§2's declared property set, never a bare conduit) — supplied,
priced, never floor. "Routing" is a system word: the two models of one monoid
action commute over the shared keys, and that commuting *is* the routing.

## 8. Ratification path

1. **Routing vectors** — hand-authored cases for §4 (cuts agree; misses
   refuse; mounts compose), judged from this record, never from an
   implementation.
2. **The battery rig** — two nodes joined by the identity wire in one
   process: the transparency law's enforced witness, essentially free.
3. **Topos M1** — the binder codomain (end, §3) and the relay contract
   (per-end order, prefix-respecting — now a corollary of §4) are queued in
   the topos record.
   *(Corrected 2026-10-05, from Bitspark/deixis#19: per-end order is not a corollary of §4. It
   is a relay property (§2), and research 0002's safety law states it (§4's amendment). Only
   prefix-respect follows from §4.)*
4. **Sessions** — with the first protocol descriptor, after the codec
   (Levitation ordering).

Lineage: the fiber model
(`bitspark/bitagent/hooks/docs/spec/ARCH-MODEL-V4.md`) reached the same joint
from the engineering side — its WIRE is this wire, its §5.5 law is §4's law,
its property sets are §2's declared relay laws; its disk wire contributed
time-shift. Plan 9 owns one-tree-with-mounts; the web owns
paths-as-references; π-calculus owns names-as-what-travels. What this record
adds is the identification: multiplex keys, composition keys, and addresses
are the *same* keys, under a proved action, with exact-or-refusal.
