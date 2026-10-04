package deixis

// The linked form, dxl2 (CODEC.md §6), one chunk per node:
//
//	chunk  := "dxl2" ‖ cuvarint(len(id)) ‖ id
//	        ‖ cuvarint(nlinks) ‖ hash{32}*          # the links header
//	        ‖ body
//	body   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ lentry*
//	lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)
//
// The links header lists each distinct child hash once, in order of first use along
// the entries in key order. A value's address is the SHA-256 of its root chunk, and
// always travels qualified by its address space (§7).
//
// §14 separates the operations. Two constructors retrieve a chunk: [ResolveRoot], from
// an address the caller supplies, and [Chunk.ResolveChild], from the links header of a
// chunk already verified. Every closure operation — [CheckClosure],
// [EstimateUnfolded], [Materialize], [Flatten] — starts from a chunk one of them
// returned, so no closure is judged without the anchor that says it is the one asked
// for.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
)

var linkedMagic = []byte("dxl2")

// AddressSpace is the address space of every deixis-codec-v2 address: "dxl2".
const AddressSpace = "dxl2"

// Address is a content address: the pair (address-space "dxl2", digest{32}), where the
// digest is the SHA-256 of a chunk's octets (§7). It is never a bare digest: the space
// travels with it in its String and in every constructor. Addresses are comparable.
//
// Before v2 freezes a dxl2 address is not a stable identity (§16): a change to the
// candidate contract changes addresses.
type Address struct {
	digest [32]byte
}

// NewAddress is the address (space, digest). It fails unless space is "dxl2" and the
// digest is 32 octets.
func NewAddress(space string, digest []byte) (Address, error) {
	if space != AddressSpace {
		return Address{}, fmt.Errorf("deixis: address space %q is not %q", space, AddressSpace)
	}
	if len(digest) != sha256.Size {
		return Address{}, fmt.Errorf("deixis: a %s digest is %d octets, not %d", AddressSpace, sha256.Size, len(digest))
	}
	var a Address
	copy(a.digest[:], digest)
	return a, nil
}

// Space is the address space, "dxl2".
func (a Address) Space() string { return AddressSpace }

// Digest is the SHA-256 digest.
func (a Address) Digest() [32]byte { return a.digest }

// String is "dxl2:" followed by the digest in lowercase hex.
func (a Address) String() string { return AddressSpace + ":" + hex.EncodeToString(a.digest[:]) }

func addressOf(octets []byte) Address { return Address{digest: sha256.Sum256(octets)} }

// EncodeLinked is the linked encoder: the address of n's root chunk under the slot
// codec c, and every chunk of n's closure by address, each once. Equal subtrees are one
// chunk, whatever the number of their occurrences. It fails only locally, with
// [ErrSlotCodecID], when c's id is not a well-formed id of a defined form.
func EncodeLinked[T any](n Node[T], c SlotCodec[T]) (Address, map[Address][]byte, error) {
	id := c.ID()
	if err := encoderID(id); err != nil {
		return Address{}, nil, err
	}
	header := append([]byte(nil), linkedMagic...)
	header = AppendCuvarint(header, uint64(len(id)))
	header = append(header, id...)

	// Post-order with an explicit stack: a chunk needs its children's addresses.
	type frame struct {
		node     Node[T]
		next     int
		children []Address // one per entry, in key order
	}
	chunks := make(map[Address][]byte)
	stack := []frame{{node: n}}
	for {
		top := len(stack) - 1
		if f := &stack[top]; f.next < len(f.node.entries) {
			child := f.node.entries[f.next].Node
			f.next++
			stack = append(stack, frame{node: child})
			continue
		}
		octets := linkedChunk(header, stack[top].node, stack[top].children, c)
		address := addressOf(octets)
		chunks[address] = octets
		stack = stack[:top]
		if top == 0 {
			return address, chunks, nil
		}
		stack[top-1].children = append(stack[top-1].children, address)
	}
}

