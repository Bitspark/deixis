# deixis — the canonical codec

**Status:** draft for review — **external expert advice integrated 2026-08-08**
(research-docs/0001; dispositions in its `.integration.md` ledger; the advice's
freeze gates are adopted below) - and **every open item is now decided**
(2026-08-20, operator-delegated: magic strings, leaf-codec-id grammar and
registry, the multidimensional envelope floors, the same-step priority table).
This is the design record that integrates every intake source for
`deixis-codec-v1`; it is **not** the freeze - the normative spec, the
hand-authored vectors and the clean-room derivation still stand between this
record and frozen bytes. The freeze requires, in order:
review of this record, the normative spec, hand-authored vectors, and only then
implementations. Bytes are forever in this family — this is the one artifact class
where a defect is a migration nobody gets to make — so the ritual is the point.

**Intake integrated here:** [0001](0001-keys-are-bytes.md)'s combinator ("deixis owns
half a codec"); the [paper](../paper/deixis.tex)'s framing theorem with its explicit
assumptions (prefix-free length code, distinct tags, strict canonical order) and its
encoder-vs-codec distinction; review-01's normative-decoder rejection list and
version/domain-separation binding; the **two-form finding** and **links-header
refinement** from the place-layer notes
(§7, §9); proposal Q5 (profile identifiers in-band); and
[0005](0005-set-keys.md)'s node-member form as the first waiting consumer.

## Scope

`deixis-codec-v1` is the codec **combinator** made concrete: given a lawful leaf
profile `e` for the slot (the codec law `x ≈ y ⟺ e(x) = e(y)`, plus an exact partial
decoder for it), it yields canonical bytes and an exact decoder for `Node(T)`. It
ships **two forms over one value semantics**:

- **Flat form** — one contiguous byte string per tree. For whole-value interchange,
  signatures over a single artifact, and small values.
- **Linked form** — one chunk per node, children referenced by hash, each chunk
  opening with an extractable **links header**. For stores and wires: structural
  sharing, Merkle sync, and servers that move subtrees they never decode (the topos
  opacity law depends on exactly this).

Each form is separately a lawful complete invariant: within a form, equal bytes iff
`=_≈`-equal values. Across forms, decoding agrees up to `=_≈`. The forms' byte strings
and hashes do **not** correspond to each other, by design.

**Which "one identity" (intake from review-02 §9, routed by the vectors lane).** Three notions must
not be conflated, and this record now states which it means where:

1. **Node identity** — both forms decode to `=_≈`-equal nodes. This is the *only*
   cross-form identity claimed, and it is the sense of "two forms over one value
   semantics" above.
2. **Canonical bytes** — each form is its own lawful complete invariant; two lawful
   codecs over the same nodes do not, and here deliberately do not, share bytes.
3. **Content address** — addresses are codec-scoped. The address of a value is the
   **linked root hash, exclusively**; the flat form's digest is a lawful invariant
   but never an address, and no cross-form commitment scheme (shared logical stream,
   representation-independent manifest) is attempted — one address source, computed
   not carried. This also settles former open question 2 below, and the
   deployed-address binding (codec version + slot codec + digest algorithm inside
   the hashed bytes) accordingly binds to the linked form specifically.

## The flat form

Per the paper's Def. framing, with every parameter now picked:

```text
flat := header ‖ node
header := "dxf1" ‖ uvarint(len(leaf-codec-id)) ‖ leaf-codec-id        # Q5: in-band
node   := 0x00 ‖ uvarint(len(payload)) ‖ payload                # Leaf; payload = e(x)
        | 0x01 ‖ uvarint(count) ‖ entry*                        # Struct
entry  := uvarint(len(key)) ‖ key ‖ node                        # strictly κ-ascending? no —
                                                                # strictly LEX-ascending, unique
```

- `uvarint` = shortest-form unsigned LEB128 over **exactly `0 … 2^64−1`** — at most
  ten octets, never an unbounded mathematical natural on the wire (external advice:
  fix the integer domain before anything else). A non-shortest spelling **rejects**
  (`non_shortest_uvarint`); a spelling exceeding the domain **rejects**
  (`uvarint_overflow`). Implementation note: TypeScript parses with `BigInt`, never
  `Number`.
- Entries in strictly ascending unsigned-lexicographic key order, keys unique;
  violations **reject** (never re-sort, never deduplicate — decode is recognition,
  and recognition never repairs).
- The **leaf-codec-id** is in-band (Q5 decided as recommended): the bytes are
  self-describing at the artifact boundary, and the identifier is the leaf encoder's
  stable id per [0005](0005-set-keys.md)'s instance framing; the registry of ids is
  an append-only table in the spec. (Formerly called the leaf "profile id" — renamed
  per the intake section below to end the collision with structure profiles.)

