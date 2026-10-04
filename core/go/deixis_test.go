package deixis_test

import (
	"bytes"
	"testing"

	deixis "github.com/bitspark/deixis/core/go"
)

// A slot whose equality is deliberately coarser than its representation. If an
// implementation reached for native equality instead of the supplied relation, every
// test using this type would fail.
type fixture struct {
	class          string
	representation string
}

func sameOwn(a, b deixis.Option[fixture]) bool {
	av, ap := a.Get()
	bv, bp := b.Get()
	return ap == bp && (!ap || sameClass(av, bv))
}

func sameClass(a, b fixture) bool {
	return a.class == b.class
}

func some(class, representation string) deixis.Option[fixture] {
	return deixis.Some(fixture{class: class, representation: representation})
}

func none() deixis.Option[fixture] {
	return deixis.None[fixture]()
}

func compose(t *testing.T, own deixis.Option[fixture], children ...deixis.Entry[deixis.Option[fixture]]) deixis.Node[deixis.Option[fixture]] {
	t.Helper()
	node, err := deixis.Compose(own, children)
	if err != nil {
		t.Fatalf("Compose: %v", err)
	}
	return node
}

func valued(t *testing.T, class, representation string) deixis.Node[deixis.Option[fixture]] {
	t.Helper()
	return compose(t, some(class, representation))
}

func entry(key string, node deixis.Node[deixis.Option[fixture]]) deixis.Entry[deixis.Option[fixture]] {
	return deixis.Entry[deixis.Option[fixture]]{Key: []byte(key), Node: node}
}

func path(keys ...string) [][]byte {
	out := make([][]byte, len(keys))
	for i, k := range keys {
		out[i] = []byte(k)
	}
	return out
}

func TestTheZeroNodeIsTheUnvaluedEmptyNode(t *testing.T) {
	var zero deixis.Node[deixis.Option[fixture]]
	if zero.Own().IsSome() || zero.Len() != 0 {
		t.Fatal("the zero Node must be Node(None, ∅)")
	}
	if !zero.EqualBy(compose(t, none()), sameOwn) {
		t.Fatal("zero Node ≠ Compose(None, ∅)")
	}
}

func TestNoneIsNotSomeOfAnEmptyValue(t *testing.T) {
	empty := compose(t, some("", ""))
	unvalued := compose(t, none())
	if empty.EqualBy(unvalued, sameOwn) || unvalued.EqualBy(empty, sameOwn) {
		t.Fatal("Node(Some(empty), ∅) and Node(None, ∅) are different nodes")
	}
	// The value is boxed, so the zero T is a legal Some.
	zero := deixis.Some(fixture{})
	if value, ok := zero.Get(); !ok || value != (fixture{}) {
		t.Fatal("Some of the zero T must come back as Some")
	}
	if _, ok := deixis.None[fixture]().Get(); ok {
		t.Fatal("None must not carry a value")
	}
}

func TestANodeCarriesAValueAndChildrenAtOnce(t *testing.T) {
	node := compose(t, some("7", "seven"), entry("k", compose(t, none())))
	if value, ok := node.Own().Get(); !ok || value.class != "7" {
		t.Fatal("the own value must survive beside the children")
	}
	if _, ok := node.Get([]byte("k")); !ok || node.Len() != 1 {
		t.Fatal("the child must survive beside the own value")
	}
}

func TestIdenticalChildrenWithDifferentOwnValuesAreDifferentNodes(t *testing.T) {
	child := entry("k", compose(t, none()))
	valuedParent := compose(t, some("7", "seven"), child)
	unvaluedParent := compose(t, none(), child)
	otherValue := compose(t, some("8", "seven"), child)

	if valuedParent.EqualBy(unvaluedParent, sameOwn) {
		t.Fatal("a parent's own value is part of the node: children cannot stand in for it")
	}
	if valuedParent.EqualBy(otherValue, sameOwn) {
		t.Fatal("own values compare by the supplied relation")
	}
}

func TestAValueRelocatedToAChildIsADifferentNode(t *testing.T) {
	atRoot := compose(t, some("7", "seven"), entry("k", compose(t, none())))
	atChild := compose(t, none(), entry("k", valued(t, "7", "seven")))
	if atRoot.EqualBy(atChild, sameOwn) {
		t.Fatal("the same values at different paths are different nodes")
	}
}

