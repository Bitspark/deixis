# Identity and boundaries

deixis is **complete, exact structure over opaque values**. It applies equally to
bytes, readers, senders, handlers, names and other carriers. A consumer's preferred
interaction model does not specialize this definition.

```text
Node[T] = T × FinMap[Bytes, Node[T]]
Path    = Bytes*
```

The current model is the mandatory-value model of [ADR 0010](docs/design/0010-mandatory-node-values.md).
[ADR 0014](docs/design/0014-structural-identity-and-lifted-access.md) explains the
reconsideration of the interaction boundary. This charter identifies the promises
that changes must account for; it does not freeze the candidate codec or claim
unproved properties of distributed systems.

## Structural invariants

| ID | Promise | Counterexample that violates it |
| --- | --- | --- |
| D1 | Every node has one opaque own value and a complete finite child map; the structure is finite and well founded. | Inventing a default parent value, or presenting an unfetched remote subtree as a complete node. |
| D2 | Keys are exact bytes and paths retain segment boundaries. Sibling presentation order is not identity. | Treating the empty path as an empty-key child, normalizing text, or joining segments lossily. |
| D3 | Selection follows children only. Empty selection is self; missing selection stays missing. | Following a name inside an own value, defaulting to an ancestor, or creating a missing child. |
| D4 | `at(at(N,p),q) = at(N,p++q)`, including equal definedness. | A path cut changes which node is selected or whether it exists. |
| D5 | Decomposition and composition are exact in both directions. Own values and whole child subtrees are retained. | Reconstructing from children alone, cloning a live participant, or dropping an interior own value. |
| D6 | Structural operations do not bind names, invoke values, acquire or dispose of their resources. | Enumerating a tree sends a message, opens a connection, or closes a borrowed endpoint. |
| D7 | Identity lifts a supplied equivalence over values and exact structural equality. Construction needs no value equality. | Comparing hidden representations when the declared equivalence identifies them, or inferring behavioral equivalence from equal bytes. |
| D8 | Mapping values preserves paths and commutes with selection. | A mapping silently rekeys, prunes, resolves or interprets values. |

The laws and their domains are in [TREE](docs/TREE.md), [PATH](docs/PATH.md) and
[SLOTS](docs/SLOTS.md). Native representation sharing is not an additional tree
identity. Preserving an existing local capability during reconstruction does not
promise object identity between separately bound proxies.

## Lifted access

For a declared operation `m` on `T`, its path-indexed use is:

```text
lift_m(N, p, args) = at(N, p).own().m(args)
```

Resolve the path first; if absent, report structural absence and invoke nothing.
If present, invoke the selected operation exactly once. Refusal or failure of that
operation is distinct from structural absence. Hence:

```text
lift_m(at(N,p), q, args) ≈ lift_m(N, p++q, args)
```

This is a derived use of the tree, not reflection, an invocation engine, or an
extra method in the pure core. For effects, the comparison uses the same selected
capability, corresponding initial state, scope, aliases and operation schedule.
It does not mean executing both sides consecutively must return the same result.

`DataTree = Node[Data]` and `WireTree = Node[Wire]` are equally valid instances;
addressless `read()` and `send(message)` supply the respective operations. A
receiver's handler tree is another equally valid instance. Neither a transport
connection nor an opaque `send(path, message)` facade alone is a complete tree.

## Consumer boundaries

| Concern | Owner and limit |
| --- | --- |
| Pure structure, selection, reconstruction, codec laws | deixis; no I/O, name lookup, transport, application vocabulary or authority policy. |
| Addressless send, endpoint ownership, addressed access and their message laws | bitwire; the addressed layer has a path argument, and is distinct from complete structure. |
| Carriers, queues, dispatch, connection lifetime and implementations of those layers | bitruntime; carrier implementations need only the addressless endpoint contract. |
| Binding names, identity and authority checks | A declared binding profile and its runtime; preparation may be pure, resolution is explicit. |
| Discovery, paging and snapshot promotion | An explicit effectful view protocol; failure to fetch does not prove absence. |
| Requests, replies, errors, cancellation and streams | Consumer message conventions; not inferred from a tree or required by a wire. |

Encoding a name does not serialize a live capability. Binding a path does not
prove remote existence, authority, stable target identity or future availability.
Transporting or relaying messages needs its own framing, ordering, admission,
failure, ownership and resource contract. The structural laws prove none of those
operational guarantees on their own.

## Amendment discipline

A change to these promises requires an explicit design record that names the
affected invariant IDs, supplies the problem or counterexample, considers the
unchanged contract as an alternative, states the new laws, and accounts for
consumer migration and evidence. A consumer release, successful build, advisory
answer or unanswered notification cannot silently amend the foundation.

An advisory answer must be evaluated against its input assumptions. Record which
boundaries the consultation was allowed to question; a premise fixed in the
question is not a conclusion independently established by the answer. Distinguish
decision authority, independent review, implementation agreement and conformance.

Preserve historical records and add explicit supersession links. Update current
normative documents together so readers encounter one current contract. Tests
must exercise the promised observations and counterexamples, not merely ban or
require type names. The review can authorize a reasoned amendment; these rules
do not require another routine user confirmation.
