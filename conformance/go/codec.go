package main

// The codec.* operations of tools/conformance/README.md ("Codec protocol"), served by the
// core's deixis-codec-v2. The CLI spells requests into the core and the core's answers back
// out; every judgment is the core's, and the harness judges the answers.
//
// A codec is named by its id. The CLI can build three: identity-bytes (00 01), the fixture
// setoid (its private id, derived below), and option-of over either, to any depth, by
// parsing 02 ‖ id. Payloads are dynamic — []byte, fixture, or deixis.Option[any] over one
// of them — and each typed core codec is carried over them by erased.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"unicode/utf8"

	deixis "github.com/bitspark/deixis/core/go"
)

// fixtureID is the fixture setoid's private slot-codec-id (vectors/README.md): 0x01, the
// first 16 octets of SHA-256("deixis vectors fixture setoid v1"), and cuvarint(k = 1).
var fixtureID = func() []byte {
	ns := sha256.Sum256([]byte("deixis vectors fixture setoid v1"))
	return deixis.AppendCuvarint(append([]byte{0x01}, ns[:16]...), 1)
}()

// fixtureCodec is the fixture setoid as a slot codec: ≈ compares class, e is the UTF-8 of
// class, and D decodes strictly valid UTF-8 to {class, representation: ""}.
type fixtureCodec struct{}

func (fixtureCodec) ID() []byte                  { return bytes.Clone(fixtureID) }
func (fixtureCodec) Equal(a, b fixture) bool     { return a.class == b.class }
func (fixtureCodec) Encode(value fixture) []byte { return []byte(value.class) }
func (fixtureCodec) Decode(payload []byte) (fixture, bool) {
	if !utf8.Valid(payload) {
		return fixture{}, false
	}
	return fixture{class: string(payload)}, true
}

// erased carries a typed slot codec over the CLI's dynamic payloads.
type erased[T any] struct{ codec deixis.SlotCodec[T] }

func (e erased[T]) ID() []byte          { return e.codec.ID() }
func (e erased[T]) Equal(a, b any) bool { return e.codec.Equal(a.(T), b.(T)) }
func (e erased[T]) Encode(v any) []byte { return e.codec.Encode(v.(T)) }
func (e erased[T]) Decode(payload []byte) (any, bool) {
	v, ok := e.codec.Decode(payload)
	return v, ok
}

// slot is a codec the CLI can build, with the reader of its payload spelling.
type slot struct {
	codec deixis.SlotCodec[any]
	read  func(json.RawMessage) (any, error)
}

func slotFor(id []byte) (slot, bool) {
	switch {
	case bytes.Equal(id, deixis.IdentityBytes().ID()):
		return slot{codec: erased[[]byte]{deixis.IdentityBytes()}, read: func(raw json.RawMessage) (any, error) {
			return bytesSort.member(raw)
		}}, true
	case bytes.Equal(id, fixtureID):
		return slot{codec: erased[fixture]{fixtureCodec{}}, read: func(raw json.RawMessage) (any, error) {
			return classSort.member(raw)
		}}, true
	case len(id) > 1 && id[0] == 0x02:
		inner, ok := slotFor(id[1:])
		if !ok {
			return slot{}, false
		}
		return slot{codec: erased[deixis.Option[any]]{deixis.OptionOf(inner.codec)}, read: func(raw json.RawMessage) (any, error) {
			var spelling struct {
				None *json.RawMessage `json:"none"`
				Some *json.RawMessage `json:"some"`
			}
			if err := json.Unmarshal(raw, &spelling); err != nil {
				return nil, err
			}
			switch {
			case spelling.None != nil && spelling.Some == nil:
				return deixis.None[any](), nil
			case spelling.Some != nil && spelling.None == nil:
				value, err := inner.read(*spelling.Some)
				if err != nil {
					return nil, err
				}
				return deixis.Some(value), nil
			}
			return nil, errors.New("an option payload is exactly one of none and some")
		}}, true
	}
	return slot{}, false
}

