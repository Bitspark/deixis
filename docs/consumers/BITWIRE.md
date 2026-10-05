# bitwire: the envelope Wire and receiver handler trees

**Current from 2026-10-05, after bitwire 0.4.0 (its decision 0014, 2026-10-04).** The interaction
half of [ADR 0012](../design/0012-data-wire-tree-symmetry.md) is superseded by
[ADR 0013](../design/0013-binding-views-and-the-service-line.md). bitwire's own contract is the
source; this page records what bitwire takes from deixis and where the line falls.

```ts
interface Envelope {
  readonly source: Path;          // Path = readonly Atom[]: exact byte keys, scoped to the connection
  readonly destination: Path;
  readonly id: Atom;
  readonly correlation?: Atom;
  readonly payload: Value;        // an immutable ontos value
}
interface Wire {
  send(envelope: Envelope): Promise<void>;                  // resolves on local admission only
  receive(handler: (envelope: Envelope) => void): () => void;
  readonly closed: Promise<Termination>;
  close(): Promise<void>;
}
```

`Wire` is bitwire's one duplex connection endpoint. **A connection is not a tree.** There is no
`WireTree` and no `AddressedWire`: bitwire's decision 0014 removed both, and its build rejects the
names.

## What it takes from the floor

- **The receiver's routing tree.** It is a complete `DeixisNode` whose own values are handlers.
  bitruntime's `route(tree, envelope)` is `tree.at(envelope.destination)` followed by invoking the
  selected own value, and it returns `false` for an absent path. That is selection followed by
  invocation, not name binding (ADR 0013 §6). It never falls back to an ancestor.
- **Keys** are exact byte strings, including empty and non-UTF-8 keys, in bitwire's own nominal
  `Atom` type. Slash bytes are ordinary key bytes, and nothing is parsed or normalized.
- **The complete structural contract.** `own()`, `children()`, `at(path)` and decomposition agree.
  Missing selection is absent, and an existing handler that ignores an envelope is still present.
  Construction rejects duplicate keys and cycles. bitwire declares the shape itself, because each
  repository stays installable without the others. Its child order is presentation order, not key
  identity.
- **No equality or codec on handlers.** Structure alone chooses neither, as for any other payload
  in [SLOTS.md](../SLOTS.md).

## What it adds above it

- **Messages and delivery.** bitwire owns envelopes, admission, ordering per direction, receive
  attachment, termination and limits. Success means local admission, not delivery or execution.
  A rejected `send` means "not admitted locally". A synchronous handler exception fails the
  endpoint, so refusal is not a thrown exception.
- **Senders cannot see remote absence.** Across a connection a sender observes admission only. It
  cannot tell a missing remote path from a present handler that ignores the envelope. Stronger
  guarantees (existence, authorization, target identity, outcome) belong to an exchange protocol
  above the wire.
- **A send capability at a path** is an application adapter over `(connection, path)`, not a
  primitive. Constructing it does not establish that the path exists remotely. A handler at a path
  can be replaced within one participant's lifetime. So a reference that promises token identity
  needs a stable target ID, a pinned routing revision, or no reassignment; otherwise it is a
  mutable route alias (ADR 0013 §6).
- **Designation is not authority.** Source and correlation do not authenticate a sender. A portable
  end reference carries a declared authority model.

deixis implements neither transport nor dispatch. Binding portable names to send adapters
follows ADR 0013 §2: a pure preparation, then a per-request resolution whose refusal is not a
`Wire.send` rejection.

## History

- **26 September 2026.** bitwire's decision 0012
  ([v0.3.0](https://github.com/Bitspark/bitwire/tree/v0.3.0/docs/decisions)) chose an addressless
  `Wire.send(message)`, a `WireTree = DeixisNode<Wire>`, and an `AddressedWire` carrier bridge.
- **Earlier.** Decision 0006 described an origin plus named, possibly opaque addressed access,
  with Unicode-string keys whose image excluded arbitrary binary keys.
- **4 October 2026.** bitwire 0.4.0 replaced all of it. Published releases remain immutable
  history, not supported profiles.
- **Implementation ownership** is unchanged: bitwire holds the contract and its independent cases,
  and bitruntime implements them. Historical results do not certify the replaced implementation.

The proposed generic structural service (deixis-svc) must not treat a relay or a connection as a
complete tree. A relay-backed structural interface needs an application protocol that supplies
discovery and snapshots (ADR 0013 §8). Nothing on this page certifies a sibling repository from
deixis.
