// deixis-codec-v2 — canonical bytes for Node[T], in two forms over one value semantics.
//
// This file holds what both forms share: the result vocabulary of docs/CODEC.md §9 and
// §12, the canonical integer of §3, the slot codec of §4 and §13, and the structural
// judgment of a slot-codec-id. The flat form is in codec_flat.go, the linked form in
// codec_linked.go.
//
// A CANDIDATE implementation of a CANDIDATE contract (§16): nothing here is frozen, and
// a dxl2 address produced here is not a stable identity until the contract freezes. It
// is an in-house implementation, not the clean-room one of design/0007. Conformance
// claimed, by §2.1 profile: flat-encoder, flat-decoder, flat-header-validator,
// linked-resolver and closure-checker — codec-holding for exactly the ids a caller's
// Registry resolves, and codec-blind for every other. There is no chunk-store here.

package deixis

import (
	"bytes"
	"errors"
	"fmt"
	"math"
)

// Code is a stable result identifier of deixis-codec-v2 (CODEC.md §9): the code of a
// decoder verdict, need_more_input for a streaming decoder's non-terminal state, or a
// store-layer code. The spelling is the one the vectors pin.
type Code string

// The invalid codes: the octets are not canonical deixis-codec-v2, now or ever.
const (
	CodeMalformedUvarint     Code = "malformed_uvarint"
	CodeNonShortestUvarint   Code = "non_shortest_uvarint"
	CodeUvarintOverflow      Code = "uvarint_overflow"
	CodeUnknownMagic         Code = "unknown_magic"
	CodeDuplicateKey         Code = "duplicate_key"
	CodeUnsortedKeys         Code = "unsorted_keys"
	CodeTrailingBytes        Code = "trailing_bytes"
	CodeUnexpectedEOF        Code = "unexpected_eof"
	CodeBadLinkIndex         Code = "bad_link_index"
	CodeUnusedLink           Code = "unused_link"
	CodeDuplicateLinkHash    Code = "duplicate_link_hash"
	CodeLinksOutOfOrder      Code = "links_out_of_order"
	CodeSlotCodecMismatch    Code = "slot_codec_mismatch"
	CodeMalformedSlotCodecID Code = "malformed_slot_codec_id"
	CodeNonCanonicalPayload  Code = "non_canonical_payload"
)

// The codes of the other three decoder classes.
const (
	// CodeUnsupportedSlotCodec is the only unsupported code: well-formed framing, and
	// an id this reader does not hold.
	CodeUnsupportedSlotCodec Code = "unsupported_slot_codec"
	// CodeNeedMoreInput is a streaming decoder's non-terminal state (§14).
	CodeNeedMoreInput Code = "need_more_input"
	// CodeLimitExceeded is a refusal on resource, naming a §12 dimension. It is never
	// invalidity.
	CodeLimitExceeded Code = "limit_exceeded"
)

// The store / traversal layer's codes. They are facts about a store, not about octets,
// so no decoder reports them as a verdict (§2.1, §9); see [StoreError].
const (
	CodeMissingChunk    Code = "missing_chunk"
	CodeHashMismatch    Code = "hash_mismatch"
	CodeAddressConflict Code = "address_conflict"
)

// Class is one of §9's four non-acceptance classes, which license different actions and
// are never collapsed — or ClassStore, which groups the store-layer codes and is not a
// decoder class at all.
type Class string

const (
	// ClassInvalid: these octets are not a value, now or ever.
	ClassInvalid Class = "invalid"
	// ClassUnsupported: the octets may be a value; this reader cannot say.
	ClassUnsupported Class = "unsupported"
	// ClassIncomplete: streaming, and more input may arrive.
	ClassIncomplete Class = "incomplete"
	// ClassResourceRefused: valid so far, beyond a local limit.
	ClassResourceRefused Class = "resource-refused"
	// ClassStore is the store / traversal layer of §9: not a decoder verdict.
	ClassStore Class = "store"
)

// Class is the class a code belongs to, or "" for a string that is not a v2 code.
func (c Code) Class() Class {
	switch c {
	case CodeMalformedUvarint, CodeNonShortestUvarint, CodeUvarintOverflow, CodeUnknownMagic,
		CodeDuplicateKey, CodeUnsortedKeys, CodeTrailingBytes, CodeUnexpectedEOF,
		CodeBadLinkIndex, CodeUnusedLink, CodeDuplicateLinkHash, CodeLinksOutOfOrder,
		CodeSlotCodecMismatch, CodeMalformedSlotCodecID, CodeNonCanonicalPayload:
		return ClassInvalid
	case CodeUnsupportedSlotCodec:
		return ClassUnsupported
	case CodeNeedMoreInput:
		return ClassIncomplete
	case CodeLimitExceeded:
		return ClassResourceRefused
	case CodeMissingChunk, CodeHashMismatch, CodeAddressConflict:
		return ClassStore
	}
	return ""
}

