package deixis_test

// Replay of the hand-authored conformance vectors (../../vectors/), through the public
// API only. See vectors/README.md and vectors/NODE-PLAN.md for the spellings and the
// fixture setoid. The corpus is read from inside this module, so the test cache tracks
// it (vectors/README.md, "A layout invariant").
//
// identity.json is spelled in the previous model and is read through the embedding E of
// ADR 0009 §10.1, as node-embedding.json's embedded-identity law says. invalid.json is
// not replayed: no fixture states a law over it in N, and node-invalid.json pins the
// duplicate-key refusals of N directly.

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	deixis "github.com/bitspark/deixis/core/go"
)

type jsonPayload struct {
	Class          *string `json:"class"`
	Representation *string `json:"representation"`
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex %q: %v", s, err)
	}
	return b
}

func payload(t *testing.T, raw json.RawMessage) fixture {
	t.Helper()
	var p jsonPayload
	if err := json.Unmarshal(raw, &p); err != nil || p.Class == nil || p.Representation == nil {
		t.Fatalf("a payload spelling carries class and representation: %s", raw)
	}
	return fixture{class: *p.Class, representation: *p.Representation}
}

// children decodes a [[hexKey, node], …] list, feeding the entries to the constructor in
// file (insertion) order — the construction owns sorting and duplicate refusal.
func children(t *testing.T, raw json.RawMessage, node func(json.RawMessage) (deixis.Node[deixis.Option[fixture]], error)) ([]deixis.Entry[deixis.Option[fixture]], error) {
	t.Helper()
	var pairs []json.RawMessage
	if err := json.Unmarshal(raw, &pairs); err != nil {
		t.Fatalf("children are a list of [hexKey, node] pairs: %v", err)
	}
	entries := make([]deixis.Entry[deixis.Option[fixture]], 0, len(pairs))
	for _, rawPair := range pairs {
		var pair []json.RawMessage
		if err := json.Unmarshal(rawPair, &pair); err != nil || len(pair) != 2 {
			t.Fatalf("a child is a [hexKey, node] pair: %v", err)
		}
		var key string
		if err := json.Unmarshal(pair[0], &key); err != nil {
			t.Fatalf("child key: %v", err)
		}
		child, err := node(pair[1])
		if err != nil {
			return nil, err
		}
		entries = append(entries, deixis.Entry[deixis.Option[fixture]]{Key: mustHex(t, key), Node: child})
	}
	return entries, nil
}

// build constructs a node from its N[T] spelling:
// {"own": {"none": {}} | {"some": payload}, "children": [[hexKey, node], …]}.
func build(t *testing.T, raw json.RawMessage) (deixis.Node[deixis.Option[fixture]], error) {
	t.Helper()
	var spelling struct {
		Own *struct {
			None *json.RawMessage `json:"none"`
			Some *json.RawMessage `json:"some"`
		} `json:"own"`
		Children *json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &spelling); err != nil || spelling.Own == nil || spelling.Children == nil {
		t.Fatalf("a node is {\"own\": …, \"children\": […]}: %s", raw)
	}
	own := deixis.None[fixture]()
	switch {
	case spelling.Own.Some != nil && spelling.Own.None == nil:
		own = deixis.Some(payload(t, *spelling.Own.Some))
	case spelling.Own.None != nil && spelling.Own.Some == nil:
	default:
		t.Fatalf("an own value is exactly one of none and some: %s", raw)
	}
	entries, err := children(t, *spelling.Children, func(child json.RawMessage) (deixis.Node[deixis.Option[fixture]], error) {
		return build(t, child)
	})
	if err != nil {
		return deixis.Node[deixis.Option[fixture]]{}, err
	}
	return deixis.Compose(own, entries)
}

// embed constructs E(n) from a previous-model spelling, {"leaf": payload} or
// {"struct": [[hexKey, node], …]}: E(Leaf(t)) = Node(Some(t), ∅) and
// E(Struct(m)) = Node(None, k ↦ E(m(k))).
func embed(t *testing.T, raw json.RawMessage) (deixis.Node[deixis.Option[fixture]], error) {
	t.Helper()
	var spelling struct {
		Leaf   *json.RawMessage `json:"leaf"`
		Struct *json.RawMessage `json:"struct"`
	}
	if err := json.Unmarshal(raw, &spelling); err != nil {
		t.Fatalf("bad node spelling: %v", err)
	}
	switch {
	case spelling.Leaf != nil:
		return deixis.Compose(deixis.Some(payload(t, *spelling.Leaf)), nil)
	case spelling.Struct != nil:
		entries, err := children(t, *spelling.Struct, func(child json.RawMessage) (deixis.Node[deixis.Option[fixture]], error) {
			return embed(t, child)
		})
		if err != nil {
			return deixis.Node[deixis.Option[fixture]]{}, err
		}
		return deixis.Compose(deixis.None[fixture](), entries)
	default:
		t.Fatal(`a previous-model node is {"leaf": …} or {"struct": …}`)
		panic("unreachable")
	}
}