// linkedChunk writes one node's chunk, given its children's addresses in key order.
func linkedChunk[T any](header []byte, n Node[T], children []Address, c SlotCodec[T]) []byte {
	// First-use order: each distinct child hash joins the header when first referenced.
	links := make([]Address, 0, len(children))
	index := make([]uint64, len(children))
	first := make(map[Address]uint64, len(children))
	for i, child := range children {
		k, seen := first[child]
		if !seen {
			k = uint64(len(links))
			first[child] = k
			links = append(links, child)
		}
		index[i] = k
	}
	out := append([]byte(nil), header...)
	out = AppendCuvarint(out, uint64(len(links)))
	for _, link := range links {
		out = append(out, link.digest[:]...)
	}
	out = appendFlatHead(out, c.Encode(n.own), len(n.entries))
	for i, entry := range n.entries {
		out = AppendCuvarint(out, uint64(len(entry.Key)))
		out = append(out, entry.Key...)
		out = AppendCuvarint(out, index[i])
	}
	return out
}

// Fetch retrieves a chunk's octets by address from a store, which is untrusted: every
// chunk is verified against the address it was fetched by. False means the store has no
// chunk at that address.
type Fetch func(Address) ([]byte, bool)

// Chunk is one chunk of a linked closure: its octets verified against the address by
// which it was reached, and its framing judged canonical under §6 — links header and
// body. Its payload has been judged by no slot codec. A Chunk is immutable.
type Chunk struct {
	address  Address
	size     uint64
	id       []byte
	reserved bool
	links    []Address
	payload  []byte
	keys     [][]byte
	index    []uint64 // each entry's link index
}

// Address is the address this chunk was verified against.
func (c *Chunk) Address() Address { return c.address }

// SlotCodecID is the chunk's slot-codec-id. The octets are a copy.
func (c *Chunk) SlotCodecID() []byte { return bytes.Clone(c.id) }

// Payload is the chunk's payload octets, framed but not decoded: no slot codec has
// judged them. The octets are a copy.
func (c *Chunk) Payload() []byte { return bytes.Clone(c.payload) }

// Len is the number of entries.
func (c *Chunk) Len() int { return len(c.keys) }

// Keys is the entries' keys in ascending order. Keys are copies.
func (c *Chunk) Keys() [][]byte {
	out := make([][]byte, len(c.keys))
	for i, key := range c.keys {
		out[i] = bytes.Clone(key)
	}
	return out
}

// ChunkEntry is one entry of a chunk: its key, and the address its link names.
type ChunkEntry struct {
	Key   []byte
	Child Address
}

// Children is the entries in ascending key order, each key with the address its link
// names. Keys are copies. Nothing is fetched: ResolveChild is what verifies a child.
func (c *Chunk) Children() []ChunkEntry {
	out := make([]ChunkEntry, len(c.keys))
	for i, key := range c.keys {
		out[i] = ChunkEntry{Key: bytes.Clone(key), Child: c.links[c.index[i]]}
	}
	return out
}

// ResolveRoot is resolve-root (§14): the chunk at the address the caller asks for,
// fetched, verified against that address, and framing-judged. It is the only place a
// caller's question enters a traversal, so it is what establishes that a closure is the
// value that was asked for.
//
// A fault of the store is a [*StoreError] (missing_chunk, hash_mismatch); a fault of the
// octets is a [Refusal]. A nil limits means [DefaultLimits].
//
// A chunk's size is met when it is fetched, before the hash check and the parse (§12):
// chunk_octets, and — the root being the first chunk of any closure it anchors — its
// share of unique_chunks and unique_octets. No fault inside the chunk precedes them.
func ResolveRoot(root Address, fetch Fetch, limits *Limits) (*Chunk, error) {
	l := limitsOrDefault(limits)
	if l.UniqueChunks < 1 {
		return nil, exceeded(DimensionUniqueChunks)
	}
	octets, ok := fetch(root)
	if !ok {
		return nil, &StoreError{code: CodeMissingChunk, address: root}
	}
	if uint64(len(octets)) > l.ChunkOctets {
		return nil, exceeded(DimensionChunkOctets)
	}
	if uint64(len(octets)) > l.UniqueOctets {
		return nil, exceeded(DimensionUniqueOctets)
	}
	return verifyChunk(root, octets, &l)
}

