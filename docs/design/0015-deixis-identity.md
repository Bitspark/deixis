# deixis's identity, written down

**Status:** proposed, 2026-10-05, by this repository's agents, seat caa (jlqyu6o5gy) and
deixis-fable. It is accepted when an openly framed expert consultation on it has been
evaluated and graded (deixis-internal, consultation issue linked from the pull request), and
it merges only then.

Identity: adopts ID1 to ID12

It adopts [IDENTITY.md](../../IDENTITY.md): deixis's identity as twelve numbered invariants,
each with its statement, reason, falsifier, status and sources, and the rule by which an
invariant may change. It folds into it the charter of
[ADR 0014](0014-structural-identity-and-lifted-access.md), which reached the same restoration
independently on the same day (§2a). It changes no code, codec byte or vector.

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
2. **A request was read more broadly than it was written.** On 4 October the owner asked
   bitwire for "no adapters if they are not required for good reasons if we could as well
   consolidate to one interface". The agent read that as covering the split. It reversed its
   own earlier advice, and its plan did not say that it reversed a recorded decision or the
   guard it had just read ("Preserve this distinction"). The owner approved that plan.
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
  bitwire-svc and bn-wires. It found none that recommended removing the addressless primitive,
  and it found that wherever a consultation listed something as fixed, the advice built on it.
  A frame that settles a question in advance gets an answer that ratifies it.
- **The floor's laws survived, and its identity did not.** No core code, codec byte or vector
  changed, because those are checked. What changed was text: which design deixis anchors, and
  on whose authority. Nothing checked that text.

## Decision

### 1. deixis's identity is IDENTITY.md

[IDENTITY.md](../../IDENTITY.md) at the repository root is deixis's identity: what deixis is,
twelve invariants, what deixis requires of a consumer, the words it uses, the change rule, and
the guards. Its invariants:

| | invariant | in short |
| --- | --- | --- |
| ID1 | Shape | one own value, a finite map of children, finite and well-founded, no node kinds |
| ID2 | Keys and paths | exact bytes, no reading; a path is a sequence; no sibling order |
| ID3 | Selection | the partial action; never creates, defaults, searches or enters a value |
| ID4 | Complete parts | a node is its parts; growth changes nothing else; addressed access alone is not a tree |
| ID5 | Carrier independence | ID1 to ID4 for every `T`; `map` is a functor |
| ID6 | Supplied identity | equality lifted from the slot's `≈` |
| ID7 | Values, not behaviour | the codec encodes values; content addresses are not paths; byte-profile names never move |
| ID8 | The floor stays empty | no I/O, names, time, routing, invocation, default or meaning |
| ID9 | The projection | `A.m(p, …) = at(A, p).own().m(…)` |
| ID10 | Composition inside one tree | `B = at(A, p1)` ⇒ `B.m(p, …) ≃ A.m(p1 ++ p, …)` |
| ID11 | Crossing, per relay profile | `connect(a) / p ≈ connect(a ++ p)`, its `≈` declared by the profile |
| ID12 | Addressless primitives, one shared path layer | `X1 = Deixis[X0]` for both wings; transports carry only the addressless contract |

ID1 to ID8 are the floor, ID9 to ID11 are pointing, and ID12 is the family's layering, which
deixis anchors without making it a floor law. The numbers begin with `ID` because `I1` to `I3`
and `D1`, `D2` already name other things ([ADR 0008](0008-proof-obligations.md)).

### 2. How the statement was reached

By the method deixis uses for anything it freezes: independent derivations, written sealed and
then compared.
- seat caa and deixis-fable each wrote a stance from the primary records before reading the
  other's: decisions, notes, the paper, the specification, both repositories' histories and
  the consultations.
- The two stances agreed on the identity, the floor, the projection, the layering and most
  guards, reached independently and from the same sources.
- They disagreed on ten points, and each was resolved from a source:

