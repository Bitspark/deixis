# Interaction layering supersedes the envelope wire

**Status:** accepted on merge, by this repository's agents, seat caa (jlqyu6o5gy), with the
acceptance of bitwire's, bitruntime's and bitstore's agents. It is the family-policy record that
[ADR 0015](0015-deixis-identity.md) §4 proposed, after research 0006 (deixis-internal#80). It
merges after deixis-fable's peer read of this revision. bitwire#76 and bitruntime#36 have merged,
and bitwire v0.5.0 is released.

Identity: adopts ID12, ID13

Supersedes: bitwire decision 0014's collapsed sending surface, released in bitwire 0.4.0 and bitruntime 0.5.0 (§1)

Supersedes: ADR 0012's specialization name `WireTree`, in naming only (§2)

Updates: WIRES.md §5, the minimal interaction primitive, which this record closes (§3)

It adopts [IDENTITY.md](../../IDENTITY.md)'s family policy: ID12, interaction layering, and
ID13, dispatch coherence per relay profile. ADR 0015 adopted the structural contract and the
derived constructions, and proposed these two, so that a family-policy matter would not hold
the tree's identity. It also records two decisions the family reached while this record waited
for its acceptances: the specialization name `WireNode` (§2), and the closure of WIRES.md §5's
open question (§3).

## 1. The layering supersedes the envelope wire


The owner approved B on 4 October, so adopting A now is a supersession of a released design,
not a finding that B was never approved (research 0006, R8). This is its record, in the form
IDENTITY.md's change rule requires.

- **Affected contract:** family policy, ID12 (interaction layering), and with it ID13. It
  touches no structural entry.
- **Supersedes:** bitwire decision 0014's collapsed sending surface, released in bitwire 0.4.0,
  and its realization in bitruntime 0.5.0. Its counterparts are bitwire decision 0015, in
  bitwire#76, which "supersedes decision 0014's collapsed sending surface", and bitruntime#36.
- **Old rationale and present tradeoff:** B's rationale, in the owner's words of 4 October 2026:
  "I would prefer there to be a clean cut. no historic profiles, no legacy baggage. also, no
  adapters if they are not required for good reasons if we could as well consolidate to one
  interface". The plan the owner approved replaced the `Wire`, `AddressedWire` and `Endpoint`
  sending surfaces with one envelope contract, with "no adapter translating one generic wire
  interface into another". Those reasons remain sound: one conveyance contract, no compatibility
  exports, no second sending interface bridged to the first. The present tradeoff is the one
  research 0006 states symmetrically (R2):
  - A keeps one conveyance contract too. Addressing can be functions over the raw endpoint, so
    a named addressed interface is an ergonomic choice, not a necessity.
  - B's self-describing messages remain available to A as an envelope profile, but only for
    that profile's messages.
  - A shared transport seam and queue implementation are compatible with both, and deleting the
    seam was a separate implementation choice.
  - A carries prefix laws directly. B can add them without changing its envelope, though a
    handler that sees the whole envelope needs a routing cursor for prefix transparency (R15).
  - What tips the balance is that A separates three independently meaningful contracts
    (conveyance, addressing, exchange). A message can then be conveyed without interpreting a
    destination, and a complete tree can exist without a connection (R1).
- **Authority and delegation:** the owner's standing ruling of 4 October 2026, which delegates
  the decision to the affected components' agents. Provenance: the owner's direction of
  25 September, verbatim in the first version of bitwire#42; ADR 0012, "accepted … by the
  operator's explicit instruction"; and the owner's approval of B on 4 October, superseded
  here. On 5 October the owner recalled the September direction and asked for a re-derivation.
  That was not a new ruling between A and B.
- **Alternatives and consequences:**
  - keep B unchanged;
  - keep B and add prefix laws and a bound send;
  - adopt A with B's envelope as an optional profile, which is chosen.

  The costs are a real layer boundary, profile-specific validation, and more API concepts; it
  does not promise less code (R1). Old JSON and RPC profiles, return-address machinery and
  compatibility exports do not return. bitwire's and bitruntime's consumers migrate with
  bitwire#76 and bitruntime#36.
- **Evidence and obligations:** research 0006's advice (R1 to R4, R13 to R15) is an expert's
  weighing, not a proof. Outstanding:
  - the exchange contract's seven problems (R3), requested on bitwire#76;
  - the crossing, exchange and relay families (R25b), owed by bitwire's and bitruntime's
    agents once bitwire#76 merges;
  - the affine-versus-persistent question (R26; WIRES.md §5, ADR 0015 §5).
- **Approved revision:** IDENTITY.md's ID12 and ID13 as pinned in
  [tools/identity.lock](../../tools/identity.lock) at this record's merge.
- **Derivations:**
  - seat caa's and deixis-fable's sealed stances, compared in ADR 0015 §2;
  - the Codex session's Bitspark/deixis#19, as a third;
  - research 0006 (deixis-internal#80), whose advice weighed B against A, with B steelmanned
    and both designs' authority quoted.
- **Peer read:** deixis-fable, on Bitspark/deixis#20 (which proposed this text as ADR 0015 §4)
  and on this record's pull request.
- **Accepted-by:** deixis, by this record; bitwire, by its decision 0015 (bitwire#76, merged,
  released in bitwire v0.5.0) and the Codex session's acceptance on this record's pull request;
  bitruntime, by bitruntime#36 (merged) and the same acceptance; bitstore, for ID12's data wing,
  by its own accepted charter, which already states that wing (bitstore `CHARTER.md`):

  > `Data` is an addressless fixed-content reader. `DataTree = DeixisNode<Data>` realizes the
  > Deixis mandatory-own-value model

  No bitstore agent is active to answer bitstore#13. Its
  acceptance is cited from that record, not inferred from silence, and the rename it alone may
  decide is left open there (§2). This acceptance covers the data wing as bitstore's charter
  states it. If bitstore changes that wing, ID12 needs bitstore's acceptance again.

## 2. The specialization names

bitwire's decision 0015, merged in bitwire#76 at `5bf2737b` and released in bitwire v0.5.0, renamed
`WireTree` to `WireNode = DeixisNode<Wire>`. It routed the rename here, to the affected
components' record, and did not treat it as settled. The order is recorded plainly: the rename
merged in bitwire 13 minutes after the owner's question, and before this record had weighed it.

- **Affected contract:** family policy, ID12's specialization names. No structural law,
  membership claim or lifetime changes.
- **Supersedes:** ADR 0012's name `WireTree = DeixisNode<Wire>`, in naming only. `DataTree` is
  bitstore's released public interface, so whether it becomes `DataNode` is bitstore's decision.
  It is asked on bitstore#13. ID12 names the structure `DeixisNode<Data>`, with bitstore's
  current name `DataTree` in parentheses, so a later rename by bitstore is an update to that
  parenthesis and nothing else.
- **Old rationale and present tradeoff:** ADR 0012's names were the owner's decision, "Use Data /
  DataTree and Wire / WireTree", and the names "emphasized complete structure" (bitwire decision
  0015's account). The present tradeoff:
  - **For the rename:** deixis's own vocabulary is `Node(T)` and `DeixisNode<T>`, and "a node is
    exactly its own value and its children" (IDENTITY.md ID4). Completeness is carried by the
    contract, not by the word. `WireNode = DeixisNode<Wire>` is exact. No released version carried
    `WireTree`, and bitwire 0.5 was untagged when the rename was decided, so the cost was lowest
    then.
  - **Against it,** from deixis-fable's adversarial derivation: "tree" names the promise beside an
    addressed-only facade; "node" already means a participant in this family (WIRES.md §8's "two
    nodes"); the written record, the owner's paper included, uses "Tree"; and a rename one day
    after the direction was re-derived spends stability.
  - The arguments against are costs of the new name, not proof that it is wrong. The mitigations
    below answer them.
- **Authority and delegation:** the owner's standing ruling of 4 October 2026 delegates the
  decision to the affected components' agents. Provenance: the owner's question of 6 October
  2026, verified by deixis-fable in the Codex session's log and quoted in bitwire decision 0015,
  "Why not WireNode actually? Wouldn't that me more consistent?" It is a question, not a ruling.
- **Alternatives and consequences:**
  - keep `WireTree` and `DataTree`;
  - rename both;
  - drop specialization names and write `DeixisNode<Wire>` and `DeixisNode<Data>` directly.

  The rename of `WireTree` is adopted, with these mitigations:
  - IDENTITY.md's words say `WireNode` is the complete rooted structure, not a participant and
    not a single position;
  - "tree" stays the prose word for a complete structure;
  - ID12's statement names the structures as `DeixisNode<Wire>` and `DeixisNode<Data>`, with the
    short names in parentheses.

  Historical records keep their words. deixis's current text moves to `WireNode`.
- **Evidence and obligations:** bitwire v0.5.0 ships `WireNode`, and bitruntime#36 (merged)
  implements it. bitstore's decision on `DataNode` stays open on bitstore#13, for bitstore's
  agents whenever they are active. The trigger is their answer there.
- **Approved revision:** IDENTITY.md's ID12 as pinned at this record's merge, and the current
  documents named in this record's pull request.
- **Derivations:** the Codex session's recommendation, on this record's pull request
  (Bitspark/deixis#21), and in bitwire decision 0015; deixis-fable's sealed derivation, which tried
  to defeat the rename (deixis board, 2026-10-06), and which seat caa answered on #21.
- **Peer read:** deixis-fable, on Bitspark/deixis#21.

## 3. WIRES.md §5 closes: persistent send refines affine one-shot transitions

*(Amended 2026-10-06: this section claimed more than bitwire v0.5.0's contract establishes. [ADR 0018](0018-affine-mapping-bounded.md) bounds it
to the endpoint admission trace model: atomic admission-level progression and at-most-once
dispatch, without establishing protocol-level payload-and-continuation transfer or redemption.
It lists all seven laws as obligations of a session or exchange profile that claims
affine semantics, and retracts the sentence below about old frames on a new connection.
bitwire's and bitruntime's agents had accepted §1 and §2 of this record, not this section.)*

WIRES.md §5 left the minimal interaction primitive OPEN, and ADR 0015 §5 gave the trigger: bitwire
releases a persistent `Wire.send`. bitwire v0.5.0 did, on 2026-10-06. Research 0006 (R26) asked for
one of two records: a state mapping from persistent sends to affine one-shot transitions, or a
record that persistent messaging is the primitive and affine sessions an optional profile. This
record supplies the mapping. It **updates** WIRES.md §5 and supersedes nothing. Research 0002's
integration ledger of 2026-08-08 stands as written: "affine one-shot endpoint transitions as
normative semantics; persistent/multiplexed transports as permitted refinements".

**The mapping** (deixis-fable's derivation). For each endpoint and direction `d` there is an
incarnation index `n_d`. A persistent handle denotes the current incarnation, and an admitted
`send(m)` is the atomic transition `E_d(n) ⊗ m → E_d(n+1)`. Each of research 0002's minimum laws
lands on a clause of bitwire v0.5.0's `docs/wire/contract.md`:

| research 0002's minimum law | the clause that meets it |
| --- | --- |
| 1. payload and continuation transfer are one atomic event | admission: "Each direction admits messages in a linear local order" |
| 2. old endpoint tokens are never accepted after use | the persistent handle never denotes a consumed incarnation; a profile with explicit sequence tokens refuses every index below `n_d` |
| 3. duplicates cannot redeem a continuation twice | dispatch "starts dispatch of whole messages in that order, at most once", with the relay safety law |
| 4. cancellation and failure are observable | `closed` and `Termination`; `close()` abandons the current incarnation and its successors |
| 5. abandoned continuations are reclaimed | "Closing one local-pair endpoint terminates both"; "Carrier output queue exhaustion refuses local admission" |
| 6. delegation carries authority | `bind` and `under` delegate the right to advance the chain at a confined destination; receive and close are not delegated |
| 7. no two independent redeemers | concurrent sends are linearized by admission; "Exactly one receive handler may be attached; a second attachment fails synchronously" |

"A rejected send was not admitted", so no transition occurs. "Later failure can leave an admitted
operation's outcome unknown": the incarnation was consumed and its delivery is unknown, which is
affine. "Opposite directions have no shared order": an endpoint is two independent chains.

**What follows:**
- The discipline is implicit at conveyance, where admission advances the incarnation. It is
  explicit, with names, at the exchange layer: a reply end is an affine one-shot end, as in WIRES.md
  §1's `apply(f, x) = send (x, reply-end)`. R3's exchange contract carries single redemption of
  reply ends, refusal of late replies and duplicate correlations, and explicit cancellation and
  failure observations, as requested on bitwire#76.
- A carrier without per-direction order is a transforming conveyance (WIRES.md §2) and declares
  it. A session over it cannot use admission order as its incarnation index.
- Replay across a reconnection is not part of this mapping. Refusing old frames on a new
  connection is a carrier's no-duplication and connection-generation duty, under the relay safety
  law (IDENTITY.md ID13).

- **Affected contract:** WIRES.md §5, under family policy ID12. No identity entry's statement
  changes.
- **Updates:** WIRES.md §5's OPEN marker, closed by the mapping. Research 0002's ledger stands.
- **Old rationale and present tradeoff:** §5 kept the question open because "one-shot ends are the
  candidate to beat", and research 0006 found that the signature alone is no refinement argument.
  The mapping is that argument. The alternative, (b), would also have kept the affine laws
  normative, at the session and exchange layer. It was rejected because it supersedes the ledger's
  application to conveyance when nothing forces that, while the mapping adds no new carrier
  obligation: each law lands on a clause bitwire v0.5.0 already states.
- **Authority and delegation:** the owner's standing ruling of 4 October 2026. This is family
  policy, accepted with §1.
- **Alternatives and consequences:** (b), as above. The costs of (a), recorded honestly:
  - laws 2 and 3 are not observable through the persistent API, only where explicit names exist;
  - implementers think in persistent sends;
  - no family protocol uses explicit one-shot ends yet, so the benefit at the exchange layer is
    prospective.
- **Evidence and obligations:** the clauses above, read at bitwire v0.5.0. R3's exchange contract
  and R25b's exchange-lifecycle family (bitwire#77) carry the explicit laws.
- **Approved revision:** WIRES.md §5 as pinned at this record's merge.
- **Derivations:**
  - deixis-fable's sealed derivation for the mapping;
  - seat caa's sealed derivation for (b), which tried to defeat it. Its defeat condition, a
    conveyance-level observable that requires single redemption, was not met.
  - Both were exchanged on the deixis board on 2026-10-06 and compared there. The comparison is
    recorded on Bitspark/deixis#21.
- **Peer read:** deixis-fable, on Bitspark/deixis#21.
