# deixis's identity, written down

**Status:** accepted, 2026-10-05, by this repository's agents, seat caa (jlqyu6o5gy) and
deixis-fable, after an openly framed expert consultation: research 0006, framed on
deixis-internal#80, evaluated by deixis-fable and graded there by seat caa. As a family-policy
record (§4), it merges once bitwire#76 and bitruntime#36 have merged, which is those components'
acceptance.

Identity: adopts ID1 to ID13

Supersedes: bitwire decision 0014's collapsed sending surface, released in bitwire 0.4.0 and bitruntime 0.5.0, for family policy ID12 (§4)

Updates: ADR 0014, whose charter folds into IDENTITY.md (§2a)

It adopts [IDENTITY.md](../../IDENTITY.md): deixis's identity in three separately governed
parts (a structural contract, derived constructions and family policy), thirteen entries with
statements, reasons, falsifiers and four attributes each, and the rule by which a contract
changes. It folds in the charter of [ADR 0014](0014-structural-identity-and-lifted-access.md),
which reached the same restoration independently on the same day. It changes no code, codec
byte or vector.

## Context: what happened

The owner put real thought into deixis's structure, and a direction was decided. On
5 October 2026 a deixis record reversed part of it, and the owner found the reversal the same
evening. This is not about blame. The point is to learn how a decided direction was lost
without anyone deciding to lose it. [ADR 0013](0013-binding-views-and-the-service-line.md)'s
correction section has the full sequence and its sources. In short:

1. **The direction was decided, but its reason was never recorded where readers look.** The
   owner's direction of 25 September separated an addressless primitive from an addressed
   composition, `A1 = Deixis[A0]`, with the same lift for data, `B0` to `B1`. It survives
   verbatim only in the first version of bitwire#42. deixis's ADR 0012 and bitwire's decision
   0012 recorded the names and the derivation, and neither recorded why.
2. **A different design was approved without its reversal being surfaced.** On 4 October the
   owner asked bitwire for "no adapters if they are not required for good reasons if we could
   as well consolidate to one interface", and then genuinely approved a concrete envelope
   replacement (bitwire 0.4.0). The plan named the replacement of the `Wire`, `AddressedWire`
   and `Endpoint` surfaces. It did not surface the earlier records, the guard the agent had just
   read ("Preserve this distinction"), or the tradeoff being reversed. That omission is the
   process defect. It is not evidence that the approval never happened.
3. **The paraphrase drifted.** The qualifier "if they are not required for good reasons" fell
   out of bitwire's decision 0014. Its change note said the owner "prohibited compatibility
   baggage".
4. **The floor followed a consumer.** deixis's research 0005 put bitwire 0014 among its fixed
   constraints, left out ADR 0012's authority and reason, and asked the expert inside that
   frame. One agent both ran and graded it, and ADR 0013 copied the answer.
5. **The drift recurred in the correction.** The first correction said the owner "confirmed"
   the split. The owner had recalled it and asked questions: "I am not sure what is right for
   deixis, but I remember that we put effort into finally deciding for a direction."

Two observations make this more than one incident:
- **A consultation follows its frame.** A reconstruction made for this record read 25 of the
  family's consultations and reviews, across deixis, bitwire, bitruntime, bitsystem3,
  bitwire-svc and bn-wires. Wherever one listed something as fixed, the advice built on it. None
  recommended removing the addressless primitive, but how many of them were asked that question
  is not recorded, so that count is not evidence against removal.
- **The structural laws survived, and the record of the family's design did not.** No core
  code, codec byte or vector changed, because those are checked. What changed was text: which
  design deixis anchors, and on whose authority. Nothing checked that text.

## Decision

### 1. deixis's identity is IDENTITY.md, in three governed parts

[IDENTITY.md](../../IDENTITY.md) at the repository root is deixis's identity. Research 0006's
advice (R5) separated what the first version had listed together:

| part | entries | changed by |
| --- | --- | --- |
| structural contract | ID1 Shape, ID2 Keys and paths, ID3 Selection, ID4 Complete parts, ID5 Slot independence, ID6 Supplied identity, ID7 Values, not live resources, ID8 The floor stays empty | deixis's agents |
| derived constructions | ID9 The projection, ID10 Composition inside one tree, ID11 Prefix composition across a boundary | deixis's agents for the structural argument; implementing libraries for their effectful helpers |
| family policy | ID12 Interaction layering, ID13 Dispatch coherence, per relay profile | the agents of every affected component, together |

The reason for the split is the argument the first version already made and then did not
follow through: a tree generic in `T` cannot forbid a slot type whose operations take paths,
so `Node<AddressedWire>` is as lawful as `Node<Wire>`. The interaction layering is therefore
not a law of the tree. It is the family's decided design, which deixis anchors. Recording it
here, adjacent to the structural contract but under its own authority, meets the owner's
request that the decided direction be written into deixis's identity, without giving the
lowest library jurisdiction over every design above it.

