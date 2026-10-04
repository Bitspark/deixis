package deixis

import (
	"bytes"
	"testing"
)

func TestStructuralTreeBinding(t *testing.T) {
	child, err := Compose("child", []Entry[string]{})
	if err != nil {
		t.Fatal(err)
	}
	key := []byte{255, 0}
	root, err := Compose("root", []Entry[string]{{Key: key, Node: child}})
	if err != nil {
		t.Fatal(err)
	}
	var tree DeixisNode[string] = AsTree(root)
	selected, ok := tree.At(TreePath{key})
	if !ok || selected.Own() != "child" {
		t.Fatal("exact binary key did not select child")
	}
	if missing, exists := tree.At(TreePath{[]byte{42}}); exists || missing != nil {
		t.Fatal("missing subtree was not distinguished")
	}
	own, children := tree.Decompose()
	if own != "root" || len(children) != 1 || !bytes.Equal(children[0].Key, key) {
		t.Fatal("incomplete structural decomposition")
	}
	children[0].Key[0] = 0
	if _, exists := tree.At(TreePath{key}); !exists {
		t.Fatal("returned key mutated the tree")
	}
	children = tree.Children()
	if len(children) != 1 || children[0].Tree.Own() != "child" {
		t.Fatal("child enumeration did not return complete subtrees")
	}
	selected, ok = selected.At(TreePath{})
	if !ok || selected.Own() != "child" {
		t.Fatal("empty path failed on a leaf")
	}

	own, children = tree.Decompose()
	rebuilt, err := ComposeTree(own, children)
	if err != nil {
		t.Fatal(err)
	}
	children[0].Key[0] = 0
	rebuilt.Children()[0].Key[0] = 0
	selected, ok = rebuilt.At(TreePath{key})
	if !ok || selected.Own() != "child" || rebuilt.Own() != tree.Own() {
		t.Fatal("interface parts failed to reconstruct the complete tree")
	}
	if _, err := ComposeTree(own, []Child[string]{{Key: key, Tree: tree}, {Key: key, Tree: tree}}); err == nil {
		t.Fatal("duplicate structural children were accepted")
	}
	if _, err := ComposeTree(own, []Child[string]{{Key: key}}); err == nil {
		t.Fatal("nil structural child was accepted")
	}
}
