# Consumers

One document per system — existing or proposed — that builds on deixis: what it takes
from the floor, what it adds above it, and the exact terms of the relationship. This
directory is the **quarantine zone for upward knowledge**: everything deixis has to say
*about* its consumers lives here, so the floor documents ([TREE](../TREE.md),
[SLOTS](../SLOTS.md), [PATH](../PATH.md)) stay meaningful in a world where no consumer
was ever written. Reference direction follows dependency direction: these documents
point down freely; nothing normative points up into them.

A consumer document records a correspondence or a design, never a requirement on the
floor — deixis owes its consumers nothing, and each entry is falsified the ordinary way,
by its consumer never arriving. The wider survey of *perceivable* consumers and the
criterion for which deserve packaging is
[design/0003-instantiations-beyond-ontos.md](../design/0003-instantiations-beyond-ontos.md);
entries graduate from that survey into a document here when they become real or become
seriously proposed.

| Document | Status | One line |
| --- | --- | --- |
| ontos | existing; bridge pins v0.2.0 | ontos values are a recognized subset of `Node(Option(Bytes))` with keys spelling positions — the founding instance |
| bittree | existing; contract, no package | a bittree node is `Node[Label]` under a declared profile, with keys spelling ordinal and field |
| [`BITWIRE.md`](BITWIRE.md) | ADR 0014; layered replacement being implemented | addressless Wire, addressed access, endpoint ownership and complete WireTree; receiver trees remain equally valid |
| [`BITSTORE.md`](BITSTORE.md) | existing library; accepted breaking contract | addressless `Data.read()`; full `DataTree = DeixisNode[Data]`; materialized byte snapshots stay distinct |
| topos | not founded (ADR 0013 §9) | its minimal cells (version CAS) and retention coordination become a named module of deixis-svc |
| deixis-svc | proposed service; ADR 0013 | a structural module (complete trees, explicit discovery views) and a cell module (named roots, CAS, retention) |

The common naming and complete structure are recorded in
[ADR 0012](../design/0012-data-wire-tree-symmetry.md). `DataTree` and `WireTree`
are the same generic construction with different own-value types. An
addressed-only read or send handle is not the full structural interface.
[ADR 0014](../design/0014-structural-identity-and-lifted-access.md) reaffirms this
symmetry while retaining ADR 0013's binding, view and service distinctions.
Accepted design and consumer implementation/release status remain separate.

The two kinds of *existing* are different claims. A **package pin** can be checked in
the consumer's manifests. A **contract adoption** can be checked only in the consumer's
own decision record. Neither is a certification by deixis: this directory restates
what each consumer decided, and it re-runs none of their conformance.