Each entry carries four independent attributes (R27): contract status, authority with its
provenance, evidence, and implementation coverage. A law can be accepted before a battery
exists, and a passing battery does not decide who may change a contract. The structural part
carries a completeness criterion (R16): a tree is determined by a finite, prefix-closed path set
and a valuation, and ID1 to ID8 determine every structural observation.

The statements follow the advice's rewordings, adopted with our falsifiers and provenance:
- ID1 to ID8 follow R17 to R24. The domain of ID1 stops at the slot. ID3 gains the one-key
  recursion. ID4 preserves slot handles and aliasing. ID5's functor laws hold for total pure
  functions. ID6 is a pointwise lifting that must not change slot aliasing. ID7 is narrowed to
  live resources, and the byte-profile rule returns to the codec's own track. ID8 leaves
  ordinary ownership to each language.
- ID9 is dispatch availability (R11): `MissingPath` on absence, otherwise exactly one initiated
  invocation whose outcome is preserved.
- ID10 compares corresponding executions under a declared observation model (R12).
- ID11 holds the two prefix laws, for a coherent complete view and for `under` (R13). Neither
  requires a prefix-closed domain, and a mount needs an explicit resolver rule.
- ID13 holds dispatch coherence per relay profile, with the profile's declarations and the
  conditional composition sentence (R13, R14).

### 2. How the statement was reached

**Two sealed stances.** seat caa and deixis-fable each wrote a stance from the primary records
before reading the other's: decisions, notes, the paper, the specification, both repositories'
histories and the consultations. They agreed on most of it and disagreed on ten points, each
resolved from a source:

| # | question | resolution | source |
| --- | --- | --- | --- |
| 1 | Is "own values take no path" a floor law? | No. The structural contract holds for every `T`, so it cannot forbid a path-taking `T`. It is family policy, ID12. Research 0006 (R5) reached the same conclusion. | the paper's `prop:functor` |
| 2 | Is a receiver's tree of handlers a `WireTree`? | Only when its values are presented through a `Wire` contract (R15, and bitwire#76's wording). A bare function tree is its own instantiation. | [WIRES.md](../WIRES.md) §2; research 0006 R15 |
| 3 | What is ID8's status? | Settled in sessions with the owner, not an agent decision. | design notes of 2026-08-07 and 2026-08-08, headers checked |
| 4 | What was missing? | The growth law joins ID4. The byte-profile rule went to ID7 and, after R23, back to the codec's track. | [TREE.md](../TREE.md) § Growth; [CODEC.md](../CODEC.md) |
| 5 | Which file, which marker? | IDENTITY.md at the root, `ID<n>`, structured `Identity:` and `Supersedes:` lines. | label collisions measured in ADR 0008 |
| 6 | What does a change need? | A supersession record, with proportionate review (§3). | both stances; research 0006 R6, R7 |
| 7 | Is WIRES.md §5's one-shot question still open? | Yes (R26). Its trigger is in §5 below. | research 0002's integration ledger; research 0006 R26 |
| 8 | Is topos in scope? | It went to the consultation; R9 repairs ADR 0013 §9 in its own record. | ADR 0013 §9 |
| 9 | Do mounts conflict? | No. Selection never follows a mount; a resolver may, by an explicit rule. | ADR 0013 §8; research 0006 R13 |
| 10 | What about bitwire-svc's advice? | Its research 0001's advice, in paraphrase: make bitwire's service an A0 primitive and keep addressed access a separate consumer interface. It went to bitwire-svc's agents, pointed at bitwire#76. | bitwire-svc PR #7 |

**A third derivation.** While the two stances were being compared, a Codex session working
across deixis, bitwire and bitruntime, which records that it worked at the owner's request,
reached the same conclusion without seeing either stance. It merged as Bitspark/deixis#19:
[ADR 0014](0014-structural-identity-and-lifted-access.md) and a charter, with bitwire#76 in
bitwire. The three agree, but they read the same records and responded to the same owner
reaction, so their agreement is shared-record agreement, not independent proof (R28). This
record takes from #19 its falsifiers, the effect semantics of ID10, the precision about opaque
facades, the ownership table (§6) and two guards. It differs in keeping one identity document
(§2a) and WIRES.md's decided doctrine, and in using labels that collide with nothing.

**The consultation.** Research 0006 was framed on deixis-internal#80 so that it would not
settle its question in advance:
- it presented design A (addressless primitives, one addressing contract above them) and
  design B (one duplex envelope wire), each with its authority and stated reason;
- it quoted the owner verbatim, with both readings of the 4 October request;
- it asked whether ID12 belongs in deixis's identity at all.

