# Codec grammar and version for mandatory node values

**Status:** accepted, 2026-09-23. Every decision below was the operator's.
- **Sections 2 (grammar A0), 3 (succeed to v2) and 5 (old bytes not preserved), and
  the migration's scope.** These are the operator's answers to a two-question prompt,
  relayed by the vectors lane with the chosen option texts verbatim:
  - *"New grammar only: One node production at every node: own-value payload, then
    child count and entries, under a new magic and version name. The old bytes stay
    historical."*
  - *"All in-house steps: Revise CODEC.md and its proof ledger, write independent codec
    vectors, then implement all four cores and gate them in the harness. It stays
    'candidate, not frozen', because freezing needs the external clean-room
    implementation and a signed manifest."*
- **Section 4 (the slot-codec renames and the option-of id form), and the migration in
  section 6.** The operator accepted both in the codec lane's session: *"Accept
  both"* (the renames and option-of), and *"Yes, merge it"*, so that the migration
  can start.

This record answers [ADR 0010](0010-mandatory-node-values.md) §8 item 6,
opened on the operator's go of 2026-09-23 ("let's do the codec then", relayed on the
deixis board), and is written by the codec lane. Under the independence rule the
ADR 0010 delivery follows, the lane that writes this grammar does not write its
expected bytes: the corpus belongs to the vectors lane.

**Scope.** If accepted, this record decides five things:
1. the node grammar of both forms;
2. the version and magic;
3. the slot-codec terminology, the fault codes, and the one registry addition the
   model needs;
4. the disposition of the previous model's bytes;
5. the migration of the codec's documents, corpus, checks and proofs.

It does not decide the freeze or its timing, the hash (SHA-256), the envelope floors,
the two-form architecture, or any expected byte string. All of those carry over or
stay with their owners.

## 1. What the options are priced against

Each fact below is reproducible. The repository facts are taken at `ccca7cd` (v0.2.0);
the ontos fact names its own commit.

- **The v1 grammar was never implemented.** No code file on any ref has ever
  contained its magic strings: `git log --all -S dxf1 --name-only -- '*.rs' '*.go'
  '*.ts' '*.py' '*.mjs' '*.js'` lists nothing, and the same holds for `dxl1`.
  The v0.2.0 release notes say *"The canonical codec remains unimplemented and
  unfrozen."*
- **The clean-room commission was never sent.** [0007](0007-clean-room-commission.md)'s
  status is *"the brief, ready to send"*.
- **No codec artifact or address exists outside this repository.** No release has
  carried the codec. The only `dxf1` and `dxl1` byte strings are this repository's own
  fixtures, so there is no artifact or address to convert.
- **Nothing outside the deixis repository uses the codec.** A grep over the whole
  constellation directory finds no file outside deixis that contains `dxf1`, `dxl1` or
  `deixis-codec-v1`. The control shows the grep can find things: 122 files outside
  deixis mention `deixis`. This check is the vectors lane's; it replaces a narrower one
  over the ontos projection alone.
- **The historical corpus is 45 named entries,** counted as the harness counts them
  (named entries of top-level arrays): 40 cases plus 5 chunk fixtures, across
  `codec-flat.json`, `codec-invalid.json`, `codec-linked.json` and
  `codec-precedence.json`. The first draft said "47 named cases", counting nested
  named objects too.
  `tools/pincheck.py` reports 158 fragments of [CODEC.md](../CODEC.md) pinned across
  40 of those cases.
- **ADR 0010 frees the choice.** §1 says *"Earlier APIs, fixture layouts, bytes and
  addresses do not constrain the chosen model"*, and *"Published history and past
  evidence are not retroactively rewritten."* §2 says an encoding that keeps bytes
  across `O[T] ≅ M[Option[T]]` *"must declare its option awareness and obey the existing
  version policy; it is not a property supplied by a generic opaque-slot codec."*