## The linked form

One node, one chunk — the chunking rule must be canonical, and "every node is its own
chunk" is the deterministic choice (inlining small subtrees is a *store's* private
representation, never the canonical form):

```text
chunk  := "dxl1" ‖ uvarint(len(leaf-codec-id)) ‖ leaf-codec-id
        ‖ uvarint(nlinks) ‖ hash*                               # the LINKS HEADER
        ‖ body
body   := 0x00 ‖ uvarint(len(payload)) ‖ payload                # Leaf
        | 0x01 ‖ uvarint(count) ‖ lentry*                       # Struct
lentry := uvarint(len(key)) ‖ key ‖ uvarint(link-index)         # child by INDEX into links
```

- The links header lists child chunk hashes in **first-use order**; `lentry` bodies
  reference by index. A server extracts the complete outgoing reference set by
  reading only the header — it never parses keys or payloads. This is the
  opacity-preserving sync primitive (git/IPFS object shape).
- **Scope of header-only validation** (external advice, stated so the guarantee is
  never overclaimed): a header-only store validates digest integrity, header
  framing, and presence of claimed links — it does **not** certify that a stored
  root is a canonical value. The layout's conservative property still holds:
  bodies reference children only by header index, so a valid body cannot hide an
  undisclosed child; extra header links cause over-retention, never hidden edges.
  Consequences land on consumers: full canonical validation is client-side or
  trusted-writer-side; name bindings distinguish **"opaque closure present"** from
  **"value validated"**; GC treats all claimed links as live; retention/fanout
  quotas bound unused-link abuse. And opacity is **not privacy**: a store can
  observe sizes, topology, repeated-subtree hashes, timing — and everything, if it
  chooses to decode. Confidentiality is outside v1's guarantees, said plainly so
  "opaque" never becomes ecosystem shorthand for "confidential".
- Duplicate child hashes appear **once** in the header (indices share); a header
  listing a hash no body index uses, an index out of range, or hashes out of
  first-use order **rejects**.
- **The canonical content address of a value is the hash of its root chunk.** The
  flat form's digest is *a* lawful invariant but not the address; one value, one
  address, and it composes (every subtree has one too).
- **An address is scoped to `deixis-codec-v1`.** Cross-version address equivalence
  will never exist; a future v2 migration is a data artifact (a mapping tree),
  never address polymorphism — the CIDv0/v1 "same content, different address"
  confusion is the named failure this sentence exists to prevent.
- **External addresses are version-qualified** (external advice, adopted):
  everywhere an address leaves a chunk — APIs, name bindings, signature envelopes,
  logs, mapping artifacts — it travels as `(address-space = dxl1, 32-byte digest)`,
  never as an anonymous `[u8; 32]`. Raw digests live only *inside* chunks, where
  the enclosing chunk fixes version and hash. This is type information for the
  address space, not multihash-style agility (git's hash-transition ambiguity note
  is the precedent), and it forbids APIs whose address type is a bare 32-byte
  array. The **conversion-claim shape** for an eventual successor is defined at
  the freeze even though no v2 exists: source address space + exact source
  artifact/closure, target space + address, conversion spec/version, leaf-codec
  mapping, floor-preservation vs application transform, signer + evidence —
  capable of one-to-many old-digest cases, because a collision-driven transition
  means one old digest may no longer identify one artifact.
- **Collision incident policy** (external advice; addresses are *computational*
  identity — every linked-form identity claim is qualified by SHA-256 collision
  resistance, stated openly rather than hidden in theorem prose): on insertion of
  an already-present digest, the store compares exact bytes; unequal bytes under
  one digest are never overwritten or silently deduplicated — both are
  quarantined, dependent name bindings stop, a catastrophic `address_conflict` is
  emitted, and the evidence is preserved for conversion to a successor address
  space. Full traversal re-verifies every fetched chunk against its requested
  hash even where storage normally does.
- **Each header hash is the SHA-256 of the referenced child's entire chunk bytes**
  under this same layout — subtree addresses compose. Every chunk of one artifact
  carries the same leaf-codec-id; a child whose id differs from its parent's
  **rejects** (research-doc review intake; freeze item to confirm).