// Dimension is a resource dimension of §12, spelled by its stable token.
type Dimension string

// The thirteen dimensions of §12's envelope.
const (
	DimensionVarintValue        Dimension = "varint_value"
	DimensionSlotCodecIDLength  Dimension = "slot_codec_id_length"
	DimensionKeyLength          Dimension = "key_length"
	DimensionPayloadLength      Dimension = "payload_length"
	DimensionEntriesPerNode     Dimension = "entries_per_node"
	DimensionLinksPerChunk      Dimension = "links_per_chunk"
	DimensionFlatArtifactOctets Dimension = "flat_artifact_octets"
	DimensionChunkOctets        Dimension = "chunk_octets"
	DimensionUniqueChunks       Dimension = "unique_chunks"
	DimensionUniqueOctets       Dimension = "unique_octets"
	DimensionLogicalDepth       Dimension = "logical_depth"
	DimensionUnfoldedNodeCount  Dimension = "unfolded_node_count"
	DimensionUnfoldedFlatOctets Dimension = "unfolded_flat_octets"
)

// Refusal is a decoder's verdict other than accepted: exactly one class and one code.
// Each class has its own type — [*InvalidError], [*UnsupportedError],
// [*IncompleteError] and [*LimitError] — so the four are distinct to errors.As as well as
// to Class (§14: they are never collapsed into one error type). A store fault is a
// [*StoreError] and is deliberately not a Refusal.
type Refusal interface {
	error
	Class() Class
	Code() Code
}

// InvalidError is the invalid class: the octets are not canonical deixis-codec-v2.
type InvalidError struct {
	code Code
}

func (e *InvalidError) Error() string { return "deixis: invalid: " + string(e.code) }

// Class is [ClassInvalid].
func (e *InvalidError) Class() Class { return ClassInvalid }

// Code is the invalid code.
func (e *InvalidError) Code() Code { return e.code }

// UnsupportedError is the unsupported class: the framing is well formed — every framing
// question was judged before this was reported (§11) — and the reader does not hold the
// slot codec the id names, or the id's form is reserved. The octets may be a value.
type UnsupportedError struct {
	id []byte
}

func (e *UnsupportedError) Error() string {
	return fmt.Sprintf("deixis: unsupported: %s %x", CodeUnsupportedSlotCodec, e.id)
}

// Class is [ClassUnsupported].
func (e *UnsupportedError) Class() Class { return ClassUnsupported }

// Code is [CodeUnsupportedSlotCodec].
func (e *UnsupportedError) Code() Code { return CodeUnsupportedSlotCodec }

// SlotCodecID is the id that was not held. The octets are a copy.
func (e *UnsupportedError) SlotCodecID() []byte { return bytes.Clone(e.id) }

// IncompleteError is the incomplete class: a streaming decoder has not reached a verdict
// and more input may arrive. It is non-terminal; see [FlatDecoder].
type IncompleteError struct{}

func (e *IncompleteError) Error() string { return "deixis: incomplete: " + string(CodeNeedMoreInput) }

// Class is [ClassIncomplete].
func (e *IncompleteError) Class() Class { return ClassIncomplete }

// Code is [CodeNeedMoreInput].
func (e *IncompleteError) Code() Code { return CodeNeedMoreInput }

// LimitError is the resource-refused class: nothing failed up to where the reader
// declined to spend beyond one of its [Limits]. It is never invalidity (§9, §12): the
// octets may be a value.
type LimitError struct {
	dimension Dimension
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("deixis: resource-refused: %s (%s)", CodeLimitExceeded, e.dimension)
}

// Class is [ClassResourceRefused].
func (e *LimitError) Class() Class { return ClassResourceRefused }

// Code is [CodeLimitExceeded].
func (e *LimitError) Code() Code { return CodeLimitExceeded }

// Dimension is the §12 dimension whose limit was exceeded.
func (e *LimitError) Dimension() Dimension { return e.dimension }

