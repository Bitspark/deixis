# Vector plan — `deixis-codec-v1`

**Status:** REVIEWED by the codec lane 2026-08-20 (freeze step 4; the spec is
[docs/CODEC.md](../docs/CODEC.md), a candidate contract at `a87f7f5`). The four open
questions are ruled, five additions are folded into the coverage below, and authoring
has not started. This plan is the thing to disagree with while disagreement is still
free. Judgments will be computed from the spec — never from an
implementation — per [README.md](README.md)'s oracle clause.

## What a codec vector file is

Two new files, split by what they can be judged against:

- **`codec-flat.json`** — `dxf1`. Every case is `{ name, bundle, bytes, verdict, … }`
  where `bytes` is hex and `verdict` is `accepted` + the node it denotes, or one of the
  four non-acceptance classes with its code.
- **`codec-linked.json`** — `dxl1`, plus the **bridge**: the same value in both forms,
  asserting one identity and one address.

Both carry a `bundle` naming the leaf codec by its **id** (§13), not by prose — the
ids published in [README.md](README.md): `00 01` for `deixis/identity-bytes`,
`01 fb44…db02 01` for the fixture setoid.

## Coverage, by what it pins

**1. Round-trip and canonicity (the laws, §8).** For each form: encode→decode→encode
is a fixed point; `≈`-equal values spell identical octets; the address of a value is
its linked-root hash and nothing else. The fixture setoid earns its keep here — two
`≈`-equal members with *different representations* must produce **identical** bytes,
which no bytes-identity codec can express.

**2. The four result classes are distinct (§9).** At least one case per class, and the
file asserts the *class* as well as the code — collapsing classes is a conformance
failure, so a vector that only checked codes would not catch it.

**3. Every invalid code, one case minimum.** `malformed_uvarint` ·
`non_shortest_uvarint` · `uvarint_overflow` · `unknown_magic` · `unknown_tag` ·
`duplicate_key` · `unsorted_keys` · `trailing_bytes` · `unexpected_eof` ·
`bad_link_index` · `unused_link` · `duplicate_link_hash` · `links_out_of_order` ·
`leaf_codec_mismatch` · `non_canonical_payload`.

**4. `non_canonical_payload` per form — the code found by writing the spec.** The
fixture setoid is the only slot in the corpus that can express it: a payload that
decodes to an `≈`-equal value under a *non-canonical spelling* is constructible
because its `≈` ignores `representation`. A bytes-identity codec cannot produce this
case at all, which is exactly why the corpus needs a coarse slot.

**5. Fault precedence (§10).** One case per row of the precedence table, each
constructed so **both** conditions are genuinely observable at that step. A case where
only one fault is present proves nothing about ordering.

**6. Codec-independent framing (§11) — the subtle one.** An artifact whose leaf-codec
id is *unknown* **and** whose framing is *deliberately broken*: the verdict must be the
**framing** code, not `unsupported_leaf_codec`. Its mirror: unknown id with sound
framing must be `unsupported`, and the case asserts the implementation does **not**
report the value as validated. These two cases are what stop a core from quietly
claiming a scope it does not have.

**7. The id grammar (§13).** `n = 0` invalid (structural impossibility); an unassigned
`n ≥ 1` unsupported (not-yet-known); a reserved first octet `0x02..0xff` unsupported,
never malformed; a non-shortest uvarint inside an id invalid; length outside 2..32
invalid.

**8. Envelope and DAG obligations (§12) — as assertions about *method*, not size.**
The MUST-accept floors are too large to ship as literal bytes, so these cases pin the
*obligations* instead: a shared-subtree artifact whose **unfolded** measure exceeds a
floor while its stored size is trivial (the sharing bomb) must be refused with
`limit_exceeded` naming the dimension — proving the measure was taken over the DAG
with saturating arithmetic **before** materialization, and that a visited-hash set was
used. `limit_exceeded` MUST NOT appear as invalidity in any case.

**9. Streaming (`incomplete`).** A truncated artifact yields `need_more_input` while
input may still arrive, and `unexpected_eof` once the input has ended — the same
octets, two verdicts, distinguished only by whether the stream is closed.

