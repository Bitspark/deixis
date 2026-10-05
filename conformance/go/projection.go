package main

// IDENTITY.md's projection (ID9) and its composition inside one tree (ID10), as a scripted
// harness over the core's native Node; no vectors or expected results. Projection is not a
// deixis API (ID8): invocation adds zero interface to deixis. A tree's own values are live
// capability objects, one per distinct id in each fixture, and every tree is built and
// read through Compose, Decompose and At.
import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	deixis "github.com/bitspark/deixis/core/go"
)

var missingPath = map[string]any{"missing-path": map[string]any{}}

// capability is a live capability: its behaviour comes from the world script, and every
// invocation is recorded in its fixture's log. A count capability counts its own
// invocations.
type capability struct {
	fixture   *projectionFixture
	id        string
	behaviour map[string]any
	calls     int
}

func (c *capability) invoke(args []byte) any {
	c.calls++
	c.fixture.log = append(c.fixture.log, []any{c.id, hex.EncodeToString(args)})
	if c.behaviour == nil {
		return map[string]any{"fault": "unscripted"}
	}
	if _, ok := c.behaviour["count"]; ok {
		return map[string]any{"ok": strconv.Itoa(c.calls)}
	}
	return c.behaviour
}

// projectionFixture is one separately initialised fixture: fresh capability objects, one
// per distinct id, and a fresh log.
type projectionFixture struct {
	world        map[string]map[string]any
	capabilities map[string]*capability
	log          []any
}

func newProjectionFixture(raw any) *projectionFixture {
	f := &projectionFixture{world: map[string]map[string]any{}, capabilities: map[string]*capability{}, log: []any{}}
	for _, entry := range raw.([]any) {
		pair := entry.([]any)
		f.world[hex.EncodeToString(mKey(pair[0]))] = pair[1].(map[string]any)
	}
	return f
}

func (f *projectionFixture) capability(spelling any) *capability {
	id := hex.EncodeToString(mKey(spelling))
	c, ok := f.capabilities[id]
	if !ok {
		c = &capability{fixture: f, id: id, behaviour: f.world[id]}
		f.capabilities[id] = c
	}
	return c
}

func (f *projectionFixture) read(raw any) deixis.Node[*capability] {
	s := raw.(map[string]any)
	children := make([]deixis.Entry[*capability], 0)
	for _, entry := range s["children"].([]any) {
		p := entry.([]any)
		children = append(children, deixis.Entry[*capability]{Key: mKey(p[0]), Node: f.read(p[1])})
	}
	n, err := deixis.Compose(f.capability(s["own"]), children)
	if err != nil {
		panic(err)
	}
	return n
}

// lift is MissingPath with no invocation when At(path) is absent, and otherwise exactly
// one invocation of the selected node's own capability.
func lift(n deixis.Node[*capability], path [][]byte, args []byte) any {
	selected, ok := n.At(path)
	if !ok {
		return missingPath
	}
	return selected.Own().invoke(args)
}

// reconstruct rebuilds every node through Decompose and then Compose.
func reconstruct(n deixis.Node[*capability]) deixis.Node[*capability] {
	own, children := n.Decompose()
	rebuilt := make([]deixis.Entry[*capability], len(children))
	for i, entry := range children {
		rebuilt[i] = deixis.Entry[*capability]{Key: entry.Key, Node: reconstruct(entry.Node)}
	}
	out, err := deixis.Compose(own, rebuilt)
	if err != nil {
		panic(err)
	}
	return out
}

// liftSide runs one side of a lift on its own fixture: the outcome and that fixture's log.
func liftSide(r map[string]any, run func(deixis.Node[*capability]) any) any {
	f := newProjectionFixture(r["world"])
	outcome := run(f.read(r["node"]))
	return map[string]any{"outcome": outcome, "invocations": f.log}
}

// readMutable builds a tree from key buffers the harness owns and mutates afterwards.
func readMutable(raw any, buffers *[][]byte) deixis.Node[[]byte] {
	s := raw.(map[string]any)
	children := make([]deixis.Entry[[]byte], 0)
	for _, entry := range s["children"].([]any) {
		p := entry.([]any)
		key := mKey(p[0])
		*buffers = append(*buffers, key)
		children = append(children, deixis.Entry[[]byte]{Key: key, Node: readMutable(p[1], buffers)})
	}
	n, err := deixis.Compose(mKey(s["own"]), children)
	if err != nil {
		panic(err)
	}
	return n
}

func handleProjection(line []byte) (map[string]any, error) {
	var r map[string]any
	if err := json.Unmarshal(line, &r); err != nil {
		return nil, err
	}
	op := strings.TrimPrefix(r["op"].(string), "projection.")
	switch op {
	case "lift":
		path, args := mPath(r["path"]), mKey(r["args"])
		return map[string]any{"result": liftSide(r, func(n deixis.Node[*capability]) any { return lift(n, path, args) })}, nil
	case "lift-cut":
		prefix, suffix, args := mPath(r["prefix"]), mPath(r["suffix"]), mKey(r["args"])
		concat := append(append([][]byte{}, prefix...), suffix...)
		return map[string]any{"result": map[string]any{
			"select-then-lift": liftSide(r, func(n deixis.Node[*capability]) any {
				selected, ok := n.At(prefix)
				if !ok {
					return missingPath
				}
				return lift(selected, suffix, args)
			}),
			"lift-concat": liftSide(r, func(n deixis.Node[*capability]) any { return lift(n, concat, args) }),
		}}, nil
	case "lift-sequence":
		f := newProjectionFixture(r["world"])
		n := f.read(r["node"])
		if r["reconstruct"].(bool) {
			n = reconstruct(n)
		}
		outcomes := []any{}
		for _, step := range r["steps"].([]any) {
			s := step.([]any)
			outcomes = append(outcomes, lift(n, mPath(s[0]), mKey(s[1])))
		}
		return map[string]any{"result": map[string]any{"outcomes": outcomes, "invocations": f.log}}, nil
	case "keys-after-mutation":
		var buffers [][]byte
		n := readMutable(r["node"], &buffers)
		for _, buffer := range buffers {
			for i := range buffer {
				buffer[i] ^= 0xff
			}
		}
		found := []any{}
		for _, probe := range r["probes"].([]any) {
			_, ok := n.At(mPath(probe))
			found = append(found, ok)
		}
		return map[string]any{"result": map[string]any{"found": found}}, nil
	}
	return nil, fmt.Errorf("unknown projection operation %s", op)
}