| # | question | resolution | source |
| --- | --- | --- | --- |
| 1 | Is "own values take no path" a floor law? | No. The floor's laws hold for every `T` (ID5), so the floor cannot forbid a path-taking `T`. It is the family's layering, ID12, and its reason moves with it. | the paper's `prop:functor` |
| 2 | Is a receiver's tree of handlers a `WireTree`? | Yes. A handler is a send end on the identity wire, and routing to it is ID9 at the receiver. The two readings were one design seen from its two ends. | [WIRES.md](../WIRES.md) §2 |
| 3 | What is ID8's status? | Settled in sessions with the owner, not an agent decision. | design notes of 2026-08-07 and 2026-08-08, headers checked |
| 4 | What was missing? | The growth law joins ID4, and the byte-profile rule joins ID7. | [TREE.md](../TREE.md) § Growth; [CODEC.md](../CODEC.md) |
| 5 | Which file, which marker? | IDENTITY.md at the root, `ID<n>`, `Identity: breaks ID<n>`. | label collisions measured in ADR 0008 |
| 6 | What does a change need? | The union of both lists (IDENTITY.md, change rule). | both stances |
| 7 | Is WIRES.md §5's one-shot question still open? | No; §4 below. | research 0002's integration ledger |
| 8 | Is topos in scope? | It goes to the consultation as a question, with both records and their authority. | ADR 0013 §9 |
| 9 | Do mounts conflict? | No. The floor never follows a mount; the path layer may, explicitly. | ADR 0013 §8; WIRES.md §4 |
| 10 | What about bitwire-svc's advice? | Its research 0001's advice, in paraphrase: make bitwire's service an A0 primitive and keep addressed access a separate consumer interface. It goes to bitwire-svc's agents, pointed at bitwire#76. | bitwire-svc PR #7 |

**A third derivation, independent of both.** While the two stances were being compared, a
Codex session working across deixis, bitwire and bitruntime, which records that it worked at
the owner's request, reached the same conclusion without seeing either stance. It merged as
Bitspark/deixis#19: [ADR 0014](0014-structural-identity-and-lifted-access.md) and a charter,
with Bitspark/bitwire#76 in bitwire. Three derivations that did not see each other agree on the
addressless `Wire`, `WireTree = Node[Wire]`, one carrier-independent addressing layer and the
lifting law.

This record takes from #19, with thanks:
- a falsifier for every invariant;
- ID10's effect semantics (the two sides are compared from the same state);
- ID11's precision about opaque facades;
- the ownership table in §6;
- the guards on reading advice against its premises and on testing promises, not names.

It differs from #19 in three ways, each for a reason:
- **One identity document.** The charter folds into IDENTITY.md (§2a).
- **WIRES.md keeps its decided doctrine.** #19 replaced it and left the reasons to Git history.
  Bitspark/deixis#18 restored it, with #19's precisions as amendments (§5).
- **Labels that collide with nothing.** `ID<n>`, not `D<n>`.

Each agent then peer-read the other's text. Four refinements came out of that:
- ID12 keeps the reason first written for the floor law that moved into it;
- the guard list is complete;
- the glossary separates the two senses of "address";
- ID7 is worded so it cannot freeze the codec by the back door.

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
| D6 structural operations never bind, invoke, acquire or dispose | ID8 | added to ID8's statement; a borrowed endpoint closed: ID8's falsifiers |
| D7 identity lifted from a supplied equivalence | ID6 | behavioural equivalence from equal bytes: ID6's falsifiers |
| D8 mapping preserves paths and commutes with selection | ID5 | — |
| lifted access | ID9, ID10 | effect semantics: ID10's statement |
| consumer boundaries | §6 below | it names consumers, so it is not in IDENTITY.md |
| amendment discipline | change rule | weigh the unchanged invariant, account for migration and evidence |

One difference is deliberate. The charter let a reasoned review amend any promise, and IDENTITY.md
keeps that for invariants this repository's agents decided. For an invariant the owner decided,
it requires the owner's words verbatim. That asks the owner for no routine confirmation. It stops
an agent from overturning the owner's ruling on a paraphrase, which is what happened here.

CHARTER.md is removed. README.md, CONTRIBUTING.md, AGENTS.md, the pull request template and
ADR 0014 point to IDENTITY.md instead, and ADR 0014 records why in a dated note.

### 3. The change rule, the guards, and the check

IDENTITY.md states the change rule (§ How an invariant changes) and the guards (§ Guards
against drift). Two of them answer this incident directly:
- **A consumer's decision never supersedes an invariant.** A contradiction is a conflict to
  resolve here.
- **A consultation that touches an invariant presents each design with its authority and
  reason.**

