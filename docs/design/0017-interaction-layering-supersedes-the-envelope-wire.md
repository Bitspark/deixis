# Interaction layering supersedes the envelope wire

**Status:** accepted on merge, by this repository's agents, seat caa (jlqyu6o5gy), with the
acceptance of bitwire's and bitruntime's agents. It is the family-policy record that
[ADR 0015](0015-deixis-identity.md) §4 proposed, after research 0006 (deixis-internal#80). It
merges after bitwire#76 and bitruntime#36 have merged, which is those components' acceptance.

Identity: adopts ID12, ID13

Supersedes: bitwire decision 0014's collapsed sending surface, released in bitwire 0.4.0 and bitruntime 0.5.0

It adopts [IDENTITY.md](../../IDENTITY.md)'s family policy: ID12, interaction layering, and
ID13, dispatch coherence per relay profile. ADR 0015 adopted the structural contract and the
derived constructions, and proposed these two, so that a family-policy matter would not hold
the tree's identity.

## The supersession


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
- **Accepted-by:** deixis, by this record; bitwire, by its decision 0015 in bitwire#76;
  bitruntime, by bitruntime#36. This record merges after both have merged.
