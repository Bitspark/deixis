# Codec proofs — `deixis-codec-v2`

**Status:** proofs written 2026-09-23 against [CODEC.md](CODEC.md) at the text that
[design/0011](design/0011-codec-for-mandatory-nodes.md) produced. They are **mathematical
proofs in prose, not proof-assistant verification.** They discharge the obligations that
[0008](design/0008-proof-obligations.md) enumerates for v2, for the concrete byte grammar,
not for the paper's abstract encoder. They are candidate evidence for a candidate
contract, and they do not freeze anything.

Sections of CODEC.md are written §N. A proof that leans on an assumption names it by its
0008 number (A1–A7).

## 0. Definitions

**Octets.** `‖` is concatenation. `|s|` is the length of `s` in octets.

**Canonical integers.** For `v ∈ [0, 2^64 − 1]`, `C(v)` is the unique shortest unsigned
LEB128 spelling of `v`: seven-bit groups, least significant first, the high bit set on
every octet but the last. So `C(v)` has length 1 when `v < 128`, and otherwise ends in
a non-zero octet. `C(v)` is at most ten octets.

**Keys.** `K(k) = C(|k|) ‖ k`. The order `<` on keys is §2's lexicographic order.

**The node encoding.** Fix a slot codec `(id, ≈, e, D)` (§4). For
`n = Node(t, m)` with `dom m = {k₁ < k₂ < … < k_c}`:

```text
E(n) = C(|e(t)|) ‖ e(t) ‖ C(c) ‖ K(k₁) ‖ E(m(k₁)) ‖ … ‖ K(k_c) ‖ E(m(k_c))
encF(n) = "dxf2" ‖ C(|id|) ‖ id ‖ E(n)
```

This is §5's grammar written as a function. Every node is a finite tree, so `E` is
defined by structural recursion on height.

**The parser.** `P` reads a node from the front of an octet stream by the grammar:
- a `cuvarint` for the payload length `p`;
- then exactly `p` octets;
- a `cuvarint` for the count `c`;
- then, `c` times, a key (a `cuvarint` length and that many octets) followed by a node
  (recursively).

`P` is the **framing** parse, which is decidable without the slot codec (§11). It checks
§3's three integer rules on every `cuvarint`, §5's rules 1, 3, 4 and 6, §13's id rules,
and §5's field-extent rule: a length-framed field is judged only once its stated extent
has been read. It **records** each payload rather than judging it, since payloads are
length-framed and do not stop the parse (law 4). `decF` is `P`, then the capability
judgment (`unsupported_slot_codec`), then rule 5 over the recorded payloads in parse
order (`non_canonical_payload`), which is §11's order. A decoder that judged a payload
while parsing would report `non_canonical_payload` where a later framing fault must win
(§10 ⭐, §11 obligation 2).

**Identity.** `=_≈` is §2's lift: `Node(t, m) =_≈ Node(t', m')` iff `t ≈ t'`,
`dom m = dom m'`, and the children under each key are `=_≈`.

## 1. The integer code

**Lemma C1 (C is injective, prefix-free and exactly decodable).**
1. *Prefix-free.* The last octet of `C(v)` is the first octet with its high bit clear, so
   a reader knows where `C(v)` ends from its octets alone. No spelling is a proper
   prefix of another.
2. *Injective.* Different values have different sequences of seven-bit groups, and the
   shortest spelling of a group sequence is unique.
3. *Exact decoder.* Read octets up to and including the first with a clear high bit.
   - More than ten octets is `malformed_uvarint`.
   - Input ending before any octet of the integer is `unexpected_eof`.
   - Input ending after one or more octets with the continuation bit set is
     `malformed_uvarint` (§3 rule 2). Inside an id, the id's own stated end plays the end
     of input for an integer already begun, with the same code. An integer that would
     begin at the id's end is a missing field, `malformed_slot_codec_id` (§13). Neither
     is ever `need_more_input`.
   - In streaming, while the stream is open, either end of input is `need_more_input`.
   - A value of `2^64` or more is `uvarint_overflow`.
   - A spelling of length above one whose last octet is `0x00` is not the shortest
     spelling of its value, and is `non_shortest_uvarint`.

   Whatever survives is `C(v)` for exactly one `v`, and nothing else is accepted.

So `C` satisfies the paper's framing assumptions (`def:framing`): injective,
prefix-free, and an exact partial decoder that refuses non-canonical spellings. The
paper's marker `τ` is the empty string in v2 (ADR 0011 §2).

## 2. Structural lemmas (0008's L1–L7, re-derived for one production)

