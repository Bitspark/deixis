package set_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	deixis "github.com/bitspark/deixis/core/go"
	set "github.com/bitspark/deixis/set/go"
)

func identity(member []byte) []byte { return member }

type fixture struct {
	class          string
	representation string
}

func classBytes(member fixture) []byte { return []byte(member.class) }

func sameClass(a, b fixture) bool { return a.class == b.class }

func octetEq(a, b []byte) bool { return bytes.Equal(a, b) }

func node(t *testing.T, own deixis.Option[[]byte], children ...deixis.Entry[deixis.Option[[]byte]]) deixis.Node[deixis.Option[[]byte]] {
	t.Helper()
	n, err := deixis.Compose(own, children)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func member(t *testing.T, value string) deixis.Node[deixis.Option[[]byte]] {
	t.Helper()
	return node(t, deixis.Some([]byte(value)))
}

func TestEnumerationIsSpellingOrder(t *testing.T) {
	built, err := set.Of([][]byte{[]byte("b"), []byte("a")}, identity)
	if err != nil {
		t.Fatal(err)
	}
	keys := built.Keys()
	if len(keys) != 2 || !bytes.Equal(keys[0], []byte("a")) || !bytes.Equal(keys[1], []byte("b")) {
		t.Fatalf("Keys() = %q, want [a b]", keys)
	}
}

func TestTheSecondInsertIsNotANodeThatExists(t *testing.T) {
	_, err := set.Of([][]byte{[]byte("k"), []byte("k")}, identity)
	var dup *deixis.DuplicateKeyError
	if !errors.As(err, &dup) {
		t.Fatalf("error is %T, want *DuplicateKeyError", err)
	}
	if !bytes.Equal(dup.Key, []byte("k")) {
		t.Fatalf("offending key %x, want 6b", dup.Key)
	}
}

func TestASetIsAnUnvaluedNodeOfValuedChildlessMembers(t *testing.T) {
	built, err := set.Of([][]byte{[]byte("a")}, identity)
	if err != nil {
		t.Fatal(err)
	}
	if built.Own().IsSome() {
		t.Fatal("the set node is unvalued")
	}
	m, ok := built.Get([]byte("a"))
	if value, some := m.Own().Get(); !ok || !some || !bytes.Equal(value, []byte("a")) || m.Len() != 0 {
		t.Fatal("a member is Node(Some(x), ∅) under e(x)")
	}
}

func TestRecognitionIsExactOrRefusal(t *testing.T) {
	good, err := set.Of([][]byte{[]byte("a")}, identity)
	if err != nil {
		t.Fatal(err)
	}
	unvalued := deixis.None[[]byte]()
	child := node(t, unvalued)

	cases := []struct {
		name string
		node deixis.Node[deixis.Option[[]byte]]
		want set.Reason
	}{
		{"a built set", good, ""},
		// The empty set has nothing to be incoherent.
		{"the empty set", node(t, unvalued), ""},
		// Key does not equal the member's bytes. Refused, never re-keyed.
		{"mis-keyed", node(t, unvalued, deixis.Entry[deixis.Option[[]byte]]{Key: []byte("x"), Node: member(t, "y")}), set.MisKeyed},
		// An unvalued child is the image of a Struct child.
		{"struct member", node(t, unvalued, deixis.Entry[deixis.Option[[]byte]]{Key: []byte("k"), Node: child}), set.StructMember},
		// A valued node without children is well-formed deixis and simply not a set.
		{"leaf node", member(t, "k"), set.LeafNode},
		// New in N: the set node carries a value beside its members.
		{"valued set node", node(t, deixis.Some([]byte("v")), deixis.Entry[deixis.Option[[]byte]]{Key: []byte("a"), Node: member(t, "a")}), set.ValuedSetNode},
		// Some of the empty value is a value: a presence check written as truthiness fails here.
		{"valued set node, empty value", node(t, deixis.Some([]byte{}), deixis.Entry[deixis.Option[[]byte]]{Key: []byte("a"), Node: member(t, "a")}), set.ValuedSetNode},
		// New in N: a member with a child, even an unvalued one.
		{"member with children", node(t, unvalued, deixis.Entry[deixis.Option[[]byte]]{Key: []byte("a"), Node: node(t, deixis.Some([]byte("a")), deixis.Entry[deixis.Option[[]byte]]{Key: []byte("k"), Node: child})}), set.MemberWithChildren},
	}
	for _, c := range cases {
		reason, ok := set.Recognize(c.node, identity)
		if ok != (c.want == "") || reason != c.want {
			t.Errorf("%s: Recognize = (%q, %v), want %q", c.name, reason, ok, c.want)
		}
		if set.IsSet(c.node, identity) != (c.want == "") {
			t.Errorf("%s: IsSet disagrees with Recognize", c.name)
		}
	}
}

func TestASetOfHandlersByRegisteredName(t *testing.T) {
	// The point of the slot-member form: members need not be data. A set of handlers,
	// self-keyed by registered name — membership and idempotence by name alone.
	type handler struct {
		name string
		run  func() int
	}
	byName := func(h handler) []byte { return []byte(h.name) }

	built, err := set.Of([]handler{
		{name: "route", run: func() int { return 42 }},
		{name: "other", run: func() int { return 7 }},
	}, byName)
	if err != nil {
		t.Fatal(err)
	}
	if !set.IsSet(built, byName) {
		t.Fatal("a built set must recognize")
	}
	// A different closure — membership is by name.
	if !set.Contains(built, handler{name: "route", run: func() int { return 0 }}, byName) {
		t.Fatal("membership is by name")
	}

	route, ok := built.Get([]byte("route"))
	if !ok {
		t.Fatal("route must be present")
	}
	stored, ok := route.Own().Get()
	if !ok || stored.run() != 42 {
		t.Fatal("the stored closure must come back callable")
	}

	// Two handlers with one name are one member; the floor refuses the second.
	_, err = set.Of([]handler{
		{name: "route", run: func() int { return 1 }},
		{name: "route", run: func() int { return 2 }},
	}, byName)
	var dup *deixis.DuplicateKeyError
	if !errors.As(err, &dup) || !bytes.Equal(dup.Key, []byte("route")) {
		t.Fatalf("a shared name must refuse with the shared key, got %v", err)
	}
}

// ----- vector replay (../../vectors/set.json, ../../vectors/node-set.json) ------------
//
// set.json is spelled in the previous model and is read through the embedding E of
// ADR 0009 §10.1, which is what node-set.json's five embedded laws say: each re-reads
// one kind of set.json case through E and pins the counts it re-reads. node-set.json's
// own cases are spelled in N, with own values spelled by the case's member encoder.

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex %q: %v", s, err)
	}
	return b
}