// ResolveChild is resolve-child (§14): the child under key, fetched by the hash in this
// chunk's links header and verified against it, framing-judged, and refused as
// slot_codec_mismatch if its slot-codec-id differs from this chunk's. It reports false
// when key is not one of this chunk's keys. What it establishes is only that the child
// is the one this chunk references; it cannot anchor a closure.
func (c *Chunk) ResolveChild(key []byte, fetch Fetch, limits *Limits) (*Chunk, bool, error) {
	i, found := slices.BinarySearchFunc(c.keys, key, bytes.Compare)
	if !found {
		return nil, false, nil
	}
	l := limitsOrDefault(limits)
	address := c.links[c.index[i]]
	octets, ok := fetch(address)
	if !ok {
		return nil, true, &StoreError{code: CodeMissingChunk, address: address}
	}
	if uint64(len(octets)) > l.ChunkOctets {
		return nil, true, exceeded(DimensionChunkOctets)
	}
	child, err := verifyChunk(address, octets, &l)
	if err != nil {
		return nil, true, err
	}
	// Read first, ruled last: the child's framing is judged before its id is compared.
	if !bytes.Equal(child.id, c.id) {
		return nil, true, invalid(CodeSlotCodecMismatch)
	}
	return child, true, nil
}

// verifyChunk checks octets against the address they were fetched by, then judges
// their framing.
func verifyChunk(address Address, octets []byte, l *Limits) (*Chunk, error) {
	if addressOf(octets) != address {
		return nil, &StoreError{code: CodeHashMismatch, address: address}
	}
	return decodeChunk(address, octets, l)
}

// chunkReader reads one whole chunk: the end of its octets is the end of input.
type chunkReader struct {
	b   []byte
	off int
	l   *Limits
}

func (r *chunkReader) take(n uint64) ([]byte, error) {
	if n > uint64(len(r.b)-r.off) {
		return nil, invalid(CodeUnexpectedEOF)
	}
	out := r.b[r.off : r.off+int(n)]
	r.off += int(n)
	return out, nil
}

func (r *chunkReader) varint() (uint64, error) {
	v, n, s := scanUvarint(r.b[r.off:])
	switch s {
	case uvarintOK:
	case uvarintShort:
		if n == 0 {
			return 0, invalid(CodeUnexpectedEOF)
		}
		return 0, invalid(CodeMalformedUvarint)
	default:
		return 0, invalid(uvarintFault(s))
	}
	r.off += n
	if v > r.l.VarintValue {
		return 0, exceeded(DimensionVarintValue)
	}
	return v, nil
}

