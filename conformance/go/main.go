// Thin conformance CLI for the Go implementation — tools/conformance/README.md.
// Reads NDJSON requests on stdin, answers each with this implementation's own judgment
// on stdout. Owns no vectors and no expectations.
//
// The node.* operations that are not accessors of the floor — replacement, attachment,
// split and plug, cuts, and the embedding of the previous model — are derived here
// through the core's accessors (Compose, Decompose, Own, Get, At), which is what
// docs/PATH.md claims they are: derivable, and no methods of the floor.
package main

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	deixis "github.com/bitspark/deixis/core/go"
	pos "github.com/bitspark/deixis/pos/go"
	set "github.com/bitspark/deixis/set/go"
)

type fixture struct {
	class          string
	representation string
}

// sort is a member sort: how a spelled payload is read and written, its encoder e and
// its equality ≈.
type sort[T any] struct {
	member func(json.RawMessage) (T, error)
	spell  func(T) any
	e      func(T) []byte
	eq     func(T, T) bool
}

var bytesSort = sort[[]byte]{
	member: func(raw json.RawMessage) ([]byte, error) {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		return hex.DecodeString(s)
	},
	spell: func(member []byte) any { return hex.EncodeToString(member) },
	e:     func(member []byte) []byte { return member },
	eq:    bytes.Equal,
}