- **The proofs need one thing of the grammar.** The paper's `def:encd`,
  `lem:selfdelim` and `thm:codec` need exactly one encoding per node whose bytes
  determine its own value and its children, with a prefix-free length code and strict
  key order. `def:encd` fixes a marker octet `τ` but selects *"neither τ nor a deployed
  byte layout"*.

Nothing is deployed, so there is nothing to preserve. An option can save documents
and fixtures, and nothing else.

## 2. The node grammar

### 2.1 Candidates

**A0: one production, no marker.**

```text
node  := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*    # payload = e(own)
entry := cuvarint(len(key)) ‖ key ‖ node
```

**A1: the same, with the paper's fixed marker octet.**

```text
node  := τ ‖ cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*
```

**A2: shape tags, childless versus with children.**

```text
node  := 0x00 ‖ cuvarint(len(payload)) ‖ payload
       | 0x01 ‖ cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*    # count ≥ 1
```

**B: the previous model's bytes kept on E's image, for `Node[Option[U]]` only.**

```text
node  := 0x00 ‖ cuvarint(len(p)) ‖ p                                  # Node(Some(u), {})
       | 0x01 ‖ cuvarint(count) ‖ entry*                              # Node(None, m)
       | 0x02 ‖ cuvarint(len(p)) ‖ p ‖ cuvarint(count) ‖ entry*        # Node(Some(u), m), m ≠ {}
```

### 2.2 What each buys and what it costs

| | buys | costs |
| --- | --- | --- |
| **A0** | Every octet carries information. One production, so the codec's proofs run over one constructor, as ADR 0010's model does. Framing stays decidable without the slot codec, because the payload is length-prefixed. The grammar never reads a payload. It is the smallest generic option. | The paper's `def:framing` fixes `τ` as an octet, so instantiating A0 needs `τ` read as a fixed, possibly empty string. The proofs never use its length. A misaligned parse fails at a later and less specific code than A1's. |
| **A1** | Instantiates `def:encd` literally. A fixed octet at every node gives a misaligned parse an early and specific fault. | One octet per node in both forms, for a value that never varies. The fault it adds is a diagnostic, not a correctness property: A0's canonicality rules already refuse every misaligned string. |
| **A2** | One octet less than A1 on childless nodes. | Two productions for one constructor, plus a new canonicality rule (`count ≥ 1` under `0x01`) and its fault. It is never smaller than A0. Dominated. |
| **B** | The previous model's bytes survive for trees in E's image, so most historical judgments would carry over. | It is not a codec for `Node[T]`: it applies only when `T = Option[U]`, and it lifts the payload's option tag into the node tag, which ADR 0010 §2 says must be a separately identified, option-aware encoding. It adds a second grammar to specify, prove, vector and freeze, and the generic case still needs A0 or A1. The bytes it preserves were never deployed. |