- **One-node-one-chunk is the canonical form, not a storage mandate.** Stores MUST
  be free to pack privately (the packfile lesson: per-node chunking at scale is
  git's loose-objects problem) with zero effect on addresses; packing is
  representation, and representation is unobservable.

## The leaf-codec-id (decided 2026-08-20)

The id names the encoder without which payload bytes mean nothing. It repeats in
**every linked chunk**, so it is opaque bounded binary - never a human-readable
name, never a DNS-shaped or case-folded string:

```text
leaf-codec-id := 0x00 | uvarint(n)              # PUBLIC - registry-assigned, n >= 1
               | 0x01 | 16 octets | uvarint(k)  # PRIVATE / EXPERIMENTAL - self-scoped
                                                #   (16 octets = the namespace; k is
                                                #    namespace-local, so a second sort
                                                #    takes k+1 with no registry act)
               # 0x02..0xff RESERVED for future id forms
```

- **Length 2..32 octets**; outside that range the artifact is **invalid** (framing).
- **`n = 0` is permanently reserved** and rejects as *invalid* - it can never name a
  codec. An unassigned `n >= 1` is a different judgment: **unsupported**, not invalid.
  The distinction is structural-impossibility versus not-yet-known, and it is why a
  registry addition can never retroactively change a past verdict.
- A **reserved first octet** (`0x02..0xff`) rejects as `unsupported_leaf_codec`, for
  the same reason: a future id form must not make today's bytes retroactively
  malformed.
- A non-shortest `uvarint` inside an id rejects (`non_shortest_uvarint`).
- **The 16 namespace octets carry an obligation, not a method** (decided 2026-08-20,
  on the vectors lane's question): they must be chosen so that two independent parties do not
  collide *without* consulting any registry. A **random draw** discharges that
  probabilistically; a **derivation from a distinctive published string** discharges
  it too and is additionally *checkable* - a reader can recompute it and see the
  namespace was minted for a stated purpose rather than squatted. Prefer derivation
  wherever the namespace is published in a spec artifact, random otherwise; and note
  the one hazard, which is why "distinctive" is load-bearing: a generic derivation
  string (`"test"`, `"fixture"`) is exactly as collidable as the name itself. The
  spec states the obligation because that is what the floor does everywhere else -
  the codec law names a property, never a procedure, and a supplier owns its own
  realization.
- Typical public ids cost **2-3 octets per chunk**, which is why the range is compact.

**Registry governance** follows RFC 8126 *Specification Required*: permanent public
documentation, expert review against stated criteria, immutable meanings, a named
change controller. Each entry pins carrier, equivalence, canonical encoder, exact
decoder acceptance language, edge cases, resource properties, complete vectors, spec
and vector-bundle hashes, status and successor. **Incompatible correction always
means a new id**; deprecation changes metadata, never meaning. Applications pin the
leaf codecs they allow - *now registered* never means *now authorized*.

**Bootstrap assignments** (two, because two consumers exist - trigger discipline):

| id | name | carrier / equality / encoder |
| --- | --- | --- |
| `00 01` | `deixis/identity-bytes` | `Bytes`, byte equality, `e = id` - the trivial slot every vector file needs |
| `00 02` | `ontos-codec-v1` | `ontos.Value` under the frozen upstream codec - the ontos bridge's leaf codec |

The conformance fixtures' **coarse setoid** takes a *private* id, published in
[vectors/README.md](../../vectors/README.md) - so the spec's own vectors exercise
both ranges, and a test carrier never occupies a public number.

## The resource envelope (floors decided 2026-08-20)

A **portable conformance floor**, never a maximum: a core MUST accept up to each
floor and MUST NOT reject below it; it MAY accept more, and beyond its own limits it
**refuses as a resource judgment**, never as invalidity. The floors are chosen for
the weakest environment we intend to call conformant - a browser-hosted TS core and
a small embedded Rust core:

| dimension | MUST-accept floor |
| --- | --- |
| varint value | `2^64 - 1` (the whole domain must parse) |
| leaf-codec-id length | 32 octets |
| key length | 4 096 octets |
| leaf payload length | 16 MiB |
| entries per struct | 65 536 |
| links per chunk | 65 536 |
| flat artifact bytes | 64 MiB |
| single chunk bytes | 32 MiB |
| unique reachable chunks | 1 000 000 |
| unique reachable bytes | 1 GiB |
| logical depth | 256 |
| **unfolded node count** | 16 777 216 (`2^24`) |
| **unfolded flat bytes** | 1 GiB |

Depth 256 is the one floor picked against a *language* rather than against data: it
bounds recursive-descent stack use in every target core while sitting far above any
real tree. The two **unfolded** rows are the sharing-bomb guard - measured over the
DAG with saturated arithmetic *before* materialization, never by materializing to
find out.

## Hash and domain separation

- v1 pins **SHA-256**. Hash agility is a new codec version, not a parameter —
  agility inside a frozen codec is how ecosystems fork silently.
- All hashes are computed over the chunk bytes as laid out above — the `dxl1` magic
  (which itself encodes the form; there is no separate form-tag field) and the
  leaf-codec-id are *inside* the hashed bytes, which is the domain-separation binding
  review-01 required: an address commits to codec version, form, and leaf
  interpretation, not merely to a naked node.

## Laws (to be proved in the spec, pinned by vectors)

1. Flat: `encF(x) = encF(y) ⟺ x =_≈ y`; `decF(encF(x)) =_≈ x`; `encF(decF(b)) = b`
   for every accepted `b` (accepted input re-encodes byte-identically).
2. Linked: root-address equality iff `=_≈` (computationally, under SHA-256 collision
   resistance — stated the honest way, per the revised paper); chunk-set decode
   agrees with flat decode up to `=_≈`.
3. Rejection is total and class-stable: every input that is not accepted receives
   a verdict in the four-class taxonomy below (invalid / unsupported / incomplete /
   resource-refused) — and for one artifact decoded sequentially, the same code
   across every core.
4. **Fault determinism, scoped (revised 2026-08-08 per external advice; supersedes
   the earlier global leftmost-first law).** For one artifact parsed sequentially,
   the code fired is where the single-pass parser first cannot continue
   canonically, with **local priorities pinned for conditions observed at the same
   parser step** (equal adjacent keys is `duplicate_key`, not `unsorted_keys`) and
   single-fault fixtures normative. Deliberately **not** frozen: a universal
   "unique first fault" across arbitrary malformed multi-chunk closures — that
   would constrain parallel fetch and streaming validators and create
   compatibility obligations unrelated to bytes or identity. A multi-chunk
   validator may report any discovered fault or a set of them; a deterministic
   root-first, header-index-order **audit traversal** is specified as an optional
   mode for reproducible diagnostics.
4a. **The same-step priority table (decided 2026-08-20).** Where two conditions are
   genuinely observable at one parser step, the code fired is the first listed:

   | at | conditions seen together | code, in precedence order |
   | --- | --- | --- |
   | artifact start | magic is not `dxf1` / `dxl1` | `unknown_magic` |
   | any `uvarint` | ill-formed continuation, or more than 10 octets | `malformed_uvarint` |
   | | well-formed, value >= `2^64` | `uvarint_overflow` |
   | | well-formed, in range, not shortest | `non_shortest_uvarint` |
   | tag octet | not `0x00` / `0x01` | `unknown_tag` |
   | entry boundary | key **equals** the previous key | `duplicate_key` |
   | | key **precedes** the previous key | `unsorted_keys` |
   | links header | the same hash listed twice | `duplicate_link_hash` |
   | | index >= `nlinks` | `bad_link_index` |
   | | first-use order violated | `links_out_of_order` |
   | | a listed hash no body index uses | `unused_link` |
   | end of input | input ends mid-structure | `unexpected_eof` (streaming: `need_more_input`) |
   | | octets remain after the root node | `trailing_bytes` |
   | child chunk | its id differs from the parent's | `leaf_codec_mismatch` |

   **Framing validation is codec-independent, and that is a normative consequence**:
   leaf payloads are length-prefixed opaque octets, so a core *without* the leaf
   codec can still judge every framing question above. Therefore framing faults
   **outrank** `unsupported_leaf_codec`, `unsupported_leaf_codec` outranks any
   payload-level judgment, and such a core MUST report the value as **unsupported -
   never as validated**. It is the header-only store's scope rule, one layer down.
5. **No lenient mode, ever.** There is no accept-noncanonical/emit-canonical option
   and none will be added under any future compatibility pressure — tolerated
   deviations are how parser-differential vulnerability classes are born (the
   duplicate-key lesson from JSON, the canonical-form-as-guidance lesson from
   CBOR).

## Result classes and rejection taxonomy (stable codes, cross-core pinned)

Reworked 2026-08-08 per external advice into **four result classes** — a decoder's
non-acceptance verdict is one of *invalid* (the bytes are not canonical deixis),
*unsupported* (well-formed framing, absent capability), *incomplete* (streaming:
a nonterminal `need_more_input` state that becomes `unexpected_eof` only when the
caller declares end-of-stream), or *resource-refused* (bytes beyond local limits —
never a claim of invalidity):

- **invalid:** `malformed_uvarint` · `non_shortest_uvarint` · `uvarint_overflow` ·
  `unknown_magic` · `unknown_tag` · `duplicate_key` · `unsorted_keys` ·
  `trailing_bytes` · `unexpected_eof` · `bad_link_index` · `unused_link` ·
  `duplicate_link_hash` · `links_out_of_order` · `leaf_codec_mismatch` (a child
  chunk's id differing from its parent's) · `non_canonical_payload` (a leaf payload
  outside `im(e)`, i.e. one the leaf decoder refuses). The varint codes are named for
  the integer, not the field — counts and link indices are not lengths.

  `non_canonical_payload` was **found by writing the normative spec** (2026-08-20):
  the taxonomy covered every framing fault and never named the one check that
  *requires* the leaf codec. It is the payload-level judgment §11 of
  [CODEC.md](../CODEC.md) orders last — outranked by framing faults and by
  `unsupported_leaf_codec` — which is why its absence was invisible until the
  ordering rule was written down.
- **unsupported:** `unsupported_leaf_codec` — an unknown id is a missing
  capability, not malformed bytes: outer framing and hashes still validate, and a
  later registry addition never rewrites the historical judgment that the bytes
  were structurally well formed. Applications pin their allowed leaf codecs;
  "now registered" never means "now authorized".
- **store/traversal layer:** `missing_chunk` · `hash_mismatch` ·
  `address_conflict` (one digest, unequal bytes — see the collision policy).
- **resource-refused:** `limit_exceeded`, against a **multidimensional MUST-accept
  envelope** fixed at the freeze — separate floors for varint value, id length,
  key length, payload length, entries per struct, links per chunk, flat-artifact
  bytes, chunk bytes, unique reachable chunks, unique reachable bytes, logical
  depth, and — the essential external finding — **unfolded logical size**. The
  linked form is a compressed DAG: chained `{a ↦ N, b ↦ N}` sharing yields `i+1`
  chunks for a tree with `2^i` leaf occurrences, so chunk-count and depth floors
  alone admit closures that explode on materialization. Consequences, normative:
  materializing and flattening APIs take explicit expansion budgets; unfolded-size
  estimation uses saturated arithmetic over the DAG; decoded linked values may use
  internal sharing so long as aliasing is unobservable (a decoder that blindly
  clones repeated subtrees into owned children is the named vulnerability);
  traversal keeps a visited-hash set always — termination never leans on the
  infeasibility of hash cycles. Envelope floors are chosen after testing the
  weakest environment intended to be conformant; service policy limits are never
  codec validity limits.

`count_mismatch` is **removed** (external advice, confirming the intake analysis:
sequentially unobservable — early end is `unexpected_eof`, excess is
`trailing_bytes`). Spec-silent limits remain the named enemy: they are how a de
facto favored implementation is born (real-world JSON interop is whatever the
dominant engine accepts), and without the envelope, differential fuzzing drowns
real disagreements in resource-frontier noise.

## Vectors (hand-authored, before any implementation)

> This plan was written for `deixis-codec-v1`, which was withdrawn before any
> implementation, so for v1 the ordering held. For `deixis-codec-v2` it held for two
> batches only; research-docs/0003
> records the split (2026-09-24).

- `codec-flat.json` — value ↔ bytes across: empty leaf/struct, uvarint boundaries
  (127/128, 16383/16384), empty and boundary keys, nesting, the full reject family
  (one case per code above, minimum), **multi-fault precedence cases** (same-input
  competing faults, pinning law 4's leftmost-first resolution), and **envelope
  boundary cases** (accepted at `D`/`S`, judged at one past).
- `codec-linked.json` — value → chunk set + root address; sharing (equal subtrees,
  one chunk); reject family for the link-specific codes.
- `codec-cross.json` — **the full triangle, per record** (external advice): the
  abstract value + its flat bytes + its exact canonical chunk closure with root
  address, asserting flat/linked decode agreement up to `=_≈`, byte-identical
  re-encode of each form, and the bridge landing on the expected address. Release
  gating fails if either form or the bridge is absent; partial implementations
  claim "flat codec" or "linked header scanner", never full conformance.
- Fixture families added at the freeze (external advice): **fragmentation** (every
  fixture split at every byte boundary), **arithmetic boundaries** (every LEB128
  width transition, `2^64−1`, overflow, unterminated), **allocation failure**
  after declared lengths and counts, **conformance-suite mutation** (introduce
  signed-byte key comparison, host equality, duplicate-last-wins, overlong-varint
  acceptance, sort-on-read, codec-mismatch acceptance, unused-link acceptance —
  the suite must kill every mutant), **cross-form metamorphic** (swap `≈`-equal
  representatives, permute authoring order, vary in-memory sharing — bytes and
  addresses must not move), **linked sharing-bombs** at the envelope boundary, and
  **store fault injection** (interrupted uploads, concurrent bind/GC, missing
  closure members, duplicate uploads).
- First profile instances vectored: `e = id` on bytes, and the coarse fixture setoid
  from [vectors/README.md](../../vectors/README.md), so coherence and native-equality
  cheating fail visibly.

## Freeze verification order (consult intake, 2026-08-08)

Before the bytes freeze, in order — this is the one artifact class that cannot be
re-frozen, verified in the right sequence:

1. Discharge the framing parameters concretely: prove shortest-form LEB128 injective,
   prefix-free, exactly-decodable, so the paper's self-delimitation lemma and codec
   theorem *instantiate* rather than being cited generically.
2. Give the linked form's **first-use order** a normative definition in terms of body
   scan order (lex key order, recursively), and prove the chunk set is a function of
   the value. Note explicitly: link-order *validity* is not header-local — a validator
   reads the body; only *extraction* is header-only.
3. Prove flat/linked agreement up to `=_≈`.
4. State that the in-band profile-id means **addresses bind interpretation, not just
   value**: one value under two leaf profiles has two addresses, so address equality
   implies value equality only within a profile id.
5. Vector additions from the byte-collision surface: sibling keys `"a"`/`"ab"` (the
   shorter-is-smaller lex edge), and a case where a LEB128 length byte-collides with a
   κ key — two integer spellings now coexist in one artifact and the vectors must
   prove the cores never confuse them.

## Intake from the research-doc review cycle (2026-08-08)

Four external-consultation reviewers over the self-contained research document
(research-docs/0001) surfaced spec-level findings, dispositioned here:

- **`profile-id` renamed `leaf-codec-id`** (applied above): the old name collided
  with *structure profiles*, which are interpretations carried beside values —
  while this field identifies the encoding function without which payload bytes
  mean nothing: a property of the byte artifact, not a tag on the value. The
  rejection code `unknown_profile` becomes `unknown_leaf_codec`.
- **The phantom "form tag"** in the hash-domain sentence (applied above): the
  magic encodes the form; prose listed a field the grammar never had.
- **`count_mismatch` may be unobservable** under sequential decoding — **resolved
  2026-08-08: struck**, per external advice confirming the analysis; the taxonomy
  now carries `unexpected_eof` with a streaming `need_more_input` state instead.
- **Store-level fault attribution** — **resolved 2026-08-08**: the external
  advice goes further than the intake did — no normative first-fault across
  closures at all (it would tax parallel fetch and streaming); stable fault set +
  single-fault vectors + optional deterministic audit traversal, per revised
  law 4.
- **Wide-node consequence recorded**: one-node-one-chunk bounds sync granularity
  by node size; content-defined chunking (prolly-tree-style) as the *canonical*
  form was considered and rejected for v1 (determinism and one-value-one-address
  outrank intra-node sync granularity); mitigations are private packing and
  structural sharding by profiles. **External advice concurs (2026-08-08)**: keep
  one-node-one-chunk, and disclose normatively that a wide node's chunk is linear
  in its width and any child change retransmits the whole node chunk (private
  packing helps disk locality, never that network cost); every collection profile
  must declare worst-case node width, update amplification, and intended scale —
  pos-v1 and set-v1 are compact profiles, not million-member representations.
- **Envelope MAY-region tradeoff recorded** — **endorsed with upgrades
  (2026-08-08)**: the external advice keeps the accept-floor stance and rejects
  MUST-reject-beyond for the same reason, with two changes applied in the
  taxonomy: the envelope is multidimensional (a single `D`/`S` cannot describe
  both forms), and `limit_exceeded` is a resource refusal, never invalidity.

## Carried into `deixis-codec-v2` (2026-09-23)

[ADR 0011](0011-codec-for-mandatory-nodes.md) replaces this record's node productions
for ADR 0010's mandatory-value model, and names the result `deixis-codec-v2`
(`dxf2`/`dxl2`). [CODEC.md](../CODEC.md) states it; the v1 text is kept in
[CODEC-v1.md](../CODEC-v1.md).

- **Carried unchanged in meaning:** the two forms and their governance as one suite,
  the integer domain, the id grammar's public and private forms and the registry's
  governance, the resource envelope, SHA-256 and domain separation, the five laws,
  the result classes, the same-step precedence (less its tag row), and the freeze
  process and its order.
- **Replaced:** the two node productions (now one), the magics (decision 1 above
  stands for v1, which was withdrawn), the tag row, and the leaf-codec names (now slot
  codec).
- **Added:** the option-of id form.

## Where the freeze stands (2026-08-29)

| step | state |
| --- | --- |
| 1. complete candidate contract | **DONE** — [CODEC.md](../CODEC.md), candidate, not frozen |
| 2. prove the central properties | **obligations enumerated** — [0008](0008-proof-obligations.md): 7 lemmas, 15 obligations, the assumption inventory, and 4 findings (3 ruled as decisions 8-10 below). The proofs themselves are unwritten; their home is the paper |
| 3. clean-room external implementation, vectors withheld | **brief ready to send** — [0007](0007-clean-room-commission.md); scope, withholding, the no-answers rule and the defect-ruling order are settled, so what remains is finding the implementer |
| 4. vectors authored + independently reviewed | in flight — [vectors/CODEC-PLAN.md](../../vectors/CODEC-PLAN.md), reviewed against the spec 2026-08-20 |
| 5-9. implementations, rehearsal, soak, manifest | behind the above |

Steps 3 and 4 are deliberately ordered against each other: the clean-room
implementer must receive the specification **with the vectors withheld**, so the
corpus can grow while the commission waits without spoiling it.

## Freeze process (adopted 2026-08-08 from external advice)

Iterative, not linear — the earlier ordering stands as a dependency graph, but the
process loops: complete candidate contract (grammar, integer domain, validation
classes, registry behavior, resource model, security assumptions, API result
states) → central proofs → **at least one genuinely clean-room external
implementation from the spec with the vectors withheld** (its ambiguity log is the
point — worth more than a fifth in-house implementation with the same review
history and AI tooling; independence lineage recorded: authors, shared libraries,
algorithms consulted, AI/model provenance, cross-visibility) → vectors authored
and independently reviewed → implementations run, every discrepancy fed back into
the spec → affected proofs/vectors/implementations restarted after any normative
change → end-to-end rehearsal with the exact candidate bytes (topos verbs,
signatures, bridging, packing, retrieval, corruption, closure validation, GC
races, crash/power-loss) → soak, unchanged — no "harmless" final magic
substitution, the magic participates in every hash and vector → a signed,
independently mirrored **freeze manifest**: normative spec, formal definitions and
proof artifacts, registry snapshot, complete vector corpus, clause-to-vector
traceability matrix, implementation commits, build instructions, fuzz and
mutation reports, known assumptions, the exact external address syntax, an errata
policy, and the collision-response policy.

**Oracle doctrine, refined** (applied in [vectors/README.md](../../vectors/README.md)):
the frozen spec and its frozen vector corpus *jointly* define conformance — the
vectors are the executable oracle for the cases they cover, with precedence on
apparent conflict: normative algorithms and grammar, then semantic laws, then
vectors, then prose. A vector never overrides a clear clause, and post-freeze a
behavior-changing ambiguity is a recorded v1 defect for a successor, never
silently "clarified" by a new vector.

## Freeze decisions (2026-08-20 - operator-delegated)

The operator delegated the remaining calls rather than ruling item by item. Each is
decided below against the floor's purpose - *portable identity, checkable by
strangers, frozen once* - and none of them now waits on anyone.

1. **Magic strings: `dxf1` (flat) and `dxl1` (linked).** Four ASCII octets, as
   advised. `dxc1` is retired: `c` named the *codec* where its sibling named a
   *form*, and an asymmetric pair would misread forever. The two forms share the
   version digit deliberately - they are one suite, versioned and governed together,
   never independently. Picked once; every vector and every hash will be generated
   against these exact octets, with no RC-magic substitution later.
2. ~~Whether the flat form carries the linked root address anywhere~~ - settled by
   the three-notion clause in Scope: it does not; one address source, computed not
   carried.
3. **Leaf-codec-id: opaque bounded binary**, with the grammar, registry governance
   and two bootstrap assignments now specified above. The deciding argument is the
   one the advice named: the id repeats in every chunk, so human-readable names are
   a permanent per-artifact tax paid for a legibility no machine needs - and names
   invite the normalization, case-folding and ownership disputes a frozen format
   cannot survive.
4. ~~Whether `limit_exceeded` minima are RECOMMENDED~~ - superseded twice and now
   **closed**: the envelope is normative, multidimensional, and its per-dimension
   floors are fixed in the table above.
5. **The same-step priority table is fixed** (law 4a), together with the
   codec-independence rule it forced out. No global multi-fault ordering is frozen,
   per the advice.

Two further items were settled before this pass and are carried here so the record
has one decision list rather than two:

6. The typed signing envelope (consumer-side — stele/topos): signatures bind
   context/purpose + address space + profile/schema claim + audience, never bare
   bytes (COSE's signature-context precedent); linked-root signatures are
   first-class, authenticating the existing address without materializing a flat
   artifact. Recorded here so a raw-byte signature is never presented as
   semantically sufficient; long-horizon signature assurance (re-attestation,
   timestamps, RFC 9321) is separate artifacts, never v1 mutation.
7. Mixed leaf-codec closures: frozen **invalid** (external advice concurs with the
   intake rule) — one artifact instantiates one carrier and one encoder;
   heterogeneous leaves are one explicitly tagged-union leaf codec, never a
   mid-tree codec change.

8. **`D` MUST be computable and `im(e)` MUST be decidable** (ruled 2026-08-29,
   operator-delegated; from [0008](0008-proof-obligations.md) finding 5.1). §4
   required `e` to be *"total, computable"* and required of `D` only that it be an
   exact partial inverse — while §5.5 makes `payload ∈ im(e)` a MUST-check and law 3
   promises every input a verdict. An undecidable `im(e)` therefore did not make
   validation expensive; **it made a stated law false.** The obligation was already
   written down, in [SLOTS.md](../SLOTS.md)'s prose sentence *"Usability additionally
   requires the injection to be computable, decodable, and canonical"* — a note about
   what makes a tier usable, one document away from the normative clause that
   consumes it. That is the hidden-dependency shape exactly: real, recorded, and
   absent from the clause that needs it, so an implementer satisfying §4 to the
   letter breaks the floor. Now stated in §4 as a slot admission requirement at the
   canonical-bytes tier, with the reason attached so it is not later trimmed as
   commentary.

9. **Law 1's re-encoding clause is scoped to full validation** (ruled 2026-08-29,
   operator-delegated; [0008](0008-proof-obligations.md) finding 5.2). `encF(decF(b))
   = b` was asserted for *"every accepted `b`"* and is true only where the leaf codec
   is held. A header-only decoder cannot check §5.5, so its accept set is strictly
   larger and the clause fails for it — while §11's *opaque closure present* state
   exists precisely to let a store validate without a leaf codec, and
   proposal 0002's valueRef clause already builds on
   that. The unscoped law promised server authors something their servers cannot do.
   Scoped in §8, with the header-only guarantee (framing and structure, payload
   uncertified) stated beside it rather than left to inference.

10. **Law 5 is reclassified, not demoted** (ruled 2026-08-29; finding 5.4). It is a
    governance commitment about future versions, and it sat under a heading reading
    *"To be proved in the freeze bundle"* — a category error a freeze manifest would
    have published, and a question the clean-room implementer
    ([0007](0007-clean-room-commission.md)) would have been right to log. §8's
    preamble now separates the four propositions from the one commitment and names
    its enforcement (§16's version policy, §14's absent option). Laws 3 and 4's
    overlap (finding 5.3) is **deliberately not repaired**: it is readable prose, and
    the freeze should not churn on redundancy that misleads nobody.

**Why these three landed when they did** (written 2026-08-29). A normative change
restarts affected vectors and implementations under this document's own iteration
rule. The codec corpus was *not yet authored* at that point
([vectors/README.md](../../vectors/README.md)), so the restart cost nothing and its
price could only rise — and finding 5.1 lands on §4, the first clause the clean-room
implementer reads.

⚠ **THAT PREMISE HAS SINCE EXPIRED, and the reasoning does not survive it.** The codec
corpus was authored from **2026-08-30** (`4f067aa`); it is now eight vector files, and a
normative change to §4 or §5 restarts real cases. ⇒ *"The restart costs nothing" was true
for one day and is the kind of sentence that reads as a standing rule.* Any later change
of this shape must price the restart rather than cite this paragraph.

<!-- claim recorded 2026-08-29: the not-yet-authored premise above is historical and was superseded the next day. Nothing re-runs it; it is kept because the reasoning it licensed is on the record. -->
<!-- claim holds: `python tools/count-codec-cases.py` == 23 of 41 -->

⛔ **And this paragraph was faithful to a source that was itself stale.** Between
`4f067aa` (2026-08-30) and `48b037d` (2026-09-03), `vectors/README.md` described the codec
corpus as *not yet authored* while the corpus existed — so a reader checking this citation
against its source found **agreement**, and both were wrong. ⇒ *The citation-drift class
has a second direction: not only "the artifact moved and the citation did not", but "the
citation is faithful and the source is stale."* Checking a copy against its source cannot
find it, and the copy inherits the defect by doing exactly the right thing. Reported to the
vectors lane, whose file it is; corrected there at `48b037d`.

⚠ **This note was itself stale within twenty minutes, in the paragraph defining the class.**
It read *"`vectors/README.md` **still** describes…"* — present tense, written before that
lane corrected their file. ⇒ **Direction 1, inside the sentence introducing direction 2:**
the artifact moved and my citation did not. The repair is the same one this document keeps
applying — bound the claim by dates rather than by a tense, since *"still"* means *"at an
instant the reader cannot recover."*

⚠ **And a trap for any checker built on this**: `README.md` now *quotes* its former sentence
inside its own correction banner, so a `grep` for the phrase still matches it. **A document
that records its own past error is indistinguishable, to a text search, from one that still
makes it.**
