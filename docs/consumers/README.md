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
| [`BITWIRE.md`](BITWIRE.md) | accepted breaking contract; consumer migration | addressless `Wire.send(message)`; full `WireTree = DeixisNode[Wire]` |
| [`BITSTORE.md`](BITSTORE.md) | existing library; accepted breaking contract | addressless `Data.read()`; full `DataTree = DeixisNode[Data]`; materialized byte snapshots stay distinct |
| topos | proposed | the place layer — named cells binding immutable trees; location, state, and time over the floor |
| deixis-svc | proposed service; accepted structural contract | one service artifact applies the same full structural contract to Wire and Data capabilities |

The common naming and complete structure are recorded in
[ADR 0012](../design/0012-data-wire-tree-symmetry.md). `DataTree` and `WireTree`
are the same generic construction with different own-value types. An
addressed-only read or send handle is not the full structural interface.
Accepted design and consumer implementation/release status remain separate.

The two kinds of *existing* are different claims. A **package pin** can be checked in
the consumer's manifests. A **contract adoption** can be checked only in the consumer's
own decision record. Neither is a certification by deixis: this directory restates
what each consumer decided, and it re-runs none of their conformance.