**Decided: A0** (the operator's answer, in the status). A1 would have kept the
paper's definition unchanged at one octet per node. The paper lane will restate
`def:framing` so that `τ` is a fixed, possibly empty string; `lem:selfdelim` and
`thm:codec` never use its length.

### 2.3 Both forms under A0

```text
flat   := header ‖ node
header := "dxf2" ‖ cuvarint(len(id)) ‖ id
node   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*
entry  := cuvarint(len(key)) ‖ key ‖ node

chunk  := "dxl2" ‖ cuvarint(len(id)) ‖ id
        ‖ cuvarint(nlinks) ‖ hash{32}*                                  # the links header
        ‖ body
body   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ lentry*
lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)
```

CODEC.md's canonicality rules (§5, §6) carry over, with three changes:
- The tag rule (§5 rule 2) is removed.
- `payload ∈ im(e)` (§5 rule 5) applies at **every** node, not only at leaves.
- *"An empty struct is `0x01 ‖ 0x00`"* is replaced: a childless node is its framed
  payload followed by `0x00`. Under a slot codec whose `e` can be empty, `0x00 ‖ 0x00`
  is a legal node.

A childless node's chunk has `nlinks = 0`. One node per chunk, first-use order, the
links-header rules and a store's freedom to pack privately are unchanged.

Consequences elsewhere in the contract:
- **§9:** `unknown_tag` is removed. No code is added. *(Amended 2026-09-23: CODEC.md
  v2 adds `malformed_slot_codec_id`. v1 declared impossible ids invalid but named no code
  for them, so law 3 could not pin one; the vectors lane found it while planning the v2
  corpus.)*
- **§10:** the tag-octet row is removed. The other rows and the three unreachable pairs
  stand.
- **§11:** *"leaf payloads are length-prefixed"* becomes *"node payloads are
  length-prefixed"*. Its three obligations are unchanged.
- **§12:** *"leaf payload length"* becomes *"payload length"*, and *"entries per
  struct"* becomes *"entries per node"*. No floor changes.

## 3. Version: a successor, not a revision of v1

| | buys | costs |
| --- | --- | --- |
| **Keep** `deixis-codec-v1`, `dxf1`, `dxl1` for the new grammar | No rename in forward-looking documents, and the first frozen version is called v1. | Two incompatible grammars under one magic and one address-space name. Every historical byte string (the 45 corpus entries, the notes, the paper's history) becomes ambiguous by its bytes alone. CODEC.md §16's *"A successor takes new magic"* needs a pre-freeze exception. [0006](0006-canonical-codec.md)'s decision 1 (*"every vector and every hash will be generated against these exact octets"*) is reversed. |
| **Succeed:** `deixis-codec-v2`, `dxf2`, `dxl2` | Bytes and names identify their grammar. Historical records that say `deixis-codec-v1` stay literally true with no edit, which is what ADR 0010 §1 asks of published history. §16 applies as written: new magic, and the new address space `dxl2`. | Forward-looking references move from v1 to v2: CODEC.md, the 0007 brief, the vectors README and CODEC-PLAN, the harness labels, EVIDENCE and 0003. The first version to freeze is numbered 2. |

**Decided: succeed** (the operator's answer, in the status). `deixis-codec-v1` becomes
a withdrawn candidate: specified,
reviewed and vectored, but never frozen, implemented or commissioned. No conversion
artifact under §16 is owed, because no v1 artifact or address exists (section 1).

## 4. Slot codecs: terminology, codes and one id form

*Decided: both the renames and the option-of form (the operator's answer, in the
status).*

Every node now carries a value, so *leaf codec* names the wrong thing. SLOTS.md already
calls it the slot codec.

**Renames, made with the version.** Fault codes are version-scoped identifiers (§9:
*"Adding a code is a version act"*), so a rename costs nothing at a version boundary
and cannot be made after one.

| v1 | v2 |
| --- | --- |
| leaf codec | slot codec |
| leaf-codec-id | slot-codec-id |
| leaf-holding / leaf-blind (§2.1) | codec-holding / codec-blind |
| `unsupported_leaf_codec` | `unsupported_slot_codec` |
| `leaf_codec_mismatch` | `slot_codec_mismatch` |

`non_canonical_payload` keeps its name.

**Carried over unchanged:** the id grammar's public and private forms, the registry's
governance, and both assignments. A slot codec's meaning does not depend on the node
grammar: `00 01` stays `deixis/identity-bytes`, and `00 02` stays `ontos-codec-v1`.

**One id form is added.** The model makes optional values an explicit instantiation,
and two consumers need one now: the set profile over `Node[Option[U]]` (ADR 0010 §6)
and E's image of historical trees.

```text
id := 0x00 ‖ cuvarint(n)              # public, registry-assigned, n ≥ 1
    | 0x01 ‖ ns{16} ‖ cuvarint(k)     # private, self-scoped
    | 0x02 ‖ id                       # option-of: Option over the codec the inner id names
                                     # 0x03..0xff reserved for future id forms
```

`option-of(c)` is defined as follows:
- **carrier:** `Option[T_c]`.
- **equivalence:** `None ≈ None`; `Some(x) ≈ Some(y)` iff `x ≈_c y`; `None ≉ Some(_)`.
- **encoder:** `e(None) = 0x00`; `e(Some(x)) = 0x01 ‖ e_c(x)`.
- **decoder:** `D` accepts exactly those two shapes. Anything else is
  `non_canonical_payload`.
- **lawfulness:** it is lawful, with decidable `im(e)`, whenever `c` is.
- **length:** the id's total length stays within 2..32 octets, which bounds nesting.
- **unknown inner id:** an option-of id whose inner id is unsupported is
  `unsupported_slot_codec`. A malformed inner id is invalid, as for any id.

**Not added.** A unit codec (`e(()) = ε`, for `Node[Unit]`) has no consumer yet. Under
the registry's trigger discipline it is registered with its first consumer, not here.

## 5. The previous model's bytes

**Decided: not preserved** (candidate B, section 2.2). A historical tree is encoded in
v2 through E, into `Node[Option[U]]`, under the slot codec `option-of(id_U)`. Its bytes
differ from v1's. No v1 byte string or address exists outside this repository, so no
conversion is owed. The v1 corpus remains the evidence for the v1 candidate. It is not
rewritten; it is relabelled through the erratum process.

## 6. Migration, if accepted

The steps are listed in dependency order. Where the independence rule decides who
does a step, the owner is named.

1. **CODEC.md** becomes the `deixis-codec-v2` candidate contract (codec lane). The v1
   text is kept as its own document, so the historical corpus still has a
   specification to cite.
2. **The checks** move in the same change, or CI fails:
   - `tools/pincheck.py` pins the v1 corpus's 158 fragments in CODEC.md, and must
     target the kept v1 text.
   - claimcheck claims that quote CODEC.md are updated or re-scoped. This includes
     0003's tag-octet claim.
   - `tools/speccheck.py` runs over the new text.
   - The harness keeps the v1 files indexed-only, labelled historical.
3. **The v2 corpus** is hand-authored from the v2 text alone, and CODEC-PLAN is
   revised (vectors lane). Expected bytes precede implementations, which is 0006's
   order.
4. **[0008](0008-proof-obligations.md)** is re-derived for one constructor (codec
   lane):
   - I3 is dropped;
   - L1 loses its tag dispatch;
   - A1 to A6 carry over;
   - the law obligations are restated over the new grammar.
5. **The paper** instantiates `def:encd` with the chosen marker (paper lane). Under A0,
   `τ` becomes a possibly empty fixed string.
6. **0007's brief** is re-scoped to v2 before it is sent. It has not been sent, so no
   commission is disturbed.
7. **0006** gains a dated note (codec lane):
   - carried into v2: the two forms, the integer domain, the id grammar and registry
     governance, the envelope, the hash, the laws, the result classes and the freeze
     process;
   - not carried: the node productions, the magics and the tag row.
8. **The status lines** move to v2: 0003's freeze-readiness rows, EVIDENCE's codec
   row, and the vectors README's distribution constraint (*"until `deixis-codec-v1`
   freezes"*).
9. **The four cores implement v2:**
   - an encoder and an exact decoder in both forms, with the option-of id form if
     section 4 is accepted;
   - gated in the harness against the v2 corpus;
   - the implementer reads the v2 text and the corpus, and never writes expected bytes.

   This is the operator's scope. The result stays *"candidate, not frozen"*: freezing
   still needs 0007's clean-room implementation and a signed manifest.

**Publication consequence:** until v2 freezes, a v0.x package may ship the v2 codec
only as a candidate. It must not claim frozen conformance. It must not present a
`dxl2` address as a stable identity, because a pre-freeze change to the grammar
changes addresses.

## 7. Not decided here

- Whether and when v2 freezes. 0006's process decides that, including the clean-room
  step.
- The hash (SHA-256), the envelope floors, one node per chunk, and the links header.
  All are kept.
- A unit codec, sum codecs, or any further id form. Each comes with its first
  consumer.
- Any expected byte string.

The migration starts with this acceptance. Until each step lands, the documents,
corpus and checks it changes stay as they are.