var classSort = sort[fixture]{
	member: func(raw json.RawMessage) (fixture, error) {
		var payload struct {
			Class          *string `json:"class"`
			Representation *string `json:"representation"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return fixture{}, err
		}
		if payload.Class == nil || payload.Representation == nil {
			return fixture{}, errors.New("class member needs class and representation")
		}
		return fixture{class: *payload.Class, representation: *payload.Representation}, nil
	},
	spell: func(member fixture) any {
		return map[string]string{"class": member.class, "representation": member.representation}
	},
	e:  func(member fixture) []byte { return []byte(member.class) },
	eq: func(a, b fixture) bool { return a.class == b.class },
}

type attachment struct {
	Key     string          `json:"key"`
	Subtree json.RawMessage `json:"subtree"`
}

type request struct {
	ID       string            `json:"id"`
	Op       string            `json:"op"`
	Embedded bool              `json:"embedded"`
	Left     json.RawMessage   `json:"left"`
	Right    json.RawMessage   `json:"right"`
	Node     json.RawMessage   `json:"node"`
	Position string            `json:"position"`
	Bytes    string            `json:"bytes"`
	Member   string            `json:"member"`
	Members  []json.RawMessage `json:"members"`
	Queries  []json.RawMessage `json:"queries"`
	Tree     json.RawMessage   `json:"tree"`
	Path     []string          `json:"path"`
	First    json.RawMessage   `json:"first"`
	Then     []string          `json:"then"`
	Parent   []string          `json:"parent"`
	Key      string            `json:"key"`
	Subtree  json.RawMessage   `json:"subtree"`
	Second   *attachment       `json:"second"`
	Parts    json.RawMessage   `json:"parts"`
	Context  json.RawMessage   `json:"context"`
	Paths    [][]string        `json:"paths"`
	Skeleton json.RawMessage   `json:"skeleton"`
	Subtrees []json.RawMessage `json:"subtrees"`
	Old      json.RawMessage   `json:"old"`
}

// --- reading spellings ----------------------------------------------------------------

// pairs decodes a [[hexKey, x], …] list in authored order.
func pairs(raw json.RawMessage) ([][]byte, []json.RawMessage, error) {
	var list []json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, nil, err
	}
	keys := make([][]byte, 0, len(list))
	values := make([]json.RawMessage, 0, len(list))
	for _, rawPair := range list {
		var pair []json.RawMessage
		if err := json.Unmarshal(rawPair, &pair); err != nil {
			return nil, nil, err
		}
		if len(pair) != 2 {
			return nil, nil, errors.New("a child is a [hexKey, node] pair")
		}
		var keyHex string
		if err := json.Unmarshal(pair[0], &keyHex); err != nil {
			return nil, nil, err
		}
		key, err := hex.DecodeString(keyHex)
		if err != nil {
			return nil, nil, err
		}
		keys = append(keys, key)
		values = append(values, pair[1])
	}
	return keys, values, nil
}

func decodePath(raw []string) ([][]byte, error) {
	path := make([][]byte, len(raw))
	for i, key := range raw {
		b, err := hex.DecodeString(key)
		if err != nil {
			return nil, err
		}
		path[i] = b
	}
	return path, nil
}

type spelledNode struct {
	Own *struct {
		None *json.RawMessage `json:"none"`
		Some *json.RawMessage `json:"some"`
	} `json:"own"`
	Children *json.RawMessage `json:"children"`
	Hole     *json.RawMessage `json:"hole"`
}

// parse reads an N[T] spelling, {"own": …, "children": […]}. With holes non-nil, a
// {"hole": {}} is admitted at any position: it is read as Node(None, ∅), which the
// caller replaces, and its path is recorded.
func parse[T any](raw json.RawMessage, s sort[T], at [][]byte, holes *[][][]byte) (deixis.Node[deixis.Option[T]], error) {
	var spelling spelledNode
	if err := json.Unmarshal(raw, &spelling); err != nil {
		return deixis.Node[deixis.Option[T]]{}, err
	}
	if spelling.Hole != nil {
		if holes == nil || spelling.Own != nil || spelling.Children != nil {
			return deixis.Node[deixis.Option[T]]{}, errors.New("a hole where no hole is admitted")
		}
		*holes = append(*holes, append([][]byte{}, at...))
		return deixis.Node[deixis.Option[T]]{}, nil
	}
	if spelling.Own == nil || spelling.Children == nil {
		return deixis.Node[deixis.Option[T]]{}, errors.New(`a node is {"own": …, "children": […]}`)
	}
	own := deixis.None[T]()
	switch {
	case spelling.Own.Some != nil && spelling.Own.None == nil:
		value, err := s.member(*spelling.Own.Some)
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		own = deixis.Some(value)
	case spelling.Own.None != nil && spelling.Own.Some == nil:
	default:
		return deixis.Node[deixis.Option[T]]{}, errors.New("an own value is exactly one of none and some")
	}
	keys, values, err := pairs(*spelling.Children)
	if err != nil {
		return deixis.Node[deixis.Option[T]]{}, err
	}
	children := make([]deixis.Entry[deixis.Option[T]], len(keys))
	for i := range keys {
		child, err := parse(values[i], s, append(append([][]byte{}, at...), keys[i]), holes)
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		children[i] = deixis.Entry[deixis.Option[T]]{Key: keys[i], Node: child}
	}
	return deixis.Compose(own, children)
}

// embed reads a previous-model spelling, {"leaf": payload} or {"struct": […]}, through
// the embedding E of ADR 0009 §10.1: E(Leaf(t)) = Node(Some(t), ∅) and
// E(Struct(m)) = Node(None, k ↦ E(m(k))).
func embed[T any](raw json.RawMessage, s sort[T]) (deixis.Node[deixis.Option[T]], error) {
	var spelling struct {
		Leaf   *json.RawMessage `json:"leaf"`
		Struct *json.RawMessage `json:"struct"`
	}
	if err := json.Unmarshal(raw, &spelling); err != nil {
		return deixis.Node[deixis.Option[T]]{}, err
	}
	switch {
	case spelling.Leaf != nil && spelling.Struct == nil:
		value, err := s.member(*spelling.Leaf)
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		return deixis.Compose(deixis.Some(value), nil)
	case spelling.Struct != nil && spelling.Leaf == nil:
		keys, values, err := pairs(*spelling.Struct)
		if err != nil {
			return deixis.Node[deixis.Option[T]]{}, err
		}
		children := make([]deixis.Entry[deixis.Option[T]], len(keys))
		for i := range keys {
			child, err := embed(values[i], s)
			if err != nil {
				return deixis.Node[deixis.Option[T]]{}, err
			}
			children[i] = deixis.Entry[deixis.Option[T]]{Key: keys[i], Node: child}
		}
		return deixis.Compose(deixis.None[T](), children)
	default:
		return deixis.Node[deixis.Option[T]]{}, errors.New(`a previous-model node is {"leaf": …} or {"struct": …}`)
	}
}

// read reads a node field of a request: in the previous model through E when the
// request says embedded, and in N otherwise.
func read[T any](req request, raw json.RawMessage, s sort[T]) (deixis.Node[deixis.Option[T]], error) {
	if req.Embedded {
		return embed(raw, s)
	}
	return parse(raw, s, nil, nil)
}

// --- writing spellings ----------------------------------------------------------------

func spellOwn[T any](own deixis.Option[T], s sort[T]) any {
	if value, ok := own.Get(); ok {
		return map[string]any{"some": s.spell(value)}
	}
	return map[string]any{"none": map[string]any{}}
}

// spell writes a node in N, with a hole at every path of holes.
func spell[T any](n deixis.Node[deixis.Option[T]], s sort[T], at [][]byte, holes [][][]byte) any {
	for _, hole := range holes {
		if samePath(hole, at) {
			return map[string]any{"hole": map[string]any{}}
		}
	}
	own, children := n.Decompose()
	spelled := make([]any, len(children))
	for i, child := range children {
		spelled[i] = []any{hex.EncodeToString(child.Key), spell(child.Node, s, append(append([][]byte{}, at...), child.Key), holes)}
	}
	return map[string]any{"own": spellOwn(own, s), "children": spelled}
}

func samePath(a, b [][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !bytes.Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

func isPrefix(p, q [][]byte) bool {
	return len(p) <= len(q) && samePath(p, q[:len(p)])
}

func defined(value any) map[string]any { return map[string]any{"defined": value} }

var undefined = map[string]any{"undefined": map[string]any{}}

// --- the derived operations -----------------------------------------------------------

// replace is n[p := s]: defined exactly when p ∈ paths(n). Every untouched own value and
// sibling on the way is retained, because each step recomposes the node's own parts.
func replace[T any](n deixis.Node[T], path [][]byte, s deixis.Node[T]) (deixis.Node[T], bool, error) {
	if len(path) == 0 {
		return s, true, nil
	}
	child, ok := n.Get(path[0])
	if !ok {
		return deixis.Node[T]{}, false, nil
	}
	replaced, ok, err := replace(child, path[1:], s)
	if !ok || err != nil {
		return deixis.Node[T]{}, ok, err
	}
	own, children := n.Decompose()
	for i := range children {
		if bytes.Equal(children[i].Key, path[0]) {
			children[i].Node = replaced
		}
	}
	node, err := deixis.Compose(own, children)
	return node, err == nil, err
}

// attach is attach(A, p, k, B) of ADR 0009 §8: A[p := compose((o, m ∪ {k ↦ B}))] with
// (o, m) = decompose(at(A, p)), defined exactly when p ∈ paths(A) and p ‖ k ∉ paths(A).
func attach[T any](a deixis.Node[T], parent [][]byte, key []byte, b deixis.Node[T]) (deixis.Node[T], bool, error) {
	at, ok := a.At(parent)
	if !ok {
		return deixis.Node[T]{}, false, nil
	}
	if _, occupied := at.Get(key); occupied {
		return deixis.Node[T]{}, false, nil
	}
	own, children := at.Decompose()
	grown, err := deixis.Compose(own, append(children, deixis.Entry[T]{Key: key, Node: b}))
	if err != nil {
		return deixis.Node[T]{}, false, err
	}
	return replace(a, parent, grown)
}

// unembed is E's inverse, defined exactly on trees whose valued positions have no
// children.
func unembed[T any](n deixis.Node[deixis.Option[T]], s sort[T]) (any, bool) {
	own, children := n.Decompose()
	if value, ok := own.Get(); ok {
		if len(children) != 0 {
			return nil, false
		}
		return map[string]any{"leaf": s.spell(value)}, true
	}
	spelled := make([]any, len(children))
	for i, child := range children {
		old, ok := unembed(child.Node, s)
		if !ok {
			return nil, false
		}
		spelled[i] = []any{hex.EncodeToString(child.Key), old}
	}
	return map[string]any{"struct": spelled}, true
}

func result[T any](n deixis.Node[deixis.Option[T]], ok bool, err error, s sort[T]) (map[string]any, error) {
	if err != nil {
		return nil, err
	}
	if !ok {
		return undefined, nil
	}
	return defined(spell(n, s, nil, nil)), nil
}

// handleNode serves the node.* operations over the fixture setoid.
func handleNode(req request) (map[string]any, error) {
	s := classSort
	tree := func() (deixis.Node[deixis.Option[fixture]], error) { return parse(req.Tree, s, nil, nil) }

	switch req.Op {
	case "node.at", "node.valueAt":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		path, err := decodePath(req.Path)
		if err != nil {
			return nil, err
		}
		found, ok := n.At(path)
		if !ok {
			return undefined, nil
		}
		if req.Op == "node.valueAt" {
			return defined(spellOwn(found.Own(), s)), nil
		}
		return defined(spell(found, s, nil, nil)), nil
	case "node.atCompose":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		var firstRaw []string
		if err := json.Unmarshal(req.First, &firstRaw); err != nil {
			return nil, err
		}
		first, err := decodePath(firstRaw)
		if err != nil {
			return nil, err
		}
		then, err := decodePath(req.Then)
		if err != nil {
			return nil, err
		}
		stage, ok := n.At(first)
		if !ok {
			return undefined, nil
		}
		found, ok := stage.At(then)
		return result(found, ok, nil, s)
	case "node.attach":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		parent, err := decodePath(req.Parent)
		if err != nil {
			return nil, err
		}
		key, err := hex.DecodeString(req.Key)
		if err != nil {
			return nil, err
		}
		subtree, err := parse(req.Subtree, s, nil, nil)
		if err != nil {
			return nil, err
		}
		grown, ok, err := attach(n, parent, key, subtree)
		return result(grown, ok, err, s)
	case "node.attachCommute":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		parent, err := decodePath(req.Parent)
		if err != nil {
			return nil, err
		}
		var first attachment
		if err := json.Unmarshal(req.First, &first); err != nil {
			return nil, err
		}
		if req.Second == nil {
			return nil, errors.New("attachCommute needs first and second")
		}
		steps := [2]attachment{first, *req.Second}
		keys := [2][]byte{}
		subtrees := [2]deixis.Node[deixis.Option[fixture]]{}
		for i, step := range steps {
			if keys[i], err = hex.DecodeString(step.Key); err != nil {
				return nil, err
			}
			if subtrees[i], err = parse(step.Subtree, s, nil, nil); err != nil {
				return nil, err
			}
		}
		orders := map[string][2]int{"forward": {0, 1}, "reverse": {1, 0}}
		response := map[string]any{}
		for name, order := range orders {
			once, ok, err := attach(n, parent, keys[order[0]], subtrees[order[0]])
			if err != nil {
				return nil, err
			}
			if ok {
				once, ok, err = attach(once, parent, keys[order[1]], subtrees[order[1]])
			}
			if response[name], err = result(once, ok, err, s); err != nil {
				return nil, err
			}
		}
		return response, nil
	case "node.decompose":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		own, children := n.Decompose()
		spelled := make([]any, len(children))
		for i, child := range children {
			spelled[i] = []any{hex.EncodeToString(child.Key), spell(child.Node, s, nil, nil)}
		}
		return defined(map[string]any{"parts": map[string]any{"own": spellOwn(own, s), "children": spelled}}), nil
	case "node.compose":
		n, err := parse(req.Parts, s, nil, nil)
		if err != nil {
			return duplicateOr(err)
		}
		return defined(spell(n, s, nil, nil)), nil
	case "node.split":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		path, err := decodePath(req.Path)
		if err != nil {
			return nil, err
		}
		found, ok := n.At(path)
		if !ok {
			return undefined, nil
		}
		return defined(map[string]any{
			"context": spell(n, s, nil, [][][]byte{path}),
			"subtree": spell(found, s, nil, nil),
		}), nil
	case "node.plug":
		var holes [][][]byte
		context, err := parse(req.Context, s, nil, &holes)
		if err != nil {
			return nil, err
		}
		if len(holes) != 1 {
			return nil, fmt.Errorf("a context has exactly one hole, not %d", len(holes))
		}
		subtree, err := parse(req.Subtree, s, nil, nil)
		if err != nil {
			return nil, err
		}
		plugged, ok, err := replace(context, holes[0], subtree)
		return result(plugged, ok, err, s)
	case "node.cut":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		paths := make([][][]byte, len(req.Paths))
		subtrees := make([]any, len(req.Paths))
		for i, raw := range req.Paths {
			if paths[i], err = decodePath(raw); err != nil {
				return nil, err
			}
			found, ok := n.At(paths[i])
			if !ok {
				return undefined, nil
			}
			subtrees[i] = []any{raw, spell(found, s, nil, nil)}
		}
		// cut_F is defined for a prefix-free F: no path of F is a prefix of another.
		for i := range paths {
			for j := range paths {
				if i != j && isPrefix(paths[i], paths[j]) {
					return undefined, nil
				}
			}
		}
		return defined(map[string]any{"skeleton": spell(n, s, nil, paths), "subtrees": subtrees}), nil
	case "node.rebuild":
		var holes [][][]byte
		skeleton, err := parse(req.Skeleton, s, nil, &holes)
		if err != nil {
			return nil, err
		}
		keys, values, err := subtreeMap(req.Subtrees)
		if err != nil {
			return nil, err
		}
		// The supplied subtrees have exactly the skeleton's holes as their domain.
		if len(keys) != len(holes) {
			return undefined, nil
		}
		for _, key := range keys {
			found := false
			for _, hole := range holes {
				found = found || samePath(key, hole)
			}
			if !found {
				return undefined, nil
			}
		}
		rebuilt := skeleton
		for i := range keys {
			subtree, err := parse(values[i], s, nil, nil)
			if err != nil {
				return nil, err
			}
			var ok bool
			if rebuilt, ok, err = replace(rebuilt, keys[i], subtree); !ok || err != nil {
				return result(rebuilt, ok, err, s)
			}
		}
		return defined(spell(rebuilt, s, nil, nil)), nil
	case "node.embed":
		n, err := embed(req.Old, s)
		if err != nil {
			return duplicateOr(err)
		}
		return defined(spell(n, s, nil, nil)), nil
	case "node.unembed":
		n, err := tree()
		if err != nil {
			return nil, err
		}
		old, ok := unembed(n, s)
		if !ok {
			return undefined, nil
		}
		return defined(old), nil
	}
	return map[string]any{"error": "unsupported"}, nil
}

// subtreeMap decodes a cut's subtrees, [[path, node], …], a path being a list of hex
// keys.
func subtreeMap(raw []json.RawMessage) ([][][]byte, []json.RawMessage, error) {
	keys := make([][][]byte, len(raw))
	values := make([]json.RawMessage, len(raw))
	for i, rawPair := range raw {
		var pair []json.RawMessage
		if err := json.Unmarshal(rawPair, &pair); err != nil {
			return nil, nil, err
		}
		if len(pair) != 2 {
			return nil, nil, errors.New("a subtree is a [path, node] pair")
		}
		var path []string
		if err := json.Unmarshal(pair[0], &path); err != nil {
			return nil, nil, err
		}
		decoded, err := decodePath(path)
		if err != nil {
			return nil, nil, err
		}
		keys[i] = decoded
		values[i] = pair[1]
	}
	return keys, values, nil
}

// duplicateOr maps a build/construction error to the protocol's refusal response, or
// fails hard on anything else (a malformed request is a harness defect).
func duplicateOr(err error) (map[string]any, error) {
	var dup *deixis.DuplicateKeyError
	if errors.As(err, &dup) {
		return map[string]any{"error": "duplicate_key", "key": hex.EncodeToString(dup.Key)}, nil
	}
	return nil, err
}

func handleSet[T any](req request, s sort[T]) (map[string]any, error) {
	parseMembers := func(raws []json.RawMessage) ([]T, error) {
		out := make([]T, len(raws))
		for i, raw := range raws {
			member, err := s.member(raw)
			if err != nil {
				return nil, err
			}
			out[i] = member
		}
		return out, nil
	}

	switch req.Op {
	case "set.form":
		members, err := parseMembers(req.Members)
		if err != nil {
			return nil, err
		}
		built, err := set.Of(members, s.e)
		if err != nil {
			return duplicateOr(err)
		}
		expected, err := read(req, req.Node, s)
		if err != nil {
			return duplicateOr(err)
		}
		return map[string]any{
			"equal":      built.EqualBy(expected, optionEqual(s.eq)) && expected.EqualBy(built, optionEqual(s.eq)),
			"recognized": set.IsSet(built, s.e),
		}, nil
	case "set.recognize":
		node, err := read(req, req.Node, s)
		if err != nil {
			return duplicateOr(err)
		}
		reason, ok := set.Recognize(node, s.e)
		if ok {
			return map[string]any{"isSet": true}, nil
		}
		return map[string]any{"isSet": false, "reason": string(reason)}, nil
	case "set.membership":
		members, err := parseMembers(req.Members)
		if err != nil {
			return nil, err
		}
		built, err := set.Of(members, s.e)
		if err != nil {
			return duplicateOr(err)
		}
		in := make([]bool, len(req.Queries))
		for i, raw := range req.Queries {
			query, err := s.member(raw)
			if err != nil {
				return nil, err
			}
			in[i] = set.Contains(built, query, s.e)
		}
		return map[string]any{"in": in}, nil
	case "set.identity":
		left, err := read(req, req.Left, s)
		if err != nil {
			return nil, err
		}
		right, err := read(req, req.Right, s)
		if err != nil {
			return nil, err
		}
		return map[string]any{"equal": left.EqualBy(right, optionEqual(s.eq))}, nil
	}
	return map[string]any{"error": "unsupported"}, nil
}

func handle(req request) (map[string]any, error) {
	switch req.Op {
	case "required.equal", "required.roundtrip", "required.at", "required.valueAt", "required.attach":
		return handleRequired(req)
	case "core.equal":
		left, err := read(req, req.Left, classSort)
		if err != nil {
			return nil, err
		}
		right, err := read(req, req.Right, classSort)
		if err != nil {
			return nil, err
		}
		return map[string]any{"equal": left.EqualBy(right, optionEqual(classSort.eq))}, nil
	case "core.build":
		if _, err := read(req, req.Node, classSort); err != nil {
			return duplicateOr(err)
		}
		return map[string]any{"ok": true}, nil
	case "pos.key":
		var position uint64
		if _, err := fmt.Sscan(req.Position, &position); err != nil {
			return nil, err
		}
		return map[string]any{"key": hex.EncodeToString(pos.Key(position))}, nil
	case "pos.isKey":
		candidate, err := hex.DecodeString(req.Bytes)
		if err != nil {
			return nil, err
		}
		return map[string]any{"isKey": pos.IsKey(candidate)}, nil
	case "set.form", "set.recognize", "set.membership", "set.identity":
		switch req.Member {
		case "bytes":
			return handleSet(req, bytesSort)
		case "class":
			return handleSet(req, classSort)
		default:
			return nil, fmt.Errorf("unknown member sort %q", req.Member)
		}
	}
	if len(req.Op) > len("node.") && req.Op[:len("node.")] == "node." {
		return handleNode(req)
	}
	return map[string]any{"error": "unsupported"}, nil
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	// A codec request carries a whole artifact or store; the buffer grows to 64 MiB.
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var envelope struct{ ID, Op string }
		if err := json.Unmarshal(line, &envelope); err != nil {
			fmt.Fprintf(os.Stderr, "malformed request: %v\n", err)
			os.Exit(1)
		}
		var response map[string]any
		var err error
		if strings.HasPrefix(envelope.Op, "mnode.") {
			response, err = handleMandatory(line)
		} else if strings.HasPrefix(envelope.Op, "binding.") {
			response, err = handleBinding(line)
		} else if strings.HasPrefix(envelope.Op, "projection.") {
			response, err = handleProjection(line)
		} else if strings.HasPrefix(envelope.Op, "codec.") {
			response, err = handleCodec(line)
		} else {
			var req request
			err = json.Unmarshal(line, &req)
			if err == nil {
				response, err = handle(req)
			}
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "request %s: %v\n", envelope.ID, err)
			os.Exit(1)
		}
		response["id"] = envelope.ID
		encoded, err := json.Marshal(response)
		if err != nil {
			fmt.Fprintf(os.Stderr, "encode: %v\n", err)
			os.Exit(1)
		}
		out.Write(encoded)
		out.WriteByte('\n')
		out.Flush()
	}
}

func optionEqual[T any](eq func(T, T) bool) func(deixis.Option[T], deixis.Option[T]) bool {
	return func(a, b deixis.Option[T]) bool {
		av, ap := a.Get()
		bv, bp := b.Get()
		return ap == bp && (!ap || eq(av, bv))
	}
}