func TestOwnValuesCompareByTheSuppliedRelation(t *testing.T) {
	a := compose(t, some("7", "seven"), entry("k", valued(t, "1", "one")))
	b := compose(t, some("7", "SEVEN"), entry("k", valued(t, "1", "ONE")))
	if !a.EqualBy(b, sameOwn) {
		t.Fatal("representations differ and classes agree: one node under ≈")
	}
}

func TestKeysAreCopiedOnConstruction(t *testing.T) {
	live := []byte("live")
	node := compose(t, none(), deixis.Entry[deixis.Option[fixture]]{Key: live, Node: valued(t, "1", "x")})
	copy(live, "!!!!")

	if _, ok := node.Get([]byte("live")); !ok {
		t.Fatal("mutating the caller's key bytes must not touch the node")
	}
	if _, ok := node.Get([]byte("!!!!")); ok {
		t.Fatal("the mutated spelling must not resolve")
	}
}

func TestKeysAreCopiedOnTheWayOut(t *testing.T) {
	node := compose(t, none(), entry("k", valued(t, "1", "x")))
	_, parts := node.Decompose()

	for _, out := range [][]byte{node.Keys()[0], node.Entries()[0].Key, parts[0].Key} {
		copy(out, "!")
		if _, ok := node.Get([]byte("k")); !ok {
			t.Fatal("mutating a returned key must not touch the node")
		}
	}
}

func TestKeysAreExactByteStrings(t *testing.T) {
	node := compose(t, none(),
		entry("", valued(t, "1", "empty key")),
		deixis.Entry[deixis.Option[fixture]]{Key: []byte{1}, Node: valued(t, "2", "one")},
		deixis.Entry[deixis.Option[fixture]]{Key: []byte{1, 0}, Node: valued(t, "3", "one zero")},
	)

	for _, key := range [][]byte{{}, {1}, {1, 0}} {
		if _, ok := node.Get(key); !ok {
			t.Fatalf("key %x must be present", key)
		}
	}
	if _, ok := node.Get([]byte{0, 1}); ok {
		t.Fatal("key 0001 must be absent")
	}
	if node.Len() != 3 {
		t.Fatalf("Len = %d, want 3", node.Len())
	}
}

func TestChildrenAreSortedRegardlessOfInsertionOrder(t *testing.T) {
	node := compose(t, none(), entry("b", valued(t, "2", "")), entry("a", valued(t, "1", "")))
	keys := node.Keys()
	if len(keys) != 2 || !bytes.Equal(keys[0], []byte("a")) || !bytes.Equal(keys[1], []byte("b")) {
		t.Fatalf("Keys() = %q, want [a b]", keys)
	}
}

func TestDecomposeReturnsCompleteParts(t *testing.T) {
	grandchild := entry("g", valued(t, "c", "c"))
	node := compose(t, some("7", "seven"),
		entry("b", compose(t, none())),
		entry("a", compose(t, some("a", "a"), grandchild)),
	)

	own, children := node.Decompose()
	if value, ok := own.Get(); !ok || value.class != "7" {
		t.Fatal("the own value is one of the parts")
	}
	if len(children) != 2 {
		t.Fatalf("every child is in the map: got %d", len(children))
	}
	// Children are whole subtrees, not their own values.
	if _, ok := children[0].Node.Get([]byte("g")); !ok {
		t.Fatal("a child comes back as a whole subtree")
	}

	rebuilt, err := deixis.Compose(own, children)
	if err != nil || !rebuilt.EqualBy(node, sameOwn) {
		t.Fatal("composing the parts again must give the node back")
	}

	// A node without children returns an empty map, never a missing one.
	_, empty := valued(t, "1", "x").Decompose()
	if empty == nil || len(empty) != 0 {
		t.Fatalf("children of a childless node = %#v, want an empty map", empty)
	}
}

func TestDuplicateKeysAreRefusedBelowAValuedParent(t *testing.T) {
	_, err := deixis.Compose(some("a", "a"), []deixis.Entry[deixis.Option[fixture]]{
		entry("k", compose(t, none())),
		entry("k", compose(t, none())),
	})
	if err == nil {
		t.Fatal("a valued node holds one child per key, like any other")
	}
}

