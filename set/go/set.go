// Package set implements deixis-set-v1, slot-member form — the finite-set container by
// self-keying.
//
//	set(S) = Node(None, { e(x) ↦ Node(Some(x), ∅) | x ∈ S })
//
// See docs/design/0005-set-keys.md. e is a lawful member encoder for the slot —
// x ≈ y ⟺ e(x) = e(y), canonical — and the codec law then does every job a set
// semantics needs, with nothing invented: membership is key membership, idempotence is
// inherited from the floor's duplicate-key refusal, set identity reduces to node
// identity, and enumeration order is spelling order (a set carries no order of its
// own).
//
// Under ADR 0010 this profile explicitly uses Node[Option[T]]: the set node
// is unvalued, and every member is a valued node without children. There is
// deliberately no repair anywhere: a mis-keyed entry is refused, never re-keyed, and
// recognition never prefers a representative among ≈-equal members — either may sit
// under their shared key.
//
// The node-member form (member(n) = n, e the deixis codec combinator) is gated on the
// codec axis and is not implemented here.
package set

import (
	"bytes"

	deixis "github.com/bitspark/deixis/core/go"
)

// Profile is the name of the profile this package implements (slot-member form).
const Profile = "deixis-set-v1"

// Reason is why a node is not a set node: the refusals of the slot-member form, by
// their stable codes.
type Reason string

const (
	// MisKeyed: a member Node(Some(x), ∅) under a key k ≠ e(x).
	MisKeyed Reason = "mis_keyed"
	// StructMember: a child whose own value is None — the image of a Struct child.
	StructMember Reason = "struct_member"
	// LeafNode: the set node itself is Node(Some(x), ∅) — the image of a bare Leaf.
	LeafNode Reason = "leaf_node"
	// ValuedSetNode: a set node with at least one member that carries its own value,
	// Node(Some(t), m) with m ≠ ∅. New in N; the childless case is LeafNode's.
	ValuedSetNode Reason = "valued_set_node"
	// MemberWithChildren: a member Node(Some(x), m) with m ≠ ∅. New in N.
	MemberWithChildren Reason = "member_with_children"
)

// Of is the set node of members under the member encoder e:
// Node(None, {e(x) ↦ Node(Some(x), ∅)}), entries fed in slice order.
//
// Two ≈-equal members spell the same key, and the floor refuses the duplicate —
// idempotence is inherited, not implemented. The returned error carries the shared key.
func Of[T any](members []T, e func(T) []byte) (deixis.Node[deixis.Option[T]], error) {
	entries := make([]deixis.Entry[deixis.Option[T]], len(members))
	for i, member := range members {
		node, err := deixis.Compose(deixis.Some(member), nil)
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		entries[i] = deixis.Entry[deixis.Option[T]]{Key: e(member), Node: node}
	}
	return deixis.Compose(deixis.None[T](), entries)
}

// Recognize is exact-or-refusal recognition of the slot-member image: an unvalued node
// whose every child is a valued node without children, coherent with its key
// (k = e(x)). It returns ("", true) for a set node and the refusal's reason otherwise.
//
// A node with several defects has several reasons that apply, and any of them may be
// returned: 0005 fixes the verdict, not an order among reasons. A key outside im(e)
// cannot cohere with any member, so it needs no check of its own — it reduces to
// mis-keying.
func Recognize[T any](node deixis.Node[deixis.Option[T]], e func(T) []byte) (Reason, bool) {
	if node.Own().IsSome() {
		if node.Len() == 0 {
			return LeafNode, false
		}
		return ValuedSetNode, false
	}
	for _, entry := range node.Entries() {
		member, ok := entry.Node.Own().Get()
		if !ok {
			return StructMember, false
		}
		if entry.Node.Len() != 0 {
			return MemberWithChildren, false
		}
		if !bytes.Equal(e(member), entry.Key) {
			return MisKeyed, false
		}
	}
	return "", true
}

// IsSet reports whether node is a set node: [Recognize] without the reason.
func IsSet[T any](node deixis.Node[deixis.Option[T]], e func(T) []byte) bool {
	_, ok := Recognize(node, e)
	return ok
}

// Contains is membership: x ∈ S iff e(x) ∈ dom — one lookup, no enumeration.
//
// Defined over set nodes (recognize first where provenance is unknown); on an
// arbitrary node it answers key membership, which coincides on the image. It never
// reads a member's own value.
func Contains[T any](node deixis.Node[deixis.Option[T]], member T, e func(T) []byte) bool {
	_, ok := node.Get(e(member))
	return ok
}
