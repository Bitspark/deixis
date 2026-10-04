package deixis

// The flat form, dxf2 (CODEC.md §5):
//
//	flat   := header ‖ node
//	header := "dxf2" ‖ cuvarint(len(id)) ‖ id
//	node   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*
//	entry  := cuvarint(len(key)) ‖ key ‖ node
//
// Decoding runs in three phases, so that §10 and §11's order holds over the whole
// artifact: framing first, codec-blind and in parse order, to the end of the input;
// then capability, the id against the registry; then every payload against D, in parse
// order. Framing faults outrank unsupported_slot_codec, which outranks
// non_canonical_payload, wherever in the octets each is found.
//
// One resumable parser serves the whole-buffer decoder and the streaming one, so a
// verdict cannot depend on how the octets were split (§14).

import (
	"bytes"
	"errors"
)

var flatMagic = []byte("dxf2")

// EncodeFlat is the flat-encoder: the canonical dxf2 octets of n under the slot codec
// c. Every node's payload is c's encoding of its own value, framed by its length, and
// entries follow in ascending key order. It fails only locally, with [ErrSlotCodecID],
// when c's id is not a well-formed id of a defined form.
func EncodeFlat[T any](n Node[T], c SlotCodec[T]) ([]byte, error) {
	id := c.ID()
	if err := encoderID(id); err != nil {
		return nil, err
	}
	out := append([]byte(nil), flatMagic...)
	out = AppendCuvarint(out, uint64(len(id)))
	out = append(out, id...)
	return appendFlatNode(out, n, c), nil
}

// appendFlatNode writes the node production for root and its subtrees, depth first
// with an explicit stack, so the depth of a tree never becomes the depth of the Go
// stack.
func appendFlatNode[T any](out []byte, root Node[T], c SlotCodec[T]) []byte {
	type frame struct {
		node Node[T]
		next int
	}
	out = appendFlatHead(out, c.Encode(root.own), len(root.entries))
	stack := []frame{{node: root}}
	for len(stack) > 0 {
		top := len(stack) - 1
		if stack[top].next == len(stack[top].node.entries) {
			stack = stack[:top]
			continue
		}
		entry := stack[top].node.entries[stack[top].next]
		stack[top].next++
		out = AppendCuvarint(out, uint64(len(entry.Key)))
		out = append(out, entry.Key...)
		out = appendFlatHead(out, c.Encode(entry.Node.own), len(entry.Node.entries))
		stack = append(stack, frame{node: entry.Node})
	}
	return out
}

// appendFlatHead writes a node's framed payload and its count.
func appendFlatHead(out, payload []byte, count int) []byte {
	out = AppendCuvarint(out, uint64(len(payload)))
	out = append(out, payload...)
	return AppendCuvarint(out, uint64(count))
}

// DecodeFlat is the flat-decoder over a whole artifact: the value data spells, under the
// slot codec registry holds for its id, with every §5 rule checked at every node.
//
// A refusal is a [Refusal]: an [*InvalidError] for malformed octets; an
// [*UnsupportedError] when the framing is well formed and the codec is not held (a nil
// or empty registry is codec-blind, and never yields a value); a [*LimitError] when a
// limit was reached first. A nil limits means [DefaultLimits].
func DecodeFlat[T any](data []byte, registry Registry[T], limits *Limits) (Decoded[T], error) {
	p := flatParser{limits: limitsOrDefault(limits), buf: data, final: true}
	if err := p.run(); err != nil {
		return Decoded[T]{}, err
	}
	return finishFlat(&p, registry)
}

// ReadFlatHeader is the flat-header-validator: it reads the magic and the slot-codec-id
// and nothing after them, and returns the codec registry holds for that id. Its
// refusals are those §2.1 lets it observe: unknown_magic, unexpected_eof, the §3 faults
// of the id length and inside the id, malformed_slot_codec_id, unsupported_slot_codec,
// and limit_exceeded.
func ReadFlatHeader[T any](data []byte, registry Registry[T], limits *Limits) (SlotCodec[T], error) {
	p := flatParser{limits: limitsOrDefault(limits), headerOnly: true, buf: data, final: true}
	if err := p.run(); err != nil {
		return nil, err
	}
	return hold(registry, p.id, p.reserved)
}