// StoreError is a fault of the store a linked closure was fetched from, not of any
// octets: missing_chunk, or hash_mismatch when the octets a store returned do not hash to
// the address they were fetched by. It is not a [Refusal].
type StoreError struct {
	code    Code
	address Address
}

func (e *StoreError) Error() string {
	return fmt.Sprintf("deixis: store: %s %s", e.code, e.address)
}

// Code is [CodeMissingChunk] or [CodeHashMismatch].
func (e *StoreError) Code() Code { return e.code }

// Address is the address that was requested.
func (e *StoreError) Address() Address { return e.address }

func invalid(code Code) error { return &InvalidError{code: code} }

func exceeded(d Dimension) error { return &LimitError{dimension: d} }

// ErrSlotCodecID is the local failure of an encoder handed a slot codec whose id is not
// a well-formed deixis-codec-v2 slot-codec-id of a defined form (§13). An encoder has no
// verdict channel (§2.1): it emits, or it fails with this.
var ErrSlotCodecID = errors.New("deixis: not a well-formed v2 slot-codec-id")

// Limits are a reader's resource limits, one per §12 dimension. Exceeding one refuses
// with a [*LimitError] naming it. [DefaultLimits] are exactly the §12 floors; a caller
// may raise any of them, and may lower one as a service policy — which is not a codec
// validity limit and makes the reader refuse inputs the floor says to accept.
//
// Wherever a function takes a *Limits, nil means [DefaultLimits].
type Limits struct {
	VarintValue uint64 // the largest cuvarint value read anywhere
	// SlotCodecIDLength bounds a slot-codec-id's octets. Its floor is §13's validity
	// bound — a longer id is malformed_slot_codec_id — so at the floor it never refuses.
	SlotCodecIDLength uint64
	// KeyLength, PayloadLength, EntriesPerNode and LinksPerChunk bound declared lengths
	// and counts, each met at its field, before the octets it announces (§12).
	KeyLength      uint64
	PayloadLength  uint64
	EntriesPerNode uint64
	LinksPerChunk  uint64
	// FlatArtifactOctets bounds the octets a flat reader will look at: it refuses when
	// it needs an octet at this offset or beyond and that octet is present. A remainder
	// is noticed without being read: an octet after a complete root is trailing_bytes
	// wherever it lies, at the limit's own offset included (§12).
	FlatArtifactOctets uint64
	// ChunkOctets bounds one chunk, and UniqueOctets the distinct chunks of one closure,
	// the root included. A chunk's size is met at its fetch, before its hash check and
	// its parse, so no fault inside it precedes either (§12).
	ChunkOctets  uint64
	UniqueChunks uint64 // distinct chunks of one closure, the root included
	UniqueOctets uint64
	// LogicalDepth bounds depth, which counts edges (§12): the root is at depth 0 and a
	// child is one deeper than its parent, so at the floor of 256 a node with 256
	// ancestors is within the limit and one with 257 is refused.
	LogicalDepth uint64
	// UnfoldedNodeCount and UnfoldedFlatOctets bound materialization and flattening of
	// a linked closure: the node occurrences of the tree it denotes, and the octets of
	// that tree's flat artifact, header included. Both are estimated with saturating
	// arithmetic over the DAG before anything is materialized. §12 lets a flat decoder
	// refuse on them too; this one does not, since FlatArtifactOctets already bounds a
	// flat artifact's length and so its node count.
	UnfoldedNodeCount  uint64
	UnfoldedFlatOctets uint64
}

// DefaultLimits are the §12 MUST-accept floors.
func DefaultLimits() Limits {
	return Limits{
		VarintValue:        math.MaxUint64,
		SlotCodecIDLength:  32,
		KeyLength:          4096,
		PayloadLength:      16 << 20,
		EntriesPerNode:     65536,
		LinksPerChunk:      65536,
		FlatArtifactOctets: 64 << 20,
		ChunkOctets:        32 << 20,
		UniqueChunks:       1_000_000,
		UniqueOctets:       1 << 30,
		LogicalDepth:       256,
		UnfoldedNodeCount:  16_777_216,
		UnfoldedFlatOctets: 1 << 30,
	}
}