// decodeChunk judges one chunk's framing in parse order (§6, §10). The links faults
// follow the parse: a repeated hash is seen as the header is read, before any entry; at
// each entry, an index out of range is bad_link_index before it can be out of first-use
// order; and a hash no entry used is unused_link once the entries end, before any
// trailing octet.
func decodeChunk(address Address, octets []byte, l *Limits) (*Chunk, error) {
	r := chunkReader{b: octets, l: l}
	magic, err := r.take(uint64(len(linkedMagic)))
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(magic, linkedMagic) {
		return nil, invalid(CodeUnknownMagic)
	}
	idLength, err := r.varint()
	if err != nil {
		return nil, err
	}
	if idLength < 2 || idLength > 32 {
		return nil, invalid(CodeMalformedSlotCodecID)
	}
	if idLength > l.SlotCodecIDLength {
		return nil, exceeded(DimensionSlotCodecIDLength)
	}
	id, err := r.take(idLength)
	if err != nil {
		return nil, err
	}
	reserved, err := judgeID(id, l.VarintValue)
	if err != nil {
		return nil, err
	}
	c := &Chunk{address: address, size: uint64(len(octets)), id: bytes.Clone(id), reserved: reserved}

	nlinks, err := r.varint()
	if err != nil {
		return nil, err
	}
	if nlinks > l.LinksPerChunk {
		return nil, exceeded(DimensionLinksPerChunk)
	}
	seen := make(map[Address]bool)
	for range nlinks {
		digest, err := r.take(sha256.Size)
		if err != nil {
			return nil, err
		}
		var link Address
		copy(link.digest[:], digest)
		if seen[link] {
			return nil, invalid(CodeDuplicateLinkHash)
		}
		seen[link] = true
		c.links = append(c.links, link)
	}

	payloadLength, err := r.varint()
	if err != nil {
		return nil, err
	}
	if payloadLength > l.PayloadLength {
		return nil, exceeded(DimensionPayloadLength)
	}
	payload, err := r.take(payloadLength)
	if err != nil {
		return nil, err
	}
	c.payload = bytes.Clone(payload)
	count, err := r.varint()
	if err != nil {
		return nil, err
	}
	if count > l.EntriesPerNode {
		return nil, exceeded(DimensionEntriesPerNode)
	}
	used := uint64(0) // links first used so far: the next new index must be this one
	for i := range count {
		keyLength, err := r.varint()
		if err != nil {
			return nil, err
		}
		if keyLength > l.KeyLength {
			return nil, exceeded(DimensionKeyLength)
		}
		key, err := r.take(keyLength)
		if err != nil {
			return nil, err
		}
		if i > 0 {
			switch cmp := bytes.Compare(key, c.keys[i-1]); {
			case cmp == 0:
				return nil, invalid(CodeDuplicateKey)
			case cmp < 0:
				return nil, invalid(CodeUnsortedKeys)
			}
		}
		link, err := r.varint()
		if err != nil {
			return nil, err
		}
		switch {
		case link >= nlinks:
			return nil, invalid(CodeBadLinkIndex)
		case link > used:
			return nil, invalid(CodeLinksOutOfOrder)
		case link == used:
			used++
		}
		c.keys = append(c.keys, bytes.Clone(key))
		c.index = append(c.index, link)
	}
	if used < nlinks {
		return nil, invalid(CodeUnusedLink)
	}
	if r.off < len(r.b) {
		return nil, invalid(CodeTrailingBytes)
	}
	return c, nil
}

// --- closures ------------------------------------------------------------------------

// closureNode is one distinct chunk of a closure, with its children by link index and
// the measures of the subtree it denotes.
type closureNode struct {
	chunk    *Chunk
	children []*closureNode
	done     bool
	height   uint64 // keys on the longest path down from here
	nodes    uint64 // unfolded node occurrences, saturating
	octets   uint64 // unfolded flat node octets, saturating
}

type closure struct {
	root  *closureNode
	order []*closureNode // distinct chunks in first-visit order
}

// flatOctets is the size of the closure's flat artifact, header included.
func (cl *closure) flatOctets() uint64 {
	id := uint64(len(cl.root.chunk.id))
	return satAdd(uint64(len(flatMagic))+cuvarintLen(id)+id, cl.root.octets)
}

