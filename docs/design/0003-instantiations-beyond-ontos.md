# deixis — instantiations beyond ontos

**Status:** survey. A dated record (2026-08-07) of the perceivable non-`Bytes`
instantiations, and of the criterion separating the ones worth packaging from the ones
worth only using. Nothing here ratifies a profile, reserves a name, or assigns an owner.
[0001](0001-keys-are-bytes.md) named the trigger for revisiting the floor beneath ontos —
a second real instance. This note maps where such instances could come from, and which
would carry their weight as libraries.

## A package is an agreement, not an instantiation

Applying the functor costs one line. `Deixis(Element)` is deixis-core and a type
argument; nothing about writing it down needs a repository. So "should X be a package" is
never answered by X being an instantiation — every row of [SLOTS.md](../SLOTS.md)'s range
is one.

ontos calibrates what does answer it. What made `Deixis(Bytes)` a package was everything
*around* the instantiation: an identity contract frozen at L0, a canonical codec whose
exact bytes downstream signatures and hashes depend on, a density rule carving the
recognized subset, vectors and conformance pinning all of it. Each is an **agreement
artifact** — something two independent parties must hold identically for the value to be
worth anything.

The criterion, in three tells. An instantiation earns a package when:

- **the relation needs governance** — `≈` presupposes an institution (a name registry, an
  endpoint scheme) whose decisions must be written down;
- **the bytes must agree across parties** — content-addressing means nothing unless both
  sides compute the same address, which is a codec freeze;
- **there are laws worth pinning** — a recognized subset, a well-formedness rule, an
  append-only judgment set, the way density is pinned for ontos.

None of the tells is about the carrier being data. All three are about a **second
party**. A slot used by one consumer, however exotic, is a call-site pattern; the same
slot between two consumers who must agree is a floor, and floors are what get packaged.

[0002](0002-positional-keys.md)'s scope note is this criterion applied once already:
deixis ships the generic spelling, and density and contiguity are "that consumer's own
profile, defined against this one." Requirements live with the consumers who hold them.
This note only asks: which consumers, holding which requirements, are perceivable?

## Tier A — the agreement is the product

### Capability surfaces — `Deixis(Handler)`

`≈` — same registered name. Codec tier, through the registry.

A tree keyed by path segments with behavior at the leaves is a router; keyed by
capability path with grants at the leaves, it is a permission surface. The codec-tier
hash of such a tree is a **surface fingerprint**: the granting side and the enforcing
side hold the same digest, and "what may this agent do" becomes an octet comparison.
Diffs of surfaces are permission changelogs.

All three tells fire. The relation presupposes a handler registry — a governed name
space, which is an institution. The fingerprint is worth nothing unless both sides
compute it identically. And a surface profile has laws to pin: what may sit at a terminal
segment, whether interior nodes carry grants, what a wildcard is, if anything.

This is also the most *probative* instance [0001](0001-keys-are-bytes.md)'s trigger could
ask for: closures at the leaves are unmistakably not data, yet the named relation reaches
the codec tier — [SLOTS.md](../SLOTS.md)'s "identify handlers by name and a router is as
encodable as a record," made load-bearing. Natural owners are systems already standing on
a grant/enforce seam; in this constellation, the gateway/runtime shape.

### The named-data floor — `Deixis(Ontos.Value)`

`≈` — ontos structural identity. Codec tier; the leaf codec is `ontos-codec-v1`,
composed.

[0001](0001-keys-are-bytes.md) anticipated this one exactly: "ontos's codec does not come
down to deixis; it becomes something deixis codecs consume." A tree with authored byte
keys and whole ontos values at the leaves is **named structure over frozen data** — the
name space ontos rightly refused, provided one floor up, where opinions are allowed.

The agreement it establishes is the one every manifest, config, and state file in a
family re-derives ad hoc: a canonical named-tree spelling with content-addressable bytes.
The codec combinator of [0001](0001-keys-are-bytes.md) plus the frozen leaf codec is the
whole build; canonical entry order is lexicographic key order, already discharged. What a
profile pins is small and real: the framing, the composed profile identifier, and nothing
about what names mean.

Cheapest to build, broadest reuse — and the least probative, because its leaves are still
data. Its weight is leverage, not proof.

### Vocabulary trees — `Deixis(Definition)`

`≈` — same qualified name. Codec tier, through the namespace.

A registry — of systems, of modules, of symbols — is a tree whose leaves are governed
names with facts hanging off them. The agreement is the vocabulary itself: two parties
meaning the same namespace state, checkable as a digest. The family already lives this
informally — a registry row changing a topology provenance digest *is* a vocabulary
fingerprint, computed today without a declared profile. Packaging would move an existing
agreement onto declared ground.

The relation's governance already exists (the registry is the institution); the laws to
pin are which key spellings are legal names and what a leaf must carry.

## Tier B — real, but the agreement partly lives elsewhere

### Evidence and artifact trees — `Deixis(Hash)`

`≈` — octet equality on digests. Codec tier trivially.

A Merkle DAG: sharing recovered through content identity, without a cycle ever entering a
value. Build graphs, artifact bundles, attestation chains. The agreement is real — a
release *is* such a tree — but the outside world already holds most of it (git-shaped,
nix-shaped tools), and inside a family the marginal agreement is one shared spelling, so
evidence assembled by one tool verifies in another. Worth a profile at the moment a
second consumer appears; inert before that.

### Task and dependency interchange — `Deixis(TaskRef)`

`≈` — same task identity.

Frontiers, dependency cones, blocked-on graphs. Useful the moment two tools exchange
them; a format decision inside one tool until then. The tell to watch is the second
consumer, same as above.

## Tier C — patterns, not packages

The rows that stay at the call site, and why:

| Slot | Why the criterion fails |
| --- | --- |
| `Element` (DOM), reference `≈` | no second party — the document is yours; reference identity has no codec tier to agree on |
| `Socket`, live endpoints | the live object's agreement collapses into its *configuration*, which is data and already has floors |
| `Deixis(())`, schema skeletons | what shapes mean is exactly what existing schema languages already govern; a shape floor without vocabulary adds no agreement |
| `Node(S)`, `Decimal`, bitwise `f64` | law-illuminating, single-consumer; they exercise the floor and demand nothing of a peer |

None of this diminishes them as instantiations — Tier C is where most actual uses of
deixis-core should live. A pattern that never becomes a package is the system working.

## Composition: surfaces stand on the named floor

A real capability surface is not handlers alone: a grant carries configuration — limits,
scopes, parameters — and configuration is data. The natural slot is the sum
`Handler | Ontos.Value`, which is to say the surface profile is a profile **over** the
named-data floor, the way ontos's density rule is a profile over `deixis-pos-v1`
([0002](0002-positional-keys.md)). The dependency order is then also the build order: the
named-data floor first — small, composed, immediately useful — and the surface profile on
top of it, the probative instance. Each has a nameable owner; neither is named here.

## What this note does not do

It assigns no owner. That is proposal Q1, which this repository's lanes decide together with
the repositories that would own the instance (since 2026-10-04 it no longer waits on the
operator), and a survey's job is to make the options legible, not to take them. It reserves no names:
"capability surface," "named-data floor," and "vocabulary tree" name kinds of agreement,
not profiles. And it ratifies nothing: every claim above is a claim about *perceivable*
agreement, falsified the ordinary way — by the second party never arriving.
