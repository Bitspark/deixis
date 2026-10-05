# Binding names, views that are not yet trees, and the service line

**Status:** accepted, 2026-10-05, by this repository's agents (seat caa). The decision follows an
expert consultation (deixis-internal research 0005, graded on deixis-internal#49). The
repositories it reaches were told on their design issues before it was recorded: deixis-svc,
bit-services-contract, bitstore-svc, bitwire and bittheory.

It **supersedes the interaction terminology of [ADR 0012](0012-data-wire-tree-symmetry.md)**:
`Wire` as an addressless sender, `WireTree = DeixisNode<Wire>`, and the `AddressedWire` bridge.
ADR 0012's complete structural contract, its `Data` naming and its snapshot rules stand.

## Context

- **ADR 0012 left an operation without an owner.** It put live capabilities into trees
  (`DataTree = DeixisNode<Data>`, `WireTree = DeixisNode<Wire>`). It said "reconstructing readers
  from persisted bytes is a separate consumer operation", and did not define that operation or
  give it an owner.
- **bitwire moved on 4 October 2026.** bitwire 0.4.0 (its decision 0014) replaced the addressless
  sender with one duplex `Wire` that sends and receives envelopes, each carrying source and
  destination byte paths scoped to the connection. `WireTree` and `AddressedWire` no longer exist
  there. bitruntime 0.5.0 routes envelopes into a receiver-side tree of handlers: `route(tree, e)`
  is `tree.at(e.destination)` followed by invoking its own value.
- **The interpretation law was stated four times without being reconciled:**
  - [ADR 0010](0010-mandatory-node-values.md) §7 with [ADR 0009](0009-optional-node-values.md)
    §11;
  - the theory paper's binding-context law;
  - [WIRES.md](../WIRES.md) §4's routing law;
  - an external review's equivariance statement.
- **No owner for the current root.** Nothing in the family owned a name's current root, its
  compare-and-swap, retention, capability lifetime or restart.

## Decision

### 1. Four concerns stay separate

> **Structure says which positions exist. Binding establishes what an existing name denotes in a
> declared scope. Invocation determines what the resulting capability does. Mutable services
> govern which roots are current and which resources remain retained.**

deixis owns the first: the tree, its laws, its codec and its vectors. It gains no I/O, no names and
no time. Everything below is defined *above* deixis in terms of its accessors, except §10, which
lists what deixis itself ships.

### 2. Binding is two stages

A **binding profile** declares:
- a target capability type `A`;
- the admitted name formats;
- the authority requirements;
- the identity rules;
- the lifecycle rules.

Under it:

```text
prepareγ : Node[Name] → Node[BindingRequest[A]]
resolve  : BindingRequest[A] → M(BindResult[A])

BindResult[A] = Bound(A) ⊎ Refused(reason) ⊎ Fault(cause) ⊎ Cancelled
```

- **Preparation is pure.** A `BindingRequest` keeps the original name bytes and captures its
  binding scope: the profile, site or session, namespace origin, authority context, and the
  revision or incarnation constraints that fix what success may denote. Constructing one never
  consults a table, opens a connection, starts I/O or invokes a capability.
- **Preparation is a context-indexed map**, `P_γ(Node(n,m)) = Node(request(γ,n), {k ↦
  P_{γ·[k]}(m[k])})`, where `γ·p` moves a lexical cursor inside the captured scope. For absolute
  names under one context it is an ordinary `map`.
- **Moving a subtree never re-roots it.** Its captured origin stays. Reinterpreting relative names
  under a new origin is a separate, explicit operation.
- **The prepared tree is the primary interpreted tree.** It is `Node[BindingRequest[A]]`, not yet
  `Node[A]`. An unrecognized name still occupies an existing node. It does not acquire a pretend
  capability.

The ordinary use is: select, report structural absence if the path is missing, otherwise
`resolve` the selected request, and invoke the capability only on `Bound`.

**The law** for preparation, using Kleene equality up to the profile's relation:

```text
at(P_γ(N), p)  ≃_Q  P_{γ·p}(at(N, p))
```

Both sides are undefined exactly when the source path is missing. Refusal, fault and cancellation
are defined results of resolving an existing request; none of them becomes structural absence.
Behavioural comparisons start from corresponding initial binding worlds and use the same admitted
operation schedule.

This reconciles the earlier statements:

| Obligation (ADR 0010 §7, ADR 0009 §11) | Reading for binding |
|---|---|
| (H) homomorphism over `compose` | preparation assembles requests without resolving them; reconstructing a prepared tree preserves its requests and scopes |
| (A) selection commutes | the law above, including equal structural definedness |
| (G) congruence | admitted assembly contexts preserve captured scope, authority, target identities, aliases and resource ownership |
| (V) realization independence | a separate profile obligation over the binding world and the permitted observations, never a consequence of structural equality. This qualification is now normative. |

**Whole-tree binding is an optional batch, never the foundation.**
- `resolveAllOrFail : Node[BindingRequest[A]] → M(Node[A])` cannot carry the unconditional
  selection law. Take a tree with a live child `a` and an expired sibling `b`: the batch fails,
  while selecting `a` and resolving only it succeeds.
- `resolveAll : … → M(Node[BindResult[A]])` preserves shape, but a result sum does not isolate
  effects. If resolving `b` revokes the capability just returned for `a`, the batch and the
  selective use differ even though both result trees have the right paths.
- A batch therefore declares its own scheduling, cancellation, cleanup and interference rules.

Two adapters are allowed as consumer conveniences, not as the binding contract:
- **A deferred `Data` reader** built from a request. Its failures must say whether they arose in
  binding or in the read.
- **An application send adapter** (for example `SendAt`), never a replacement `Wire`. A binding
  refusal in it is not a `Wire.send` rejection, since `send` need never have been called.

### 3. Outcomes carry phase and cause

| Situation | Classification | Reported by |
|---|---|---|
| path missing from a complete tree | structural absence | `at` |
| name malformed for the profile, unsupported, or unrecognized | binding refusal, with a reason | `resolve` |
| name expired, revoked, unauthorized, or of a stale incarnation | binding refusal, once established | `resolve` |
| backend unreachable, or the binding exchange fails | binding fault | `resolve` |
| chunk missing, hash mismatch, address conflict | store fault, kept as the underlying cause | store adapter |
| chunk violates the grammar | decoder verdict, kept as the underlying cause | decoder or store adapter |
| a bound capability then fails | capability-operation failure | `read`, `send` or the application operation |
| a remote child set cannot be established | view-operation failure; the structure stays unknown | the discovery interface (§8) |
| an envelope was admitted, then the connection was lost | application outcome possibly unknown | an exchange protocol above the wire |

**Failure to establish validity is not proof of invalidity.** An unreachable authority yields a
fault, never an invented refusal. A correctly decoded own value can still be an invalid *name* for
a profile: name syntax is not tree encoding.

### 4. Admitted names are profile-specific

deixis defines no universal name language. A profile declares the names it understands and what
each denotes:
- **Data references** say exactly which fixed bytes the reader yields. A qualified tree root
  denotes a tree, not its own bytes or its serialization.
- **End references** name the issuing authority, target identity, incarnation, routing and
  restoration requirements. Local handles never appear in portable form.
- **Cell references** name mutable registers. To derive a `Data` reader, observe the cell and pin
  the root first, because a reader that followed the cell would break `Data`'s
  fixed-successful-bytes contract.
- **Mount specifications** request traversal into another tree (§8). They are not node-local
  binding.

In a mixed carrier the tags live in the own value under a declared slot codec, never in keys. No
existing codec byte changes.

### 5. What a binding promises, and what it declines

| Observation | Promise | What turns it red |
|---|---|---|
| path set | preparation preserves it exactly | a refused name removes a node or adds a default child |
| original names | requests keep the exact bytes | a name is normalized, rewritten, or replaced by a local handle |
| structural noninterference | selection and reconstruction resolve and invoke nothing | an instrumented binder, reader, sender or connection opener is called |
| scoped selection | selecting before or after preparation gives equivalent scoped requests | relative names resolve differently because a subtree was silently re-rooted |
| reconstruction identity | reconstructing a local capability tree keeps its own-value objects | a participant is cloned, reset, or replaced by a freshly bound proxy |
| target identity | success denotes the target the name and profile admit | a stale reference resolves to a replacement participant |
| semantic aliases | references declared to denote one participant share its state | two aliases drive independent counters |
| failure distinctions | binding, store, decoder and operation failures stay distinct | an unreachable store is reported as a missing child |
| connection attachment | a connection-bound capability never migrates | an old capability sends through a newly installed connection |
| resource ownership | structural operations neither acquire nor dispose of borrowed resources | recomposition attaches a handler, closes a connection or releases a borrowed end |

**Declined:**
- future liveness;
- object identity across independent resolutions, unless a profile names that guarantee;
- equal outcomes across different times or binding worlds;
- behavioural equivalence from equal successful bytes alone.

**Profile requirements that follow:**
- A profile that caches capabilities declares its cache key and scope. It never merges different
  authorities, incarnations, attenuations or connection lifetimes. It never creates a participant
  because the old one is unavailable; creation is an explicit operation. It declares how transient
  failures are cached.
- There is one framework of declared observations, with profile-indexed relations, not one
  universal equivalence. A sum carrier combines relations by tag; it does not make them
  interchangeable.

### 6. The interaction instance (supersedes ADR 0012's interaction terminology)

> A complete receiver-side tree of handlers is a principal interaction instance of `Node[T]`. A
> duplex connection is not a tree. A process may also assemble a complete tree of
> connection-bound send adapters, but such a tree is a local application structure, not the
> bitwire primitive.

- **`WireTree` is not restored in bitwire.** In deixis, `DeixisNode<Wire>` is no longer a family
  name. `Wire` means bitwire's duplex connection endpoint.
- **`route` is selection followed by invocation.** Its `false` reports an absent path in the
  receiver's tree. A namespace protocol may translate that into a binding refusal, but `route`
  itself is not binding.
- **Constructing `(connection, p)`** establishes the ability to submit envelopes addressed to `p`.
  It does not establish that `p` exists remotely. Existence, authorization or target identity need
  an exchange protocol.
- **Incarnation does not pin a handler.** A handler at `p` can be replaced within one participant
  lifetime. A token-identity reference needs stable target IDs, a routing revision pinned at
  dispatch, or no reassignment for the reference's lifetime. Otherwise it is a **mutable route
  alias**, and it says so.
- **Realization independence respects shared connection ordering.** Splitting one connection into
  several, or adding independent deferred-resolution queues, is not justified merely because each
  path still reaches the same handler.
- **Designation is not authority.** A routing domain and a path say where an envelope is
  addressed, not who may act. A portable end reference carries a declared authority model.
  Serializable is not safe to publish: names that confer authority need a policy for persistence,
  logging, discovery and export. Borrowing is not ownership: disposal rights live in explicit
  lifecycle objects.

### 7. Data: restoring snapshot readers

The operation ADR 0012 left without an owner is:

```text
restoreSnapshot : Node[Bytes] → Node[Data]
```

It builds in-memory readers that keep fixed bytes and return independently owned buffers. It does
not recover an original reader, credential or connection. Its law, for successful materialization,
is `materialize(restoreSnapshot(S)) =_bytes S`. The reverse is **not** an identity on capabilities.

It is bitstore's operation, whose stored-root promotion to snapshot readers is the precedent.
Opening a stored root, binding names at existing nodes and restoring snapshot readers stay three
distinct operations.

### 8. Views that are not yet trees

- **Keys known, subtrees remote.** The content-addressed view keeps its contract: verified child
  keys and addresses are local, and fetching a subtree can fail. Such a view does not claim the
  tree interface. Root and child verification stay separate ([CODEC.md](../CODEC.md) §14).
- **Keys knowable only through I/O.** This needs a separate snapshot-discovery protocol; an opaque
  route interface is not one. The protocol is deixis-svc's to design. Before promotion it owes
  these laws:
  - **Snapshot coherence.** Every page, own value and child reference of one completed snapshot
    belongs to that snapshot.
  - **Exact membership.** Absence requires an authoritative negative answer for the snapshot. A
    timeout, a denial, a missing committed chunk or a lost connection is not one.
  - **Complete enumeration.** Valid cursors followed to an explicit completion marker yield the
    full child map, without duplicate keys. Page boundaries and order are not key identity.
  - **Lookup agreement.** Successful enumeration and successful lookup agree on membership and
    child identity within one snapshot.
  - **Scope preservation.** A child view inherits the snapshot and the relative binding origin. It
    never opens "whatever is current now".
  - **Honest authority scope.** An authorization-scoped tree is declared as such, never presented
    as a fuller tree with silent omissions.

  A participant that cannot offer a stable snapshot offers **live discovery**, named as such,
  which claims no coherent tree.
- **Promotion** has the shape `promote : SnapshotView[A] × Limits → Op[Node[A]]`. It succeeds only
  when every key and own value is in hand and finiteness and acyclicity are established. After
  that, every structural operation is synchronous and needs no I/O. It fails explicitly on a stale
  snapshot, an unavailable committed child, malformed structure, cancellation or a limit. A
  diagnostic partial result is not a tree and not a skeleton, since skeletons are cuts of complete
  trees ([PATH.md](../PATH.md)). A stale traversal is never silently restarted under the old
  token. For remote interaction the path is `remote snapshot → Node[Name] → prepareγ`, which
  separates discovery from capability availability.
- **Mounts are explicit.** `openMount(spec, γ) → Op[SnapshotView[A]]` hands the caller another
  root, and `at` never follows a mount. Automatic expansion is deferred. An expanded presentation
  is a new interpreted tree, and a mount cycle yields a cycle or limit outcome, never a fabricated
  leaf or default route.

### 9. The service line

**One deployment, separate modules.** Minimal named cells and retention coordination become an
explicitly named **cell module of deixis-svc**, next to its structural module. **topos is not
founded now**. Its proposal is disposed of by this decision, and the module's interfaces stay
separable so the deployment can change later without redefining cell semantics. The provide table
is not a cell-module responsibility: it belongs to the runtime at the site where its objects live.

| Responsibility | Owner | Invariant | Across a restart |
|---|---|---|---|
| pure trees, structural laws, codec, vectors | deixis | no names, time or capability invocation | no live state to restore |
| stored-root opening, data views, snapshot readers, materialization | bitstore adapters | qualified roots and fixed successful content; faults are not absence | bytes and roots survive; local readers are recreated |
| structural access and the discovery protocol | deixis-svc structural module | complete trees and effectful views are distinct interfaces | persisted descriptors survive; live views reopen or explicitly resume |
| current root, cell version, CAS, cell identity | deixis-svc cell module | one authoritative update order per cell; version tokens never reused | acknowledged state and versions survive durably |
| retention roots and publication protection | the cell module's retention part | published roots and promised reader leases stay protected | protection state survives, or GC stays fenced |
| physical reclamation | the storage backend under the retention contract | no protected chunk is reclaimed | a sweep resumes only once protection state is trustworthy |
| provide table, binding sessions, proxy caches | the site runtime or consumer library | exact targets, scoped authority, explicit ownership | process-local objects disappear; registration and binding are explicit |
| relay allocations and live pairings | bitwire-svc | an allocation's identity differs from a live generation | durable allocations survive; live generations end |
| participant incarnation and operation recovery | the application owning the participant | no silent replacement and no automatic replay of uncertain operations | a new participant life is distinguishable; recovery is the application's |

**Backends are not interchangeable.**
- A relay-backed structural service needs an application protocol that actually supplies
  discovery and snapshots; without one, the supported interface is opaque route access.
- A backend without durable atomic updates cannot implement a durable linearizable cell.
- Unsupported features are rejected explicitly, never hidden behind an adapter.

**The minimal cell:**

```text
observe(cell)                              → (qualifiedRoot, versionToken)
create(cell, qualifiedRoot)                → Created(versionToken) | Refused(reason) | Fault(cause)
compareSwap(cell, expectedVersion, root)   → Updated(newVersion) | Mismatch(currentVersion) | Fault(cause)
```

- `expectedVersion` is required; no omitted argument means an unconditional write.
- The CAS is on the **version, not the value**, so an `A → B → A` history still fails a writer
  holding the first version.
- Every accepted update, including to the same root, mints a fresh version.
- A restart never resets versions; if recovery cannot preserve non-reuse, a new durable epoch
  fences the old tokens.
- `watch` is deferred. When it comes, it has resumable version cursors and gap detection, and it is
  not a relay.

**Retention covers the actual races:**
- **during upload:** staging protection keeps chunks alive while the closure is assembled and
  verified;
- **during publication:** the new root's protection becomes durable before, or atomically with,
  publishing it. A crash may leave excess retention, never an acknowledged unprotected root;
- **during observation:** a returned root carries the promised protection (a read lease or a
  retained revision), so an immediate cell update cannot let GC take it before the reader opens it.

Safe ordering that may leak is preferred to ordering that may publish a dangling root, and
reconciliation belongs to the retention module. **A name inside an own value is not a GC edge**:
the codec's linked closure follows links headers only, so cross-root retention, including mount
targets, is declared by the profile or registered explicitly. The first implementation is
append-only, with reclamation disabled until this boundary exists.

**Lifetimes have separate types:**
- cell versions;
- participant incarnations;
- connection and relay generations;
- routing snapshot revisions;
- GC epochs.

A reconnect may preserve the participant but creates a new connection-bound capability. A
participant restart creates a new participant life. A cell update changes a state version, not an
identity. Old capabilities never migrate, rebinding is explicit and rechecks identity, and a
reconnect never replays an uncertain admitted mutation.

### 10. What deixis ships

1. **Laws and shared scripted vectors** for §2, §3 and the structural rows of §5. They run in all
   four cores: a scripted binder is a table, and requests and results are tagged own values, so
   Rust and Python run them on native trees with no shared foreign interface. TypeScript and Go
   also get adapter conformance tests.
2. **`toNative`** in TypeScript and Go, the cores with a foreign-tree interface. It converts a
   lawful complete foreign tree to the native node:
   - keeps exact keys and own-value objects;
   - performs no I/O, invokes no reader and binds no name;
   - exposes duplicate-key, cycle and limit failures and never repairs them;
   - treats shared acyclic subtrees as not cycles.

   The native node is what the codec encodes.
3. **No asynchronous capability materialization in the core.** Effectful traversal, scheduling,
   cancellation, read memoization and cleanup belong to consumer libraries.
4. **Asynchronous chunk verification needs no new interface.** `ResolveRoot`/`resolveRoot` and
   `ResolveChild`/`resolveChild` take any synchronous fetch, and a verified chunk exposes its child
   addresses before any fetch. An asynchronous adapter fetches first, then verifies through a fetch
   over the pre-fetched bytes. That keeps the root and child provenance constructors distinct. The
   pattern is documented and tested.
5. **A foreign child whose `at` disagrees with its `children()` is nonconforming.** It is a negative
   test case. The deixis-Go generic selection (which delegates to the child's `At`) and the
   TypeScript one (which walks `children()`) may answer differently for such a child, and neither
   answer is sanctioned.

## Not decided here

These have named owners outside this record:
- the discovery protocol's wire design, and the cell module's implementation and protocol
  (deixis-svc);
- the system acceptance battery: concurrent aliases, promotion across revisions, CAS and recovery,
  publication and GC, observation and GC, unknown operation outcomes (deixis-svc, before
  implementation);
- end-reference authority models and route-identity guarantees (bitwire and the applications);
- `restoreSnapshot` and the phase-preserving deferred reader (bitstore);
- send adapters (bitruntime or the applications).

## Validation boundary

The structural laws of §2, §3 and §5 are checked by the scripted vector family and by the
`toNative` and negative-conformance tests, all with runs that can come out red. The system-level
guarantees in §5, §8 and §9 have no evidence until the owning services exist and their batteries
run. This record states obligations; it does not report them as met.
