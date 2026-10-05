# bitstore: Data and DataTree

**Accepted contract, 2026-09-26.** The operator chose the symmetric primitive
and tree names in [ADR 0012](../design/0012-data-wire-tree-symmetry.md):

```ts
type Bytes = Uint8Array;

interface Data {
  read(): Promise<Bytes>;
}

type DataTree = DeixisNode<Data>;
```

`Data` is addressless access to fixed bytes. Successful reads of the same
Data return the same content; failures remain explicit. `DataTree` has the
same complete structural interface as every deixis tree, including the receiver handler trees on
[bitwire's page](BITWIRE.md), documented in [API.md](../API.md). Restoring snapshot readers from a
`Node[Bytes]` is bitstore's `restoreSnapshot`, with the one-way law
`materialize(restoreSnapshot(S)) = S`
([ADR 0013](../design/0013-binding-views-and-the-service-line.md) §7). An own Data and a complete child map exist at every node,
keys are exact bytes, and every tree is finite and well-founded.

Reading at a path is derived, where selection succeeds:

```text
read(tree, path) = select(tree, path).own().read()
```

A missing node is distinct from a node holding empty bytes and from a node
whose Data read fails. `at(path)` selects structure; `read()` may perform I/O.
Neither a read nor a send changes the meaning of structural selection.

## Materialization and persistence

A reader is a capability, not the bytes it returns. bitstore must materialize
the own Data at each node before encoding a complete snapshot:

```text
DataTree = DeixisNode[Data]
snapshot = DeixisNode[Bytes]
```

The snapshot uses the candidate `deixis-codec-v2` identity-bytes profile.
The rename does not change `dxf2` / `dxl2`, slot codec identities, hash domains
or the distinction between a raw SHA-256 blob and a qualified deixis root.
The profile remains a candidate, not a frozen identity guarantee; see
[CODEC.md](../CODEC.md). A Data capability itself is not serialized under the
identity-bytes codec.

The raw content-addressed `Store` is separate persistence machinery. It can
hold snapshots and their chunks without being either the Data primitive or
the DataTree structure. A store-backed view can fetch or materialize
structure, but an incomplete lazy index is not a complete DataTree merely
because it can look up known paths.

## Delivery boundary

The public [bitstore repository](https://github.com/Bitspark/bitstore) owns the
library; the private bitstore service owns its server and deployment. Public
bitstore [v0.1.0](https://github.com/Bitspark/bitstore/releases/tag/v0.1.0)
delivered Go and TypeScript implementations with an earlier naming: `Data`
was the immutable materialized byte tree. The new `Data` / `DataTree` names
are a breaking migration, not a reinterpretation of that published package.
Sibling package versions and their conformance establish when each migration
has shipped; this mapping does not certify their implementation.

The storage-backed deixis-svc proposal must use the same
structural contract as its interaction-backed instance. The raw store
contract, structural service contract and application data profile are
different contracts and must be advertised separately.
