# Path

The pointing. [TREE.md](TREE.md) says what a tree *is*; this says how to point into one.

**Model status:** all four cores implement mandatory `T` under
[ADR 0010](design/0010-mandatory-node-values.md).
[ADR 0012](design/0012-data-wire-tree-symmetry.md) gives DataTree and WireTree
this same partial selection contract. Addressless reading/sending occurs on
the own value after successful selection; it cannot erase a missing-versus-present
distinction. `at` selects structure, so selecting a Wire that refuses a message
still succeeds.

```
Path = Key*
```

A path is a finite sequence of keys — not a key, and not a string.

## Resolution

Resolution is a partial function, written `N / p`:

```
at : Node[T] × Path ⇀ Node[T]

N           / ε        =  N
Node(o, m)  / (k · p)  =  m(k) / p      when k ∈ dom m
Node(o, m)  / (k · p)  =  undefined     when k ∉ dom m
```

`ε` is the empty path, and `N / ε = N` — a node points at itself with no keys spent. There
is no separate clause for a node without children: `Node(o, ∅)` resolves no nonempty
path, whatever its own value, because no key is in the domain of `∅`.

The own value at a path is read off the node found there:

```
valueAt : Node[T] × Path ⇀ T

valueAt(N, p)  =  o     when N / p = Node(o, m)
valueAt(N, p)  =  undefined     when N / p is undefined
```

`valueAt` returns the stored `T` for every existing node and is undefined only for
a missing node. If `T` includes `None`, null or another sentinel, that is a legal
payload at an existing path. The API's failure representation must distinguish
it from a missing path; optional storage is not implied by partial navigation.

**This is a reading, not a layer.** Resolution adds no values, constructs nothing, and
defines no equality. `N / p` returns a subtree that was already there, or nothing. Every
property [TREE.md](TREE.md) fixes is untouched.

**Resolution never enters a value.** It walks children, and only children. A node whose
own value is itself a tree holds that tree as content; its paths are not the tree's paths.

## What resolution is not

- **Not creation.** A miss does not bring a node into being. There is no autovivification.
- **Not defaulting.** A miss is undefined. Every constructed `Node(t, ∅)` is an
  existing node, whatever its legal payload. It cannot stand in for a missing path.
- **Not search.** `N / p` follows the keys given, in order. It does not look for `p`
  elsewhere in the tree.

## Properties

**Resolution is a partial monoid action.** `Key*` is the free monoid under concatenation,
and

```
N / ε          =  N
N / (p ++ q)   =  (N / p) / q
```

with the two sides defined in exactly the same cases. Splitting a path anywhere and
resolving in stages gives the same answer as resolving it whole.

**Path sets are prefix-closed.** Write `paths(N)` for the set of `p` where `N / p` is
defined:

```
paths(Node(o, m))  =  { ε } ∪ { k · p  |  k ∈ dom m,  p ∈ paths(m(k)) }
```

If `N / q` is defined and `p` is a prefix of `q`, then `N / p` is defined — resolving `q`
walks through `p` on the way. So `paths(N)` is closed under prefixes, and the prefix order
on it is the ancestor relation: `p ≤ q` iff `N / p` is an ancestor of `N / q`.

**Every existing path has a value.** A path is terminal when `N / p` has no
children; interior paths are the rest. Both carry `T`. An optional instantiation
may distinguish `None` from `Some(t)` as payloads, but that distinction is not
node presence and does not add another core path domain.

## Identity, extensionally

Two nodes are equal exactly when they point the same way. `N = M` iff

1. `paths(N) = paths(M)`, and
2. for every `p` in `paths(N)`, the stored values at `p` are `≈`-equal.

For `Node[Option[T]]` with tag-respecting equality, comparing values includes the
option tags, so a third core presence condition is unnecessary. Paths must still
be retained even when a profile interprets their payload as absence:
`Node(None, {a ↦ Node(None, ∅)})` and `Node(None, ∅)` have different path domains.
This characterization uses the carrier supplied to the mandatory core.

## Contexts and replacement

For a path `p` in `paths(N)`, *splitting* `N` at `p` yields the node found there and its
**context**: `N` with a single hole at `p`, retaining every ancestor's own value, the keys
leading to the hole, and every sibling subtree. *Plugging* a node into the hole rebuilds a
tree. Splitting at a path not in `paths(N)` is undefined. Both directions are exact:

```
split_p : Node[T] ⇀ Context_T(p) × Node[T]
plug    : (Context_T(p) × Node[T]) → Node[T]

plug(split_p(N))          = N              when p ∈ paths(N)
split_p(plug((C, s)))     = (C, s)         for every context C at p and node s
```

The second law is the one that is easy to omit, and it matters: recovering the context from
a result must return *the same* context, not merely some context that could have produced
that result. Write `N[p := s]` for replacement at an existing path — split, then plug `s`.
Then, by induction on `p`, retaining each untouched parent's own value and siblings on the
way:

```
N[p := s] / p       =  s
N[p := N / p]       =  N
N[p := s][p := t]   =  N[p := t]
s = t   ⟹   N[p := s] = N[p := t]
```

More generally, *cutting* `N` at a finite set `F` of paths in `paths(N)`, none a prefix
of another, yields a skeleton with a hole at each path of `F` and the subtrees found
there. Cutting is undefined when any path of `F` is missing: skipping that path would
silently return a different cut. Rebuilding from exactly those parts returns `N`, and
cutting a rebuilt tree returns exactly its parts.
Every distinction must survive in the skeleton or in a supplied subtree — own values above a
hole and nodes without children included. Different complete cuts of one tree rebuild the
same tree; moving subtrees to other keys is a different tree.

These are laws about trees, stated so that any operation defined through them inherits
them. They add no methods to the floor: `split`, `plug`, replacement and cuts are
derivable through the accessors.

## Paths do not flatten

Keys are arbitrary byte strings. They may contain `/`, `\`, `\0`, newlines, invalid UTF-8;
and the empty key is a perfectly good key. Therefore:

> A path is a *sequence* of byte strings and cannot be represented as a single byte string
> by concatenation. Deixis defines no textual spelling of a path.

Concatenation loses the boundaries, and the collisions are immediate:

```
["a", "bc"]   and  ["ab", "c"]    concatenate identically
["a"]   ["", "a"]   ["a", ""]     all render as "a" under naive "/"-joining
```

Any consumer that needs to write a path down — a URL, a config key, a log line, a CLI
argument — owes a **separator and escaping profile**, named and versioned, exactly as a
positional key spelling is owed by whoever needs one
([0001](design/0001-keys-are-bytes.md)). That profile belongs to the consumer. It is not
part of the floor, and deixis will not supply a default, because a default here is a silent
source of collisions rather than a convenience.

The corollary for APIs: path parameters are sequences of byte strings. An implementation
that accepts a delimited string has chosen a profile whether it admits it or not.

## Instantiation note

Resolution never consults the slot — it walks keys, which are bytes. So paths are available
at every tier in [SLOTS.md](SLOTS.md), including a carrier-only slot with no equality at
all. Navigation is the one thing every instantiation gets. `valueAt` needs no equality
either: it returns what is there, and comparing it is a separate, priced act.