// entries decodes a [[hexKey, node], …] list in authored order; the construction owns
// sorting and duplicate refusal.
func entries[T any](t *testing.T, raw json.RawMessage, child func(json.RawMessage) (deixis.Node[deixis.Option[T]], error)) ([]deixis.Entry[deixis.Option[T]], error) {
	t.Helper()
	var pairs []json.RawMessage
	if err := json.Unmarshal(raw, &pairs); err != nil {
		t.Fatalf("children are [hexKey, node] pairs: %v", err)
	}
	out := make([]deixis.Entry[deixis.Option[T]], 0, len(pairs))
	for _, rawPair := range pairs {
		var pair []json.RawMessage
		if err := json.Unmarshal(rawPair, &pair); err != nil || len(pair) != 2 {
			t.Fatalf("a child is a [hexKey, node] pair: %v", err)
		}
		var key string
		if err := json.Unmarshal(pair[0], &key); err != nil {
			t.Fatalf("child key: %v", err)
		}
		n, err := child(pair[1])
		if err != nil {
			return nil, err
		}
		out = append(out, deixis.Entry[deixis.Option[T]]{Key: mustHex(t, key), Node: n})
	}
	return out, nil
}

// embed constructs E(n) from a previous-model spelling, leaf payloads parsed by member.
func embed[T any](t *testing.T, raw json.RawMessage, member func(json.RawMessage) T) (deixis.Node[deixis.Option[T]], error) {
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
		return deixis.Compose(deixis.Some(member(*spelling.Leaf)), nil)
	case spelling.Struct != nil:
		children, err := entries(t, *spelling.Struct, func(c json.RawMessage) (deixis.Node[deixis.Option[T]], error) { return embed(t, c, member) })
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		return deixis.Compose(deixis.None[T](), children)
	default:
		t.Fatal(`a previous-model node is {"leaf": ...} or {"struct": ...}`)
		panic("unreachable")
	}
}

// build constructs a node from its N[T] spelling, own values parsed by member.
func build[T any](t *testing.T, raw json.RawMessage, member func(json.RawMessage) T) (deixis.Node[deixis.Option[T]], error) {
	t.Helper()
	var spelling struct {
		Own *struct {
			None *json.RawMessage `json:"none"`
			Some *json.RawMessage `json:"some"`
		} `json:"own"`
		Children *json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &spelling); err != nil || spelling.Own == nil || spelling.Children == nil {
		t.Fatalf(`a node is {"own": ..., "children": [...]}: %s`, raw)
	}
	own := deixis.None[T]()
	switch {
	case spelling.Own.Some != nil && spelling.Own.None == nil:
		own = deixis.Some(member(*spelling.Own.Some))
	case spelling.Own.None != nil && spelling.Own.Some == nil:
	default:
		t.Fatalf("an own value is exactly one of none and some: %s", raw)
	}
	children, err := entries(t, *spelling.Children, func(c json.RawMessage) (deixis.Node[deixis.Option[T]], error) { return build(t, c, member) })
	if err != nil {
		return deixis.Node[deixis.Option[T]]{}, err
	}
	return deixis.Compose(own, children)
}

