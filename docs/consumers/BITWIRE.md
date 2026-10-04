# bitwire: Wire and WireTree

**Accepted contract, 2026-09-26.** The operator chose the symmetric primitive
and tree names in [ADR 0012](../design/0012-data-wire-tree-symmetry.md):

```ts
interface Wire {
  send(message: Message): void;
}

type WireTree = DeixisNode<Wire>;
```

`Wire` is addressless sending access. `WireTree` is the full deixis structure,
not merely an interface that can dispatch to paths. The shared structural
contract is specified in [API.md](../API.md); the corresponding storage
instantiation is [DataTree](BITSTORE.md).

## What it takes from the floor

- Every node has an own `Wire` and a complete child map. A refusing Wire is
  still an own value; it does not mean that the node is missing.
- Keys are exact byte strings. Both trees use this same key domain, including
  empty and non-UTF-8 keys. String keys are an explicit application encoding,
  not the complete structural key domain.
- `own()`, `children()`, `at(path)` and decomposition expose the full
  structure. Selection is partial: an absent child is distinguishable from a
  present child whose Wire refuses every send. Empty-path selection is self.
- Construction and recomposition preserve the own value and complete map.
  Every tree is finite and well-founded; opaque payloads remain opaque.
- Structure alone does not choose an equality or a codec for Wire values.
  Those require a separately supplied relation or representation, as for any
  other payload in [SLOTS.md](../SLOTS.md).

Addressed sending is derived, on paths for which selection succeeds:

```text
send(tree, path, message) = select(tree, path).own().send(message)
```

Missing selection must be reported as missing, rather than replaced with a
default Wire. deixis specifies the selection result; the operation adapter
defines how it reports that result to its caller. Binding a path prefix alone
does not establish that a subtree exists.

## What it adds above it

bitwire owns the message, send-admission, refusal, receiving and lifecycle
contracts. A bare sending `Wire` does not by itself grant receive attachment
or closing. bitruntime supplies implementations and derived operations under
bitwire's contract. deixis implements neither transport nor dispatch.

Remote or restricted addressed access may be useful, but a handle that only
offers `send(path, message)` is not the full `WireTree` contract. It needs a
distinct access interface unless it also supplies complete structure and
partial selection. Similarly, an opaque child that accepts arbitrary paths
on demand cannot be called a finite deixis subtree merely because prefix
composition works.

## Migration and evidence

This is a breaking contract selection, not a declaration that every bitwire
language binding and runtime has already migrated. The consumer's package
versions, tests and release records establish implementation status.

The earlier
[decision 0006](https://github.com/Bitspark/bitwire/blob/main/docs/decisions/0006-declared-composites-realize-deixis-nodes.md)
was accepted on 2026-09-23, added in `fdc2ae9`, and clarified in `150d67c`.
It described an origin plus named, potentially opaque addressed access, with
composition observed through send behavior and retained parts available to
the construction owner. Its keys were Unicode scalar strings mapped to
UTF-8, so its image excluded arbitrary binary keys. Those were the guarantees
of that earlier access contract; they do not establish the new full tree
contract. The proposed `End` primitive and addressed `Wire` naming in the
later draft is superseded by the operator's `Wire` / `WireTree` choice.

Implementation ownership remains the split recorded in bitwire decisions
[0007](https://github.com/Bitspark/bitwire/blob/main/docs/decisions/0007-using-bitwire-never-requires-nightseam.md)
and
[0010](https://github.com/Bitspark/bitwire/blob/main/docs/decisions/0010-bitwire-holds-the-contract-and-bitruntime-implements-it.md):
bitwire holds the contract and conformance; bitruntime implements them.
Historical nightseam results and earlier declared-composite interpreters do
not certify a renamed or extended implementation.

The separate deixis-svc proposal must preserve this same full
structural contract. Its deployment and crossing behavior require their own
evidence. Nothing on this page certifies a sibling repository from deixis.