func nested(t *testing.T) deixis.Node[deixis.Option[fixture]] {
	return compose(t, none(), entry("a", compose(t, some("a", "a"), entry("b", valued(t, "1", "deep")))))
}

func TestTheEmptyPathResolvesToTheNodeItself(t *testing.T) {
	node := nested(t)
	got, ok := node.At(nil)
	if !ok || !got.EqualBy(node, sameOwn) {
		t.Fatal("the empty path must resolve to the node itself")
	}
}

func TestResolutionWalksKeysInOrder(t *testing.T) {
	node := nested(t)

	got, ok := node.At(path("a", "b"))
	if value, present := got.Own().Get(); !ok || !present || value.class != "1" {
		t.Fatal("a/b must resolve to the deep node")
	}
	// Order matters, and a miss is a miss — never a default, never a search.
	if _, ok := node.At(path("b", "a")); ok {
		t.Fatal("b/a must miss")
	}
	if _, ok := node.At(path("a", "nope")); ok {
		t.Fatal("a/nope must miss")
	}
	// A childless node resolves no nonempty path, whatever its own value.
	if _, ok := node.At(path("a", "b", "c")); ok {
		t.Fatal("a/b/c must miss below a childless node")
	}
}

func TestResolutionPassesThroughAValuedNode(t *testing.T) {
	node := nested(t)
	through, ok := node.At(path("a"))
	if value, present := through.Own().Get(); !ok || !present || value.class != "a" {
		t.Fatal("the valued interior node must resolve with its value")
	}
	if _, ok := node.At(path("a", "b")); !ok {
		t.Fatal("resolution must continue through a valued node to its child")
	}
}

func TestResolutionIsAPartialMonoidAction(t *testing.T) {
	node := nested(t)

	whole, wholeOK := node.At(path("a", "b"))
	stage, stageOK := node.At(path("a"))
	var staged deixis.Node[deixis.Option[fixture]]
	stagedOK := false
	if stageOK {
		staged, stagedOK = stage.At(path("b"))
	}

	if !wholeOK || !stagedOK || !whole.EqualBy(staged, sameOwn) {
		t.Fatal("resolving a‖b must agree with resolving a then b")
	}

	// Defined in exactly the same cases, including when neither is.
	if _, ok := node.At(path("x", "y")); ok {
		t.Fatal("x/y must miss")
	}
}

func TestPathElementsAreByteStringsNotADelimitedString(t *testing.T) {
	// The empty key is a key, and a key may contain what a separator would be.
	node := compose(t, none(), entry("", compose(t, none(), entry("a/b", valued(t, "1", "slash")))))

	if _, ok := node.At([][]byte{{}, []byte("a/b")}); !ok {
		t.Fatal("the empty key then a/b must resolve")
	}
	// The two path elements do not concatenate into one.
	if _, ok := node.At(path("a/b")); ok {
		t.Fatal("a/b alone must miss")
	}
	// The empty key and the empty path are different.
	root, _ := node.At(nil)
	child, _ := node.At([][]byte{{}})
	if root.EqualBy(child, sameOwn) {
		t.Fatal("[\"\"] and ε are different paths")
	}
}

// The design claim: the slot is constrained by nothing — a closure implements no
// meaningful equality and is still a legal own value, beside children or without them.
func TestTheSlotCarriesNoBounds(t *testing.T) {
	route, err := deixis.Compose(deixis.Some(func() int { return 42 }), nil)
	if err != nil {
		t.Fatal(err)
	}
	handlers, err := deixis.Compose(deixis.Some(func() int { return 7 }), []deixis.Entry[deixis.Option[func() int]]{
		{Key: []byte("route"), Node: route},
	})
	if err != nil {
		t.Fatal(err)
	}
	node, ok := handlers.Get([]byte("route"))
	if !ok {
		t.Fatal("route must be present")
	}
	handler, ok := node.Own().Get()
	if !ok || handler() != 42 {
		t.Fatal("the stored closure must come back callable")
	}
	root, ok := handlers.Own().Get()
	if !ok || root() != 7 {
		t.Fatal("the parent's closure must survive beside its child")
	}
}