**10. Sharing is lawful, not merely bounded (law 2).** Area 3 covers the *invalid*
direction (`duplicate_link_hash`); this is the lawful one. A value with two identical
subtrees MUST produce that chunk **once**, referenced twice by index, its hash listed
once in the header. Without this case a core that emits the chunk twice — a different
closure for the same value — passes the entire corpus.

**11. Byte-collision edges.** Sibling keys `"a"` and `"ab"`: the shorter-orders-first
edge of the key order, where a core comparing octets and forgetting the prefix rule
gets the answer exactly backwards. The correctly-ordered spelling is a canonicity case
here; its wrongly-ordered twin is an `unsorted_keys` case in area 5. Second edge: an
artifact where a `uvarint` length octet byte-collides with a κ position key, so two
integer spellings coexist and the corpus proves the cores never confuse them.

**12. Empty struct, empty key.** `Struct(∅)` is a legal node distinct from every leaf
([TREE.md](../docs/TREE.md)), and the empty byte string is a legal key. Both are cheap,
and both are precisely where an untagged implementation fails — the failure TREE.md
stipulates against, so the corpus must be able to catch it.

**13. Insertion-order invariance.** [README.md](README.md)'s convention — entries
authored in deliberate insertion order, the constructor owning the sort — carried into
this corpus: one struct case authored **out of sorted order**, asserting identical
bytes. It pins canonical order as a property of the *value* rather than of how the case
was written, and it is the cross-form metamorphic property the codec advice asked for.

**14. A flat digest is not an address (§7).** One case carrying both the flat digest
and the linked root address of the *same* value, asserted **distinct** and distinctly
labelled. Conflating them is the named failure the three-notion clause exists to
prevent, and this is the only place the corpus can catch it.

## Rulings (codec lane, 2026-08-20)

1. **Bridge assertions travel BY REFERENCE**, never inline — two copies of one octet
   string in two files is two records of one fact, and the drift is silent (editing the
   flat case leaves the inline copy passing). **A dangling reference MUST be a loud
   error, never a skip**: a bridge assertion that vanishes when its target is renamed is
   worse than one never written, because the corpus still reads green.
2. **Full 32-octet digests, always.** A prefix cannot be compared without a truncation
   convention, and that convention is a second thing implementations can differ on — in
   the one artifact whose job is to remove that possibility. Prefixes remain a *paper*
   affordance. **And where a case asserts an ADDRESS rather than a raw child link hash,
   it is spelled version-qualified as `(dxl1, digest)`** — the one place vectors can
   reach §7's rule, making the anonymous-32-octet habit fail here rather than in an API
   years from now.
3. **Envelope: obligations in the vectors, floors in implementation tests.** The sharing
   bomb is in, because it pins a *method* (saturating, over the DAG, before
   materialization, with a visited set) and a method disagreement is a cross-core
   disagreement — what the corpus exists to settle. The thirteen floor *numbers* stay
   out: they are properties of resource behaviour, not of a byte string's meaning, and
   shipping them as bytes would be a corpus a small core cannot replay. `limit_exceeded`
   never appearing as invalidity is a *class* judgment, so it stays in.
4. **Authoring order** as proposed — laws → codes → precedence → framing scope → id
   grammar → envelope → streaming, each batch reviewed against the spec before the next
   — **with the bridge cases in batch 1**, not appended later: they are law 2, so if the
   bridge is wrong then every linked case's address is wrong and a late bridge batch
   would invalidate reviewed work.

### Two consequences of ruling 1, for the harness (this lane's, not the codec lane's)

- **Case names become identifiers.** A referenced name is load-bearing, so names must be
  unique across the corpus and stable once authored; renaming a referenced case is a
  breaking act, not an edit. Uniqueness becomes a corpus invariant the replayer asserts
  at load.
- **The replayer loads the corpus, not a file.** [`tools/conformance/harness.mjs`](../tools/conformance/harness.mjs)
  currently drives each file independently; cross-file references require it to resolve
  names across all files first and **fail loudly on a dangling or duplicate name** before
  any case is sent. That is a harness change in this lane, and it lands before batch 1
  rather than with it — a green run must never be reachable while a reference is broken.

## What this plan does not cover

Node-member sets (the sorted-positional form, gated on this freeze), whole-tree
encoding of the fixture profiles, and the artifact bundle for the paper — all of them
sit behind the freeze and take their own vectors afterwards.
