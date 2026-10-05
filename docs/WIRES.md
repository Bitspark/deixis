# Interaction over structure

**Current doctrine:** [ADR 0014](design/0014-structural-identity-and-lifted-access.md),
2026-10-05. This replaces the earlier interaction exposition; its derivation and
revisions remain in Git history. [CHARTER.md](../CHARTER.md) states the invariant
boundary. Nothing here adds invocation or transport to the pure core.

## Structure and operations

An interaction capability is a legal opaque own value. A complete tree of
addressless senders and a complete tree of receive handlers are equally valid
`Node[T]` instances. Neither is the universal meaning of interaction.

For a declared operation on `T`:

```text
lift_m(N,p,args) = select(N,p).own().m(args)
lift_m(select(N,p),q,args) ≈ lift_m(N,p++q,args)
```

The path is selected first. Absence invokes nothing; an existing value may then
refuse or fail. The selected capability is invoked once. For effectful operations
the equation compares corresponding initial worlds and schedules, retaining
state, aliases, authority and resource scope. It is not a promise that two
successive invocations return equal results.

Selection and reconstruction do not invoke, bind, clone, acquire or close own
values. They follow exact child keys and never enter an own value. A mount or
relative name needs an explicit interpretation above those operations.

## Addressless and addressed interaction

bitwire owns the addressless `Wire.send(message)` capability. Endpoint ownership
adds receiving and closure. `AddressedWire.send(path,message)` is a layer above
addressless messages; bitruntime can realize it once for every carrier. A
complete `WireTree = Node[Wire]` derives addressed sending by selection.

An opaque addressed facade is not a tree. Locally forming or prefixing a path
does not prove that a remote path exists, can be used, or denotes a stable target.
The path still uses the free monoid of exact byte segments, so prefix scopes
compose by concatenation. No string conversion or path normalization is implied.

## Conveyance and its assumptions

Opaque data can be copied under a declared codec. Interaction can be relayed
under a declared transport profile. Neither operation is performed by deixis.
A function or capability can remain a local opaque value; arbitrary behavior
does not thereby acquire a computable canonical encoding. A portable name is
data; obtaining its local capability is a separate binding operation.

For a relay direction, let `I(t)` be complete messages admitted by time `t` and
`O(t)` those emitted. A safety profile can require `O(t)` to be an identical
prefix of `I(t)`: no invention, corruption, duplication, reordering, or skipping
followed by later delivery. Eventual delivery additionally needs stated
readiness, scheduling, resource and failure assumptions. Each direction has its
own order; no cross-direction total order is implied.

Safety-transparent relays compose under compatible framing and identity rules.
Liveness, timing, authority and resource guarantees require their own compatible
assumptions. Tree selection associativity proves none of them. An implementation
may not cite the path law as proof that its relay is reliable or transparent.

## Crossing a boundary

A profile may state a law of the form:

```text
select(connect(origin),p) ≈ connect(origin+p)
```

It must define `connect`, root scope, the admitted observations, failure and
definedness on both sides. This law applies only when the connected result
actually supplies a complete structural view. An addressable endpoint cannot
use the equation to claim enumeration or structural absence it does not know.
For an opaque facade, state the weaker prefix-access law instead.

Names resolve under a captured profile, authority, namespace, identity and
lifetime scope. Pure preparation may commute with selection. Eager resolution
of unrelated siblings need not: a failing sibling can prevent the whole result,
or an effect can change another capability's state. The preparation/resolution
split in [ADR 0013](design/0013-binding-views-and-the-service-line.md) addresses
that distinction and remains valid after the wire correction.

## Evidence and limits

The paper and structural corpus support the finite tree and exact path laws.
The scripted binding corpus exercises scoped preparation and outcome
distinctions, not real I/O or distributed scheduling. bitwire owns independent
wire observations and bitruntime must demonstrate its implementations against
them. Neither a transport endpoint nor its canonical bytes establish complete
discovery, serialization of capabilities, RPC, authentication or behavior
equivalence. Each further promise needs its own contract and evidence.