// FlatDecoder is the streaming flat-decoder (§14). Feed it the octets of one artifact
// in pieces, then call Finish to declare the end of input. For every split of an
// artifact, Finish returns the verdict [DecodeFlat] returns for the whole of it.
type FlatDecoder[T any] struct {
	p        flatParser
	registry Registry[T]
	finished bool
	result   Decoded[T]
	err      error
}

// NewFlatDecoder is a streaming flat-decoder holding registry. A nil limits means
// [DefaultLimits].
func NewFlatDecoder[T any](registry Registry[T], limits *Limits) *FlatDecoder[T] {
	return &FlatDecoder[T]{p: flatParser{limits: limitsOrDefault(limits)}, registry: registry}
}

// Feed appends the next octets of the artifact. It returns an [*IncompleteError]
// (need_more_input) while no verdict is certain — which includes a complete root, since
// trailing octets may still arrive — or the final [Refusal] once one is: a framing fault
// already in view, trailing_bytes, or limit_exceeded. A final refusal is returned again
// by every later call. After Finish, Feed ignores its octets and reports Finish's
// verdict, nil for an accepted value.
func (d *FlatDecoder[T]) Feed(octets []byte) error {
	if d.finished {
		return d.err
	}
	if d.p.err != nil {
		return d.p.err
	}
	d.p.buf = append(d.p.buf, octets...)
	if err := d.p.run(); err != nil && !errors.Is(err, errMore) {
		return err
	}
	return &IncompleteError{}
}

// Finish declares the end of input and returns the verdict: the value, or a [Refusal].
// need_more_input never survives Finish: input that ends mid-structure is
// unexpected_eof, and input that ends inside a cuvarint is malformed_uvarint (§3 rule 2),
// exactly as for the whole buffer.
func (d *FlatDecoder[T]) Finish() (Decoded[T], error) {
	if d.finished {
		return d.result, d.err
	}
	d.finished = true
	d.p.final = true
	if d.err = d.p.run(); d.err == nil {
		d.result, d.err = finishFlat(&d.p, d.registry)
	}
	d.p.nodes, d.p.stack, d.p.buf = nil, nil, nil
	return d.result, d.err
}

// FlatHeaderValidator is the streaming flat-header-validator: it reads the magic and
// the slot-codec-id and decides as soon as they are complete, whatever follows.
type FlatHeaderValidator[T any] struct {
	p        flatParser
	registry Registry[T]
	decided  bool
	codec    SlotCodec[T]
	err      error
}

// NewFlatHeaderValidator is a streaming header validator holding registry. A nil
// limits means [DefaultLimits].
func NewFlatHeaderValidator[T any](registry Registry[T], limits *Limits) *FlatHeaderValidator[T] {
	return &FlatHeaderValidator[T]{p: flatParser{limits: limitsOrDefault(limits), headerOnly: true}, registry: registry}
}

// Feed appends the next octets. It returns an [*IncompleteError] until the header is
// decided, then the header's verdict at once and on every later call: nil when the id
// is held, or a [Refusal].
func (v *FlatHeaderValidator[T]) Feed(octets []byte) error {
	if v.decided {
		return v.err
	}
	v.p.buf = append(v.p.buf, octets...)
	if err := v.p.run(); errors.Is(err, errMore) {
		return &IncompleteError{}
	} else if err != nil {
		v.decided, v.err = true, err
		return err
	}
	v.decided = true
	v.codec, v.err = hold(v.registry, v.p.id, v.p.reserved)
	return v.err
}

// Finish declares the end of input and returns the held codec, or the refusal.
func (v *FlatHeaderValidator[T]) Finish() (SlotCodec[T], error) {
	if !v.decided {
		v.decided = true
		v.p.final = true
		if v.err = v.p.run(); v.err == nil {
			v.codec, v.err = hold(v.registry, v.p.id, v.p.reserved)
		}
	}
	return v.codec, v.err
}

// --- the parser ----------------------------------------------------------------------

// errMore is the parser's internal pause: the next field is not complete in the input
// received so far, and the end of input has not been declared. It never reaches a
// caller.
var errMore = errors.New("deixis: more input needed")

type flatStage uint8

const (
	stageMagic flatStage = iota
	stageIDLength
	stageID
	stageNode     // inside the root: see the frames
	stageTrailing // the root is complete
	stageDone     // accepted framing: the root and the end of input, or the header
)