[tools/identity_check.py](../../tools/identity_check.py) runs in CI's `spec` job. It pins each
statement in [tools/identity.lock](../../tools/identity.lock) to the ADR that last set it, and
it refuses a record that supersedes a source of an invariant without an `Identity: breaks`
line. It also requires every quotation in a status to occur verbatim in the record it cites,
ignoring line breaks and emphasis. Its self-test plants ADR 0013's original sentence and a
paraphrased owner quote, and requires the check to turn red on each. It
cannot judge whether a change is right. What it does is stop a change to the floor from
merging looking like an ordinary edit.

### 4. WIRES.md §5's open question is closed

WIRES.md §5 left the minimal interaction primitive open: one-shot or multi-shot. Research
0002's integration ledger (2026-08-08) adopted the expert's form: "affine one-shot endpoint
transitions as normative semantics; persistent/multiplexed transports as permitted
refinements", with seven minimum laws. ADR 0012's `send(message): void` on a persistent wire is
therefore a permitted refinement, not a rival primitive. This closure is the agents' decision,
because the ledger is an agents' record. It changes no invariant.

### 5. WIRES.md keeps its doctrine

#19 replaced WIRES.md with a shorter exposition, and Bitspark/deixis#18 restored the decided
doctrine with #19's precisions as amendments:
- `/` is selection only on a complete structural view, and prefix binding through an opaque
  facade;
- what a profile stating the law defines;
- research 0002's relay safety law;
- per-end order is a relay property, not a corollary of the routing law.

This record adds two pointers: §4's amendment is ID11, and §5 records the closure in §4 above.

### 6. Who owns what

The family's split of responsibilities under ID9 to ID12, as Bitspark/deixis#19 proposed it.
It is recorded here and not in IDENTITY.md, because it names consumers. Each row is its
owners' to confirm.

| concern | owner, and its limit |
| --- | --- |
| structure, selection, reconstruction, codec laws | deixis: no I/O, name lookup, transport, application vocabulary or authority policy |
| addressless send, endpoint ownership, addressed access and their message laws | bitwire: addressed access is distinct from complete structure |
| carriers, queues, dispatch, connection lifetime, the one shared addressing implementation | bitruntime: a carrier needs only the addressless contract |
| binding names, identity and authority checks | a declared binding profile and its runtime (ADR 0013 §2) |
| discovery, paging and snapshot promotion | an explicit effectful view (ADR 0013 §8): a failed fetch does not prove absence |
| requests, replies, errors, cancellation, streams | **open.** Never inferred from a tree or required by a wire. Leaving them to each consumer's conventions duplicates them per consumer. deixis-fable's peer read of bitwire#76 (item 3) proposes one exchange profile, specified once above addressed access. The trigger is that proposal's decision on bitwire#76 |

### 7. What comes next

- **A projection vector family.** ID10 is proved but not yet checked. A scripted family in
  [vectors/](../../vectors/), replayed by all four cores, should cover selecting, invoking
  once, a miss on both sides, and prefix composition. Until it lands, ID10's status says "not
  yet".
- **The crossing battery** of [WIRES.md](../WIRES.md) §8 stays the route by which ID11 becomes
  checked.
- **bitwire and bitruntime.** Restoring the addressless primitive and one shared path layer is
  for their agents to design under ID9 to ID12. deixis-fable carries the request. Keeping
  bitwire 0.4.0's single conveyance type and message format is compatible with ID12: the
  message format can serve as the path layer's encoding.

## What this does not decide

- It does not freeze `deixis-codec-v2`. The codec keeps its own freeze track.
- It does not decide where names sit in a profile, or how a consumer realizes the path layer.
- It does not settle topos. ADR 0013 §9's disposition, made by agents on 2026-10-05, set aside
  an operator-delegated ruling of 2026-08-20. That is the same pattern as above, so the
  consultation reviews it with both records and their authority.

## Consequences

- [README.md](../../README.md), [CONTRIBUTING.md](../../CONTRIBUTING.md),
  [AGENTS.md](../../AGENTS.md) and the pull request template name IDENTITY.md as deixis's
  identity, where they named the charter.
- The `spec` check is required on `main`, so a change that breaks an invariant's pin cannot
  merge without the ADR, the change-log entry and the new pin.
- A record that reverses part of the floor now has to say so, in a line a reviewer and a
  machine can both find.