// Set sets the limit for the dimension d, reporting false if d is not a §12 token.
func (l *Limits) Set(d Dimension, limit uint64) bool {
	switch d {
	case DimensionVarintValue:
		l.VarintValue = limit
	case DimensionSlotCodecIDLength:
		l.SlotCodecIDLength = limit
	case DimensionKeyLength:
		l.KeyLength = limit
	case DimensionPayloadLength:
		l.PayloadLength = limit
	case DimensionEntriesPerNode:
		l.EntriesPerNode = limit
	case DimensionLinksPerChunk:
		l.LinksPerChunk = limit
	case DimensionFlatArtifactOctets:
		l.FlatArtifactOctets = limit
	case DimensionChunkOctets:
		l.ChunkOctets = limit
	case DimensionUniqueChunks:
		l.UniqueChunks = limit
	case DimensionUniqueOctets:
		l.UniqueOctets = limit
	case DimensionLogicalDepth:
		l.LogicalDepth = limit
	case DimensionUnfoldedNodeCount:
		l.UnfoldedNodeCount = limit
	case DimensionUnfoldedFlatOctets:
		l.UnfoldedFlatOctets = limit
	default:
		return false
	}
	return true
}

func limitsOrDefault(l *Limits) Limits {
	if l == nil {
		return DefaultLimits()
	}
	return *l
}

// --- the integer domain (§3) ---------------------------------------------------------

// AppendCuvarint appends the cuvarint spelling of v to dst: unsigned LEB128 in its
// unique shortest form, at most ten octets.
func AppendCuvarint(dst []byte, v uint64) []byte {
	for v >= 0x80 {
		dst = append(dst, byte(v)|0x80)
		v >>= 7
	}
	return append(dst, byte(v))
}

// cuvarintLen is the length of v's cuvarint spelling.
func cuvarintLen(v uint64) uint64 {
	n := uint64(1)
	for v >= 0x80 {
		v >>= 7
		n++
	}
	return n
}

type uvarintStatus uint8

const (
	uvarintOK uvarintStatus = iota
	// uvarintShort: b ended before a terminator, with at most nine octets read, each
	// continuing. Whether that is a fault depends on whether more input can arrive.
	uvarintShort
	uvarintMalformed
	uvarintOverflow
	uvarintNonShortest
)

// scanUvarint reads one uvarint from the front of b under §3's three rules. n is the
// number of octets it took, or examined when the status is uvarintShort.
//
// The order is §10's: a tenth octet that still continues is malformed_uvarint before
// any value is formed, because the length bound needs no accumulation; a terminated
// spelling above 2^64 − 1 is uvarint_overflow; a terminated spelling in range whose last
// octet is 0x00 (after the first) is not the shortest, and is non_shortest_uvarint. The
// last two are disjoint: a non-shortest spelling has a value below 2^63.
func scanUvarint(b []byte) (v uint64, n int, status uvarintStatus) {
	for i := range 10 {
		if i == len(b) {
			return 0, i, uvarintShort
		}
		c := b[i]
		if i == 9 {
			// The tenth octet carries bit 63 alone.
			switch {
			case c&0x80 != 0:
				return 0, 10, uvarintMalformed
			case c > 1:
				return 0, 10, uvarintOverflow
			case c == 0:
				return 0, 10, uvarintNonShortest
			}
			return v | uint64(c)<<63, 10, uvarintOK
		}
		v |= uint64(c&0x7f) << (7 * i)
		if c&0x80 == 0 {
			if c == 0 && i > 0 {
				return 0, i + 1, uvarintNonShortest
			}
			return v, i + 1, uvarintOK
		}
	}
	panic("unreachable")
}

// uvarintFault is the invalid code of a terminal scan status.
func uvarintFault(s uvarintStatus) Code {
	switch s {
	case uvarintMalformed:
		return CodeMalformedUvarint
	case uvarintOverflow:
		return CodeUvarintOverflow
	case uvarintNonShortest:
		return CodeNonShortestUvarint
	}
	panic("not a fault")
}

// ReadCuvarint reads one cuvarint from the front of b, which is the whole remaining
// input, and returns its value and the number of octets it took. It enforces all three
// of §3's rules: an error is an [*InvalidError] with malformed_uvarint (more than ten
// octets, or input that ends while the continuation bit is set — §3 rule 2),
// uvarint_overflow, or non_shortest_uvarint; or unexpected_eof when b is empty.
func ReadCuvarint(b []byte) (uint64, int, error) {
	v, n, s := scanUvarint(b)
	switch s {
	case uvarintOK:
		return v, n, nil
	case uvarintShort:
		if n == 0 {
			return 0, 0, invalid(CodeUnexpectedEOF)
		}
		return 0, 0, invalid(CodeMalformedUvarint)
	}
	return 0, 0, invalid(uvarintFault(s))
}

// --- slot codecs (§4, §13) -----------------------------------------------------------