type frameStage uint8

const (
	framePayloadLength frameStage = iota
	framePayload
	frameCount
	frameKeyLength // also: waiting for the next entry once a child has closed
	frameKey
)

// flatFrame is one open node.
type flatFrame struct {
	node      int    // index into flatParser.nodes
	depth     uint64 // keys from the root
	stage     frameStage
	length    uint64 // the declared length of the payload or key being read
	remaining uint64 // entries not yet begun
	prevKey   []byte
	hasPrev   bool
}

// rawNode is one node as framing read it: payload octets not yet judged by any codec.
type rawNode struct {
	payload  []byte
	keys     [][]byte
	children []int
}

// flatParser is phase A: framing, in parse order, over input that may arrive in pieces.
// Every field is complete before it is judged — the availability of a field's octets is
// decided before their content — except a cuvarint, whose end is in its own octets.
type flatParser struct {
	limits     Limits
	headerOnly bool
	buf        []byte // received and not yet consumed
	pos        uint64 // offset of buf[0] in the artifact
	final      bool   // the end of input is declared
	err        error  // a terminal refusal, once found

	stage    flatStage
	idLength uint64
	id       []byte
	reserved bool

	nodes []rawNode // in parse order: every parent precedes its children
	stack []flatFrame
}

// run advances as far as the input allows. It returns nil at stageDone, errMore when
// the next field needs input not yet received, or a terminal refusal.
func (p *flatParser) run() error {
	for p.err == nil && p.stage != stageDone {
		if err := p.step(); err != nil {
			if errors.Is(err, errMore) {
				return err
			}
			p.err = err
		}
	}
	return p.err
}

// room is the number of received octets that lie below the flat-artifact limit.
func (p *flatParser) room() int {
	within := p.limits.FlatArtifactOctets - p.pos
	if uint64(len(p.buf)) < within {
		return len(p.buf)
	}
	return int(within)
}

// short is what running out of room means for the field being read. started reports
// that a cuvarint has begun and is still continuing.
func (p *flatParser) short(started bool) error {
	switch {
	case len(p.buf) > p.room():
		// The octet the parser needs is at the limit or past it, and it is present.
		return exceeded(DimensionFlatArtifactOctets)
	case !p.final:
		return errMore
	case started:
		return invalid(CodeMalformedUvarint)
	}
	return invalid(CodeUnexpectedEOF)
}

func (p *flatParser) consume(n int) {
	p.buf = p.buf[n:]
	p.pos += uint64(n)
}

// take is the next n octets, all present, or why not.
func (p *flatParser) take(n uint64) ([]byte, error) {
	if n > uint64(p.room()) {
		return nil, p.short(false)
	}
	out := p.buf[:n]
	p.consume(int(n))
	return out, nil
}

// varint is the next cuvarint under §3, then under the varint_value limit.
func (p *flatParser) varint() (uint64, error) {
	v, n, s := scanUvarint(p.buf[:p.room()])
	switch s {
	case uvarintOK:
	case uvarintShort:
		return 0, p.short(n > 0)
	default:
		return 0, invalid(uvarintFault(s))
	}
	p.consume(n)
	if v > p.limits.VarintValue {
		return 0, exceeded(DimensionVarintValue)
	}
	return v, nil
}

func (p *flatParser) step() error {
	switch p.stage {
	case stageMagic:
		magic, err := p.take(uint64(len(flatMagic)))
		if err != nil {
			return err
		}
		if !bytes.Equal(magic, flatMagic) {
			return invalid(CodeUnknownMagic)
		}
		p.stage = stageIDLength
	case stageIDLength:
		n, err := p.varint()
		if err != nil {
			return err
		}
		// Judged when the length is read (§13), before any octet of the id.
		if n < 2 || n > 32 {
			return invalid(CodeMalformedSlotCodecID)
		}
		if n > p.limits.SlotCodecIDLength {
			return exceeded(DimensionSlotCodecIDLength)
		}
		p.idLength = n
		p.stage = stageID
	case stageID:
		id, err := p.take(p.idLength)
		if err != nil {
			return err
		}
		if p.reserved, err = judgeID(id, p.limits.VarintValue); err != nil {
			return err
		}
		p.id = bytes.Clone(id)
		if p.headerOnly {
			p.stage = stageDone
			return nil
		}
		p.nodes = append(p.nodes, rawNode{})
		p.stack = append(p.stack, flatFrame{node: 0})
		p.stage = stageNode
	case stageNode:
		return p.stepNode()
	case stageTrailing:
		if len(p.buf) > 0 {
			return invalid(CodeTrailingBytes)
		}
		if !p.final {
			return errMore
		}
		p.stage = stageDone
	}
	return nil
}