// holding is the registry of a request's holding list: the base ids it names, and
// option-of over any id it holds (§13), at any depth. ok is false when the list names
// anything but a base id this CLI can build: the protocol's list holds base ids only, so
// an option-of id in it is not served, never read as holding what it wraps.
func holding(ids []string) (deixis.Registry[any], bool, error) {
	held := map[string]deixis.SlotCodec[any]{}
	for _, h := range ids {
		id, err := hex.DecodeString(h)
		if err != nil {
			return nil, false, err
		}
		if len(id) > 0 && id[0] == 0x02 {
			return nil, false, nil
		}
		s, ok := slotFor(id)
		if !ok {
			return nil, false, nil
		}
		held[string(id)] = s.codec
	}
	var registry deixis.Registry[any]
	registry = func(id []byte) (deixis.SlotCodec[any], bool) {
		if c, ok := held[string(id)]; ok {
			return c, true
		}
		if len(id) > 1 && id[0] == 0x02 {
			if inner, ok := registry(id[1:]); ok {
				return erased[deixis.Option[any]]{deixis.OptionOf(inner)}, true
			}
		}
		return nil, false
	}
	return registry, true, nil
}

// --- spellings -----------------------------------------------------------------------

func readCodecNode(raw json.RawMessage, s slot) (deixis.Node[any], error) {
	var spelling struct {
		Own      json.RawMessage  `json:"own"`
		Children *json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(raw, &spelling); err != nil {
		return deixis.Node[any]{}, err
	}
	if spelling.Own == nil || spelling.Children == nil {
		return deixis.Node[any]{}, errors.New(`a node is {"own": …, "children": […]}`)
	}
	own, err := s.read(spelling.Own)
	if err != nil {
		return deixis.Node[any]{}, err
	}
	keys, values, err := pairs(*spelling.Children)
	if err != nil {
		return deixis.Node[any]{}, err
	}
	children := make([]deixis.Entry[any], len(keys))
	for i := range keys {
		child, err := readCodecNode(values[i], s)
		if err != nil {
			return deixis.Node[any]{}, err
		}
		children[i] = deixis.Entry[any]{Key: keys[i], Node: child}
	}
	return deixis.Compose(own, children)
}

func spellPayload(v any) any {
	switch x := v.(type) {
	case []byte:
		return hex.EncodeToString(x)
	case fixture:
		return classSort.spell(x)
	case deixis.Option[any]:
		if inner, ok := x.Get(); ok {
			return map[string]any{"some": spellPayload(inner)}
		}
		return map[string]any{"none": map[string]any{}}
	}
	panic(fmt.Sprintf("no spelling for a %T payload", v))
}

func spellCodecNode(n deixis.Node[any]) any {
	own, children := n.Decompose()
	spelled := make([]any, len(children))
	for i, child := range children {
		spelled[i] = []any{hex.EncodeToString(child.Key), spellCodecNode(child.Node)}
	}
	return map[string]any{"own": spellPayload(own), "children": spelled}
}

func spellAddress(a deixis.Address) map[string]any {
	digest := a.Digest()
	return map[string]any{"space": a.Space(), "digest": hex.EncodeToString(digest[:])}
}

// answer spells a core result: a value, or the refusal as a verdict, or a store fault
// under "store" — never as a verdict (§9). Anything else is a CLI defect.
func answer(value func() any, err error) (map[string]any, error) {
	if err == nil {
		return map[string]any{"value": value()}, nil
	}
	return refusal(err)
}

func refusal(err error) (map[string]any, error) {
	if err == nil {
		// No state to spell: an open stream the core called final, or a caller that
		// reached here without a refusal. Fail loudly rather than answer with no body.
		return nil, errors.New("refusal of a nil error: the core reported no state to spell")
	}
	var store *deixis.StoreError
	if errors.As(err, &store) {
		digest := store.Address().Digest()
		return map[string]any{"store": map[string]any{"code": string(store.Code()), "digest": hex.EncodeToString(digest[:])}}, nil
	}
	var r deixis.Refusal
	if errors.As(err, &r) {
		v := map[string]any{"class": string(r.Class()), "code": string(r.Code())}
		var limit *deixis.LimitError
		if errors.As(err, &limit) {
			v["dimension"] = string(limit.Dimension())
		}
		return map[string]any{"verdict": v}, nil
	}
	return nil, err
}

// unsupportedOp is the protocol's answer to a request this CLI cannot serve. It is a new
// map each time: main writes the request id into every response.
func unsupportedOp() map[string]any { return map[string]any{"error": "unsupported"} }

// --- requests ------------------------------------------------------------------------

type codecAddress struct {
	Space  string `json:"space"`
	Digest string `json:"digest"`
}

type codecRequest struct {
	Op        string                     `json:"op"`
	SlotCodec string                     `json:"slot_codec"`
	Node      json.RawMessage            `json:"node"`
	Bytes     string                     `json:"bytes"`
	Holding   []string                   `json:"holding"`
	Cuts      []int                      `json:"cuts"`
	End       *bool                      `json:"end"`
	Root      *codecAddress              `json:"root"`
	Chunks    [][]string                 `json:"chunks"`
	Budget    map[string]json.RawMessage `json:"budget"`
	Path      []string                   `json:"path"`
}

// pieces splits data at ascending interior offsets.
func pieces(data []byte, cuts []int) ([][]byte, error) {
	var out [][]byte
	at := 0
	for _, cut := range cuts {
		if cut <= at || cut >= len(data) {
			return nil, fmt.Errorf("cuts %v are not ascending interior offsets of %d octets", cuts, len(data))
		}
		out = append(out, data[at:cut])
		at = cut
	}
	return append(out, data[at:]), nil
}

// budget is the caller's explicit budget: §12 tokens to decimal strings, every dimension
// it does not name at its floor.
func budget(tokens map[string]json.RawMessage) (*deixis.Limits, error) {
	limits := deixis.DefaultLimits()
	for token, raw := range tokens {
		var decimal string
		if err := json.Unmarshal(raw, &decimal); err != nil {
			decimal = string(raw)
		}
		v, err := strconv.ParseUint(decimal, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("budget %s: %w", token, err)
		}
		if !limits.Set(deixis.Dimension(token), v) {
			return nil, fmt.Errorf("budget names %q, which is not a §12 token", token)
		}
	}
	return &limits, nil
}

// untrustedStore reads a request's chunk pairs as a store: a digest need not be the
// SHA-256 of its octets, and the core verifies every chunk it fetches. The same digest
// twice with different octets is the store's own address_conflict (§15).
func untrustedStore(pairs [][]string) (deixis.Fetch, map[string]any, error) {
	chunks := map[deixis.Address][]byte{}
	for _, pair := range pairs {
		if len(pair) != 2 {
			return nil, nil, errors.New("a chunk is a [digest, hex] pair")
		}
		digest, err := hex.DecodeString(pair[0])
		if err != nil {
			return nil, nil, err
		}
		a, err := deixis.NewAddress(deixis.AddressSpace, digest)
		if err != nil {
			return nil, nil, err
		}
		octets, err := hex.DecodeString(pair[1])
		if err != nil {
			return nil, nil, err
		}
		if seen, ok := chunks[a]; ok && !bytes.Equal(seen, octets) {
			return nil, map[string]any{"store": map[string]any{"code": string(deixis.CodeAddressConflict), "digest": pair[0]}}, nil
		}
		chunks[a] = octets
	}
	return func(a deixis.Address) ([]byte, bool) {
		octets, ok := chunks[a]
		return octets, ok
	}, nil, nil
}

func handleCodec(line []byte) (map[string]any, error) {
	var req codecRequest
	if err := json.Unmarshal(line, &req); err != nil {
		return nil, err
	}
	switch req.Op {
	case "codec.encodeFlat", "codec.encodeLinked":
		return encode(req)
	case "codec.decodeFlat", "codec.readHeader":
		return decodeFlat(req)
	case "codec.resolve", "codec.checkClosure", "codec.flatten":
		return resolve(req)
	case "codec.navigate":
		return navigate(req)
	}
	return unsupportedOp(), nil
}

func encode(req codecRequest) (map[string]any, error) {
	id, err := hex.DecodeString(req.SlotCodec)
	if err != nil {
		return nil, err
	}
	s, ok := slotFor(id)
	if !ok {
		return unsupportedOp(), nil
	}
	node, err := readCodecNode(req.Node, s)
	if err != nil {
		return duplicateOr(err)
	}
	if req.Op == "codec.encodeFlat" {
		octets, err := deixis.EncodeFlat(node, s.codec)
		if err != nil {
			return nil, err
		}
		return map[string]any{"bytes": hex.EncodeToString(octets)}, nil
	}
	root, chunks, err := deixis.EncodeLinked(node, s.codec)
	if err != nil {
		return nil, err
	}
	listed := make([][2]string, 0, len(chunks))
	for a, octets := range chunks {
		digest := a.Digest()
		listed = append(listed, [2]string{hex.EncodeToString(digest[:]), hex.EncodeToString(octets)})
	}
	slices.SortFunc(listed, func(x, y [2]string) int { return bytes.Compare([]byte(x[0]), []byte(y[0])) })
	return map[string]any{"root": spellAddress(root), "chunks": listed}, nil
}

// decodeFlat serves the flat-decoder and the flat-header-validator. With neither cuts nor
// end the whole buffer is decoded; otherwise the pieces are fed to the streaming decoder,
// end of input is declared iff end, and only the final state is reported.
func decodeFlat(req codecRequest) (map[string]any, error) {
	data, err := hex.DecodeString(req.Bytes)
	if err != nil {
		return nil, err
	}
	registry, ok, err := holding(req.Holding)
	if err != nil {
		return nil, err
	}
	if !ok {
		return unsupportedOp(), nil
	}
	header := req.Op == "codec.readHeader"
	spellHeader := func(c deixis.SlotCodec[any]) map[string]any {
		return map[string]any{"header": map[string]any{"slot_codec": hex.EncodeToString(c.ID())}}
	}
	if req.Cuts == nil && req.End == nil {
		if header {
			c, err := deixis.ReadFlatHeader(data, registry, nil)
			if err != nil {
				return refusal(err)
			}
			return spellHeader(c), nil
		}
		d, err := deixis.DecodeFlat(data, registry, nil)
		return answer(func() any { return spellCodecNode(d.Node) }, err)
	}
	parts, err := pieces(data, req.Cuts)
	if err != nil {
		return nil, err
	}
	end := req.End != nil && *req.End
	if header {
		v := deixis.NewFlatHeaderValidator(registry, nil)
		var state error
		for _, part := range parts {
			state = v.Feed(part)
		}
		if end || state == nil {
			c, err := v.Finish()
			if err != nil {
				return refusal(err)
			}
			return spellHeader(c), nil
		}
		return refusal(state)
	}
	d := deixis.NewFlatDecoder(registry, nil)
	var state error
	for _, part := range parts {
		state = d.Feed(part)
	}
	if !end {
		return refusal(state)
	}
	decoded, err := d.Finish()
	return answer(func() any { return spellCodecNode(decoded.Node) }, err)
}

// resolve serves the linked-resolver (resolve, flatten) and the closure-checker. The root
// comes from the caller, through resolve-root, and anchors everything after it.
func resolve(req codecRequest) (map[string]any, error) {
	if req.Root == nil {
		return nil, errors.New("a linked request names its root")
	}
	digest, err := hex.DecodeString(req.Root.Digest)
	if err != nil {
		return nil, err
	}
	root, err := deixis.NewAddress(req.Root.Space, digest)
	if err != nil {
		return unsupportedOp(), nil // not an address this resolver can resolve
	}
	fetch, conflict, err := untrustedStore(req.Chunks)
	if err != nil || conflict != nil {
		return conflict, err
	}
	limits, err := budget(req.Budget)
	if err != nil {
		return nil, err
	}
	chunk, err := deixis.ResolveRoot(root, fetch, limits)
	if err != nil {
		return refusal(err)
	}
	if req.Op == "codec.checkClosure" {
		if err := deixis.CheckClosure(chunk, fetch, limits); err != nil {
			return refusal(err)
		}
		return map[string]any{"ok": true}, nil
	}
	registry, ok, err := holding(req.Holding)
	if err != nil {
		return nil, err
	}
	if !ok {
		return unsupportedOp(), nil
	}
	if req.Op == "codec.flatten" {
		octets, err := deixis.Flatten(chunk, fetch, registry, limits)
		if err != nil {
			return refusal(err)
		}
		return map[string]any{"bytes": hex.EncodeToString(octets)}, nil
	}
	d, err := deixis.Materialize(chunk, fetch, registry, limits)
	return answer(func() any { return spellCodecNode(d.Node) }, err)
}

// navigate is §14's two constructors and nothing else: resolve-root once, then
// resolve-child per key of the path, nothing fetched off it and nothing materialized. The
// answer is the reached chunk's own value and its entries, each with its link digest;
// "absent" at the first key no entry has; or the verdict or store fault that stopped the
// walk.
func navigate(req codecRequest) (map[string]any, error) {
	if req.Root == nil {
		return nil, errors.New("a linked request names its root")
	}
	digest, err := hex.DecodeString(req.Root.Digest)
	if err != nil {
		return nil, err
	}
	root, err := deixis.NewAddress(req.Root.Space, digest)
	if err != nil {
		return unsupportedOp(), nil // not an address this resolver can resolve
	}
	registry, ok, err := holding(req.Holding)
	if err != nil {
		return nil, err
	}
	if !ok {
		return unsupportedOp(), nil
	}
	fetch, conflict, err := untrustedStore(req.Chunks)
	if err != nil || conflict != nil {
		return conflict, err
	}
	chunk, err := deixis.ResolveRoot(root, fetch, nil)
	if err != nil {
		return refusal(err)
	}
	for i, spelled := range req.Path {
		key, err := hex.DecodeString(spelled)
		if err != nil {
			return nil, err
		}
		child, found, err := chunk.ResolveChild(key, fetch, nil)
		if !found {
			return map[string]any{"absent": i}, nil
		}
		if err != nil {
			return refusal(err)
		}
		chunk = child
	}
	// The slot codec enters only here, at the chunk answered with (§14).
	codec, held := registry(chunk.SlotCodecID())
	if !held {
		return verdictOf(deixis.CodeUnsupportedSlotCodec), nil
	}
	own, canonical := codec.Decode(chunk.Payload())
	if !canonical {
		return verdictOf(deixis.CodeNonCanonicalPayload), nil
	}
	entries := chunk.Children()
	children := make([]any, len(entries))
	for i, entry := range entries {
		d := entry.Child.Digest()
		children[i] = []any{hex.EncodeToString(entry.Key), hex.EncodeToString(d[:])}
	}
	return map[string]any{"node": map[string]any{"own": spellPayload(own), "children": children}}, nil
}

// verdictOf spells a decoder verdict the CLI reaches itself rather than through a core error.
func verdictOf(code deixis.Code) map[string]any {
	return map[string]any{"verdict": map[string]any{"class": string(code.Class()), "code": string(code)}}
}
