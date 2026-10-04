package deixis

import (
	"bytes"
	"fmt"
	"slices"
)

// Key is an exact byte-string key, without text or separator interpretation.
type Key = []byte

// TreePath is a relative sequence of keys. An empty path selects the current node.
type TreePath = [][]byte

// Child binds an exact byte key to a complete child tree.
type Child[T any] struct {
	Key  Key
	Tree DeixisNode[T]
}

// DeixisNode is the shared structural binding for every opaque payload.
// Implementations owe a finite, well-founded tree, complete child maps, copied
// keys, and the selection and reconstruction laws in docs/TREE.md. The interface
// alone cannot establish these laws for arbitrary implementations.
type DeixisNode[T any] interface {
	Own() T
	Children() []Child[T]
	At(TreePath) (DeixisNode[T], bool)
	Decompose() (T, []Child[T])
}

// ComposeTree reconstructs the shared structural interface from complete parts.
// Children must obey DeixisNode's laws. Keys and the collection are copied;
// payloads and child trees remain opaque. Duplicate keys and nil children fail.
func ComposeTree[T any](own T, children []Child[T]) (DeixisNode[T], error) {
	owned := make([]Child[T], len(children))
	for i, child := range children {
		if child.Tree == nil {
			return nil, fmt.Errorf("nil child tree at key %x", child.Key)
		}
		owned[i] = Child[T]{Key: bytes.Clone(child.Key), Tree: child.Tree}
	}
	slices.SortFunc(owned, func(a, b Child[T]) int { return bytes.Compare(a.Key, b.Key) })
	for i := 1; i < len(owned); i++ {
		if bytes.Equal(owned[i-1].Key, owned[i].Key) {
			return nil, &DuplicateKeyError{Key: bytes.Clone(owned[i].Key)}
		}
	}
	return &structuralTree[T]{own: own, children: owned}, nil
}

type structuralTree[T any] struct {
	own      T
	children []Child[T]
}

func (n *structuralTree[T]) Own() T { return n.own }

func (n *structuralTree[T]) Children() []Child[T] {
	children := make([]Child[T], len(n.children))
	for i, child := range n.children {
		children[i] = Child[T]{Key: bytes.Clone(child.Key), Tree: child.Tree}
	}
	return children
}

func (n *structuralTree[T]) At(path TreePath) (DeixisNode[T], bool) {
	if len(path) == 0 {
		return n, true
	}
	i, found := slices.BinarySearchFunc(n.children, path[0], func(child Child[T], key []byte) int {
		return bytes.Compare(child.Key, key)
	})
	if !found {
		return nil, false
	}
	return n.children[i].Tree.At(path[1:])
}

func (n *structuralTree[T]) Decompose() (T, []Child[T]) {
	return n.Own(), n.Children()
}

// AsTree exposes a native Node through the shared structural binding. Go does
// not allow Node.At's concrete return type to satisfy an interface return type,
// so this adapter leaves existing native and codec operations concrete.
func AsTree[T any](node Node[T]) DeixisNode[T] {
	return nodeTree[T]{node}
}

type nodeTree[T any] struct {
	Node[T]
}

func (n nodeTree[T]) Children() []Child[T] {
	entries := n.Entries()
	children := make([]Child[T], len(entries))
	for i, entry := range entries {
		children[i] = Child[T]{Key: entry.Key, Tree: AsTree(entry.Node)}
	}
	return children
}

func (n nodeTree[T]) At(path TreePath) (DeixisNode[T], bool) {
	selected, ok := n.Node.At(path)
	if !ok {
		return nil, false
	}
	return AsTree(selected), true
}

func (n nodeTree[T]) Decompose() (T, []Child[T]) {
	return n.Own(), n.Children()
}
