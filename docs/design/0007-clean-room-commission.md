# deixis — the clean-room commission

**Amended 2026-10-04: the repository goes public, and the withholding is per implementer.**
The operator ruled on 2026-10-04 that deixis goes public with its corpus. This record had
enforced the withholding by keeping the repository private, and that no longer holds. It
also never held for the corpus alone: the brief withholds the corpus, the four
implementations *and* the design records, and the implementations and design records were
going public in any case. What remains is the protocol both external consultations on the
codec describe (the consultations themselves are not published): give the
implementer the specification first, keep the vectors from them during the initial
implementation, and reveal them once their interpretation package is committed. That now
rests on the implementer's undertaking not to consult this repository and on the lineage
record, which is weaker than access control and is stated as such below.
[§ Delivery mechanics](#delivery-mechanics--the-undertaking-that-replaces-access-control)
and the brief's [§ What you are asked not to consult](#what-you-are-asked-not-to-consult-and-why)
are rewritten for it; nothing else in the commission changes.

**Re-scoped 2026-09-23:** the commission is now for `deixis-codec-v2`
([ADR 0011](0011-codec-for-mandatory-nodes.md)), whose contract is
[CODEC.md](../CODEC.md). The brief was never sent, so no commission is disturbed.
Wherever the brief below says `deixis-codec-v1`, read `deixis-codec-v2`. The four
files it names are the current ones. Any implementation built in-house, including
the four cores', has seen the corpus and is not this commission's clean-room
implementation.

**Status:** the brief, ready to send. Freeze step 3 of
[0006](0006-canonical-codec.md)'s process, and the item the external codec advice
(research-docs/0001) called *"the single highest-value addition"*: one genuinely
clean-room implementation of `deixis-codec-v1`, built from the specification alone,
**with our conformance corpus withheld**.

Part I records the decisions — what we commission and what we deliberately do not.
**Part II is the brief itself**, self-contained, and is what an implementer receives.

---

# Part I — the decisions (ours, not the implementer's)

## Why the vectors are withheld

Our vectors are hand-authored from the spec, replayed by four cores, and they are a
good oracle. What they cannot do is tell us whether the **specification** is
readable, because everyone who has read it has also read them — and a vector
silently teaches the reading it encodes. An implementer with the corpus resolves
ambiguities against the fixtures without ever noticing one existed.

So the deliverable we are buying is **two artifacts, and the second is the more
valuable**:

1. a working implementation, and
2. **the ambiguity log** — every question the specification failed to answer, every
   inferred choice, recorded at the moment of doubt.

The advice put the reason plainly: a fifth implementation written inside this
organisation, with the same review history and the same AI tooling, is a fifth
correlated reading. The point of paying an outsider is to buy a reading that is not
ours.

## What we commission — three artifacts, not the whole spec

Scoped deliberately small, so the commission is affordable and lands on the parts
where a misreading is fatal:

| # | artifact | why this one |
| --- | --- | --- |
| 1 | flat encoder + decoder | canonicality and the rejection discipline live here |
| 2 | linked chunk encoder + closure validator | first-use order and the links header are the subtlest clauses in the document |
| 3 | the flat ↔ linked bridge | law 2's cross-form agreement, which nothing else exercises |

**Out of scope** and stated so: the resource envelope's per-dimension floors
(implementation-test material, not spec-agreement material), the leaf-codec
registry beyond the two assignments they need, streaming, and performance of any
kind.

⚠ **Two leaf codecs, not one — corrected 2026-08-29 by the O1.5 audit**
([0008](0008-proof-obligations.md) A3). This brief originally supplied only
`00 01` `deixis/identity-bytes`, whose `e` is the identity, so `im(e) = Bytes` and
**§5.5's `payload ∈ im(e)` can never fire.** With that codec alone the implementer
could not exercise §5.5 at all — and therefore could not exercise §11's *validated*
versus *header-only* distinction either, since that distinction is precisely about
whether a decoder can check §5.5. The commission would have been structurally unable
to test the clause whose repair landed the same day. A second codec with a
proper-subset image fixes it, and the cheapest honest one is a UTF-8 string codec:
its image is the valid UTF-8 sequences, so invalid UTF-8 is a payload the encoder
can never emit and the rule bites. It is defined in the brief rather than taken from
our corpus, so nothing is leaked.

## What is supplied, and what is withheld

| supplied | withheld |
| --- | --- |
| [CODEC.md](../CODEC.md), the normative spec, complete and unmodified | **`vectors/` — the entire corpus, including `CODEC-PLAN.md`** |
| the leaf codec `00 01` `deixis/identity-bytes` (it is in §13) | [0006](0006-canonical-codec.md) and every other design record |
| [TREE.md](../TREE.md) and [SLOTS.md](../SLOTS.md), for the value model the codec is *of* | our four core implementations, in any language |
| **Part II of this record**, extracted and sent on its own | Part I (it names what is withheld), the paper, the advice ledgers, and **access to this repository in any form** |

TREE and SLOTS are supplied because the codec is meaningless without the value
model — an implementer who has to guess what a node *is* produces ambiguities about
our failure to send the right document, which teaches us nothing. Everything else
is withheld because it encodes a reading.

## The rule that makes the commission work: do not answer questions

**A clarification given mid-implementation repairs the code and leaves the
specification broken.** That is the whole failure mode this exercise exists to
detect, so:

- Questions are **logged, not answered.** A logged question is the product.
- If the implementer is genuinely blocked — cannot proceed at all — they may ask.
  We then record it as a **blocking ambiguity** *first*, in the log, and only then
  answer. The answer is marked in the log as ours, so it is never mistaken for
  something the specification said.
- Nobody on our side reviews their code while it is being written. There is no
  "quick look".

This is the discipline the exercise buys, and it is the one most likely to erode
under ordinary politeness.

## Acceptance, and how disagreements are ruled

When the implementer declares done, we run their artifacts against the withheld
corpus. Then, for every disagreement:

> **A discrepancy is a specification defect until proven an implementation bug.**

Not the reverse. The instinct will be to read a mismatch as their error, because we
have four cores that agree — but four cores that agree with each other and with the
vectors they were written against is exactly the correlated reading this commission
exists to break. The ruling procedure: re-derive the disputed behaviour **from the
frozen clause alone**, in writing, before looking at any implementation. If the
clause does not decide it, the spec is defective, whatever the corpus says.

Their implementation is **not** adopted, vendored, or maintained by us. We are
buying a reading, not a fifth core.

## Independence lineage — recorded, because "clean-room" is a claim

We ask the implementer to record, and we publish alongside the log: who wrote it;
what libraries and reference implementations were consulted (CBOR, protobuf,
Merkle-DAG codecs — consulting them is *allowed*, concealing it is not); which
AI models or assistants were used and how; and whether any of our source, vectors,
or design records were visible at any point. A lineage record that says "an LLM
wrote most of it, prompted from the spec" is useful evidence; the same fact
undisclosed silently destroys the independence claim the commission is buying.

## Delivery mechanics — the undertaking that replaces access control

While the repository was private, the withholding was enforced by access control:
`vectors/` lived inside it beside the spec. Once it is public, anyone, the implementer
included, can read the corpus, the four implementations and these design records. **The commission therefore asks for an undertaking instead: the
implementer does not open this repository, its vectors, its implementations or its
design records until their interpretation package is committed**, and the lineage record
says whether they did anyway. This is weaker than access control, and the difference is
the one that mattered before: nothing announces that the corpus was seen. A disclosed
glimpse is evidence, recorded and weighed; an undisclosed one ends the exercise silently,
and the resulting ambiguity log looks exactly as valuable as a real one. So the brief
asks for the undertaking in plain words, and the lineage section asks the question
directly rather than leaving it implied.

Deliver as **four files, sent directly**: `CODEC.md`, `TREE.md`,
`SLOTS.md`, and Part II of this record extracted on its own. Part I does not
travel — it describes what is being withheld and how disagreements will be ruled,
which is our business and biases theirs.

Their deliverables come back the same way, outside the repository. Their code is
not vendored here (§ *Acceptance*); the ambiguity log and lineage record land as a
research-doc-shaped artifact once the commission closes.

## Where this sits in the freeze

Steps 3 and 4 are ordered against each other on purpose: the implementer receives
the spec **while the corpus is still growing**, so the vectors can be authored in
parallel without ever reaching them. The commission does not block, and is not
blocked by, the vectors lane's batches.

---

# Part II — the brief

*Everything below is what the implementer receives, together with `CODEC.md`,
`TREE.md`, and `SLOTS.md`.*

## What we are asking you to build

Three artifacts, in a language of your choice, from the enclosed specification:

1. **A flat-form encoder and decoder** — `encode(value) → octets`,
   `decode(octets) → value | refusal`.
2. **A linked-form encoder and closure validator** — `encode(value) → chunks +
   root address`, and a validator that decides whether a set of chunks plus a root
   address is a canonical value.
3. **A bridge** — decode one form, re-encode as the other, and reproduce the
   expected address.

**Two leaf codecs**, and the second one matters more than its size suggests:

1. `00 01` `deixis/identity-bytes` (specification §13) — leaves are octet strings,
   equality is octet equality, the encoder is the identity.
2. A **UTF-8 string codec**, which we assign the private id
   `01 ‖ 974f082fbda84c182b8f4cfbadbb71a7 ‖ 01` (that is `0x01`, sixteen namespace
   octets, then `uvarint(1)`; §13 gives the form). Leaves are Unicode strings,
   equality is string equality, and `e` is the UTF-8 encoding.

   The namespace octets are the first sixteen of
   `sha256("deixis clean-room commission utf8 leaf codec v1")`. §13 states the
   non-collision requirement as an **obligation, not a method**; a derivation from a
   distinctive string discharges it the way a random draw does and is additionally
   *checkable* — you can recompute it and see it was minted for a stated purpose
   rather than squatted. It is private and stays private: it exists for this
   commission and names nothing in the public registry.

The second exists because the first cannot exercise §5.5. `identity-bytes` maps
onto *all* octet strings, so `payload ∈ im(e)` is satisfied by everything and the
rule never fires. UTF-8's image is a **proper subset** of the octet strings, so an
invalid UTF-8 payload is something the encoder can never produce and your decoder
must refuse — which is the behaviour §5.5 is actually about, and the one place where
holding the leaf codec changes what a decoder can certify.

Out of scope: the resource envelope's numeric floors (§12), streaming, the registry
beyond those two ids, and performance. Correctness and refusal behaviour are the
whole of it.

## What you are asked not to consult, and why

**You will not receive our conformance test vectors, our implementations, or our
design records, and we ask you not to look them up.** They are published in the deixis
repository; please do not open it, or any copy of it, until your interpretation of the
specification is committed and handed back. This is deliberate and it is the point of
the exercise. If you see any of it anyway, even briefly, say so in your lineage record:
a disclosed glimpse is useful evidence, and an undisclosed one destroys what we are
paying for.

We have four implementations that agree with each other. They were all written by
people who had read the same fixtures, so their agreement may reflect a shared
reading rather than a clear specification. **You are being asked to find out
whether the document alone is sufficient** — which only works if the document is
all you have.

## The deliverable you may not expect: the ambiguity log

**The log is a first-class deliverable and, for us, the more valuable one.** We are
buying your confusion, in detail, at the moment it occurred.

Record an entry every time you:

- could not tell what the specification required, and picked;
- found two clauses that seemed to pull in different directions;
- had to consult another format's conventions to decide something;
- implemented something that felt underspecified even though you were fairly sure;
- were surprised by a clause — *especially* if you later decided it was right.

**Write entries as you go, not at the end.** A log reconstructed afterwards is
written by someone who now knows the answers, and the moment of genuine doubt is
exactly what it loses. A retrospective log is worth a fraction of a contemporaneous
one.

Suggested entry shape — plain text is fine, structure is not the point:

```text
id:        AMB-007
clause:    §6, "first-use order"
date:      when you hit it
question:  What I could not determine from the text alone.
options:   The readings I considered, and why the text seemed to permit each.
chose:     What I implemented, and the reasoning that decided it.
confidence: sure | fairly sure | guessed
blocking:  no | yes (see below)
```

**Low-confidence entries are the most valuable rows in the document.** Please do
not tidy them away or resolve them retroactively once the answer becomes obvious.
If you find later that you guessed wrong, add a *new* entry rather than editing the
old one — the fact that a clause admitted a wrong reading is the finding.

## Questions: log them, do not send them

**Please do not ask us clarifying questions while you implement.** If you ask, we
will decline to answer, and this is not unfriendliness: an answer would repair your
implementation while leaving our specification broken, which defeats the entire
commission.

The one exception: if you are **genuinely blocked** and cannot proceed at all, ask.
We will record it as a blocking ambiguity first, then answer. Expect the answer to
be terse and to arrive with a note saying it was ours and not the document's.

We will not review your code, offer hints, or comment on your approach while the
work is in progress.

## Independence lineage

Please record, and expect us to publish alongside the log:

- who wrote the implementation;
- which libraries, reference implementations, or other formats' specifications you
  consulted (this is **allowed and normal** — CBOR, protobuf and Merkle-DAG codecs
  are reasonable things to look at; we only need to know);
- which AI models or coding assistants you used, and how much of the work they did;
- whether any of our source code, vectors, or design documents became visible to
  you at any point, even briefly.

None of these disqualify anything. An undisclosed one destroys the claim we are
paying for, so please err toward recording too much.

## What "done" looks like

1. The three artifacts, building and running.
2. The ambiguity log.
3. The lineage record.
4. A short note on anything you found *unnecessarily* hard to read — organisation,
   ordering, terminology — separate from genuine ambiguity. A clause that is
   correct but hard to follow is a real finding and has no other route to us.

After you declare done, we will run your artifacts against our withheld corpus and
share the results with you, including any place our specification turns out to have
been wrong. **A disagreement between your implementation and our corpus is treated
as a defect in our specification until we prove otherwise** — so a mismatch is not
a mark against your work, and finding one is a good outcome for both of us.

## The one thing to keep in mind

Every clause in this specification will be frozen and immutable. Bytes are forever
in this family: a defect becomes a migration nobody gets to make. So if something
reads ambiguously to you, that ambiguity is not a nuisance to be worked around — it
is the most valuable thing you can hand back to us, and it is why you are being
asked to work without the answers.
