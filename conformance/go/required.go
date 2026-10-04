package main

import (
	"encoding/hex"
	"encoding/json"

	deixis "github.com/bitspark/deixis/core/go"
)

func parseRequired(raw json.RawMessage) (deixis.Node[fixture], error) {
	var spelling struct {
		Own      json.RawMessage
		Children json.RawMessage
	}
	if err := json.Unmarshal(raw, &spelling); err != nil {
		return deixis.Node[fixture]{}, err
	}
	own, err := classSort.member(spelling.Own)
	if err != nil {
		return deixis.Node[fixture]{}, err
	}
	keys, values, err := pairs(spelling.Children)
	if err != nil {
		return deixis.Node[fixture]{}, err
	}
	children := make([]deixis.Entry[fixture], len(keys))
	for i, value := range values {
		child, err := parseRequired(value)
		if err != nil {
			return deixis.Node[fixture]{}, err
		}
		children[i] = deixis.Entry[fixture]{Key: keys[i], Node: child}
	}
	return deixis.Compose(own, children)
}

func spellRequired(node deixis.Node[fixture]) any {
	children := make([]any, 0, node.Len())
	for _, entry := range node.Entries() {
		children = append(children, []any{hex.EncodeToString(entry.Key), spellRequired(entry.Node)})
	}
	return map[string]any{"own": classSort.spell(node.Own()), "children": children}
}

func handleRequired(req request) (map[string]any, error) {
	if req.Op == "required.equal" {
		left, err := parseRequired(req.Left)
		if err != nil {
			return nil, err
		}
		right, err := parseRequired(req.Right)
		if err != nil {
			return nil, err
		}
		return map[string]any{"equal": left.EqualBy(right, classSort.eq)}, nil
	}
	tree, err := parseRequired(req.Tree)
	if err != nil {
		return nil, err
	}
	switch req.Op {
	case "required.roundtrip":
		own, children := tree.Decompose()
		rebuilt, err := deixis.Compose(own, children)
		if err != nil {
			return nil, err
		}
		return defined(spellRequired(rebuilt)), nil
	case "required.at", "required.valueAt":
		path, err := decodePath(req.Path)
		if err != nil {
			return nil, err
		}
		found, ok := tree.At(path)
		if !ok {
			return undefined, nil
		}
		if req.Op == "required.valueAt" {
			return defined(classSort.spell(found.Own())), nil
		}
		return defined(spellRequired(found)), nil
	case "required.attach":
		parent, err := decodePath(req.Parent)
		if err != nil {
			return nil, err
		}
		key, err := hex.DecodeString(req.Key)
		if err != nil {
			return nil, err
		}
		subtree, err := parseRequired(req.Subtree)
		if err != nil {
			return nil, err
		}
		result, ok, err := attach(tree, parent, key, subtree)
		if err != nil {
			return nil, err
		}
		if !ok {
			return undefined, nil
		}
		return defined(spellRequired(result)), nil
	}
	return map[string]any{"error": "unsupported"}, nil
}