// SlotCodec is a slot codec for the payload type T: SlotCodec(T) = {id, ≈, e, D} of
// CODEC.md §4. The four travel as one unit and are used together.
//
// The supplier's whole obligation is lawfulness: Equal(x, y) ⟺ Encode(x) = Encode(y).
// Decode is an exact partial inverse — defined exactly on the image of Encode, where
// Encode(Decode(b)) = b — and refuses a non-canonical spelling rather than repair it.
// Decode may keep the octets it is given but must not modify them; Encode's result is
// only read.
type SlotCodec[T any] interface {
	// ID is the slot-codec-id (§13), which travels in every artifact's octets.
	ID() []byte
	// Equal is the slot's equivalence ≈, which node identity lifts.
	Equal(a, b T) bool
	// Encode is e: the canonical payload octets of a value.
	Encode(value T) []byte
	// Decode is D: the value a payload spells, or false outside the image of Encode.
	Decode(payload []byte) (T, bool)
}

// Decoded is a value decoded from an artifact together with the slot codec it was
// decoded under (§4: a decoded artifact retains its codec context). Compare decoded
// nodes with Node.EqualBy(other, Codec.Equal).
type Decoded[T any] struct {
	Node  Node[T]
	Codec SlotCodec[T]
}

type identityBytes struct{}

// IdentityBytes is deixis/identity-bytes, public id 00 01: the carrier is Bytes, ≈ is
// octet equality, and e and D are the identity. Every octet string is canonical.
func IdentityBytes() SlotCodec[[]byte] { return identityBytes{} }

func (identityBytes) ID() []byte                           { return []byte{0x00, 0x01} }
func (identityBytes) Equal(a, b []byte) bool               { return bytes.Equal(a, b) }
func (identityBytes) Encode(value []byte) []byte           { return value }
func (identityBytes) Decode(payload []byte) ([]byte, bool) { return bytes.Clone(payload), true }

type optionOf[T any] struct {
	inner SlotCodec[T]
	id    []byte
}

// OptionOf is option-of(c), id 0x02 ‖ id(c) (§13): the carrier is Option[T]; None ≈ None,
// Some(x) ≈ Some(y) iff x ≈ y under c, and None ≉ Some; e(None) = 0x00 and
// e(Some(x)) = 0x01 ‖ e_c(x); D accepts exactly 0x00 and 0x01 ‖ b with b decodable by c.
// No self-delimitation is needed of c, because every payload is framed by its length.
func OptionOf[T any](c SlotCodec[T]) SlotCodec[Option[T]] {
	return optionOf[T]{inner: c, id: append([]byte{0x02}, c.ID()...)}
}

func (o optionOf[T]) ID() []byte { return bytes.Clone(o.id) }

func (o optionOf[T]) Equal(a, b Option[T]) bool {
	av, ap := a.Get()
	bv, bp := b.Get()
	return ap == bp && (!ap || o.inner.Equal(av, bv))
}

func (o optionOf[T]) Encode(value Option[T]) []byte {
	inner, some := value.Get()
	if !some {
		return []byte{0x00}
	}
	return append([]byte{0x01}, o.inner.Encode(inner)...)
}

func (o optionOf[T]) Decode(payload []byte) (Option[T], bool) {
	switch {
	case len(payload) == 1 && payload[0] == 0x00:
		return None[T](), true
	case len(payload) >= 1 && payload[0] == 0x01:
		inner, ok := o.inner.Decode(payload[1:])
		if !ok {
			return None[T](), false
		}
		return Some(inner), true
	}
	return None[T](), false
}

// Registry is what a decoder holds (§2.1's codec-holding modifier): the slot codec it
// resolves for a slot-codec-id, or false where it is codec-blind. A nil Registry holds
// nothing. It is consulted only after all framing is judged, with the octets of a
// well-formed id of a defined form, and a codec whose own ID differs from the id asked
// for is treated as not held. Being in the public registry is never being held
// (§13: registered is never authorized).
type Registry[T any] func(id []byte) (SlotCodec[T], bool)

// Holding is the registry holding exactly the given codecs, matched by the exact octets
// of their ids. It panics if two codecs share an id or an id is not a well-formed id of
// a defined form, since such a registry could not answer unambiguously.
func Holding[T any](codecs ...SlotCodec[T]) Registry[T] {
	held := make(map[string]SlotCodec[T], len(codecs))
	for _, c := range codecs {
		id := c.ID()
		if reserved, err := judgeID(id, math.MaxUint64); err != nil || reserved {
			panic(fmt.Sprintf("deixis: Holding: %x is not a well-formed v2 slot-codec-id", id))
		}
		if _, dup := held[string(id)]; dup {
			panic(fmt.Sprintf("deixis: Holding: two codecs share the id %x", id))
		}
		held[string(id)] = c
	}
	return func(id []byte) (SlotCodec[T], bool) {
		c, ok := held[string(id)]
		return c, ok
	}
}

