package main

// ADR 0010 protocol over direct JSON payloads; no expected results or vectors.
import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	deixis "github.com/bitspark/deixis/core/go"
)

type mNode = deixis.Node[any]

var missingOwn = errors.New("missing own")

func mEqual(slot string, a, b any) bool {
	if slot == "json" {
		return reflect.DeepEqual(a, b)
	}
	if slot == "unit" {
		return true
	}
	x, y := a.(map[string]any), b.(map[string]any)
	if slot == "fixture" {
		return x["class"] == y["class"]
	}
	if slot == "option" || slot == "option-sum" {
		_, xn := x["none"]
		_, yn := y["none"]
		if xn || yn {
			return xn && yn
		}
		inner := "fixture"
		if slot == "option-sum" {
			inner = "sum"
		}
		return mEqual(inner, x["some"], y["some"])
	}
	if slot == "sum" {
		tag, inner := "right", "json"
		if _, ok := x["left"]; ok {
			tag, inner = "left", "fixture"
		}
		v, ok := y[tag]
		return ok && mEqual(inner, x[tag], v)
	}
	panic("unknown slot " + slot)
}

func mKey(raw any) []byte {
	key, err := hex.DecodeString(raw.(string))
	if err != nil {
		panic(err)
	}
	return key
}
func mPath(raw any) [][]byte {
	list := raw.([]any)
	out := make([][]byte, len(list))
	for i, k := range list {
		out[i] = mKey(k)
	}
	return out
}
func mRead(raw any) (mNode, error) {
	s := raw.(map[string]any)
	own, ok := s["own"]
	if !ok {
		return mNode{}, missingOwn
	}
	children := make([]deixis.Entry[any], 0)
	for _, entry := range s["children"].([]any) {
		p := entry.([]any)
		child, err := mRead(p[1])
		if err != nil {
			return mNode{}, err
		}
		children = append(children, deixis.Entry[any]{Key: mKey(p[0]), Node: child})
	}
	return deixis.Compose(own, children)
}
func mMust(raw any) mNode {
	n, err := mRead(raw)
	if err != nil {
		panic(err)
	}
	return n
}
func mPtr(n mNode) *mNode { return &n }
func mSpell(n mNode, here [][]byte, holes [][][]byte) any {
	for _, p := range holes {
		if samePath(p, here) {
			return map[string]any{"hole": map[string]any{}}
		}
	}
	own, children := n.Decompose()
	out := make([]any, 0, len(children))
	for _, entry := range children {
		p := append(append([][]byte{}, here...), entry.Key)
		out = append(out, []any{hex.EncodeToString(entry.Key), mSpell(entry.Node, p, holes)})
	}
	return map[string]any{"own": own, "children": out}
}
func mSelected(n *mNode, value bool) any {
	if n == nil {
		return undefined
	}
	if value {
		return defined(n.Own())
	}
	return defined(mSpell(*n, nil, nil))
}
func mAt(n *mNode, p [][]byte) *mNode {
	if n == nil {
		return nil
	}
	found, ok := n.At(p)
	if !ok {
		return nil
	}
	return &found
}
func mReplace(n *mNode, p [][]byte, s mNode) *mNode {
	if n == nil {
		return nil
	}
	out, ok, err := replace(*n, p, s)
	if err != nil {
		panic(err)
	}
	if !ok {
		return nil
	}
	return &out
}
func mAttach(n *mNode, r map[string]any) *mNode {
	if n == nil {
		return nil
	}
	out, ok, err := attach(*n, mPath(r["parent"]), mKey(r["key"]), mMust(r["B"]))
	if err != nil {
		panic(err)
	}
	if !ok {
		return nil
	}
	return &out
}
func mMap(n mNode, f func(any) any) mNode {
	own, children := n.Decompose()
	for i := range children {
		children[i].Node = mMap(children[i].Node, f)
	}
	out, err := deixis.Compose(f(own), children)
	if err != nil {
		panic(err)
	}
	return out
}
func mApply(name string, v any) any {
	if name == "id" {
		return v
	}
	if name == "wrap-in-array" {
		return []any{v}
	}
	o := v.(map[string]any)
	switch name {
	case "class-suffix-x":
		return map[string]any{"class": o["class"].(string) + "x", "representation": o["representation"]}
	case "representation-upper":
		return map[string]any{"class": o["class"], "representation": strings.ToUpper(o["representation"].(string))}
	case "none-to-z":
		if _, ok := o["none"]; ok {
			return map[string]any{"some": map[string]any{"class": "z", "representation": "z"}}
		}
		return v
	case "option-map-class-suffix-x":
		if _, ok := o["none"]; ok {
			return v
		}
		return map[string]any{"some": mApply("class-suffix-x", o["some"])}
	}
	panic("unknown map " + name)
}
func mSkeleton(raw any, here [][]byte, holes *[][][]byte) mNode {
	s := raw.(map[string]any)
	if _, ok := s["hole"]; ok {
		*holes = append(*holes, here)
		n, _ := deixis.Compose[any](nil, nil)
		return n
	}
	children := make([]deixis.Entry[any], 0)
	for _, entry := range s["children"].([]any) {
		p := entry.([]any)
		key := mKey(p[0])
		at := append(append([][]byte{}, here...), key)
		children = append(children, deixis.Entry[any]{Key: key, Node: mSkeleton(p[1], at, holes)})
	}
	own, ok := s["own"]
	if !ok {
		panic("missing own")
	}
	n, err := deixis.Compose(own, children)
	if err != nil {
		panic(err)
	}
	return n
}