**L1 — unique decodability.** For every node `n`, `P` parses `E(n)` in exactly one
way, and the parse ends exactly at the end of `E(n)`. Hence `E` is a prefix code: if
`E(n)` is a prefix of `E(n')`, then `E(n) = E(n')`.

*Proof,* by induction on the height of `n`.
1. By C1, the first `cuvarint` is recovered uniquely as `|e(t)|`. The payload is then
   exactly that many octets.
2. The count `c` is recovered uniquely, by C1 again.
3. Each of the `c` entries is a key, whose extent is fixed by C1 and its length, then
   a child node, whose extent is fixed by the induction hypothesis.

So the end of `E(n)` is fixed by its own octets. Suppose `E(n)` were a proper prefix
of `E(n')`. Then `P` would stop at the end of `E(n)` inside `E(n')`, contradicting the
uniqueness of `E(n')`'s parse. ∎

*Unlike v1*, nothing here dispatches on a tag, and nothing needs constructor
disjointness (v1's I3). Every production is prefixed by an explicit length or count.

**L2 — termination.** On every finite input, `P` halts after reading at most `|b|`
octets, without appeal to §12.

*Proof.*
- Each field read either consumes the octets it declares or stops at the end of input,
  with `unexpected_eof` or, streaming, `need_more_input`.
- Every loop iteration reads at least two octets (a key-length `cuvarint`, then the
  child's payload-length `cuvarint`), so the entry loop runs at most `|b|/2` times.
- A declared count of `2^64 − 1` therefore ends by exhausting the input, not by a
  limit.
- Recursion depth is bounded by the number of octets read. ∎

**L3 — the canonical parse order is unique.**
- `P` reads the header, then the node's fields in grammar order.
- It visits entries in their spelled order and each child depth-first before the next
  key.
- Given the input, this fixes one total order on field reads, so *"the first point at
  which the parse cannot continue canonically"* (law 4) is well defined. Payloads are
  recorded, not judged, so that point is always a framing fault. ∎

**L4 — §9's classes partition the verdicts on one artifact.**
- *Exhaustive:* by L2 and L3, the verdict is exactly one of: the first framing failure;
  else `unsupported_slot_codec`; else the first payload refused, `non_canonical_payload`;
  else acceptance. §9 assigns each code to exactly one class. `limit_exceeded` is the
  reader declining to continue at a point below which nothing failed (§12).
- *Disjoint:* §9's code lists are disjoint, and §11 orders framing faults above
  `unsupported_slot_codec`, and that above the payload judgment.

"Input" is one artifact, never a closure, as law 3 scopes it. ∎

**L5 — §10 decides every realizable same-step pair.**
- The only groups whose rows can co-occur at one step are the links-header rows (0008
  §5.6). §10 orders them.
- Framing against capability is ordered by §11.
- v2 removed the tag row and added the slot-codec-id row. Both are single-code groups.
  The id row's only same-step neighbours are the integer rows, since a malformed
  `cuvarint` inside the id is detected while that integer is read; §10 lists the
  integer rows first.
- *Input ending inside a length-framed field whose present octets already prove a
  fault* (an id cut off after `00 00`, a key cut off after an octet that already sorts
  before its predecessor) is not a precedence pair. §5's field-extent rule decides it:
  the field is judged only once its stated extent is read, so the verdict is
  `unexpected_eof`. This class was found by the vectors lane in review; it generalises
  0008's B3.

So every realizable pair is decided. ∎

**L6 — first-use order is well defined and a function of the value.**
- The body's entries are in ascending key order.
- By induction on height, each child's chunk octets are a function of the child's
  value (the case below).
- So each child's hash is a function of the child's value.
- Listing the distinct hashes in order of first appearance along the body yields one
  header, determined by the value. ∎

**L7 — the chunk set is a function of the value.**
- `chunks(n) = {chunk(n)} ∪ ⋃ₖ chunks(m(k))`.
- `chunk(n)` is a function of `n`'s value: its payload, its sorted keys, and its
  header (L6).
- So the set is a function of the value. Identical subtrees give identical chunks,
  and the set holds each once. ∎

## 3. Law 1 — flat canonicality

**O1.1 — well-definedness: `n =_≈ n' ⟹ encF(n) = encF(n')`.**

*Proof,* by induction on height, for one slot codec. Let `n = Node(t, m)` and
`n' = Node(t', m')` with `n =_≈ n'`.
1. From `t ≈ t'`, A2 (⟹) gives `e(t) = e(t')`, so the payload fields are equal.
2. `dom m = dom m'`, so the counts are equal and the ascending key sequences are equal.
3. Children under each key are `=_≈`, so by the induction hypothesis their encodings
   are equal.
4. The header is the same octets for the same codec. ∎

**O1.2 — injectivity up to `=_≈`: `encF(n) = encF(n') ⟹ n =_≈ n'`.**

*Proof.* Equal octet strings parse identically (L1).
1. The payload octets are equal, `e(t) = e(t')`, so A2 (⟸) gives `t ≈ t'`.
2. The counts and the key sequences are equal, so `dom m = dom m'`.
3. The child encodings are equal substrings (their extents are fixed by L1), so by the
   induction hypothesis the children are `=_≈`. ∎

**O1.3 — round trip: `decF(encF(n)) =_≈ n`.**

*Proof.*
- The header parses to the codec's own id.
- At each node, `P` reads `e(t)`. That is in `im(e)`, so rule 5 passes and
  `D(e(t)) ≈ t` (A4).
- The count, the ascending keys and the children decode by the induction hypothesis.
- Nothing trails.

So the decoded node is `=_≈ n`. ∎

**O1.4 — encoder soundness: `im(encF) ⊆ Accept`.**

*Proof,* rule by rule, for a codec-holding decoder:
- Rule 1: the magic is written literally.
- §3: every integer is written as `C(v)`, which is shortest, at most ten octets, and
  in range.
- Rule 3: the encoder writes the count, then exactly that many entries.
- Rule 4: `dom m` is a set, enumerated by the strict total order `<`, so the keys are
  strictly ascending.
- Rule 5: every payload is `e(t)`, which is in `im(e)`.
- Rule 6: nothing is written after the root.
- §13: the id is the codec's own id, which is exactly one id of its form, so it is not
  `malformed_slot_codec_id`.

*Precondition (A7):* every payload length, key length and count is below `2^64`. That
holds for any finite in-memory value. ∎

**O1.5 — accept-set exactness: for every `b` accepted under full validation,
`encF(decF(b)) = b`.**

*Proof.* `b = "dxf2" ‖ C(|id|) ‖ id ‖ w`, where `w` parses as one node with every
rule checked. We show, by induction on the parse of `w`, that `E(decF(w)) = w`. At a
node, `w = C(p) ‖ q ‖ C(c) ‖ K(k₁) ‖ w₁ ‖ … ‖ K(k_c) ‖ w_c` with:
- `|q| = p` and `q ∈ im(e)`, by rule 5;
- `k₁ < … < k_c`, by rule 4;
- each `wᵢ` accepted, so `E(decF(wᵢ)) = wᵢ` by the induction hypothesis.

Because `q ∈ im(e)`, `q = e(x)` for some `x`. Then `D(q) ≈ x` (A4), and so
`e(D(q)) = e(x) = q` (A2). Re-encoding `decF(w) = Node(D(q), {kᵢ ↦ decF(wᵢ)})`
therefore writes:
- `C(|q|) = C(p)`;
- then `q`;
- then `C(c)`;
- then the keys in ascending order, which is exactly `k₁ … k_c`, since they are
  strictly ascending;
- then each `wᵢ`.

Every integer in `b` was accepted only in shortest form (§3 rule 3), so `C` rewrites
the same octets. The header's magic is literal. The id is reproduced because `encF`
writes the codec's own id (for option-of, `02 ‖ id(c)`, recursively), and the accepted id
is exactly that spelling: §13 refuses a second spelling of an ordinal
(`non_shortest_uvarint`) and octets left over or missing within the stated length
(`malformed_slot_codec_id`). Nothing trails (rule 6). ∎

*Why the scope is load-bearing:* a codec-blind decoder does not check rule 5, so it can
accept a `q ∉ im(e)`. Such a `q` has no `D(q)`, so `decF(b)` does not exist and the
identity cannot hold. That is law 1's *"under full validation"*.

## 4. Law 2 — linked canonicality

Write `chunk(n)` for §6's chunk of `n`. Its header lists the distinct child hashes
`H(chunk(m(kᵢ)))` in first-use order, and each `lentry`'s index points into that
header. Write `addr(n) = H(chunk(n))`, with `H` = SHA-256.

- **O2.1** is L6 and **O2.2** is L7.
- **O2.3 — `n =_≈ n' ⟹ addr(n) = addr(n')`, unconditionally.** As in O1.1, by
  induction: equal children give equal chunks, hence equal hashes, hence equal headers
  and bodies. ∎
- **O2.4 — `addr(n) = addr(n') ⟹ n =_≈ n'`, within one slot-codec-id,
  computationally.** Suppose the chunk octets differ while the addresses are equal.
  That is a SHA-256 collision. Otherwise `chunk(n) = chunk(n')`, so by the body
  argument of O1.2 the payloads are `≈`, the keys are equal, and the indices are equal.
  Equal header hashes then give, by the same no-collision step, equal child chunks, and
  induction completes. Every counterexample exhibits a collision in the finite set of
  chunks involved (A6). ∎
- **O2.5 — linked accept-set exactness.** A closure accepted under full validation has
  every reachable chunk passing §6's rules 1 to 7. Rules 2 to 6 make the header exactly
  the list of distinct referenced hashes in first-use order, which is the header the
  encoder computes from the body. The body re-encodes as in O1.5. Traversal is over a
  DAG with a visited set (§12), and every chunk is verified against the hash that
  reached it (§14), so induction over reachability applies. Re-encoding therefore
  reproduces every chunk and the root address. ∎
- **O2.6 — bridge agreement.** `decL(closure(n)) =_≈ n =_≈ decF(encF(n))`, by the
  linked analogue of O1.3 and by O1.3 itself. So the two forms decode to `=_≈` values. ∎

## 5. Laws 3 and 4 — refusal and fault determinism

- **O3.1 — totality** is L2.
- **O3.2 — exactly one class** is L4.
- **O4.1** is L3.
- **O4.2** is L5.

Law 3's cross-implementation clause is O4.1 and O4.2 together, within §12's floors.
Law 5 is a governance commitment, not a proposition (0008 §5.4).

## 6. The option-of codec (§13)

**Lawfulness.** Let `c` be lawful. Then:
- `e(None) = e(None)`.
- For `Some(x)` and `Some(y)`: `x ≈_c y ⟺ e_c(x) = e_c(y) ⟺ 0x01 ‖ e_c(x) = 0x01 ‖ e_c(y)`.
- `None` against `Some(y)`: the encodings differ at the first octet, and the values are
  not `≈`.

So `x ≈ y ⟺ e(x) = e(y)`. ∎

**Exact partial decoder.** `D` accepts `0x00` as `None`, and `0x01 ‖ b` as
`Some(D_c(b))` exactly when `b ∈ im(e_c)`. It refuses everything else.
- `im(e)` is decidable whenever `im(e_c)` is.
- `D(e(v)) ≈ v` follows from `c`'s.
- No prefix property of `e_c` is needed, because the node grammar frames every payload
  by its length (§5).

**Id verdicts.**
- An option-of id is unsupported exactly when its inner id is.
- It is invalid exactly when its inner id is invalid, or the whole id breaks §13's
  length bound.
- Both follow from §13 read recursively, bounded by the id's total length. ∎

## 7. Streaming split-invariance (§14)

**Claim.** A streaming decoder built as `P`, returning `need_more_input` whenever it needs
an octet beyond those received, reaches the same final verdict for every split of an
artifact as `P` does on the whole buffer.

*Proof.*
- `P`'s every step depends only on the octets already read (L3), so its sequence of
  steps is a function of the octet sequence, not of how the sequence was cut.
- `need_more_input` occurs only where the whole-buffer `P` would read an octet at that
  position. That includes the position just after a complete root, where the
  whole-buffer `P` reads on to test for a remainder. So `need_more_input` also covers
  "awaiting end of input", which §14 states (F4).
- After the final fragment and the caller's end-of-input declaration, that octet either
  exists (and the run continues identically) or the position is past the end. There
  both decoders give the same end-of-input verdict: acceptance, or the remaining
  capability or payload verdict, after a complete root; `malformed_uvarint` inside a
  `cuvarint` whose continuation bit is set; `unexpected_eof` anywhere else. ∎

This is a property of implementations structured as `P`. §14 makes it a requirement, and
the conformance tests check it by feeding every split.

## 8. What these proofs do not cover

- **Machine checking.** None of the above is verified by a proof assistant.
- **Implementations.** A proof about `E` and `P` says nothing about a given binding. The
  corpus and the harness test those.
- **Pair-shaped obligations in the corpus.** O1.1, O1.2, O2.3 and O2.4 quantify over
  pairs of values. They are proved here, and the v2 corpus carries pair cases.
  Each case pins its own octets, so a core passing both halves necessarily agrees or
  differs across the pair:
  - `v2-flat/fixture-representation-first` and `-second` (O1.1);
  - `v2-flat/option-none` and `option-some-empty`, and `parent-payload-and-child` and
    `parent-empty-payload-one-child` (O1.2's contrapositive);
  - `v2-bridge/*` (O2.6);
  - `v2-linked/sharing-is-lawful` (L7, O2.3).

  O2.4 stays untestable, by collision resistance.
- **The freeze.** 0006's clean-room step and the signed manifest remain.
