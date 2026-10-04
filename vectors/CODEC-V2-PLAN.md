# Vector plan: `deixis-codec-v2`

**Status:** plan written 2026-09-23 by the vectors lane, before any v2 fixture
exists. **Nothing below is a judgment until it is in a fixture file.** It replaces
[CODEC-PLAN.md](CODEC-PLAN.md) for the v2 candidate and keeps that plan's reviewed coverage
areas and rulings wherever v2 does not change them. The v1 plan and the v1 corpus stay as
the withdrawn candidate's evidence ([ADR 0011](../docs/design/0011-codec-for-mandatory-nodes.md) §5).

**Source, and the independence rule.** Every expected byte string and verdict is derived
from [CODEC.md](../docs/CODEC.md) v2, as written at `343cda9`, and
from nothing else. The codec lane writes the contract and will write the four
implementations. This lane writes no contract text and reads no implementation. No v2
implementation exists as this is written. Every pin is re-verified against the contract as
merged, and a difference is a finding against one side, never a silent edit. Judgments are
computed from the spec, never from an implementation, per [README.md](README.md)'s oracle
clause.

## Files

| file | holds |
| --- | --- |
| `codec-v2-flat.json` | `dxf2`: accepted values and their canonical octets (the laws, §8) |
| `codec-v2-linked.json` | `dxl2`: named chunks with their SHA-256, closures, and the flat/linked bridge |
| `codec-v2-invalid.json` | one case or more for every §9 code a decoder can report, with its class |
| `codec-v2-precedence.json` | §10's observable orderings, each with the code the naive strategy returns |

Every case name starts with `v2-`, so v2 names can never collide with v1's in the one
corpus namespace ([tools/conformance/README.md](../tools/conformance/README.md)).

## Spelling

The case shapes are v1's, so the harness keeps one reader:
- flat accept: `{name, kind: "accept", bundle, node, bytes, note, pins}`;
- invalid: `{name, class, code, fault_locus, min_profile, bundle, bytes, clause, note, pins}`;
- precedence: v1's shape, `loses_to_naive` included.

A node is spelled as in the mandatory corpus, with both fields always present:
`{"own": <payload>, "children": [["<hex key>", <node>], …]}`. `own` is spelled in the
bundle's carrier:
- identity-bytes: a hex string;
- the fixture setoid: `{class, representation}`;
- option-of: `{"none": {}}` or `{"some": <inner>}`.

**Bundles** name the slot codec by its id (§13):