func readVectors(t *testing.T, file string, profile string, into any) {
	t.Helper()
	data, err := os.ReadFile("../../vectors/" + file)
	if err != nil {
		t.Fatal(err)
	}
	var header struct {
		Profile string `json:"profile"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		t.Fatal(err)
	}
	if header.Profile != profile {
		t.Fatalf("%s: profile = %q, want %q", file, header.Profile, profile)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatal(err)
	}
}

type identityCase struct {
	Name  string          `json:"name"`
	Left  json.RawMessage `json:"left"`
	Right json.RawMessage `json:"right"`
	Equal bool            `json:"equal"`
}

// judgeIdentity checks one identity case both ways round, and reflexivity, reporting
// whether it is an equal judgment between nodes whose root representations differ.
func judgeIdentity(t *testing.T, c identityCase, construct func(*testing.T, json.RawMessage) (deixis.Node[deixis.Option[fixture]], error)) bool {
	t.Helper()
	left, err := construct(t, c.Left)
	if err != nil {
		t.Fatalf("%s: left: %v", c.Name, err)
	}
	right, err := construct(t, c.Right)
	if err != nil {
		t.Fatalf("%s: right: %v", c.Name, err)
	}

	if got := left.EqualBy(right, sameOwn); got != c.Equal {
		t.Errorf("%s: EqualBy = %v, want %v", c.Name, got, c.Equal)
	}
	// Equality is symmetric; the judgment must not depend on argument order.
	if got := right.EqualBy(left, sameOwn); got != c.Equal {
		t.Errorf("%s (flipped): EqualBy = %v, want %v", c.Name, got, c.Equal)
	}
	// And every node equals itself under the fixture relation.
	if !left.EqualBy(left, sameOwn) || !right.EqualBy(right, sameOwn) {
		t.Errorf("%s: reflexivity", c.Name)
	}

	l, lok := left.Own().Get()
	r, rok := right.Own().Get()
	return c.Equal && lok && rok && l.representation != r.representation
}

// The embedded-identity law of node-embedding.json: for every case of identity.json,
// E(left) ≡ E(right) in N iff the case's `equal` is true. The law pins the source's
// counts, and a replayer must refuse when they differ.
func TestIdentityVectorsReplayThroughTheEmbedding(t *testing.T) {
	var law struct {
		Cases []struct {
			Name           string `json:"name"`
			Op             string `json:"op"`
			Source         string `json:"source"`
			SourceCases    int    `json:"source_cases"`
			SourceEqual    int    `json:"source_equal"`
			SourceNotEqual int    `json:"source_not_equal"`
		} `json:"cases"`
	}
	readVectors(t, "node-embedding.json", "deixis-node-embedding", &law)
	pinned := -1
	for i, c := range law.Cases {
		if c.Op == "embedded-identity" {
			pinned = i
		}
	}
	if pinned < 0 || law.Cases[pinned].Source != "identity.json" {
		t.Fatal("node-embedding.json no longer states the embedded-identity law over identity.json")
	}
	pin := law.Cases[pinned]

	var file struct {
		Cases []identityCase `json:"cases"`
	}
	readVectors(t, "identity.json", "deixis-core-identity", &file)
	equal := 0
	for _, c := range file.Cases {
		if c.Equal {
			equal++
		}
	}
	if len(file.Cases) != pin.SourceCases || equal != pin.SourceEqual || len(file.Cases)-equal != pin.SourceNotEqual {
		t.Fatalf("identity.json has %d cases, %d equal, %d not; %s pins %d, %d, %d — "+
			"an erratum to identity.json, and the law must be re-checked by a person",
			len(file.Cases), equal, len(file.Cases)-equal, pin.Name, pin.SourceCases, pin.SourceEqual, pin.SourceNotEqual)
	}

	// The vectors must themselves exercise the coarseness of ≈: at least one equal
	// judgment between values whose representations differ, or they could not tell a
	// lifted relation from native equality.
	coarsenessExercised := false
	for _, c := range file.Cases {
		if judgeIdentity(t, c, embed) {
			coarsenessExercised = true
		}
	}
	if !coarsenessExercised {
		t.Error("no equal judgment between values with differing representations")
	}
}

func TestNodeIdentityVectorsReplay(t *testing.T) {
	var file struct {
		Cases []identityCase `json:"cases"`
	}
	readVectors(t, "node-identity.json", "deixis-node-identity", &file)
	if len(file.Cases) < 20 {
		t.Fatalf("vector file shrank? %d cases", len(file.Cases))
	}
	coarsenessExercised := false
	for _, c := range file.Cases {
		if judgeIdentity(t, c, build) {
			coarsenessExercised = true
		}
	}
	if !coarsenessExercised {
		t.Error("no equal judgment between values with differing representations")
	}
}

func TestNodeInvalidVectorsReplay(t *testing.T) {
	var file struct {
		Cases []struct {
			Name  string          `json:"name"`
			Node  json.RawMessage `json:"node"`
			Error string          `json:"error"`
			Key   string          `json:"key"`
		} `json:"cases"`
	}
	readVectors(t, "node-invalid.json", "deixis-node-invalid", &file)
	if len(file.Cases) < 6 {
		t.Fatalf("vector file shrank? %d cases", len(file.Cases))
	}

	for _, c := range file.Cases {
		if c.Error != "duplicate_key" {
			t.Fatalf("%s: unknown rejection code %q", c.Name, c.Error)
		}
		_, err := build(t, c.Node)
		var dup *deixis.DuplicateKeyError
		if !errors.As(err, &dup) {
			t.Errorf("%s: construction must fail with *DuplicateKeyError, got %v", c.Name, err)
			continue
		}
		if want := mustHex(t, c.Key); !bytes.Equal(dup.Key, want) {
			t.Errorf("%s: offending key %x, want %x", c.Name, dup.Key, want)
		}
	}
}

func decodePath(t *testing.T, raw []string) [][]byte {
	t.Helper()
	out := make([][]byte, len(raw))
	for i, key := range raw {
		out[i] = mustHex(t, key)
	}
	return out
}

// The navigation laws of node-navigation.json: at, the own value read off the node at a
// path (valueAt), and at composed with itself (S1).
func TestNodeNavigationVectorsReplay(t *testing.T) {
	var file struct {
		Cases []struct {
			Name     string          `json:"name"`
			Op       string          `json:"op"`
			Tree     json.RawMessage `json:"tree"`
			Path     []string        `json:"path"`
			First    []string        `json:"first"`
			Then     []string        `json:"then"`
			Expected struct {
				Defined   *json.RawMessage `json:"defined"`
				Undefined *json.RawMessage `json:"undefined"`
			} `json:"expected"`
		} `json:"cases"`
	}
	readVectors(t, "node-navigation.json", "deixis-node-navigation", &file)

	for _, c := range file.Cases {
		tree, err := build(t, c.Tree)
		if err != nil {
			t.Fatalf("%s: tree: %v", c.Name, err)
		}
		if (c.Expected.Defined == nil) == (c.Expected.Undefined == nil) {
			t.Fatalf("%s: expected is exactly one of defined and undefined", c.Name)
		}

		var got deixis.Node[deixis.Option[fixture]]
		var ok bool
		switch c.Op {
		case "at", "valueAt":
			got, ok = tree.At(decodePath(t, c.Path))
		case "at-compose":
			var stage deixis.Node[deixis.Option[fixture]]
			if stage, ok = tree.At(decodePath(t, c.First)); ok {
				got, ok = stage.At(decodePath(t, c.Then))
			}
		default:
			t.Fatalf("%s: unknown op %q", c.Name, c.Op)
		}

		if c.Expected.Undefined != nil {
			if ok {
				t.Errorf("%s: defined, want undefined", c.Name)
			}
			continue
		}
		if !ok {
			t.Errorf("%s: undefined, want defined", c.Name)
			continue
		}
		if c.Op == "valueAt" {
			var want struct {
				None *json.RawMessage `json:"none"`
				Some *json.RawMessage `json:"some"`
			}
			if err := json.Unmarshal(*c.Expected.Defined, &want); err != nil {
				t.Fatal(err)
			}
			value, present := got.Own().Get()
			switch {
			case want.None != nil && present:
				t.Errorf("%s: Some(%v), want None", c.Name, value)
			case want.Some != nil && !present:
				t.Errorf("%s: None, want Some", c.Name)
			case want.Some != nil && !sameClass(value, payload(t, *want.Some)):
				t.Errorf("%s: Some(%v), want a value ≈ %s", c.Name, value, *want.Some)
			}
			continue
		}
		want, err := build(t, *c.Expected.Defined)
		if err != nil {
			t.Fatal(err)
		}
		if !got.EqualBy(want, sameOwn) {
			t.Errorf("%s: the node found is not the expected one", c.Name)
		}
	}
}
