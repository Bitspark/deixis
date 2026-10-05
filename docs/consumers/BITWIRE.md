# bitwire: addressless interaction and lifted access

**Decision:** [ADR 0014](../design/0014-structural-identity-and-lifted-access.md),
2026-10-05. The layered replacement is being implemented in bitwire and bitruntime;
this mapping does not certify a release. Immutable bitwire 0.4.0 and bitruntime
0.5.0 describe the previous duplex envelope contract.

```ts
interface Wire { send(message: Value): Promise<void> }
interface AddressedWire { send(path: Path, message: Value): Promise<void> }
type WireTree = DeixisNode<Wire>;
```

`Value` is a ground Ontos value. `Path` retains exact byte keys and segment
boundaries. An endpoint additionally owns receiving and closure; exposing a
send-only Wire does not hand out those rights. Carriers implement addressless
endpoints. The same addressing layer can be used over every carrier.

## The structural relationship

A WireTree has own send capabilities, complete finite children, exact partial
selection, and decomposition/reconstruction. Derived addressed sending is
`select(tree,path).own().send(message)`. Missing selection invokes nothing;
refusal by an existing sender remains a different outcome. Empty self and an
empty-key child differ. No normalization, ancestor fallback or implicit mounting
is performed.

A tree of receive handlers is another complete instance. Dispatch is selection
followed by invocation. Neither its usefulness nor a runtime's choice to use it
changes what a sender tree means. deixis implements neither dispatch nor send.

An opaque addressed facade supplies no complete child map and proves no remote
membership. Prefix binding such a facade returns access in a narrower relative
path scope; it is not structural selection. Discovery needs a protocol that
actually supplies membership, enumeration and any promised snapshot coherence.

## Agreements owned above deixis

bitwire defines message admission, ordering, ownership, failure, resource bounds
and canonical carrier/addressed formats. bitruntime implements those contracts.
Application protocols supply IDs, correlation, reply routes, invocation and
authorization. Designation alone never supplies authority.

Sending successfully means local admission, not remote existence, execution or
response. Binding a path does not pin a participant: stable target IDs, routing
revisions or a no-reassignment rule are additional profile choices. Existing
connection-bound capabilities never migrate silently to new connections.

Portable names and scoped binding follow ADR 0013's preparation/resolution
distinction. Encoding names does not encode live capabilities. Complete tree
construction and reconstruction preserve borrowed capabilities without acquiring
or releasing their resources. Cross-path ordering and shared state remain
operational obligations, not consequences of path associativity.

## Decision history

- September's ADR 0012 established Data/DataTree and Wire/WireTree symmetry.
- bitwire 0.4.0 removed the addressless/addressed distinction with the RPC cleanup.
- ADR 0013 adopted that consumer change as its interaction baseline.
- ADR 0014 restores the separation on its merits while retaining exact byte paths,
  Ontos values, explicit lifecycle laws and the removal of RPC compatibility.

Current implementation evidence must be recorded by the owning repositories.
The structural corpus proves neither remote discovery nor relay transparency.