// hold is the capability judgment (§11): the codec this reader holds for a well-framed
// artifact's id, or unsupported_slot_codec. A reserved form is unsupported without
// asking the registry: no v2 codec can have it.
func hold[T any](registry Registry[T], id []byte, reserved bool) (SlotCodec[T], error) {
	if reserved || registry == nil {
		return nil, &UnsupportedError{id: bytes.Clone(id)}
	}
	c, ok := registry(id)
	if !ok || c == nil || !bytes.Equal(c.ID(), id) {
		return nil, &UnsupportedError{id: bytes.Clone(id)}
	}
	return c, nil
}

// canonical reports whether payload is in the image of the codec's encoder, and decodes
// it. Re-encoding checks D's exactness as well as its definedness, so a codec whose D
// repairs a spelling still cannot make a decoder accept octets it would not emit (§8
// law 1, law 5).
func canonical[T any](c SlotCodec[T], payload []byte) (T, bool) {
	value, ok := c.Decode(payload)
	if !ok || !bytes.Equal(c.Encode(value), payload) {
		var zero T
		return zero, false
	}
	return value, true
}

// --- the slot-codec-id (§13) ---------------------------------------------------------

// judgeID is the structural judgment of a slot-codec-id whose octets are all present.
// It returns reserved when the judgment stopped at a reserved first octet (03..ff, at the
// top or inside option-of), which is unsupported rather than invalid; or an error: an
// [*InvalidError] with malformed_slot_codec_id or a §3 integer code, or a [*LimitError]
// when n or k exceeds maxVarint.
//
// The id is a bounded input: no field is read past its end. A cuvarint that reaches the
// end still continuing is malformed_uvarint; a field that would begin at or past the end
// is malformed_slot_codec_id, as are octets left over after one whole id of its form.
func judgeID(id []byte, maxVarint uint64) (reserved bool, err error) {
	if len(id) < 2 || len(id) > 32 {
		return false, invalid(CodeMalformedSlotCodecID)
	}
	i := 0
	for {
		if i == len(id) {
			return false, invalid(CodeMalformedSlotCodecID)
		}
		switch id[i] {
		case 0x00: // public: n ≥ 1
			n, width, err := idUvarint(id[i+1:], maxVarint)
			if err != nil {
				return false, err
			}
			if n == 0 {
				return false, invalid(CodeMalformedSlotCodecID)
			}
			i += 1 + width
		case 0x01: // private: ns{16} ‖ k
			i++
			if len(id)-i < 16 {
				return false, invalid(CodeMalformedSlotCodecID)
			}
			i += 16
			_, width, err := idUvarint(id[i:], maxVarint)
			if err != nil {
				return false, err
			}
			i += width
		case 0x02: // option-of: one whole inner id
			i++
			continue
		default:
			return true, nil
		}
		if i != len(id) {
			return false, invalid(CodeMalformedSlotCodecID)
		}
		return false, nil
	}
}

// idUvarint reads a cuvarint that must lie wholly inside the rest of an id, b.
func idUvarint(b []byte, maxVarint uint64) (uint64, int, error) {
	if len(b) == 0 {
		return 0, 0, invalid(CodeMalformedSlotCodecID)
	}
	v, n, s := scanUvarint(b)
	switch s {
	case uvarintOK:
		if v > maxVarint {
			return 0, 0, exceeded(DimensionVarintValue)
		}
		return v, n, nil
	case uvarintShort:
		return 0, 0, invalid(CodeMalformedUvarint)
	}
	return 0, 0, invalid(uvarintFault(s))
}

// encoderID checks a codec's id before an encoder writes it: a malformed id or a
// reserved form would make every artifact written with it unreadable as v2.
func encoderID(id []byte) error {
	if reserved, err := judgeID(id, math.MaxUint64); err != nil || reserved {
		return fmt.Errorf("%w: %x", ErrSlotCodecID, id)
	}
	return nil
}

func satAdd(a, b uint64) uint64 {
	if s := a + b; s >= a {
		return s
	}
	return math.MaxUint64
}