// traverse validates the closure under root: every distinct reachable chunk fetched
// once, verified against the hash that reached it, framing-judged, and compared with
// its parent's id — depth first, in links-header order, with a visited set, so
// termination and cost rest on nothing but the limits. Measures are computed bottom-up
// with saturating arithmetic, and nothing is materialized. Each chunk's size is met at
// its fetch, before its hash check and parse (§12); the root's was met by ResolveRoot,
// and is met again here in case the root was resolved under other limits.
func traverse(root *Chunk, fetch Fetch, l *Limits) (*closure, error) {
	if l.UniqueChunks < 1 {
		return nil, exceeded(DimensionUniqueChunks)
	}
	if root.size > l.ChunkOctets {
		return nil, exceeded(DimensionChunkOctets)
	}
	if root.size > l.UniqueOctets {
		return nil, exceeded(DimensionUniqueOctets)
	}
	unique := root.size
	start := &closureNode{chunk: root, children: make([]*closureNode, len(root.links))}
	visited := map[Address]*closureNode{root.address: start}
	cl := &closure{root: start, order: []*closureNode{start}}

	type frame struct {
		node  *closureNode
		next  int
		depth uint64
	}
	stack := []frame{{node: start}}
	for len(stack) > 0 {
		top := len(stack) - 1
		f := &stack[top]
		if f.next < len(f.node.chunk.links) {
			i := f.next
			f.next++
			address := f.node.chunk.links[i]
			depth := f.depth + 1
			if seen, ok := visited[address]; ok {
				// Reached again, perhaps deeper than before. A chunk still open is on the
				// current path: a cycle, which denotes no finite tree.
				if !seen.done || satAdd(depth, seen.height) > l.LogicalDepth {
					return nil, exceeded(DimensionLogicalDepth)
				}
				f.node.children[i] = seen
				continue
			}
			if depth > l.LogicalDepth {
				return nil, exceeded(DimensionLogicalDepth)
			}
			if uint64(len(visited)) >= l.UniqueChunks {
				return nil, exceeded(DimensionUniqueChunks)
			}
			octets, ok := fetch(address)
			if !ok {
				return nil, &StoreError{code: CodeMissingChunk, address: address}
			}
			size := uint64(len(octets))
			if size > l.ChunkOctets {
				return nil, exceeded(DimensionChunkOctets)
			}
			if satAdd(unique, size) > l.UniqueOctets {
				return nil, exceeded(DimensionUniqueOctets)
			}
			chunk, err := verifyChunk(address, octets, l)
			if err != nil {
				return nil, err
			}
			if !bytes.Equal(chunk.id, f.node.chunk.id) {
				return nil, invalid(CodeSlotCodecMismatch)
			}
			unique += size
			child := &closureNode{chunk: chunk, children: make([]*closureNode, len(chunk.links))}
			visited[address] = child
			cl.order = append(cl.order, child)
			f.node.children[i] = child
			stack = append(stack, frame{node: child, depth: depth})
			continue
		}
		n := f.node
		c := n.chunk
		n.nodes = 1
		n.octets = cuvarintLen(uint64(len(c.payload))) + uint64(len(c.payload)) + cuvarintLen(uint64(len(c.keys)))
		for j, key := range c.keys {
			child := n.children[c.index[j]]
			n.height = max(n.height, child.height+1)
			n.nodes = satAdd(n.nodes, child.nodes)
			n.octets = satAdd(n.octets, cuvarintLen(uint64(len(key)))+uint64(len(key)))
			n.octets = satAdd(n.octets, child.octets)
		}
		n.done = true
		stack = stack[:top]
	}
	return cl, nil
}

// CheckClosure is the closure-checker: every chunk reachable from root is present,
// matches the hash that reached it, is framed canonically, and carries root's
// slot-codec-id. It decodes no payload, so it never reports non_canonical_payload, and
// success certifies an opaque closure present — never a validated value (§15).
func CheckClosure(root *Chunk, fetch Fetch, limits *Limits) error {
	l := limitsOrDefault(limits)
	_, err := traverse(root, fetch, &l)
	return err
}

// Unfolded measures the tree a linked closure denotes, computed over the DAG with
// saturating arithmetic: at most 2^64 − 1, whatever the sharing.
type Unfolded struct {
	Nodes      uint64 // node occurrences
	FlatOctets uint64 // octets of the flat artifact, header included
}

// EstimateUnfolded validates the closure under root as [CheckClosure] does and measures
// the tree it denotes, without materializing anything.
func EstimateUnfolded(root *Chunk, fetch Fetch, limits *Limits) (Unfolded, error) {
	l := limitsOrDefault(limits)
	cl, err := traverse(root, fetch, &l)
	if err != nil {
		return Unfolded{}, err
	}
	return Unfolded{Nodes: cl.root.nodes, FlatOctets: cl.flatOctets()}, nil
}

// validate is the linked-resolver's judgment before it spends: the closure's framing,
// then capability (§11), then every distinct payload against D in first-visit order.
func validate[T any](root *Chunk, fetch Fetch, registry Registry[T], l *Limits) (*closure, SlotCodec[T], error) {
	cl, err := traverse(root, fetch, l)
	if err != nil {
		return nil, nil, err
	}
	codec, err := hold(registry, root.id, root.reserved)
	if err != nil {
		return nil, nil, err
	}
	for _, n := range cl.order {
		if _, ok := canonical(codec, n.chunk.payload); !ok {
			return nil, nil, invalid(CodeNonCanonicalPayload)
		}
	}
	return cl, codec, nil
}