func (p *flatParser) stepNode() error {
	f := &p.stack[len(p.stack)-1]
	switch f.stage {
	case framePayloadLength:
		n, err := p.varint()
		if err != nil {
			return err
		}
		if n > p.limits.PayloadLength {
			return exceeded(DimensionPayloadLength)
		}
		f.length = n
		f.stage = framePayload
	case framePayload:
		payload, err := p.take(f.length)
		if err != nil {
			return err
		}
		p.nodes[f.node].payload = bytes.Clone(payload)
		f.stage = frameCount
	case frameCount:
		n, err := p.varint()
		if err != nil {
			return err
		}
		if n > p.limits.EntriesPerNode {
			return exceeded(DimensionEntriesPerNode)
		}
		f.remaining = n
		f.stage = frameKeyLength
		p.settle()
	case frameKeyLength:
		n, err := p.varint()
		if err != nil {
			return err
		}
		if n > p.limits.KeyLength {
			return exceeded(DimensionKeyLength)
		}
		f.length = n
		f.stage = frameKey
	case frameKey:
		key, err := p.take(f.length)
		if err != nil {
			return err
		}
		// §5 rule 4, against the predecessor: never sorted, never deduplicated.
		if f.hasPrev {
			switch c := bytes.Compare(key, f.prevKey); {
			case c == 0:
				return invalid(CodeDuplicateKey)
			case c < 0:
				return invalid(CodeUnsortedKeys)
			}
		}
		if f.depth+1 > p.limits.LogicalDepth {
			return exceeded(DimensionLogicalDepth)
		}
		key = bytes.Clone(key)
		f.prevKey, f.hasPrev = key, true
		f.remaining--
		f.stage = frameKeyLength
		child := len(p.nodes)
		parent := &p.nodes[f.node]
		parent.keys = append(parent.keys, key)
		parent.children = append(parent.children, child)
		depth := f.depth + 1
		p.nodes = append(p.nodes, rawNode{})
		p.stack = append(p.stack, flatFrame{node: child, depth: depth})
	}
	return nil
}

// settle closes every node on top of the stack whose entries have all been read, and
// moves to the trailing check when the root closes.
func (p *flatParser) settle() {
	for len(p.stack) > 0 {
		f := &p.stack[len(p.stack)-1]
		if f.stage != frameKeyLength || f.remaining > 0 {
			return
		}
		p.stack = p.stack[:len(p.stack)-1]
	}
	p.stage = stageTrailing
}

// finishFlat is phases B and C over complete, well-framed octets: the capability
// judgment, then D at every node in parse order, then the value, built bottom-up. The
// parse order puts every parent before its children, so the reverse order builds each
// child before its parent without recursion.
func finishFlat[T any](p *flatParser, registry Registry[T]) (Decoded[T], error) {
	codec, err := hold(registry, p.id, p.reserved)
	if err != nil {
		return Decoded[T]{}, err
	}
	values := make([]T, len(p.nodes))
	for i := range p.nodes {
		value, ok := canonical(codec, p.nodes[i].payload)
		if !ok {
			return Decoded[T]{}, invalid(CodeNonCanonicalPayload)
		}
		values[i] = value
	}
	built := make([]Node[T], len(p.nodes))
	for i := len(p.nodes) - 1; i >= 0; i-- {
		raw := p.nodes[i]
		var entries []Entry[T]
		if len(raw.children) > 0 {
			entries = make([]Entry[T], len(raw.children))
			for j, child := range raw.children {
				entries[j] = Entry[T]{Key: raw.keys[j], Node: built[child]}
				built[child] = Node[T]{}
			}
		}
		built[i] = Node[T]{own: values[i], entries: entries}
	}
	return Decoded[T]{Node: built[0], Codec: codec}, nil
}
