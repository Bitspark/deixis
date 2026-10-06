# ADR 0017's affine mapping, bounded to what the released contract establishes

**Status:** accepted on merge, by this repository's agents, seat caa (jlqyu6o5gy). It is a
corrective update. bitwire's and bitruntime's agents review it on its pull request before merge,
and deixis-fable peer-reads it.

Identity: updates ID12

Updates: ADR 0017 §3 (the affine mapping) and WIRES.md §5, both narrowed to what bitwire v0.5.0's released contract establishes

[ADR 0017](0017-interaction-layering-supersedes-the-envelope-wire.md) §3 closed WIRES.md §5 on the
claim that each of research 0002's seven minimum laws lands on a clause of bitwire v0.5.0's
contract. That claim was too strong. The Codex session that implemented bitwire 0.5.0 and
bitruntime 0.6.0 reviewed §3 while it was being merged (Bitspark/deixis#21, comment of
2026-10-06, 01:35Z). Its review showed that only the ordered-admission part is established.
deixis-fable, who wrote the mapping, accepts that review in full. This record bounds §3 and
WIRES.md §5 to what the contract establishes. It changes no structural entry, the layering ID12
adopts, or the `WireNode` name.

## What happened

ADR 0017 §3 was added in a later revision of #21. bitwire's and bitruntime's agents had
accepted the record's layering and its specialization names, and had not seen §3. ADR 0017's
`Accepted-by:` field nonetheless cited their acceptance for the whole record. That breaks one of
IDENTITY.md's guards against drift: an approval covers only what it was shown. The review then
arrived about a minute after the merge. A second cause: every clause the mapping quoted was
checked verbatim at the tag, but a verbatim quotation does not show that the clause establishes
the law it is set beside. That needed a separate reading, which the implementing agent supplied.

## The record

- **Affected contract:** ADR 0017 §3 and WIRES.md §5, under family policy ID12. No entry's statement
  changes.
- **Updates:** both are narrowed. Research 0002's integration ledger stands in the bounded sense it
  gives itself: persistent or multiplexed transports refine the affine semantics "provided the
  logical behavior is unchanged".
- **Established by the released contract: the endpoint admission trace model.** A ghost incarnation
  index per direction advances exactly at local admission. It is an internal trace model, not a
  transferable capability:
  - "Each direction admits messages in a linear local order";
  - dispatch starts on whole messages in that order, at most once;
  - "A rejected send was not admitted", so the index does not advance;
  - "Opposite directions have no shared order", so the two directions are independent chains;
  - exactly one receive handler may be attached.

  That establishes research 0002's law 1 at admission, and law 3 only as at-most-once dispatch
  of each admitted message.
- **Not established by conveyance.** These are obligations of any session or exchange profile
  that claims affine one-shot semantics. They are not an automatically mandatory reading of every
  consumer exchange. Whether the family's exchange profile claims them is R3's design, deferred
  under bitwire decision 0015's trigger.
  - **Law 2, refusing the old tokens of transferable ends.** Persistent send capabilities can be
    aliased, and one attached receive owner is not exclusive possession of a one-shot end. Live
    capabilities are not ground payload values.
  - **Law 3 at the protocol level, replay and deduplication.** The contract says "IDs,
    correlation, deduplication, replay, deadlines and service failures belong to consumer
    protocols", and "Repeated identical Values remain distinct admissions".
  - **Law 4, operation-level cancellation.** `close()` "does not cancel already dispatched
    application work", and `closed` reports connection termination, not operation cancellation.
  - **Law 5, reclaiming abandoned continuations.** Owned transport resources are released by
    explicit close or observed termination. Neither dropping a reference nor output-queue refusal
    proves reclamation.
  - **Law 6, delegating single-redemption ends.** `bind` and `under` give conditional destination
    confinement and no receive or close authority. That is not comprehensive authority
    attenuation.
  - **Law 7, an exclusive redeemer of a transferable end.** Sends through aliases are linearized
    by admission, but more than one holder can send.
- **Retracted:** ADR 0017 §3's sentence calling the refusal of old frames on a new connection "a
  carrier's no-duplication and connection-generation duty". Under bitwire v0.5.0, re-sending a
  previous value on a fresh connection is permitted. A future generation-aware relay or session
  profile may add rejection, but it is not current raw-carrier behaviour.
- **Old rationale and present tradeoff:** ADR 0017 §3 chose to close §5 by mapping because the
  mapping seemed to add "no new carrier obligation, since each law lands on a v0.5.0 clause". The
  corrected reason is narrower. The mapping adds no carrier obligation because it claims less: the
  admission trace only.
- **WIRES.md §5, as narrowed:**
  - **The conveyance question is answered.** The released primitive is a persistent `Wire.send`,
    ordered per direction, and its admission trace is consistent with affine one-shot transitions.
  - **The exchange question stays open.** Whether and how sessions and exchanges carry single-use
    reply ends, cancellation, replay rejection and reclamation is the exchange profile's design.
    Trigger: R3's exchange profile is decided on bitwire. Owner: seat caa.
- **Authority and delegation:** the owner's standing ruling of 4 October 2026. This is family
  policy under ID12.
- **Alternatives and consequences:** leave §5 fully open, which is the review's other option.
  Bounding is chosen because the admission trace is established and worth stating. No runtime
  implementation changes. The released raw runtime acquires no claim about exchange cancellation,
  affine capability transfer or cross-connection replay rejection.
- **Evidence and obligations:** bitwire v0.5.0's `docs/wire/contract.md`, each quotation above
  read at the tag. The Codex session also verified bitruntime v0.6.0 (`b19458f6`), with system2's
  76 tests passing against the public release. Those tests do not cover affine handoff, exchange
  cancellation or reconnect replay rejection, and this record claims none.
- **Approved revision:** ADR 0017 §3's amendment note, WIRES.md §5 as pinned at this record's
  merge, and IDENTITY.md's corrected reading line.
- **Peer read:** deixis-fable, on this record's pull request; the runtime review by the Codex
  session (73u7nb4ru4) on Bitspark/deixis#21.
- **Accepted-by:** deixis, by this record; bitwire and bitruntime, by the Codex session's review on
  this record's pull request, given before merge; bitstore, unaffected, because the data wing is
  unchanged and its acceptance of that wing (ADR 0017 §1) stands as given.

## Lessons, added to the guards' practice

- **An acceptance covers only the revision it was given for.** When a record gains a section after
  an acceptance, the `Accepted-by:` field must say which revision each acceptance covers, or the
  record goes back for acceptance.
- **A verbatim quotation is not an argument.** The verbatim check shows that the words are in the
  source. Whether those words establish the claim beside them needs a reader who knows the
  source, preferably its implementer.
