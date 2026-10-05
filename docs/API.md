# Required-payload core APIs

## One structural contract

[ADR 0012](design/0012-data-wire-tree-symmetry.md) fixes the family names:
`Data.read()` and `Wire.send(message)` are addressless primitives;
`DataTree = DeixisNode<Data>` and `WireTree = DeixisNode<Wire>` have identical
structure. *(2026-10-05: [ADR 0013](design/0013-binding-views-and-the-service-line.md)
supersedes the interaction half of this: bitwire 0.4.0's `Wire` is a duplex envelope
connection, the principal interaction instance is a receiver-side tree of handlers, and
`WireTree` is no longer a family name. Binding portable names to capabilities is ADR 0013 §2. The
structural contract below is unchanged.)* The TypeScript core exports this binding:

```ts
type Key = Uint8Array;
type Path = readonly Key[];

interface Parts<T> {
  readonly own: T;
  readonly children: ReadonlyArray<readonly [Key, DeixisNode<T>]>;
}

interface DeixisNode<T> {
  own(): T;
  children(): ReadonlyArray<readonly [Key, DeixisNode<T>]>;
  at(path: Path): DeixisNode<T> | undefined;
  decompose(): Parts<T>;
}

declare function compose<T>(
  own: T,
  children: Iterable<readonly [Key, DeixisNode<T>]>,
): DeixisNode<T>;
```

`children` and `decompose().children` are complete maps of whole subtrees, with
exact byte keys; they are never a lossy list of reachable paths. The exported
`compose(parts.own, parts.children)` reconstructs the interface from complete
parts, including children supplied by independent bindings. Structures are finite and
well-founded, keys are copied, and every existing node has its own `T`. These
laws are obligations beyond TypeScript's structural type check. A payload that
refuses an operation remains present. Selection is synchronous and partial; a
remote or lazy loader is a separate operation, not an undisclosed effect of `at`.

For an existing path, the consumer operations are precisely:

```text
read(tree, path)          = tree.at(path).own().read()
send(tree, path, message) = tree.at(path).own().send(message)
```

bitstore's `Data.read(): Promise<Bytes>` may perform I/O. A DataTree is a tree of
readers, while an identity-bytes codec snapshot is `Node[Bytes]`. Reading each
payload creates that materialized snapshot; the codec never serializes reader
capabilities. bitwire owns the message, admission/refusal, receive, and lifetime
contracts. None of them changes deixis's structural laws.

The Go projection is:

```go
type Key = []byte
type TreePath = [][]byte
type Child[T any] struct { Key Key; Tree DeixisNode[T] }
type DeixisNode[T any] interface {
    Own() T
    Children() []Child[T]
    At(TreePath) (DeixisNode[T], bool)
    Decompose() (T, []Child[T])
}
func ComposeTree[T any](own T, children []Child[T]) (DeixisNode[T], error)
```

`AsTree(nativeNode)` exposes this interface without changing the concrete return
types of native `Node[T]`. `ComposeTree` reconstructs decomposed interface
parts, while native `Compose` continues to accept concrete `Entry` values.
Both generic constructors copy keys, reject duplicates, and retain lawful
child trees without materializing their payloads or hidden implementations.
Other languages preserve idiomatic spellings for the
same structure. Independent bindings in other repositories, such as bitwire's
and bitstore's, implement the same shape and laws without depending on these
packages.

## Native constructors

The four implementations use the model of
[ADR 0010](design/0010-mandatory-node-values.md):

```text
Node[T] = T × FinMap[Bytes, Node[T]]
```

Construction requires a supplied `T`. Decomposition returns that payload and
the complete child map. Own-value access returns the whole payload. Navigation
has a separate success/missing result.

| Language | Construct | Complete parts | Payload | Select subtree |
| --- | --- | --- | --- | --- |
| Rust | `Node::compose(t, children)` | `node.decompose() -> (T, Vec<(Key, Node<T>)>)` | `node.own() -> &T` | `node.at(path) -> Option<&Node<T>>` |
| Go | `deixis.Compose(t, children)` | `node.Decompose() (T, []Entry[T])` | `node.Own() T` | `node.At(path) (Node[T], bool)` |
| TypeScript | `Node.compose(t, children)` | `node.decompose(): {own: T, children: …}` | `node.own(): T` | `node.at(path): Node<T> \| undefined` |
| Python | `Node.compose(t, children)` | `node.decompose() -> tuple[T, list[tuple[bytes, Node[T]]]]` | `node.own: T` | `node.at(path) -> Node[T] \| None` |

