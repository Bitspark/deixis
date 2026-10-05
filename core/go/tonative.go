package deixis

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
)

// CycleError reports that [ToNative] met a node that is its own ancestor. The stable
// rejection code is "cycle". A subtree shared at several positions is not a cycle.
type CycleError struct {
	// Path is where the node met itself again.
	Path TreePath
}

func (e *CycleError) Error() string { return "cycle at " + hexPath(e.Path) }

// NonconformingTreeError reports that a foreign node's Children lists a key its own At
// cannot select, or that it cannot select itself at the empty path. Its Children and At
// disagree, so the tree is outside the contract, whichever answer a caller might prefer.
// The stable rejection code is "nonconforming_child".
type NonconformingTreeError struct {
	// Path is the path whose selection disagreed with the parent's child map.
	Path TreePath
}

func (e *NonconformingTreeError) Error() string {
	return "Children and At disagree at " + hexPath(e.Path)
}

// TreeLimitError reports that [ToNative] exceeded a limit. The stable rejection code is
// "limit_exceeded".
type TreeLimitError struct {
	// Limit is "depth" (path length) or "nodes" (distinct foreign nodes converted).
	Limit string
}

func (e *TreeLimitError) Error() string { return fmt.Sprintf("tree exceeds the %s limit", e.Limit) }

// ToNativeLimits bounds [ToNative]. A zero field is unbounded.
type ToNativeLimits struct {
	// Depth is the longest path, in keys, the tree may contain.
	Depth int
	// Nodes is the number of distinct foreign nodes the conversion may visit.
	Nodes int
}

// uncomparableDepth bounds the walk below a node whose dynamic type is not comparable:
// such a node cannot be recognised again by identity, so a cycle through it would
// otherwise never end.
const uncomparableDepth = 1 << 20

// ToNative copies a lawful complete foreign tree, any [DeixisNode], into the native
// [Node], which is the representation the codec encodes (ADR 0013 §10).
//
// Keys are copied and own values are retained as they are: never cloned, never invoked.
// Nothing is fetched or bound. A native node behind [AsTree] is returned as it is. A
// comparable subtree shared at several positions is converted once, which is
// unobservable. Refusals are returned, never repaired: [*CycleError], [*DuplicateKeyError],
// [*NonconformingTreeError] when a node's Children lists a key its own At cannot select,
// and [*TreeLimitError]. A node whose dynamic type is not comparable is converted per
// position, and its depth is bounded even without a limit. The walk is iterative, so depth
// does not grow the call stack. A nil limits is unbounded.
func ToNative[T any](tree DeixisNode[T], limits *ToNativeLimits) (Node[T], error) {
	var l ToNativeLimits
	if limits != nil {
		l = *limits
	}
	type frame struct {
		node    DeixisNode[T]
		id      any // nil when the node's dynamic type is not comparable
		key     []byte
		entries []Child[T]
		next    int
		built   []Entry[T]
	}
	done := map[any]Node[T]{}
	active := map[any]bool{}
	var stack []*frame
	pathTo := func(key []byte) TreePath {
		path := make(TreePath, 0, len(stack)+1)
		for i := 1; i < len(stack); i++ {
			path = append(path, stack[i].key)
		}
		if key != nil {
			path = append(path, key)
		}
		return path
	}
	// enter returns the native node at once when it is already known, or pushes a frame.
	enter := func(node DeixisNode[T], key []byte) (Node[T], bool, error) {
		if native, ok := node.(nodeTree[T]); ok {
			return native.Node, true, nil
		}
		if node == nil {
			return Node[T]{}, false, &NonconformingTreeError{Path: pathTo(key)}
		}
		var id any
		if reflect.TypeOf(node).Comparable() {
			id = node
			if native, ok := done[id]; ok {
				return native, true, nil
			}
			if active[id] {
				return Node[T]{}, false, &CycleError{Path: pathTo(key)}
			}
		} else if len(stack) > uncomparableDepth {
			return Node[T]{}, false, &TreeLimitError{Limit: "depth"}
		}
		if l.Depth > 0 && len(stack) > l.Depth {
			return Node[T]{}, false, &TreeLimitError{Limit: "depth"}
		}
		if l.Nodes > 0 && len(done)+len(stack) >= l.Nodes {
			return Node[T]{}, false, &TreeLimitError{Limit: "nodes"}
		}
		if _, ok := node.At(nil); !ok {
			return Node[T]{}, false, &NonconformingTreeError{Path: pathTo(key)}
		}
		entries := node.Children()
		for _, child := range entries {
			if _, ok := node.At(TreePath{child.Key}); !ok {
				return Node[T]{}, false, &NonconformingTreeError{Path: append(pathTo(key), bytes.Clone(child.Key))}
			}
		}
		if id != nil {
			active[id] = true
		}
		stack = append(stack, &frame{node: node, id: id, key: key, entries: entries})
		return Node[T]{}, false, nil
	}

	if native, known, err := enter(tree, nil); err != nil || known {
		return native, err
	}
	for {
		top := stack[len(stack)-1]
		if top.next < len(top.entries) {
			child := top.entries[top.next]
			top.next++
			key := bytes.Clone(child.Key)
			native, known, err := enter(child.Tree, key)
			if err != nil {
				return Node[T]{}, err
			}
			if known {
				top.built = append(top.built, Entry[T]{Key: key, Node: native})
			}
			continue
		}
		stack = stack[:len(stack)-1]
		native, err := Compose(top.node.Own(), top.built)
		if err != nil {
			return Node[T]{}, err
		}
		if top.id != nil {
			delete(active, top.id)
			done[top.id] = native
		}
		if len(stack) == 0 {
			return native, nil
		}
		parent := stack[len(stack)-1]
		parent.built = append(parent.built, Entry[T]{Key: top.key, Node: native})
	}
}

func hexPath(path TreePath) string {
	parts := make([]string, len(path))
	for i, key := range path {
		parts[i] = fmt.Sprintf("%x", key)
	}
	return "/" + strings.Join(parts, "/")
}