type setCase struct {
	Name    string            `json:"name"`
	Member  string            `json:"member"`
	Kind    string            `json:"kind"`
	Members []json.RawMessage `json:"members"`
	Node    json.RawMessage   `json:"node"`
	Error   string            `json:"error"`
	Key     string            `json:"key"`
	Valid   bool              `json:"valid"`
	Reason  string            `json:"reason"`
	Queries []struct {
		Value json.RawMessage `json:"value"`
		In    bool            `json:"in"`
	} `json:"queries"`
	Left  json.RawMessage `json:"left"`
	Right json.RawMessage `json:"right"`
	Equal bool            `json:"equal"`
}

func runCase[T any](
	t *testing.T,
	c setCase,
	construct func(*testing.T, json.RawMessage, func(json.RawMessage) T) (deixis.Node[deixis.Option[T]], error),
	member func(json.RawMessage) T,
	e func(T) []byte,
	eq func(T, T) bool,
) {
	t.Helper()
	parseMembers := func() []T {
		out := make([]T, len(c.Members))
		for i, raw := range c.Members {
			out[i] = member(raw)
		}
		return out
	}

	switch c.Kind {
	case "form":
		built, err := set.Of(parseMembers(), e)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		expected, err := construct(t, c.Node, member)
		if err != nil {
			t.Fatalf("%s: expected node: %v", c.Name, err)
		}
		if !built.EqualBy(expected, optionEqual(eq)) || !expected.EqualBy(built, optionEqual(eq)) {
			t.Errorf("%s: form", c.Name)
		}
		if !set.IsSet(built, e) {
			t.Errorf("%s: a built set must recognize", c.Name)
		}
	case "duplicate":
		if c.Error != "duplicate_key" {
			t.Fatalf("%s: unknown rejection code %q", c.Name, c.Error)
		}
		_, err := set.Of(parseMembers(), e)
		var dup *deixis.DuplicateKeyError
		if !errors.As(err, &dup) {
			t.Errorf("%s: error is %T, want *DuplicateKeyError", c.Name, err)
			return
		}
		if !bytes.Equal(dup.Key, mustHex(t, c.Key)) {
			t.Errorf("%s: offending key %x, want %s", c.Name, dup.Key, c.Key)
		}
	case "recognize":
		n, err := construct(t, c.Node, member)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		reason, ok := set.Recognize(n, e)
		if ok != c.Valid {
			t.Errorf("%s: recognized = %v, want %v", c.Name, ok, c.Valid)
		}
		// A refusal pins its reason only on a node with exactly one defect; a case
		// without one is judged on the verdict alone.
		if !c.Valid && c.Reason != "" && string(reason) != c.Reason {
			t.Errorf("%s: reason = %q, want %q", c.Name, reason, c.Reason)
		}
	case "membership":
		built, err := set.Of(parseMembers(), e)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		for _, query := range c.Queries {
			if got := set.Contains(built, member(query.Value), e); got != query.In {
				t.Errorf("%s: query = %v, want %v", c.Name, got, query.In)
			}
		}
	case "identity":
		left, err := construct(t, c.Left, member)
		if err != nil {
			t.Fatalf("%s: left: %v", c.Name, err)
		}
		right, err := construct(t, c.Right, member)
		if err != nil {
			t.Fatalf("%s: right: %v", c.Name, err)
		}
		if left.EqualBy(right, optionEqual(eq)) != c.Equal || right.EqualBy(left, optionEqual(eq)) != c.Equal {
			t.Errorf("%s: identity", c.Name)
		}
	default:
		t.Fatalf("%s: unknown kind %q", c.Name, c.Kind)
	}
}

func runSorted(t *testing.T, c setCase, construct string) {
	t.Helper()
	bytesMember := func(raw json.RawMessage) []byte {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			t.Fatalf("bytes member: %v", err)
		}
		return mustHex(t, s)
	}
	classMember := func(raw json.RawMessage) fixture {
		var leaf struct {
			Class          *string `json:"class"`
			Representation *string `json:"representation"`
		}
		if err := json.Unmarshal(raw, &leaf); err != nil || leaf.Class == nil || leaf.Representation == nil {
			t.Fatalf("class member: %v", err)
		}
		return fixture{class: *leaf.Class, representation: *leaf.Representation}
	}
	switch c.Member {
	case "bytes":
		if construct == "embed" {
			runCase(t, c, embed[[]byte], bytesMember, identity, octetEq)
		} else {
			runCase(t, c, build[[]byte], bytesMember, identity, octetEq)
		}
	case "class":
		if construct == "embed" {
			runCase(t, c, embed[fixture], classMember, classBytes, sameClass)
		} else {
			runCase(t, c, build[fixture], classMember, classBytes, sameClass)
		}
	default:
		t.Fatalf("unknown member sort %q", c.Member)
	}
}