// Materialize is the linked-resolver's materialization: the whole closure under root
// validated, then the tree it denotes built, within the explicit budget of limits
// (§12). The unfolded node count and flat octets are estimated over the DAG first and a
// budget they exceed is refused before any node is built. Every occurrence of a shared
// chunk is decoded separately, so the result shares no payload between positions. A nil
// limits means [DefaultLimits].
func Materialize[T any](root *Chunk, fetch Fetch, registry Registry[T], limits *Limits) (Decoded[T], error) {
	l := limitsOrDefault(limits)
	cl, codec, err := validate(root, fetch, registry, &l)
	if err != nil {
		return Decoded[T]{}, err
	}
	if cl.root.nodes > l.UnfoldedNodeCount {
		return Decoded[T]{}, exceeded(DimensionUnfoldedNodeCount)
	}
	if cl.flatOctets() > l.UnfoldedFlatOctets {
		return Decoded[T]{}, exceeded(DimensionUnfoldedFlatOctets)
	}

	type frame struct {
		node    *closureNode
		next    int
		entries []Entry[T]
	}
	stack := []frame{{node: cl.root}}
	for {
		top := len(stack) - 1
		f := &stack[top]
		c := f.node.chunk
		if f.next < len(c.keys) {
			child := f.node.children[c.index[f.next]]
			stack = append(stack, frame{node: child})
			continue
		}
		own, _ := codec.Decode(bytes.Clone(c.payload))
		node := Node[T]{own: own, entries: f.entries}
		stack = stack[:top]
		if top == 0 {
			return Decoded[T]{Node: node, Codec: codec}, nil
		}
		parent := &stack[top-1]
		parent.entries = append(parent.entries, Entry[T]{Key: parent.node.chunk.keys[parent.next], Node: node})
		parent.next++
	}
}

// DecodeLinked resolves the value at root: [ResolveRoot], then [Materialize].
func DecodeLinked[T any](root Address, fetch Fetch, registry Registry[T], limits *Limits) (Decoded[T], error) {
	chunk, err := ResolveRoot(root, fetch, limits)
	if err != nil {
		return Decoded[T]{}, err
	}
	return Materialize(chunk, fetch, registry, limits)
}

// Flatten is the bridge from the linked form to the flat one: the dxf2 artifact of the
// value the closure under root denotes, validated as [Materialize] validates it, within
// the explicit output budget limits.UnfoldedFlatOctets, which is checked against the
// DAG estimate before any octet is written. Payload octets are copied, not re-encoded:
// they were judged canonical.
func Flatten[T any](root *Chunk, fetch Fetch, registry Registry[T], limits *Limits) ([]byte, error) {
	l := limitsOrDefault(limits)
	cl, _, err := validate(root, fetch, registry, &l)
	if err != nil {
		return nil, err
	}
	size := cl.flatOctets()
	if size > l.UnfoldedFlatOctets {
		return nil, exceeded(DimensionUnfoldedFlatOctets)
	}
	out := make([]byte, 0, size)
	out = append(out, flatMagic...)
	out = AppendCuvarint(out, uint64(len(root.id)))
	out = append(out, root.id...)
	out = appendFlatHead(out, cl.root.chunk.payload, len(cl.root.chunk.keys))

	type frame struct {
		node *closureNode
		next int
	}
	stack := []frame{{node: cl.root}}
	for len(stack) > 0 {
		top := len(stack) - 1
		f := &stack[top]
		c := f.node.chunk
		if f.next == len(c.keys) {
			stack = stack[:top]
			continue
		}
		key := c.keys[f.next]
		child := f.node.children[c.index[f.next]]
		f.next++
		out = AppendCuvarint(out, uint64(len(key)))
		out = append(out, key...)
		out = appendFlatHead(out, child.chunk.payload, len(child.chunk.keys))
		stack = append(stack, frame{node: child})
	}
	return out, nil
}