| bundle | id octets | carrier, `e` |
| --- | --- | --- |
| `identity-bytes` | `00 01` | `Bytes`; `e = id` |
| `fixture-setoid` | `01 fb44faaf3a9db590cbc4cb1abfdadb02 01` | [README.md](README.md#the-fixture-setoid)'s setoid; `e` = UTF-8 of `class`; `D` decodes UTF-8 strictly |
| `option-of-identity-bytes` | `02 00 01` | `Option[Bytes]`; `e(None) = 00`, `e(Some(b)) = 01 ‖ b` |
| `option-of-fixture-setoid` | `02 01 fb44faaf3a9db590cbc4cb1abfdadb02 01` | `Option` over the fixture setoid |

`pins` quote the v2 contract verbatim; `tools/pincheck.py` fails any pin the text no longer
contains.

## Coverage

**Carried from the v1 plan, restated for one production** (areas 1–14 there):
1. round-trip and canonicity, per form;
2. the four result classes, kept distinct;
3. every invalid code at least once;
4. `non_canonical_payload`, which only the fixture setoid can express (overlong and
   invalid UTF-8);
5. §10's observable precedence rows;
6. codec-independent framing: an unknown id with broken framing reports the framing code;
7. the id grammar;
8. envelope obligations as method (the sharing bomb), never floor numbers;
9. streaming;
10. lawful sharing;
11. byte-collision edges (`"a"` before `"ab"`; a length octet equal to a key octet);
12. the empty key;
13. insertion-order invariance;
14. a flat digest is not an address.

`unknown_tag` is gone (§9); no case may name it.

**New in v2:**

| area | what fails without it | clause |
| --- | --- | --- |
| V1. a payload at **every** node | an encoder or decoder that frames payloads only at childless nodes | §5 grammar; §1 *"each node's own payload"* |
| V2. `non_canonical_payload` at a node **with children** | a decoder that checks `im(e)` only at childless nodes | §5.5 *"including nodes with children"* |
| V3. the childless node `payload ‖ 00`; `00 00` legal when `e` can be empty | a codec that treats an empty payload or a zero count as absence | §5, closing paragraph |
| V4. v1's node tag is not read | a reader that dispatches on a first octet `00`/`01` | §5 rule 2, retired |
| V5. option-of payloads | a slot that stands in `None` for a missing node, or a lenient `D` | §13 option-of table |
| V6. option-of ids: nesting, inner unsupported, inner invalid, the 32-octet bound | an id parser that treats `02` as reserved, or ignores the inner id | §13 |
| V7. `03` is the first reserved form | a parser still reserving `02` | §13 grammar |
| V8. streaming split-invariance | a streaming decoder whose verdict depends on the split | §14 |
| V9. read first, ruled last, at both scales | resolving the codec on sight of the id | §10 ⭐ |
| V10. the renamed codes only | a core still reporting v1 names | §9 |
| V11. a historical tree through option-of | encoding an old tree without the explicit `Option` codec | §4 *"served by a codec for `Option[U]`"* |

## Rulings carried from the v1 plan

1. Bridge assertions travel **by reference**, and a dangling reference is a loud error.
2. Digests are full 32 octets, and an address is spelled `("dxl2", digest)`.
3. Envelope obligations go in the vectors; floor numbers stay in implementation tests.
4. Authoring order: laws and bridge, then codes, precedence, framing scope, the id grammar,
   the envelope and streaming. The bridge is in the first batch.

## Batches

| batch | files | holds |
| --- | --- | --- |
| 1 | `codec-v2-flat.json`, `codec-v2-linked.json` | 16 accept cases over five bundles; 5 chunks; sharing, the parent payload in its chunk, two bridges, the flat digest distinct from the address |
| 2 | `codec-v2-invalid.json`, `codec-v2-precedence.json`, and one accept case in `codec-v2-flat.json` | 46 flat and 15 linked non-acceptance cases covering every §9 code and the store layer; 11 streaming cases; 3 envelope cases; 18 precedence cases |
| 2b | `codec-v2-flat.json` | the accept case at the whole-id bound: option-of nested thirty times, a 32-octet id. It is the pair of `v2-invalid/id-length-33-caps-nesting`, without which a core capping nesting early passed everything |
| 3 | `codec-v2-flat.json`, `codec-v2-invalid.json`, `codec-v2-linked.json` | key order where a mistaken comparison reads the octets differently: three key pairs (`7f`/`80`, `80`/`c3 a9`, `ee 80 80`/`f0 90 80 80`), each separating §2's unsigned octet order from signed octets, from host strings, or from UTF-16 code units, each as a flat accept case, its unsorted mirror, and a linked accept case; and the two key-order faults inside a chunk, `duplicate_key` and `unsorted_keys`, which no linked case carried. Prompted by 0006's conformance-suite mutation (2026-09-24), where eight planted defects survived in the Python core; the verdicts come from §2, §5 rule 4 and §6 rule 7 alone |
| 4 | `codec-v2-linked.json` (`navigate_cases`, and one chunk) | `codec.navigate`, §14's resolve-root then resolve-child per key, which no earlier operation observed: 23 cases on the answer (own value, entries with their link digests, `absent` at an index), lookup under unsigned octet order for both keys of each batch-3 pair, laziness (a missing or corrupt chunk off the path is never fetched, the sharing bomb answers within the wall-clock bound), and verification against the requested address and against each link hash. Authored before any core implements the op. Every id is held, no case carries a payload fault, and every framing fault is in a chunk the path fetches, so no case depends on what a navigator owes a chunk it passes through, which the codec lane is pinning in §14 |
| 5 | `codec-v2-linked.json` (`navigate_cases`, one chunk), `codec-v2-invalid.json` (three chunks) | 17 navigate cases from §14's pins: rule 2, the codec judged only at the answering chunk (a passed-through payload is never judged; capability before payload; an unheld codec is not met before the answer); rule 1, the order inside a chunk (size, hash, whole framing, then the id comparison; a key found early does not excuse a later fault); rule 3, fetch order along a path. Plus second cases where the mutation run at `7a953d2` found a single-check kill: lookup across four keys either side of the top bit, and the id comparison under a fixture-setoid parent |
| 6 | `codec-v2-flat.json`, `codec-v2-invalid.json`, `codec-v2-linked.json` | deepens the 16 kills the mutation run at `553144d` found at exactly two checks, all four cores: seven keys (`01 7f 80 c3a9 ee8080 f0908080 ff`) that signed octets, code points and UTF-16 code units each reorder, as a flat accept, its three wrongly ordered mirrors, a linked accept and a navigate lookup per key; the id comparison at traversal under a fixture-setoid parent and two hops down, and at the second hop of a navigation; and unused_link in a second shape, a childless chunk listing one link, by resolve, checkClosure and navigate |

Batch 2 is authored against the contract as merged at `7393c2a`, which pins what the
vectors lane found while writing it:
- `malformed_slot_codec_id`;
- the id as a bounded input, the whole-id bound, and the dimension tokens;
- F4, the state of a complete root while the stream is open;
- F5, a length-framed field judged only once its stated extent is read;
- first-use order stated precisely, and either exceeded dimension conforming.

**Every decoding case states `holding`**, the base ids its decoder holds (§2.1's
modifier, stated with the ids it ranges over as §16 requires). Linked cases give the
store as `[digest, chunk-name]` pairs, and the store is untrusted: that is how
`hash_mismatch`, and §14's anchor on the requested root, are expressed.

**A payload fault inside a chunk has its own locus, `chunk-payload`**, deriving
`linked-resolver`. `payload` derives `flat-decoder`, which reads no chunk, and
`closure-checker` never applies `D`.

**F4 and F5 are pinned, and have cases.**
- **F4.** A complete root with the stream open is `need_more_input`, even when its payload would be refused, because a following octet would make it `trailing_bytes`. At end of input it resolves to the verdict the remaining checks reach. Cases: `v2-stream/complete-root-*` and `v2-stream/cut-at-the-root-boundary`.
- **F5.** An id, a key or a payload cut off inside its stated extent is `unexpected_eof`, whatever its present octets already prove. Cases: the three `v2-precedence/*-cut-*` cases, each recording the octet-by-octet reader's code.

## Not covered

Codec-level structure profiles (the codec reads none, §1), floor numbers, the clean-room
commission, and anything that needs an implementation to judge.