func handleMandatory(line []byte) (map[string]any, error) {
	var r map[string]any
	if err := json.Unmarshal(line, &r); err != nil {
		return nil, err
	}
	op := strings.TrimPrefix(r["op"].(string), "mnode.")
	slot := r["slot"].(string)
	if op == "equal" {
		return map[string]any{"equal": mMust(r["left"]).EqualBy(mMust(r["right"]), func(a, b any) bool { return mEqual(slot, a, b) })}, nil
	}
	var result any
	switch op {
	case "construct":
		n, err := mRead(r["node"])
		if err != nil {
			var duplicate *deixis.DuplicateKeyError
			if errors.As(err, &duplicate) {
				return map[string]any{"error": "duplicate_key", "key": hex.EncodeToString(duplicate.Key)}, nil
			}
			if !errors.Is(err, missingOwn) {
				return nil, err
			}
			result = undefined
		} else {
			result = mSelected(&n, false)
		}
	case "compose":
		result = mSpell(mMust(r), nil, nil)
	case "assemble":
		children := make([]deixis.Entry[any], 0)
		for _, entry := range r["children"].([]any) {
			p := entry.([]any)
			tag := p[1].(string)
			n := mMap(mMust(p[2]), func(v any) any {
				injected := map[string]any{tag: v}
				if slot == "option-sum" {
					return map[string]any{"some": injected}
				}
				return injected
			})
			children = append(children, deixis.Entry[any]{Key: mKey(p[0]), Node: n})
		}
		own, ok := r["parent"]
		if !ok {
			panic("missing parent")
		}
		n, err := deixis.Compose(own, children)
		if err != nil {
			var duplicate *deixis.DuplicateKeyError
			if errors.As(err, &duplicate) {
				return map[string]any{"error": "duplicate_key", "key": hex.EncodeToString(duplicate.Key)}, nil
			}
			return nil, err
		} else {
			result = mSelected(&n, false)
		}
	case "plug", "rebuild":
		field := "skeleton"
		if op == "plug" {
			field = "context"
		}
		holes := make([][][]byte, 0)
		n := mPtr(mSkeleton(r[field], nil, &holes))
		type filling struct {
			path [][]byte
			raw  any
		}
		supplied := make([]filling, 0)
		if op == "plug" {
			if len(holes) != 1 {
				panic("one hole required")
			}
			supplied = append(supplied, filling{holes[0], r["subtree"]})
		} else {
			for _, entry := range r["subtrees"].([]any) {
				p := entry.([]any)
				supplied = append(supplied, filling{mPath(p[0]), p[1]})
			}
		}
		if len(supplied) != len(holes) {
			panic("exact hole domain required")
		}
		for _, f := range supplied {
			found := -1
			for i, h := range holes {
				if samePath(h, f.path) {
					found = i
					break
				}
			}
			if found < 0 {
				panic("exact hole domain required")
			}
			holes = append(holes[:found], holes[found+1:]...)
			n = mReplace(n, f.path, mMust(f.raw))
		}
		result = mSpell(*n, nil, nil)
	case "attach", "attach-seq", "attach-then-at", "attach-then-valueAt":
		n := mPtr(mMust(r["A"]))
		steps := []any{r}
		if op == "attach-seq" {
			steps = r["steps"].([]any)
		}
		for _, step := range steps {
			n = mAttach(n, step.(map[string]any))
		}
		if op == "attach-then-at" || op == "attach-then-valueAt" {
			n = mAt(n, mPath(r["at"]))
		}
		result = mSelected(n, op == "attach-then-valueAt")
	default:
		n := mMust(r["node"])
		switch op {
		case "own":
			result = n.Own()
		case "at", "valueAt":
			result = mSelected(mAt(&n, mPath(r["path"])), op == "valueAt")
		case "decompose":
			result = map[string]any{"parts": mSpell(n, nil, nil)}
		case "map", "at-after-map", "embed-some":
			if op == "embed-some" {
				n = mMap(n, func(v any) any { return map[string]any{"some": v} })
			} else {
				fs, ok := r["f"].([]any)
				if !ok {
					fs = []any{r["f"]}
				}
				for _, f := range fs {
					name := f.(string)
					n = mMap(n, func(v any) any { return mApply(name, v) })
				}
			}
			if op == "at-after-map" {
				result = mSelected(mAt(&n, mPath(r["path"])), false)
			} else {
				result = mSpell(n, nil, nil)
			}
		case "replace":
			p := mPath(r["path"])
			out := mReplace(&n, p, mMust(r["subtree"]))
			if s, ok := r["then"]; ok {
				out = mReplace(out, p, mMust(s))
			}
			result = mSelected(out, false)
		case "split":
			p := mPath(r["path"])
			found := mAt(&n, p)
			if found == nil {
				result = undefined
			} else {
				result = defined(map[string]any{"context": mSpell(n, nil, [][][]byte{p}), "subtree": mSpell(*found, nil, nil)})
			}
		case "cut":
			ps := r["paths"].([]any)
			paths := make([][][]byte, len(ps))
			subs := make([]any, 0, len(ps))
			bad := false
			for i, p := range ps {
				paths[i] = mPath(p)
				found := mAt(&n, paths[i])
				if found == nil {
					bad = true
				} else {
					subs = append(subs, []any{p, mSpell(*found, nil, nil)})
				}
			}
			for i, p := range paths {
				for j, q := range paths {
					if i != j && isPrefix(p, q) {
						bad = true
					}
				}
			}
			if bad {
				result = undefined
			} else {
				result = defined(map[string]any{"skeleton": mSpell(n, nil, paths), "subtrees": subs})
			}
		default:
			return nil, fmt.Errorf("unknown mandatory operation %s", op)
		}
	}
	return map[string]any{"result": result}, nil
}
