# Structural identity and lifted access

**Status:** decided, 2026-10-05, in the owner-requested reconsideration across
deixis, bitwire and bitruntime. The implementation agent's reasoned decision is
recorded here; this is not a claim that the owner separately selected every API
detail or that independent review has occurred. Delivery evidence remains
separate. The [charter](../../CHARTER.md) makes the resulting identity explicit.

This supersedes ADR 0013's retirement of the addressless sender, `WireTree`, and
addressed sending distinction, and its preference for a receiver-side principal
interaction instance. It preserves ADR 0010's model, ADR 0012's complete tree and
Data/Wire symmetry, and the sound binding and discovery boundaries in ADR 0013.
No core tree operation or codec byte changes through this decision.

## Why reconsider

The September decision distinguished an addressless capability, path-indexed
access and a complete finite tree. The October bitwire replacement removed those
distinctions while removing JSON/RPC profiles and old return-address machinery.
The latter cleanup did not require the former architectural change.

ADR 0013 then treated the new consumer implementation as its baseline. Its
consultation explicitly did not reopen bitwire's October decision. Its advice
about interaction examples is consequently conditional on that premise. This
does not invalidate the advice about pure preparation, effectful resolution,
captured scope, failure distinctions, views or retention. It does mean that the
advice cannot establish that the earlier sender abstraction was unnecessary.

The structural core was not replaced: own values, child maps, path selection,
reconstruction and codec identity survived. The correction concerns what is
derived from that core and which repository owns each further agreement.

## Alternatives and decision

| Alternative | Assessment |
| --- | --- |
| Keep one duplex connection that requires source, destination and message IDs in every message. | Useful as a particular envelope protocol, but couples all carriers to addressing and exchange metadata. It is not the minimal opaque interaction primitive. |
| Restore the September release wholesale. | Restores useful boundaries but also string-path bridges, RPC profiles and return-address machinery that are independently superseded. |
| Retain the current pure tree; restore addressless sending and layer exact byte-path access above it. | Chosen. Keeps transport reuse, the Data/Wire symmetry and the method-lifting law without imposing RPC or a second path representation. |
| Add transport or automatic invocation to deixis itself. | Rejected. Interpretation would enter an opaque structural core and bind all instances to one consumer. |

Neither senders nor handlers are privileged payloads. `Node[Wire]`, `Node[Handler]`,
`Node[Data]` and `Node[BindingRequest[A]]` are instances of the same definition.
An interface accepting paths may expose only access; completeness requires the
whole `DeixisNode<T>` contract. Remote or lazy access needs its own view contract.

## Structural and operational laws

For an operation on an own value:

```text
lift_m(N,p,args) = select(N,p).own().m(args)
lift_m(select(N,p),q,args) â‰ˆ lift_m(N,p++q,args)
```

Both sides first perform the same partial selection. A missing path invokes no
value and is not confused with refusal by an existing value. On success, the
same capability is invoked once. These equations compare corresponding worlds
and schedules, not repeated executions of an effect.

Selection, decomposition and reconstruction never invoke or rebind values.
Binding contexts and resource ownership are not reset when a subtree is selected
or recomposed. Moving a subtree does not silently reinterpret captured relative
names. An interpretation that intentionally does so must declare a different
operation and its laws.

For address access, prefix binding obeys concatenation in `Bytes*`. Prefixing an
opaque router is not structural selection and does not establish remote
membership. Crossing a transport requires separately tested admission, ordering,
termination and resource assumptions. Path associativity alone does not prove
relay transparency, reliability, distributed identity or application outcomes.

## Preserved October work

- Two-stage binding: pure scoped request preparation, explicit per-node resolution
  and invocation, with binding refusal distinct from structural absence.
- Complete trees, effectful snapshot views and live discovery remain distinct.
  Promotion succeeds only after acquiring and validating the complete structure.
- Explicit mounts; ordinary `at` never follows an own value.
- Local capabilities remain local. Snapshot restoration does not restore original
  capability objects, credentials or connection ownership.
- `toNative` remains a pure structural conversion. Existing scripted binding
  cases retain their stated scope; they are not transport conformance evidence.

Service deployment, mutable cells and retention assignments made elsewhere are
not revised by this structural correction.

## Cross-repository realization

bitwire owns the addressless `Wire.send(Value)` capability, an endpoint's receive
and close ownership, `AddressedWire.send(Path, Value)`, the canonical addressed
message representation and the complete `WireTree` alias. bitruntime supplies
carriers and one carrier-independent addressing implementation, plus tree
construction and derived sending. Consumer protocols own correlation, reply
addresses, service errors and authentication policy.

These are different abstraction levels, not alternative generic protocols or
compatibility APIs. Each level has one current contract. Live-wire conveyance and
multiplexing, if added, require an explicit runtime allocation/lifetime protocol;
an endpoint object cannot appear inside a ground ontos value.

## Evidence and future review

The core invariants already have the structural corpus and four implementations.
This decision adds no assertion that the candidate codec is frozen. The new wire
realization must show independent cases for arbitrary ground messages, exact path
segments, cut agreement, own-value retention, no invocation during selection or
reconstruction, missing-versus-refused dispatch, and identical addressing over
local and WebSocket carriers. Endpoint admission and resource-release checks must
continue to pass after the split.

The [charter's amendment discipline](../../CHARTER.md#amendment-discipline) is part
of repository review. A future consumer migration must identify any proposed
foundation change explicitly rather than first implementing it downstream and
then treating that implementation as an unreviewable premise upstream.
