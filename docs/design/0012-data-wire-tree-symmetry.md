# Data / DataTree and Wire / WireTree

**Current interpretation:** [ADR 0014](0014-structural-identity-and-lifted-access.md)
reaffirms this record's structural symmetry and supersedes the interaction
retirement in the dated ADR 0013 amendment below. That amendment is retained as
historical evidence. Current binding and snapshot boundaries remain in force.

**Status:** accepted, 2026-09-26, by the operator's explicit instruction:
"Use Data / DataTree and Wire / WireTree" and "Make sure to document this
everywhere and do the renaming." The operator accepted breaking renames before
more services depend on the previous names.

*(Amended 2026-10-05: [ADR 0013](0013-binding-views-and-the-service-line.md) supersedes this
record's interaction terminology, after bitwire 0.4.0 (its decision 0014) replaced the
addressless sender with a duplex envelope `Wire`. `Wire` as an addressless sender,
`WireTree = DeixisNode<Wire>` and the `AddressedWire` bridge are no longer family names. The
principal interaction instance is a receiver-side tree of handlers. This record's complete
structural contract, its `Data` naming and its snapshot rules stand. ADR 0013 §7 also defines the
"separate consumer operation" below as bitstore's `restoreSnapshot`.)*

## Decision

The primitive names are `Data` and `Wire`. They grant addressless operations:

```ts
type Bytes = Uint8Array;
interface Data { read(): Promise<Bytes> }
interface Wire { send(message: Message): void }

type DataTree = DeixisNode<Data>;
type WireTree = DeixisNode<Wire>;
```

`Message` and send admission/refusal remain bitwire's payload and interaction
contract. `Data.read` belongs to bitstore; successful reads represent fixed byte
content. A read can fail for storage or transport reasons. deixis interprets
neither operation, chooses no payload equality, and does not close a resource.

Both trees implement the **same complete structural contract** described in
[API.md](../API.md): own value, complete exact-byte-keyed children, partial path
selection, and decomposition/reconstruction. Their structure is finite and
well-founded. The structural API itself is synchronous; asynchronous work lies
behind the payload operation. Discovering a lazy or remote structure requires
an explicit loader or separate effectful view before claiming this interface.

The operations at an existing path are derivations, not alternate routing laws:

```text
read(tree, path)          = select(tree, path).own().read()
send(tree, path, message) = select(tree, path).own().send(message)
```

`select` is the partial `at` operation. A missing path is resolved before any
payload operation; it must remain distinguishable from a present node whose
read fails or whose send is refused. An empty path selects the node itself. An
empty byte key is a real child key. Paths use exact bytes, not an implicit UTF-8
restriction, slash parser, normalization, or parent navigation.

An addressed-only access facade is not a `WireTree` or `DataTree`: it omits the
complete structure. Retaining such a facade for transport or compatibility does
not entitle it to the full deixis contract. Lifecycle and receive ownership are
separate from the addressless `Wire.send` capability.

## Data readers and byte snapshots

`DataTree` is `Node[Data]`, not `Node[Bytes]`. Materializing a data tree reads every
Data payload and retains the same structure, producing a `Node[Bytes]` snapshot.
It can fail; successful byte content is fixed, so a snapshot does not depend on
the order of successful reads. Such a snapshot can be encoded with the existing
identity-bytes codec. Encoding bytes does not serialize a reader, its ambient
credentials, or a live sending capability. Reconstructing readers from persisted
bytes is a separate consumer operation.

No `dxf2` or `dxl2` grammar, slot-codec identifier, candidate profile, existing
release, or content address changes through this naming decision. The codec
remains **candidate, not frozen**. It still encodes the selected payload type
under its supplied codec; it does not magically make arbitrary capabilities
portable.

## Binding and migration

TypeScript exports the structural `DeixisNode<T>` interface. The native `Node`
constructor implements it: `own` becomes `own()`, and `children()` is the common
complete child-map operation. Existing `entries()` remains a traversal spelling.
The exported `compose` reconstructs `DeixisNode<T>` parts without requiring
children to be instances of the native `Node` class.
The mandatory payload and reconstruction model of ADR 0010 is unchanged.

Go exports the same recursive interface and `AsTree` for native `Node[T]` values.
`ComposeTree` reconstructs its interface parts without requiring native children.
An adapter is necessary because Go does not treat a concrete `Node[T]` return as
covariant with a `DeixisNode[T]` return. Rust and Python keep their idiomatic
native `Node` bindings and the same structural laws; naming a TypeScript
interface does not require renaming every native model constructor.

bitwire's former addressed `Wire` name, the draft addressless `End` name,
bitstore's former materialized `Data` name, and the proposed `ByteSource` name
are superseded for the current family API. Historical releases and decisions
retain their original meanings, with current guidance pointing to this decision.

This private repository remains private. Public bitwire and bitstore bindings
must remain installable without access to it. Their self-contained structural
bindings implement the same published shape and laws; sharing that contract does
not require a private package dependency or publication of this repository.
*(Amended 2026-10-05: since 2026-10-04 deixis is public, as `Bitspark/deixis`,
so the privacy this paragraph assumed no longer holds. The rule stands for its
other reason: bitwire's and bitstore's self-contained bindings implement the same
shape and laws, and sharing the contract needs no package dependency on deixis.)*

## Validation boundary

Static TypeScript shapes cannot prove finiteness, well-foundedness, key copying,
or decomposition laws for arbitrary implementations. Implementations owe these
laws in addition to satisfying the interface. Native constructors enforce the
child-map invariants. Conformance continues to judge the unchanged structural
model and candidate codec. The binding tests exercise Data and Wire payloads
through one interface, including binary keys and the distinction between a
missing child and a child that refuses a message.
