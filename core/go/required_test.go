package deixis_test

import (
	"testing"

	deixis "github.com/bitspark/deixis/core/go"
)

func TestDirectPayloadAndParts(t *testing.T) {
	child, err := deixis.Compose(func() int { return 7 }, nil)
	if err != nil {
		t.Fatal(err)
	}
	root, err := deixis.Compose(func() int { return 42 }, []deixis.Entry[func() int]{{Key: []byte("child"), Node: child}})
	if err != nil {
		t.Fatal(err)
	}
	if root.Own()() != 42 {
		t.Fatal("own must be the supplied handler")
	}
	found, ok := root.At([][]byte{[]byte("child")})
	if !ok || found.Own()() != 7 {
		t.Fatal("child handler")
	}
	own, children := root.Decompose()
	rebuilt, err := deixis.Compose(own, children)
	if err != nil || rebuilt.Own()() != 42 {
		t.Fatal("complete parts")
	}
	if _, ok := rebuilt.At([][]byte{[]byte("missing")}); ok {
		t.Fatal("missing path")
	}
}

func TestWholePayloadEqualityIncludesNilAndOptionalValues(t *testing.T) {
	raw, err := deixis.Compose[*int](nil, nil)
	if err != nil || raw.Own() != nil {
		t.Fatal("nil is a payload")
	}
	if raw.EqualBy(raw, func(a, b *int) bool { return false }) {
		t.Fatal("core must call equality for nil")
	}
	absent, _ := deixis.Compose(deixis.None[int](), nil)
	present, _ := deixis.Compose(deixis.Some(7), nil)
	if !absent.EqualBy(present, func(a, b deixis.Option[int]) bool { return true }) {
		t.Fatal("option tags belong to the supplied payload relation")
	}
}