Construction rejects duplicate keys. It sorts and owns the child-key structure;
it does not infer a parent value, clone an opaque payload or compare values.
Rust's decomposition consumes the node. Go, TypeScript and Python return child
collections that cannot mutate the original structure through their keys.
Payload mutability is the caller's concern.

For example, a TypeScript handler tree needs no option wrapper:

```ts
type Handler = (data: Uint8Array) => void;
const child = Node.compose<Handler>(childHandler, []);
const root = Node.compose<Handler>(rootHandler, [[key, child]]);
root.own()(data);
const selected = root.at([key]);
if (selected !== undefined) selected.own()(data);
```

The variables `childHandler`, `rootHandler`, `key` and `data` are supplied by
the application. This is structural handler storage, not a definition of Wire's
behavioral or lifetime contract. TypeScript's former `node.own` property is now
the `node.own()` method; a callable payload therefore needs a second invocation.
`node.children()` returns the complete child map; `entries()` remains available
as a native traversal helper. Earlier release interfaces are historical.

Use `Node[Option[U]]` only when the payload domain needs optional values. Rust
uses its native `Option`; Go offers `deixis.Option`; TypeScript offers
`Option<U> = Some<U> | undefined`; Python offers `Some[U] | None`.
These helpers have no special treatment inside `Node`. A raw `None`, `null`,
`undefined` or nil pointer is also a payload when admitted by the selected `T`.
Check the subtree lookup result before reading its payload so a missing path
cannot collapse with such a value.

`equal_by` / `EqualBy` / `equalBy` takes a relation on the **whole `T`**.
For an optional payload, callers explicitly lift their `U` equivalence to
distinguish `None` from `Some`. A different lawful relation, such as total
equivalence on the option carrier, is permitted. There is no payload-tag test
inside the core equality algorithm.

The set profile chooses the conventional optional specialization: its root
carries `None`, and each childless member carries `Some(u)` under its encoded
key. Its public node types reflect that choice.

This is an API change. Earlier core constructors and automatic option
wrapping are not compatibility requirements. Mapping, contexts, cuts and
attachment remain derivations through the minimal core APIs; their conformance
implementations are not additional public library methods. Packages pinned to
an earlier release have not adopted this interface merely because main has it.

## Codec: `deixis-codec-v2` (candidate)

Since v0.3.0, each core encodes and decodes `Node[T]` under
[`deixis-codec-v2`](CODEC.md): a flat form (`dxf2`) and a linked form (`dxl2`, one
SHA-256-addressed chunk per node). The contract is a **candidate, not frozen**. Bytes
and addresses produced now are not stable identities (CODEC.md §16).

The four APIs share one shape:

- **A slot codec** is `{id, equivalence, encode, decode}`, supplied and used as one
  unit (CODEC.md §4). Identity-bytes (id `00 01`) and option-of (id `02 ‖ id(c)`) are
  built in. Any other codec, such as a private one for an application's payload type,
  is the caller's.
- **Holding is explicit.** A decoder is handed the codecs it holds, and option-of over
  a held codec is held. A header naming anything else is `unsupported_slot_codec`,
  never guessed at. An accepted value comes back together with the codec it was
  decoded under, so later comparisons use that codec's equivalence.
- **Verdicts keep §9's four classes apart:** invalid, unsupported, incomplete
  (`need_more_input`, streaming only) and resource-refused (`limit_exceeded` with a
  §12 dimension). Store outcomes (`missing_chunk`, `hash_mismatch`) come back
  separately and are never verdicts.
- **Limits default to §12's floors.** Materialization and flattening take an explicit
  budget.
- **The linked form** is resolved from a root address through two separate
  constructors, resolve-root and resolve-child (§14). A closure can be checked,
  estimated, materialized or flattened without materializing to measure it.

