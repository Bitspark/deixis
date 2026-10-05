package deixis

import (
	"bytes"
	"errors"
	"testing"
)

// foreignNode is an independent DeixisNode with a configurable At, for conformance tests.
type foreignNode[T any] struct {
	own      T
	children func() []Child[T]
	at       func(self DeixisNode[T], path TreePath) (DeixisNode[T], bool) // nil walks Children
}

func (f *foreignNode[T]) Own() T               { return f.own }
func (f *foreignNode[T]) Children() []Child[T] { return f.children() }
func (f *foreignNode[T]) Decompose() (T, []Child[T]) {
	return f.own, f.children()
}
func (f *foreignNode[T]) At(path TreePath) (DeixisNode[T], bool) {
	if f.at != nil {
		return f.at(f, path)
	}
	var current DeixisNode[T] = f
	for _, key := range path {
		var next DeixisNode[T]
		for _, child := range current.Children() {
			if bytes.Equal(child.Key, key) {
				next = child.Tree
				break
			}
		}
		if next == nil {
			return nil, false
		}
		current = next
	}
	return current, true
}

func mustTree[T any](t *testing.T, own T, children []Child[T]) DeixisNode[T] {
	t.Helper()
	tree, err := ComposeTree(own, children)
	if err != nil {
		t.Fatal(err)
	}
	return tree
}

func mustNode[T any](t *testing.T, own T, children []Entry[T]) Node[T] {
	t.Helper()
	node, err := Compose(own, children)
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func TestToNativeConvertsALawfulForeignTree(t *testing.T) {
	leaf := mustTree(t, []byte{3}, nil)
	middle := mustTree(t, []byte{2}, []Child[[]byte]{{Key: []byte{}, Tree: leaf}})
	generic := mustTree(t, []byte{1}, []Child[[]byte]{{Key: []byte{255, 0}, Tree: middle}})

	native, err := ToNative(generic, nil)
	if err != nil {
		t.Fatal(err)
	}
	expected := mustNode(t, []byte{1}, []Entry[[]byte]{{Key: []byte{255, 0}, Node: mustNode(t, []byte{2},
		[]Entry[[]byte]{{Key: []byte{}, Node: mustNode(t, []byte{3}, nil)}})}})
	if !native.EqualBy(expected, bytes.Equal) {
		t.Fatal("converted tree differs from the native tree it denotes")
	}
	got, err := EncodeFlat(native, IdentityBytes())
	if err != nil {
		t.Fatal(err)
	}
	want, err := EncodeFlat(expected, IdentityBytes())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("the converted tree does not encode like the native tree")
	}
}

func TestToNativeKeepsOwnValuesAndInvokesNothing(t *testing.T) {
	a, b := new(int), new(int)
	generic := mustTree(t, a, []Child[*int]{{Key: []byte{7}, Tree: mustTree(t, b, nil)}})
	native, err := ToNative(generic, nil)
	if err != nil {
		t.Fatal(err)
	}
	child, ok := native.At([][]byte{{7}})
	if native.Own() != a || !ok || child.Own() != b {
		t.Fatal("own-value objects were not retained as they are")
	}

	already := mustNode(t, a, nil)
	back, err := ToNative(AsTree(already), nil)
	if err != nil || back.Own() != a || back.Len() != 0 {
		t.Fatalf("a native node behind AsTree is not returned as it is: %v", err)
	}
}

func TestToNativeAcceptsASharedSubtreeAndRefusesACycle(t *testing.T) {
	shared := mustTree(t, "shared", nil)
	dag := mustTree(t, "root", []Child[string]{{Key: []byte{1}, Tree: shared}, {Key: []byte{2}, Tree: shared}})
	native, err := ToNative(dag, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range [][]byte{{1}, {2}} {
		if n, ok := native.At([][]byte{key}); !ok || n.Own() != "shared" {
			t.Fatalf("shared subtree missing at %x", key)
		}
	}

	loop := &foreignNode[string]{own: "loop"}
	loop.children = func() []Child[string] { return []Child[string]{{Key: []byte{9}, Tree: loop}} }
	var cycle *CycleError
	if _, err := ToNative[string](loop, nil); !errors.As(err, &cycle) {
		t.Fatalf("a cycle was not refused as CycleError: %v", err)
	}
}

func TestToNativeRefusesDuplicateKeysAndANonconformingChild(t *testing.T) {
	child := mustTree(t, "c", nil)
	dup := &foreignNode[string]{own: "d", children: func() []Child[string] {
		return []Child[string]{{Key: []byte{5}, Tree: child}, {Key: []byte{5}, Tree: child}}
	}}
	var duplicate *DuplicateKeyError
	if _, err := ToNative[string](dup, nil); !errors.As(err, &duplicate) {
		t.Fatalf("duplicate keys were not refused: %v", err)
	}

	// Children lists key 6, but At([6]) says it is absent. deixis-Go's generic selection
	// delegates to the child's At while TypeScript walks Children, so such a tree can answer
	// differently in the two languages; neither answer is sanctioned (ADR 0013 §10).
	liar := &foreignNode[string]{
		own:      "l",
		children: func() []Child[string] { return []Child[string]{{Key: []byte{6}, Tree: child}} },
		at: func(self DeixisNode[string], path TreePath) (DeixisNode[string], bool) {
			if len(path) == 0 {
				return self, true
			}
			return nil, false
		},
	}
	var nonconforming *NonconformingTreeError
	if _, err := ToNative[string](liar, nil); !errors.As(err, &nonconforming) {
		t.Fatalf("a nonconforming child was not refused: %v", err)
	}
}

func TestToNativeExposesItsLimits(t *testing.T) {
	chain := mustTree(t, 0, nil)
	for i := 1; i <= 5; i++ {
		chain = mustTree(t, i, []Child[int]{{Key: []byte{0}, Tree: chain}})
	}
	var limit *TreeLimitError
	if _, err := ToNative(chain, &ToNativeLimits{Depth: 3}); !errors.As(err, &limit) || limit.Limit != "depth" {
		t.Fatalf("depth limit not exposed: %v", err)
	}
	if _, err := ToNative(chain, &ToNativeLimits{Nodes: 4}); !errors.As(err, &limit) || limit.Limit != "nodes" {
		t.Fatalf("node limit not exposed: %v", err)
	}
	if native, err := ToNative(chain, &ToNativeLimits{Depth: 5, Nodes: 6}); err != nil || native.Own() != 5 {
		t.Fatalf("a tree inside its limits was refused: %v", err)
	}
}

func TestToNativeConvertsADeepForeignTree(t *testing.T) {
	deep := mustTree(t, 0, nil)
	for i := 1; i <= 12000; i++ {
		deep = mustTree(t, i, []Child[int]{{Key: []byte{1}, Tree: deep}})
	}
	native, err := ToNative(deep, nil)
	if err != nil {
		t.Fatal(err)
	}
	path := make([][]byte, 12000)
	for i := range path {
		path[i] = []byte{1}
	}
	if bottom, ok := native.At(path); native.Own() != 12000 || !ok || bottom.Own() != 0 {
		t.Fatal("deep tree not converted intact")
	}
}
