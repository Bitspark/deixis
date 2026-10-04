# deixis — positional keys

**Status:** decided. Ratifies the position spelling deferred by
[0001](0001-keys-are-bytes.md) as a named, versioned profile:

- **`deixis-pos-v1`** — the spelling `κ : ℕ → Bytes` of positions into keys.

[0001](0001-keys-are-bytes.md) established that positional and named keys are readings of
one key space, and that a positional reading becomes exact only when some profile pins
which bytes a position is. This decision pins it — once, generically. Any sequence-shaped
reading over deixis (a tuple, an array, an ordered log) uses this spelling; none of them
gets to define its own, and the profile knows nothing about any of them.

## The spelling

For a natural `i`, let `mag(i)` be the shortest unsigned big-endian encoding of `i`, with
`mag(0) = 00` (one byte, the only magnitude with a leading zero). Then:

```text
κ(i) = ff^(len(mag(i)) − 1) ‖ 00 ‖ mag(i)
```

```text
κ(0)     = 0000
κ(1)     = 0001
κ(255)   = 00ff
κ(256)   = ff000100
κ(65535) = ff00ffff
```

Three properties, each carrying a law's weight:

- **Injective.** The `ff`-run's length determines `len(mag)`, and shortest-form magnitudes
  are unique per length. One position, one key.
- **Prefix-free.** If `len(mag(i)) < len(mag(j))`, then at the index where `κ(i)` carries
  its `00` terminator, `κ(j)` still carries `ff` — they differ strictly inside the shorter
  key. No key extends another. The floor itself never needs this — a path is a *sequence*
  of already-delimited keys ([PATH.md](../PATH.md)), consumed one at a time, never a
  concatenation — the property exists for **flattened** spellings: readings that
  concatenate a key path into a single byte string (single-string path names, radix
  layouts, streamed prefixes), where unambiguous parsing is exactly prefix-freeness. It
  costs `κ` nothing and licenses those readings in advance. (Purpose stated explicitly
  per the paper's review 01.)
- **Order-preserving.** `i < j` iff `κ(i) <lex κ(j)`. A longer magnitude means more
  leading `ff` bytes, hence lexicographically greater; equal lengths share the prefix and
  compare big-endian, which is numeric comparison.

The third is the one a sequence reading stands on: deixis's canonical entry order is
lexicographic byte order ([0001](0001-keys-are-bytes.md)), so a positionally-keyed
struct's entries iterate in sequence order *for free*. No sorting by decoded index — no
decoding at all. A consumer that only walks sequences never needs a `κ` parser; it
generates `κ(0) … κ(n−1)` and compares octets.

**Validity is exact.** A byte string is a `deixis-pos-v1` key iff it is `κ(i)` for some
`i` — the `ff`-run and terminator well-formed, the magnitude shortest-form. `ff000001`
spells nothing: its magnitude `0001` carries a leading zero, and 1 is spelled `0001`. A
consumer recognizing positional structure must compare against generated spellings (or
reject non-canonical forms outright), never normalize an alternate spelling to its index —
normalization is a repair pass, and a repair pass silently coarsens identity.

## Alternatives rejected

**Plain shortest big-endian.** Not order-preserving across lengths: `2 = 02` sorts after
`256 = 0100`. A sequence reading would have to decode and sort, importing a parser into
every consumer.

**Length-prefixed and varint spellings** (a count byte, or continuation-bit varints as
codecs use for lengths). Not order-preserving either, and the natural implementations are
bounded (one count byte, u64 varints) — a bound on *positions* that is no property of
positions. `κ` is total over ℕ.

**Fixed width.** Order-preserving but partial — any width excludes the positions above
it — and pads the common small cases. Totality is not negotiable: every node is finite,
but no node size is privileged.

## Scope

This decision fixes the spelling and nothing else. It is a profile above the floor, not
part of it: node identity ([TREE.md](../TREE.md)) is untouched, `Struct({κ(0), κ(2)})`
remains a well-formed node, and what a consumer *requires* of positional keys — density,
contiguity, bounds — is that consumer's own profile, defined against this one.

In [0004](0004-structure-slot.md)'s later vocabulary, this decision is the first
**structure profile**: the sequence container's embedding into the key space, with
order-preservation as the strongest form of a transport law.


**Under ADR 0009 (2026-09-23): unaffected.** This profile constrains key bytes and nothing
else, and [ADR 0009](0009-optional-node-values.md) leaves keys unchanged (`K = Bytes`).
[positional.json](../../vectors/positional.json) pins keys and holds no node spelling
(0 `leaf`, 0 `struct`), so it carries over as it is. The example `Struct({κ(0), κ(2)})`
above is previous-model spelling. Under ADR 0009 read it as
`Node(o, {κ(0) ↦ …, κ(2) ↦ …})` for any own value `o`. This profile says nothing about
`o`, so a consumer profile that needs its sequence node to be unvalued must say so
itself, the same way it already owns density, contiguity and bounds.

## Vectors

[vectors/positional.json](../../vectors/positional.json) pins the spelling: boundary
cases of `κ` (hand-computed from this spec), listed in ascending position order so the
order-preservation property is visible in the file itself, plus non-keys every
implementation must reject. Positions are written as decimal strings — some exceed what
JSON numbers carry exactly.