| | Rust | Go | TypeScript | Python |
| --- | --- | --- | --- | --- |
| Module | `deixis_core::codec` | package `deixis` (`core/go`) | `@bitspark/deixis-core/codec` | `deixis_codec` (`core/py`, source-only) |
| Slot codecs | `IdentityBytes`, `OptionOf::new(c)` | `IdentityBytes()`, `OptionOf(c)` | `identityBytes`, `optionOf(c)` | `IDENTITY_BYTES`, `option_of(c)` |
| Holding | any `impl Registry` (a codec is a registry of its own id) | `Holding(codecs...)` | `new Registry(codecs)` | `registry_of(*codecs)` |
| Flat encode | `encode_flat(&node, &codec)` | `EncodeFlat(node, codec)` | `encodeFlat(node, codec)` | `encode_flat(node, codec)` |
| Flat decode | `decode_flat(octets, &registry, &limits)` | `DecodeFlat(b, registry, limits)` | `decodeFlat(bytes, registry, limits?)` | `decode_flat(data, registry, limits)` |
| Streaming decode | `FlatDecoder::new(&registry, limits)`, `feed`, `finish` | `NewFlatDecoder(registry, limits)`, `Feed`, `Finish` | `new FlatDecoder(registry, limits?)`, `feed`, `finish` | `FlatDecoder(registry, limits)`, `feed`, `finish` |
| Header only | `read_header`, `HeaderDecoder` | `ReadFlatHeader`, `NewFlatHeaderValidator` | `readFlatHeader`, `FlatHeaderReader` | `read_header`, `HeaderReader` |
| Linked encode | `encode_linked(&node, &codec)` | `EncodeLinked(node, codec)` | `encodeLinked(node, codec)` | `encode_linked(node, codec)` |
| Resolve root / child | `Chunk::resolve_root(&addr, &store, &limits)`, `chunk.resolve_child(key, &store, &limits)` | `ResolveRoot(addr, fetch, limits)`, `chunk.ResolveChild(key, fetch, limits)` | `LinkedChunk.resolveRoot(addr, fetch, limits?)`, `chunk.resolveChild(key, fetch, limits?)` | `resolve_root(addr, fetch, limits)`, `resolve_child(parent, key, fetch, limits)` |
| A chunk's entries, each key with its child's address | `chunk.entries()` (key, links-header position) with `chunk.links()` | `chunk.Children()` | `chunk.children()` | `chunk.children` |
| Check closure | `Closure::check` | `CheckClosure` | `checkClosure` | `check_closure` |
| Estimate unfolded size | `closure.unfolded()` | `EstimateUnfolded` | `estimateUnfolded` | `estimate_unfolded` |
| Materialize | `closure.materialize(&registry, &limits)`, or `resolve` from an address | `Materialize(chunk, fetch, registry, limits)`, or `DecodeLinked` from an address | `decodeLinked(root, fetch, registry, limits?)` | `materialize(address, fetch, registry, limits)` |
| Flatten | `closure.flatten`, or `flatten` from an address | `Flatten` | `flattenClosure` | `flatten` |
| Verdicts | `Refusal::{Invalid, Unsupported, LimitExceeded}`, `Progress::NeedMoreInput`; store: `LinkedError::Store` | `*InvalidError`, `*UnsupportedError`, `*IncompleteError`, `*LimitError`; store: `*StoreError` | a `class` field on every result; store: `class: "store"` | `Invalid`, `Unsupported`, `Incomplete`, `ResourceRefused`; store: `StoreFault` |
| Limits | `Limits` (`Limits::FLOORS` by default) | `Limits`, `DefaultLimits()` | `FLOORS`, optional per call | `Limits`, `FLOORS` |

Addresses are the pair (`dxl2`, 32-octet digest) in every language, never a bare
array. TypeScript represents every `cuvarint` value as a `bigint`.

The conformance CLIs hold identity-bytes plus a private fixture codec, which exists
only to test the laws. It is not part of any public API. A codec for handler or
definition **names** serializes names. Binding a decoded name to behaviour is the
application's act, and no codec makes behaviour itself transferable.
