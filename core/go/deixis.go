// deixis/core — finite keyed trees with one opaque value at every node.
//
// Node[T] = T × FinMap[Bytes, Node[T]].
//
// The payload carries no bounds. Equality is an optional caller-supplied
// relation over the entire T. A caller can choose an optional payload type;
// the core neither unwraps it nor assigns meaning to its absence tag.
// Own values and children are independent. Missing paths are distinct from
// existing nodes whose payload happens to be empty, null or an option.
// See docs/design/0010-mandatory-node-values.md, TREE.md and PATH.md.
// Parts, navigation and supplied equality are the public core; attachment,
// replacement, contexts, cuts and mapping are derivable through these parts.
package deixis

import (
	"bytes"
	"fmt"
	"slices"
)

// Option is an opt-in payload type. Node does not interpret it. Its zero value is None.
//
// The value is boxed rather than represented by a sentinel of T, so every T — pointers,
// interfaces and empty values included — is a legal Some.
type Option[T any] struct {
	value T
	some  bool
}

// Some is Some(value).
func Some[T any](value T) Option[T] {
	return Option[T]{value: value, some: true}
}

// None constructs the absent alternative of a caller-chosen optional payload.
func None[T any]() Option[T] {
	return Option[T]{}
}

// Get is the value and true for Some, or the zero T and false for None.
func (o Option[T]) Get() (T, bool) {
	return o.value, o.some
}

// IsSome reports whether this is Some.
func (o Option[T]) IsSome() bool {
	return o.some
}

// Node is a node: an opaque own value and a finite map from byte keys to nodes.
// Structure is immutable once constructed; payloads may be mutable.
// The zero Node has the zero value of T and no children.
//
// deixis does not define identity, it lifts one from the slot, and the slot is not
// required to have a good equality — or any particular equality. Compare nodes with
// [Node.EqualBy], passing the relation explicitly; native == over Node values is not the
// lifted identity.
type Node[T any] struct {
	own T
	// Sorted by key under unsigned-octet lexicographic order, keys unique. Both halves
	// of that invariant are established in Compose and relied on by Get (binary
	// search) and EqualBy (pairwise zip).
	entries []Entry[T]
}

// Entry is one child: a byte key bound to a child node.
type Entry[T any] struct {
	Key  []byte
	Node Node[T]
}

// DuplicateKeyError reports that [Compose] was given the same key twice. The stable
// rejection code for this condition is "duplicate_key".
type DuplicateKeyError struct {
	// Key is the key that appeared more than once.
	Key []byte
}

func (e *DuplicateKeyError) Error() string {
	return fmt.Sprintf("duplicate key: %x", e.Key)
}

// Compose is Node(own, children), from children in any order.
//
// Keys are copied; the caller's slice and key bytes are never retained. Children are
// sorted, so insertion order is not observable — sibling order is not part of a node.
// Returns a [DuplicateKeyError] if two children share a key: a finite map has one child
// per key, and deixis has no policy for which would win, so it declines to choose.
func Compose[T any](own T, children []Entry[T]) (Node[T], error) {
	owned := make([]Entry[T], len(children))
	for i, child := range children {
		owned[i] = Entry[T]{Key: bytes.Clone(child.Key), Node: child.Node}
	}

	slices.SortFunc(owned, func(a, b Entry[T]) int {
		return bytes.Compare(a.Key, b.Key)
	})

	for i := 1; i < len(owned); i++ {
		if bytes.Equal(owned[i-1].Key, owned[i].Key) {
			return Node[T]{}, &DuplicateKeyError{Key: bytes.Clone(owned[i].Key)}
		}
	}

	return Node[T]{own: own, entries: owned}, nil
}

// Decompose is the node's parts, (own, children): its own value, and every child under
// its exact key as a whole subtree, in unsigned-octet lexicographic key order. A node
// without children returns an empty map, never a missing one. Composing the parts
// again gives the node back, and nothing about the node is outside them.
func (n Node[T]) Decompose() (T, []Entry[T]) {
	return n.own, n.Entries()
}

// Own is the node's own value.
func (n Node[T]) Own() T {
	return n.own
}

// Len is the number of children.
func (n Node[T]) Len() int {
	return len(n.entries)
}

// Get is the child at key, or false if the key is not in the domain. Key equality is
// octet equality.
func (n Node[T]) Get(key []byte) (Node[T], bool) {
	i, found := slices.BinarySearchFunc(n.entries, key, func(entry Entry[T], k []byte) int {
		return bytes.Compare(entry.Key, k)
	})
	if !found {
		return Node[T]{}, false
	}
	return n.entries[i].Node, true
}

// Entries is the children in unsigned-octet lexicographic key order. Keys are copies;
// mutating them does not touch the node.
func (n Node[T]) Entries() []Entry[T] {
	out := make([]Entry[T], len(n.entries))
	for i, entry := range n.entries {
		out[i] = Entry[T]{Key: bytes.Clone(entry.Key), Node: entry.Node}
	}
	return out
}

// Keys is the domain in order. Keys are copies.
func (n Node[T]) Keys() [][]byte {
	out := make([][]byte, len(n.entries))
	for i, entry := range n.entries {
		out[i] = bytes.Clone(entry.Key)
	}
	return out
}

// At is n / path — resolve a path, a sequence of byte keys. See docs/PATH.md.
//
// The empty path resolves to n itself. A miss is false: resolution never creates, never
// defaults, and never searches, and it walks children only — it never enters an own
// value, whatever that value holds. The own value at a path is read off the node found
// there: At, then [Node.Own].
//
// A path is not a string. Keys may contain any bytes, including separators and no bytes
// at all, so there is no delimited spelling to accept here — a caller wanting one owes a
// separator and escaping profile of its own.
func (n Node[T]) At(path [][]byte) (Node[T], bool) {
	node := n
	for _, key := range path {
		child, ok := node.Get(key)
		if !ok {
			return Node[T]{}, false
		}
		node = child
	}
	return node, true
}

// EqualBy is identity, lifted from the slot equality eq supplied by the caller.
//
//	Node(o, m) = Node(o', m')   iff  o ≈ o'  and  dom m = dom m'  and  m(k) = m'(k) for every k
//
// The result is an equivalence relation exactly when eq is one. Pass a relation that is
// not reflexive — IEEE == over floats, say, where NaN != NaN — and a node stops being
// equal to itself. deixis lifts what it is given and makes no attempt to repair it.
func (n Node[T]) EqualBy(other Node[T], eq func(a, b T) bool) bool {
	if !eq(n.own, other.own) {
		return false
	}
	// Both sides are sorted and key-unique, so equal domains plus pointwise-equal
	// children is exactly a pairwise walk.
	if len(n.entries) != len(other.entries) {
		return false
	}
	for i := range n.entries {
		if !bytes.Equal(n.entries[i].Key, other.entries[i].Key) {
			return false
		}
		if !n.entries[i].Node.EqualBy(other.entries[i].Node, eq) {
			return false
		}
	}
	return true
}