The expert favoured A's layering on its merits, kept B's envelope as an admissible profile (R1),
and moved ID12 out of the structural identity (R5). It also tightened most statements (R11 to
R24), replaced the change rule's authority model (R6, R7) and corrected the record's account of
the October approval (R8). deixis-fable evaluated 28 recommendations: 24 hold, 4 hold with an
adaptation, one is split with its second half deferred, and none was rejected. seat caa graded
the table with five conditions, all applied here. The consultation did not reverse the direction
the stances reached. It made the record more precise and more honest about authority.

### 2a. The charter of ADR 0014 folds into IDENTITY.md

Two identity documents would bring the problem back: the next reader would have to decide which
one governs. Every promise of the charter has a home here, and every counterexample it gave is a
falsifier.

| charter | IDENTITY.md | what moved |
| --- | --- | --- |
| D1 one own value, complete finite children, finite and well founded | ID1, ID4 | an unfetched remote subtree presented as complete: ID4's falsifiers |
| D2 exact byte keys, segment boundaries, no sibling order | ID2 | — |
| D3 selection follows children only | ID3 | — |
| D4 `at(at(N,p),q) = at(N,p++q)` | ID3 | a cut that changes the selection: ID3's falsifiers |
| D5 exact decomposition and composition | ID4 | a live participant cloned: ID4's falsifiers |
| D6 structural operations never bind, invoke, acquire or dispose | ID8 | in ID8's statement, with lifecycle left to each language (R24) |
| D7 identity lifted from a supplied equivalence | ID6 | behavioural equivalence from equal bytes: ID6's falsifiers |
| D8 mapping preserves paths and commutes with selection | ID5 | for total pure functions (R21) |
| lifted access | ID9, ID10 | its effect semantics: ID10's statement |
| consumer boundaries | §6 below | it names consumers, so it is not in IDENTITY.md |
| amendment discipline | change rule | weigh the unchanged contract, account for migration and evidence |

On authority, the charter and research 0006 agree: a reasoned review may authorize an amendment
when the reviewer holds the delegation (R7). IDENTITY.md writes the delegation down, adds
proportionate review, and requires every affected component's acceptance for family policy.

CHARTER.md is removed. README.md, CONTRIBUTING.md, AGENTS.md, the pull request template and
ADR 0014 point to IDENTITY.md instead, and ADR 0014 records why in a dated note.

### 3. The change rule, the guards, and the check

IDENTITY.md states the change rule (§ How a contract changes) and the guards (§ Guards against
drift).
- **Every substantive change is a supersession record** with seven fields: the affected
  contract; what it supersedes or updates; the old rationale and the present tradeoff;
  authority and delegation; alternatives and consequences; evidence and obligations; and the
  approved revision (R6). The old reason need not be shown false.
- **Authority.** The owner's standing ruling of 4 October 2026 ("Ultimately, it is your call.
  Never ask me.") delegates these decisions to the affected components' agents. The owner's
  earlier words are provenance, not an authorization test (R7). A family policy changes only
  with the acceptance of every affected component's agents. No single component and no
  consumer release can supersede one (grade condition 1).
- **Review is proportionate.** An editorial change needs nothing more. An update that
  supersedes nothing needs a peer read. A supersession of any recorded decision, above all one
  the owner made, needs two sealed derivations, one of which tries to defeat the favoured
  design, and a peer read (R7, grade condition 2).
- **The guards.** "Consumers cannot amend a depended-on contract by implication. Conflicts are
  resolved by the authority responsible for the affected contract." (R5) This replaces "authority
  flows floor-ward": dependency direction protects contracts, and it does not give the lowest
  library jurisdiction over the designs above it.

[tools/identity_check.py](../../tools/identity_check.py) runs in CI's `spec` job as a
change-detection and provenance aid, not a decision procedure (R7). It checks that:
- each entry has its statement, reason and four attributes;
- each statement, reason and authority matches its pin in
  [tools/identity.lock](../../tools/identity.lock), and so does each pinned section;
- every supersession record carries the seven fields, two cited derivations and a peer read;
- a family-policy record names every component's acceptance;
- every structured `Supersedes:` line naming a record a contract rests on comes with an
  `Identity:` line;
- every quotation in an entry's attributes is verbatim.

Its self-test plants each defect and requires it to turn red for that defect.

One adaptation is named. R7 makes the English-keyword rule a warning. The check keeps it an
error in one case: prose that supersedes a record the contracts rest on, without the structured
lines. That was the October defect exactly, and a warning in a CI log would not have stopped
it. Prose that supersedes anything else only warns, and adding the structured lines satisfies
the rule, so the structured links are the primary check.

### 4. ID12's adoption supersedes released B

The owner approved B on 4 October, so adopting A now is a supersession of a released design,
not a finding that B was never approved (R8). This is its record.

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
  - the affine-versus-persistent question (R26, §5).
