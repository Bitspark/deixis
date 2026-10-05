package main

// ADR 0013's scripted binding laws over the core's native Node; no vectors or expected
// results. Binding is not a deixis API: this is the scripted harness of ADR 0013 §10
// item 1. A name is bytes, preparation turns it into a request that captures the context
// and the path from the original root, and a binder is a script table that records every
// name it is asked for. Every tree is built and read through Compose, Decompose and At.
import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	deixis "github.com/bitspark/deixis/core/go"
)

// bindingRequest is a binding request: the exact name bytes and its captured scope, the
// context's origin and the cursor, a path from the original root.
type bindingRequest struct {
	name   []byte
	origin string
	at     [][]byte
}

// scriptBinder is a script table that records every name it is asked to resolve, so
// selection's noninterference is observed rather than inferred (ADR 0013 §5).
type scriptBinder struct {
	table     map[string]any
	consulted []any
}

func newScriptBinder(raw any) (*scriptBinder, error) {
	b := &scriptBinder{table: map[string]any{}, consulted: []any{}}
	for _, entry := range raw.([]any) {
		pair := entry.([]any)
		name, err := hex.DecodeString(pair[0].(string))
		if err != nil {
			return nil, err
		}
		b.table[string(name)] = pair[1]
	}
	return b, nil
}

func (b *scriptBinder) resolve(r bindingRequest) any {
	b.consulted = append(b.consulted, hex.EncodeToString(r.name))
	if outcome, ok := b.table[string(r.name)]; ok {
		return outcome
	}
	return map[string]any{"refused": "unrecognized"}
}

func bindingRead(raw any) (deixis.Node[[]byte], error) {
	s := raw.(map[string]any)
	name, err := hex.DecodeString(s["own"].(string))
	if err != nil {
		return deixis.Node[[]byte]{}, err
	}
	children := make([]deixis.Entry[[]byte], 0)
	for _, entry := range s["children"].([]any) {
		p := entry.([]any)
		child, err := bindingRead(p[1])
		if err != nil {
			return deixis.Node[[]byte]{}, err
		}
		children = append(children, deixis.Entry[[]byte]{Key: mKey(p[0]), Node: child})
	}
	return deixis.Compose(name, children)
}

// prepare is P_{γ·at}: each name becomes a request whose cursor is its path from the
// original root. Pure: it consults nothing.
func prepare(n deixis.Node[[]byte], origin string, at [][]byte) deixis.Node[bindingRequest] {
	name, children := n.Decompose()
	out := make([]deixis.Entry[bindingRequest], len(children))
	for i, entry := range children {
		cursor := append(append([][]byte{}, at...), entry.Key)
		out[i] = deixis.Entry[bindingRequest]{Key: entry.Key, Node: prepare(entry.Node, origin, cursor)}
	}
	prepared, err := deixis.Compose(bindingRequest{name: name, origin: origin, at: at}, out)
	if err != nil {
		panic(err) // the keys are a node's keys, so they are unique
	}
	return prepared
}

// bindAll is resolveAllOrFail: depth-first, a node before its children, and children in
// the core's unsigned-octet key order. It answers the first outcome that is not bound.
func bindAll(n deixis.Node[bindingRequest], b *scriptBinder) (deixis.Node[string], any) {
	r, children := n.Decompose()
	outcome := b.resolve(r)
	tagged, _ := outcome.(map[string]any)
	id, bound := tagged["bound"].(string)
	if !bound || len(tagged) != 1 {
		return deixis.Node[string]{}, outcome
	}
	out := make([]deixis.Entry[string], len(children))
	for i, entry := range children {
		child, failed := bindAll(entry.Node, b)
		if failed != nil {
			return deixis.Node[string]{}, failed
		}
		out[i] = deixis.Entry[string]{Key: entry.Key, Node: child}
	}
	tree, err := deixis.Compose(id, out)
	if err != nil {
		panic(err)
	}
	return tree, nil
}

func bindingSpell[T any](n deixis.Node[T], own func(T) any) any {
	value, children := n.Decompose()
	out := make([]any, 0, len(children))
	for _, entry := range children {
		out = append(out, []any{hex.EncodeToString(entry.Key), bindingSpell(entry.Node, own)})
	}
	return map[string]any{"own": own(value), "children": out}
}

func spellRequest(r bindingRequest) any {
	at := make([]any, len(r.at))
	for i, k := range r.at {
		at[i] = hex.EncodeToString(k)
	}
	return map[string]any{"name": hex.EncodeToString(r.name), "origin": r.origin, "at": at}
}

func bindingSide(n deixis.Node[bindingRequest], ok bool) any {
	if !ok {
		return undefined
	}
	return defined(bindingSpell(n, spellRequest))
}

func handleBinding(line []byte) (map[string]any, error) {
	var r map[string]any
	if err := json.Unmarshal(line, &r); err != nil {
		return nil, err
	}
	op := strings.TrimPrefix(r["op"].(string), "binding.")
	n, err := bindingRead(r["node"])
	if err != nil {
		return nil, err
	}
	origin := r["context"].(string)
	if op == "prepare" {
		return map[string]any{"result": bindingSpell(prepare(n, origin, nil), spellRequest)}, nil
	}
	var p [][]byte
	if raw, ok := r["path"]; ok {
		p = mPath(raw)
	}
	if op == "at-after-prepare" {
		before, beforeOK := prepare(n, origin, nil).At(p)
		selected, selectedOK := n.At(p)
		var after deixis.Node[bindingRequest]
		if selectedOK {
			after = prepare(selected, origin, p)
		}
		return map[string]any{"result": map[string]any{
			"prepare-then-select": bindingSide(before, beforeOK),
			"select-then-prepare": bindingSide(after, selectedOK),
		}}, nil
	}
	b, err := newScriptBinder(r["binder"])
	if err != nil {
		return nil, err
	}
	var outcome any
	switch op {
	case "resolve-at":
		found, ok := prepare(n, origin, nil).At(p)
		if !ok {
			// Structural absence is selection's answer; the binder is never asked.
			outcome = map[string]any{"absent": map[string]any{}}
		} else {
			outcome = b.resolve(found.Own())
		}
	case "resolve-all-or-fail":
		tree, failed := bindAll(prepare(n, origin, nil), b)
		if failed != nil {
			outcome = map[string]any{"failed": failed}
		} else {
			outcome = map[string]any{"bound-tree": bindingSpell(tree, func(id string) any { return id })}
		}
	default:
		return nil, fmt.Errorf("unknown binding operation %s", op)
	}
	return map[string]any{"result": map[string]any{"outcome": outcome, "consulted": b.consulted}}, nil
}