type setFile struct {
	Profile string    `json:"profile"`
	Form    string    `json:"form"`
	Cases   []setCase `json:"cases"`
}

func readSetFile(t *testing.T, name string) setFile {
	t.Helper()
	data, err := os.ReadFile("../../vectors/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var file setFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if file.Profile != "deixis-set-v1" || file.Form != "slot-member" {
		t.Fatalf("%s: profile/form = %q/%q", name, file.Profile, file.Form)
	}
	return file
}

// pin is one embedded law of node-set.json: the kind of set.json case it re-reads and
// the counts it pins. A replayer must refuse when the source's counts differ.
type pin struct {
	Name       string         `json:"name"`
	Kind       string         `json:"kind"`
	Source     string         `json:"source"`
	SourceKind string         `json:"source_kind"`
	Cases      int            `json:"source_cases"`
	Valid      *int           `json:"source_valid"`
	Refused    *int           `json:"source_refused"`
	Reasons    map[string]int `json:"source_reasons"`
	Queries    *int           `json:"source_queries"`
	In         *int           `json:"source_in"`
	Out        *int           `json:"source_out"`
	Equal      *int           `json:"source_equal"`
	NotEqual   *int           `json:"source_not_equal"`
}

func checkPin(t *testing.T, p pin, source []setCase) {
	t.Helper()
	var cases, valid, refused, queries, in, out, equal, notEqual int
	reasons := map[string]int{}
	for _, c := range source {
		if c.Kind != p.SourceKind {
			continue
		}
		cases++
		if c.Valid {
			valid++
		} else if c.Kind == "recognize" {
			refused++
			reasons[c.Reason]++
		}
		for _, q := range c.Queries {
			queries++
			if q.In {
				in++
			} else {
				out++
			}
		}
		if c.Kind == "identity" {
			if c.Equal {
				equal++
			} else {
				notEqual++
			}
		}
	}
	mismatch := cases != p.Cases
	for _, pair := range []struct {
		pinned *int
		got    int
	}{{p.Valid, valid}, {p.Refused, refused}, {p.Queries, queries}, {p.In, in}, {p.Out, out}, {p.Equal, equal}, {p.NotEqual, notEqual}} {
		if pair.pinned != nil && *pair.pinned != pair.got {
			mismatch = true
		}
	}
	if p.Reasons != nil {
		for reason, count := range p.Reasons {
			if reasons[reason] != count {
				mismatch = true
			}
		}
		for reason, count := range reasons {
			if p.Reasons[reason] != count {
				mismatch = true
			}
		}
	}
	if mismatch {
		t.Fatalf("%s: set.json's %s cases no longer match the counts the law pins — "+
			"an erratum to set.json, and the law must be re-checked by a person", p.Name, p.SourceKind)
	}
}

func TestSetVectorsReplayThroughTheEmbedding(t *testing.T) {
	laws := readSetFile(t, "node-set.json")
	source := readSetFile(t, "set.json")

	var pins []pin
	data, err := os.ReadFile("../../vectors/node-set.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Cases []pin `json:"cases"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	for _, p := range raw.Cases {
		if p.Kind == "embedded" {
			if p.Source != "set.json" {
				t.Fatalf("%s: a law over %q, which this replay does not know", p.Name, p.Source)
			}
			pins = append(pins, p)
		}
	}

	covered := map[string]bool{}
	for _, p := range pins {
		checkPin(t, p, source.Cases)
		covered[p.SourceKind] = true
	}
	for _, c := range source.Cases {
		if !covered[c.Kind] {
			t.Fatalf("%s: set.json's %q cases have no law in node-set.json", c.Name, c.Kind)
		}
		runSorted(t, c, "embed")
	}

	nCases := 0
	for _, c := range laws.Cases {
		if c.Kind == "embedded" {
			continue
		}
		nCases++
		runSorted(t, c, "build")
	}
	if len(pins) != 5 || nCases < 4 {
		t.Fatalf("node-set.json shrank? %d laws, %d cases", len(pins), nCases)
	}
}

func optionEqual[T any](eq func(T, T) bool) func(deixis.Option[T], deixis.Option[T]) bool {
	return func(a, b deixis.Option[T]) bool {
		av, ap := a.Get()
		bv, bp := b.Get()
		return ap == bp && (!ap || eq(av, bv))
	}
}