- **Approved revision:** IDENTITY.md's ID12 and ID13 as pinned in
  [tools/identity.lock](../../tools/identity.lock) at this record's merge.
- **Derivations:**
  - seat caa's and deixis-fable's sealed stances, compared in §2;
  - the Codex session's Bitspark/deixis#19, as a third;
  - research 0006 (deixis-internal#80), whose advice weighed B against A with both designs'
    authority. That is the explicit attempt to defeat the favoured design.
- **Peer read:** deixis-fable, on Bitspark/deixis#20, at each revision.
- **Accepted-by:** deixis, by this record; bitwire, by its decision 0015 in bitwire#76;
  bitruntime, by bitruntime#36. This record merges after both have merged.

### 5. WIRES.md

WIRES.md keeps its decided doctrine. #19 had replaced it, and Bitspark/deixis#18 restored it
with #19's precisions as amendments. This record changes two things:
- **§4's amendment** now states the three laws of R13: complete views (ID11), `under` (ID11),
  and dispatch coherence per relay profile (ID13). It gives the relay-profile declarations
  (R14), and replaces "a relay chain is a relay" with the conditional composition sentence.
- **§5 stays OPEN** (R26). The earlier version of this record closed it, on the reading that a
  persistent `send(message): void` is a refinement of affine one-shot transitions. The advice
  shows that the signature alone is not a refinement argument, so that closure is withdrawn.
  Trigger: when bitwire#76 merges and a persistent `Wire.send` becomes the released primitive,
  one of two records is owed. Either supply the state mapping from persistent sends to affine
  transitions (concurrent sends, continuation advancement, cancellation, failure, replay), or
  record that persistent messaging is the primitive and affine sessions an optional profile.
  Owner: seat caa.

### 6. Who owns what

The family's split of responsibilities under ID9 to ID13, as Bitspark/deixis#19 proposed it.
It is recorded here and not in IDENTITY.md, because it names consumers. Each row is its
owners' to confirm.

| concern | owner, and its limit |
| --- | --- |
| structure, selection, reconstruction, codec laws | deixis: no I/O, name lookup, transport, application vocabulary or authority policy |
| addressless send, endpoint ownership, addressed access and their message laws | bitwire: addressed access is distinct from complete structure |
| carriers, queues, dispatch, connection lifetime, the shared addressing implementation | bitruntime: a carrier needs only the addressless contract |
| binding names, identity and authority checks | a declared binding profile and its runtime (ADR 0013 §2) |
| discovery, paging and snapshot promotion | an explicit effectful view (ADR 0013 §8): a failed fetch does not prove absence |
| requests, replies, errors, cancellation, streams | **open.** Never inferred from a tree or required by a wire. Leaving them to each consumer duplicates them per consumer. Research 0006's R3 names the seven problems an exchange contract must settle. deixis-fable carried them to bitwire#76, and that contract's decision there is the trigger |

### 7. What comes next

- **Projection and effects vectors (R25a).** Hand-authored families in [vectors/](../../vectors/),
  replayed by all four cores:
  - every cut;
  - zero invocations on absence and exactly one on presence;
  - unchanged argument and handle identity;
  - separately initialised fixtures for effects and aliases;
  - path capture after binding;
  - the `Atom`/`Uint8Array` boundary.

  Owner: deixis-fable, once this record merges. ID9 and ID10 then move from "not yet" to
  checked.
- **Family batteries (R25b), deferred.** Trigger: bitwire#76 merges. Then bitwire's and
  bitruntime's agents own the crossing, exchange, relay and ownership families against the
  merged contract.
- **ADR 0013, in its own record.** These belong to that record:
  - §9's topos disposition becomes a scoped supersession of the 20 August ruling's destination
    (R9), with M1's deliverables kept or retired by name, extraction triggers, and the
    cell-contract open list;
  - §8 gains the mount resolver rule (R13);
  - the correction section's account is made symmetric (R2, R28, grade condition 4).

## What this does not decide

- It does not freeze `deixis-codec-v2`. The codec keeps its own freeze track.
- It does not decide where names sit in a profile, or how a component implements the addressing
  contract.
- It does not settle the exchange contract (§6) or the affine-versus-persistent question (§5).
  Each has its owner and its trigger.

## Consequences

- [README.md](../../README.md), [CONTRIBUTING.md](../../CONTRIBUTING.md),
  [AGENTS.md](../../AGENTS.md) and the pull request template name IDENTITY.md as deixis's
  identity, where they named the charter.
- The `spec` check is required on `main`. A change to a contract's statement, reason or
  authority therefore cannot merge without a record, a change-log entry and the new pin, and a
  supersession cannot merge without its fields, derivations and peer read.
- A record that reverses part of deixis's design now has to say so, in lines a reviewer and a
  machine can both find.
