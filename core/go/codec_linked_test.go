package deixis_test

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"maps"
	"math"
	"testing"
	"time"

	deixis "github.com/bitspark/deixis/core/go"
)

// store is an in-memory, untrusted chunk store.
type store map[deixis.Address][]byte

func (s store) fetch(a deixis.Address) ([]byte, bool) {
	b, ok := s[a]
	return b, ok
}

// address is the address of chunk octets: ("dxl2", SHA-256).
func address(octets []byte) deixis.Address {
	digest := sha256.Sum256(octets)
	a, err := deixis.NewAddress(deixis.AddressSpace, digest[:])
	if err != nil {
		panic(err)
	}
	return a
}

func encodeLinked[T any](t testing.TB, n deixis.Node[T], c deixis.SlotCodec[T]) (deixis.Address, store) {
	t.Helper()
	root, chunks, err := deixis.EncodeLinked(n, c)
	if err != nil {
		t.Fatalf("EncodeLinked: %v", err)
	}
	for a, octets := range chunks {
		if address(octets) != a {
			t.Fatalf("chunk listed under %s hashes elsewhere", a)
		}
	}
	return root, chunks
}

func resolveRoot(t testing.TB, root deixis.Address, s store, limits *deixis.Limits) *deixis.Chunk {
	t.Helper()
	chunk, err := deixis.ResolveRoot(root, s.fetch, limits)
	if err != nil {
		t.Fatalf("ResolveRoot: %s", verdict(err))
	}
	return chunk
}

func countNodes[T any](n deixis.Node[T]) uint64 {
	count := uint64(1)
	for _, e := range n.Entries() {
		count += countNodes(e.Node)
	}
	return count
}

// subtrees calls each on every subtree of n, n included.
func subtrees[T any](n deixis.Node[T], each func(deixis.Node[T])) {
	each(n)
	for _, e := range n.Entries() {
		subtrees(e.Node, each)
	}
}

func TestAddressesAreVersionQualified(t *testing.T) {
	digest := sha256.Sum256([]byte("x"))
	a, err := deixis.NewAddress("dxl2", digest[:])
	if err != nil || a.Space() != "dxl2" || a.Digest() != digest || a.String()[:5] != "dxl2:" {
		t.Fatalf("an address is the pair (dxl2, digest): %v %v", a, err)
	}
	for _, space := range []string{"", "dxl1", "dxf2", "DXL2"} {
		if _, err := deixis.NewAddress(space, digest[:]); err == nil {
			t.Errorf("%q is not the v2 address space", space)
		}
	}
	for _, n := range []int{0, 31, 33} {
		if _, err := deixis.NewAddress("dxl2", make([]byte, n)); err == nil {
			t.Errorf("a %d-octet digest is not a dxl2 digest", n)
		}
	}
}

func TestLinkedRoundTripAndTheBridge(t *testing.T) {
	check := func(name string, root deixis.Address, s store, reencode func() (deixis.Address, store, bool), flat []byte, nodes uint64, holding, blind func(*deixis.Chunk) ([]byte, error)) {
		t.Helper()
		again, againChunks, equal := reencode()
		if !equal {
			t.Errorf("%s: the resolved value is not =_≈ to the encoded one", name)
		}
		if again != root || !maps.EqualFunc(againChunks, s, bytes.Equal) {
			t.Errorf("%s: the resolved value re-encodes to another closure", name)
		}
		chunk := resolveRoot(t, root, s, nil)
		if err := deixis.CheckClosure(chunk, s.fetch, nil); err != nil {
			t.Errorf("%s: CheckClosure: %s", name, verdict(err))
		}
		u, err := deixis.EstimateUnfolded(chunk, s.fetch, nil)
		if err != nil || u.Nodes != nodes || u.FlatOctets != uint64(len(flat)) {
			t.Errorf("%s: estimated %+v (%v), want %d nodes and %d octets", name, u, err, nodes, len(flat))
		}
		// The bridge: the linked closure flattens to the flat form's canonical octets.
		got, err := holding(chunk)
		if err != nil || !bytes.Equal(got, flat) {
			t.Errorf("%s: flattened to other octets than the flat encoder's (%s)", name, verdict(err))
		}
		// §7: the flat form's digest is a lawful invariant, never an address.
		if root.Digest() == sha256.Sum256(flat) {
			t.Errorf("%s: the flat digest is the address", name)
		}
		_, err = blind(chunk)
		expect(t, name+", flattened blind", err, refusedAs(deixis.CodeUnsupportedSlotCodec))
	}
	for i, n := range byteTrees(t) {
		c := deixis.IdentityBytes()
		root, s := encodeLinked(t, n, c)
		check(fmt.Sprint("byte tree ", i), root, s, func() (deixis.Address, store, bool) {
			got, err := deixis.DecodeLinked(root, s.fetch, deixis.Holding(c), nil)
			if err != nil {
				t.Fatalf("byte tree %d: %s", i, verdict(err))
			}
			again, againChunks := encodeLinked(t, got.Node, got.Codec)
			return again, againChunks, got.Node.EqualBy(n, c.Equal)
		}, encodeFlat(t, n, c), countNodes(n), func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten(ch, s.fetch, deixis.Holding(c), nil)
		}, func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten[[]byte](ch, s.fetch, nil, nil)
		})
	}
	for i, n := range optionTrees(t) {
		c := deixis.OptionOf(deixis.IdentityBytes())
		root, s := encodeLinked(t, n, c)
		check(fmt.Sprint("option tree ", i), root, s, func() (deixis.Address, store, bool) {
			got, err := deixis.DecodeLinked(root, s.fetch, deixis.Holding(c), nil)
			if err != nil {
				t.Fatalf("option tree %d: %s", i, verdict(err))
			}
			again, againChunks := encodeLinked(t, got.Node, got.Codec)
			return again, againChunks, got.Node.EqualBy(n, c.Equal)
		}, encodeFlat(t, n, c), countNodes(n), func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten(ch, s.fetch, deixis.Holding(c), nil)
		}, func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten[deixis.Option[[]byte]](ch, s.fetch, nil, nil)
		})
	}
	for i, n := range coarseTrees(t) {
		c := deixis.SlotCodec[coarse](coarseCodec{})
		root, s := encodeLinked(t, n, c)
		check(fmt.Sprint("coarse tree ", i), root, s, func() (deixis.Address, store, bool) {
			got, err := deixis.DecodeLinked(root, s.fetch, deixis.Holding(c), nil)
			if err != nil {
				t.Fatalf("coarse tree %d: %s", i, verdict(err))
			}
			again, againChunks := encodeLinked(t, got.Node, got.Codec)
			return again, againChunks, got.Node.EqualBy(n, c.Equal)
		}, encodeFlat(t, n, c), countNodes(n), func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten(ch, s.fetch, deixis.Holding(c), nil)
		}, func(ch *deixis.Chunk) ([]byte, error) {
			return deixis.Flatten[coarse](ch, s.fetch, nil, nil)
		})
	}
}

// Law 2: the chunk set is a function of the value — one chunk per distinct subtree,
// however often it occurs. Distinct subtrees are counted by their flat octets, which
// are equal exactly when the subtrees are =_≈ (law 1).
func TestOneChunkPerDistinctSubtree(t *testing.T) {
	c := deixis.IdentityBytes()
	g := newGen(7)
	shared := tree(t, g, 3, 3, g.bytes)
	sharing := mustCompose(t, []byte{0}, []deixis.Entry[[]byte]{
		{Key: []byte("a"), Node: shared}, {Key: []byte("b"), Node: shared},
		{Key: []byte("c"), Node: mustCompose(t, nil, []deixis.Entry[[]byte]{{Key: []byte("d"), Node: shared}})},
	})
	for i, n := range append(byteTrees(t), sharing) {
		_, s := encodeLinked(t, n, c)
		distinct := map[string]bool{}
		subtrees(n, func(sub deixis.Node[[]byte]) { distinct[string(encodeFlat(t, sub, c))] = true })
		if len(s) != len(distinct) {
			t.Errorf("tree %d: %d chunks for %d distinct subtrees", i, len(s), len(distinct))
		}
	}
}

// Law 2's identity: root addresses are equal exactly when the values are =_≈.
func TestAddressesAreEqualExactlyWhenValuesAreEqual(t *testing.T) {
	c := deixis.SlotCodec[coarse](coarseCodec{})
	g := newGen(8)
	var trees []deixis.Node[coarse]
	var roots []deixis.Address
	for range 300 {
		n := tree(t, g, 2, 2, g.coarse)
		root, s := encodeLinked(t, n, c)
		twinRoot, twinChunks := encodeLinked(t, representation(t, g, n), c)
		if twinRoot != root || !maps.EqualFunc(twinChunks, s, bytes.Equal) {
			t.Fatal("two representations of one value must have one address and one chunk set")
		}
		trees = append(trees, n)
		roots = append(roots, root)
	}
	equal := 0
	for i := range trees {
		for j := i + 1; j < len(trees); j++ {
			same := roots[i] == roots[j]
			if same != trees[i].EqualBy(trees[j], c.Equal) {
				t.Fatalf("trees %d and %d: addresses equal = %v, values =_≈ = %v", i, j, same, !same)
			}
			if same {
				equal++
			}
		}
	}
	if equal < 50 {
		t.Fatalf("the generator must produce equal pairs: %d", equal)
	}
	// One value under two slot codecs has two addresses.
	n := mustCompose[[]byte](t, []byte("x"), nil)
	a, _ := encodeLinked(t, n, deixis.IdentityBytes())
	b, _ := encodeLinked[[]byte](t, n, renamed{publicID(9)})
	if a == b {
		t.Fatal("the slot-codec-id is inside the hashed octets")
	}
}

func TestResolveChildNavigatesVerifiedChunks(t *testing.T) {
	c := deixis.IdentityBytes()
	for i, n := range byteTrees(t)[:20] {
		root, s := encodeLinked(t, n, c)
		chunk := resolveRoot(t, root, s, nil)
		if chunk.Address() != root || !bytes.Equal(chunk.SlotCodecID(), c.ID()) || chunk.Len() != n.Len() {
			t.Fatalf("tree %d: the root chunk does not describe the root", i)
		}
		if own, _ := n.Decompose(); !bytes.Equal(chunk.Payload(), c.Encode(own)) {
			t.Fatalf("tree %d: the root chunk's payload is not e(own)", i)
		}
		for j, key := range chunk.Keys() {
			if !bytes.Equal(key, n.Keys()[j]) {
				t.Fatalf("tree %d: key %d differs", i, j)
			}
			child, found, err := chunk.ResolveChild(key, s.fetch, nil)
			if !found || err != nil {
				t.Fatalf("tree %d: child %x: %v %s", i, key, found, verdict(err))
			}
			got, err := deixis.Materialize(child, s.fetch, deixis.Holding(c), nil)
			want, _ := n.Get(key)
			if err != nil || !got.Node.EqualBy(want, c.Equal) {
				t.Fatalf("tree %d: the child chunk under %x is not that subtree", i, key)
			}
		}
		if _, found, err := chunk.ResolveChild([]byte("no such key, surely"), s.fetch, nil); found || err != nil {
			t.Fatalf("tree %d: a missing key must be reported as missing", i)
		}
	}
}

func TestStoreFaultsAreNeverDecoderVerdicts(t *testing.T) {
	c := deixis.IdentityBytes()
	g := newGen(9)
	for range 10 {
		n := tree(t, g, 3, 3, g.bytes)
		root, s := encodeLinked(t, n, c)
		for a, octets := range s {
			tampered := maps.Clone(s)
			tampered[a] = append(bytes.Clone(octets), 0x00)
			_, err := deixis.DecodeLinked(root, tampered.fetch, deixis.Holding(c), nil)
			expect(t, "a tampered chunk", err, storeFault(deixis.CodeHashMismatch, a))
			missing := maps.Clone(s)
			delete(missing, a)
			_, err = deixis.DecodeLinked(root, missing.fetch, deixis.Holding(c), nil)
			expect(t, "a missing chunk", err, storeFault(deixis.CodeMissingChunk, a))
			if a == root {
				continue
			}
			// The closure-checker meets the same store.
			err = deixis.CheckClosure(resolveRoot(t, root, s, nil), missing.fetch, nil)
			expect(t, "a missing chunk, checked", err, storeFault(deixis.CodeMissingChunk, a))
		}
	}
	// The root is verified against the address that was asked for, and nothing else:
	// another value's intact chunk served under the requested address is a mismatch.
	one, _ := encodeLinked(t, mustCompose[[]byte](t, []byte{1}, nil), c)
	two, s2 := encodeLinked(t, mustCompose[[]byte](t, []byte{2}, nil), c)
	lying := store{one: s2[two]}
	_, err := deixis.ResolveRoot(one, lying.fetch, nil)
	expect(t, "another value's chunk under the requested address", err, storeFault(deixis.CodeHashMismatch, one))
}

// --- chunk faults --------------------------------------------------------------------

// rawChunk spells a chunk field by field with nothing checked. As with rawNode, tests use
// it only for inputs whose verdict a rule decides — and to build a sharing bomb, which no
// encoder can be asked for without unfolding it.
type rawChunk struct {
	magic    string // "" is "dxl2"
	id       []byte
	links    []deixis.Address
	payload  []byte
	count    int // written instead of len(entries) when not -1
	entries  []rawLentry
	trailing []byte
}

type rawLentry struct {
	key   string
	index uint64
}

func (c rawChunk) octets() []byte {
	magic := c.magic
	if magic == "" {
		magic = "dxl2"
	}
	out := deixis.AppendCuvarint([]byte(magic), uint64(len(c.id)))
	out = append(out, c.id...)
	out = deixis.AppendCuvarint(out, uint64(len(c.links)))
	for _, link := range c.links {
		digest := link.Digest()
		out = append(out, digest[:]...)
	}
	out = deixis.AppendCuvarint(out, uint64(len(c.payload)))
	out = append(out, c.payload...)
	count := len(c.entries)
	if c.count != -1 {
		count = c.count
	}
	out = deixis.AppendCuvarint(out, uint64(count))
	for _, e := range c.entries {
		out = deixis.AppendCuvarint(out, uint64(len(e.key)))
		out = append(out, e.key...)
		out = deixis.AppendCuvarint(out, e.index)
	}
	return append(out, c.trailing...)
}

// put stores octets under their own address.
func (s store) put(octets []byte) deixis.Address {
	a := address(octets)
	s[a] = octets
	return a
}

func entries(pairs ...rawLentry) []rawLentry { return pairs }

func TestChunkFramingAndLinksFaults(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	s := store{}
	_, leaves := encodeLinked(t, mustCompose[[]byte](t, []byte{1}, nil), deixis.IdentityBytes())
	maps.Copy(s, leaves)
	var one deixis.Address
	for a := range leaves {
		one = a
	}
	_, more := encodeLinked(t, mustCompose[[]byte](t, []byte{2}, nil), deixis.IdentityBytes())
	maps.Copy(s, more)
	var two deixis.Address
	for a := range more {
		two = a
	}
	for name, c := range map[string]struct {
		chunk rawChunk
		want  string
	}{
		"childless":                        {rawChunk{id: id, count: -1}, "accepted"},
		"one link, used twice":             {rawChunk{id: id, links: []deixis.Address{one}, count: -1, entries: entries(rawLentry{"a", 0}, rawLentry{"b", 0})}, "accepted"},
		"two links, first-use order":       {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 0}, rawLentry{"b", 1}, rawLentry{"c", 0})}, "accepted"},
		"a hash listed twice":              {rawChunk{id: id, links: []deixis.Address{one, one}, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeDuplicateLinkHash)},
		"a hash twice, an index too large": {rawChunk{id: id, links: []deixis.Address{one, one}, count: -1, entries: entries(rawLentry{"a", 5})}, refusedAs(deixis.CodeDuplicateLinkHash)},
		"an index too large":               {rawChunk{id: id, links: []deixis.Address{one}, count: -1, entries: entries(rawLentry{"a", 1})}, refusedAs(deixis.CodeBadLinkIndex)},
		"an index too large, links unused": {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 5})}, refusedAs(deixis.CodeBadLinkIndex)},
		"no links at all":                  {rawChunk{id: id, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeBadLinkIndex)},
		"out of first-use order":           {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 1}, rawLentry{"b", 0})}, refusedAs(deixis.CodeLinksOutOfOrder)},
		"out of order, a link unused":      {rawChunk{id: id, links: []deixis.Address{two, one}, count: -1, entries: entries(rawLentry{"a", 1})}, refusedAs(deixis.CodeLinksOutOfOrder)},
		"a link unused":                    {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeUnusedLink)},
		"a link and no entries":            {rawChunk{id: id, links: []deixis.Address{one}, count: -1}, refusedAs(deixis.CodeUnusedLink)},
		"a link unused, a trailing octet":  {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 0}), trailing: []byte{0}}, refusedAs(deixis.CodeUnusedLink)},
		"a trailing octet":                 {rawChunk{id: id, links: []deixis.Address{one}, count: -1, entries: entries(rawLentry{"a", 0}), trailing: []byte{0}}, refusedAs(deixis.CodeTrailingBytes)},
		"keys descending":                  {rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"b", 0}, rawLentry{"a", 1})}, refusedAs(deixis.CodeUnsortedKeys)},
		"keys equal":                       {rawChunk{id: id, links: []deixis.Address{one}, count: -1, entries: entries(rawLentry{"a", 0}, rawLentry{"a", 0})}, refusedAs(deixis.CodeDuplicateKey)},
		"a count above the entries":        {rawChunk{id: id, links: []deixis.Address{one}, count: 2, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeUnexpectedEOF)},
		"the flat magic":                   {rawChunk{magic: "dxf2", id: id, count: -1}, refusedAs(deixis.CodeUnknownMagic)},
		"n = 0":                            {rawChunk{id: publicID(0), count: -1}, malformedID},
		"an id over 32 octets":             {rawChunk{id: optionOf(31, publicID(1)), count: -1}, malformedID},
		"a reserved form":                  {rawChunk{id: []byte{0x03, 0x03}, count: -1}, refusedAs(deixis.CodeUnsupportedSlotCodec)},
	} {
		root := s.put(c.chunk.octets())
		_, err := deixis.DecodeLinked(root, s.fetch, registry, nil)
		expect(t, name, err, c.want)
	}
	// A truncated chunk is judged under its own address: the end of its octets is the end
	// of input.
	whole := rawChunk{id: id, links: []deixis.Address{one, two}, count: -1, entries: entries(rawLentry{"a", 0}, rawLentry{"b", 1})}.octets()
	for cut := range len(whole) {
		root := s.put(whole[:cut])
		_, err := deixis.ResolveRoot(root, s.fetch, nil)
		if v := verdict(err); v != refusedAs(deixis.CodeUnexpectedEOF) && v != refusedAs(deixis.CodeMalformedUvarint) {
			t.Errorf("a chunk cut at %d: %s", cut, v)
		}
	}
}

// §10 ⭐ at the chunk scale: a child's id is read before its body, and ruled on after it.
func TestChildIDsAreRuledAfterFraming(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	other := publicID(5)
	s := store{}
	stranger := s.put(rawChunk{id: other, payload: []byte{1}, count: -1}.octets())
	broken := s.put(rawChunk{id: other, payload: []byte{1}, count: -1, trailing: []byte{0}}.octets())
	for name, c := range map[string]struct {
		chunk rawChunk
		want  string
	}{
		"a child under another id":                   {rawChunk{id: id, links: []deixis.Address{stranger}, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeSlotCodecMismatch)},
		"a child under another id, badly framed":     {rawChunk{id: id, links: []deixis.Address{broken}, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeTrailingBytes)},
		"a parent's duplicate hash, a strange child": {rawChunk{id: id, links: []deixis.Address{stranger, stranger}, count: -1, entries: entries(rawLentry{"a", 0})}, refusedAs(deixis.CodeDuplicateLinkHash)},
	} {
		root := s.put(c.chunk.octets())
		_, err := deixis.DecodeLinked(root, s.fetch, registry, nil)
		expect(t, name, err, c.want)
		if c.want == refusedAs(deixis.CodeDuplicateLinkHash) {
			continue // the root itself does not resolve
		}
		err = deixis.CheckClosure(resolveRoot(t, root, s, nil), s.fetch, nil)
		expect(t, name+", checked", err, c.want)
	}
	parent := resolveRoot(t, s.put(rawChunk{id: id, links: []deixis.Address{stranger}, count: -1, entries: entries(rawLentry{"a", 0})}.octets()), s, nil)
	_, found, err := parent.ResolveChild([]byte("a"), s.fetch, nil)
	if !found {
		t.Fatal("the key is there")
	}
	expect(t, "resolve-child under another id", err, refusedAs(deixis.CodeSlotCodecMismatch))
}

func TestLinkedPayloadsAreJudgedLast(t *testing.T) {
	strict := deixis.SlotCodec[coarse](coarseCodec{})
	n := mustCompose(t, []byte("ok"), []deixis.Entry[[]byte]{
		{Key: []byte("a"), Node: mustCompose(t, []byte{0xc0, 0x80}, []deixis.Entry[[]byte]{{Key: []byte("b"), Node: mustCompose(t, []byte("ok"), nil)}})},
	})
	root, s := encodeLinked[[]byte](t, n, lenientTwin{})
	chunk := resolveRoot(t, root, s, nil)
	_, err := deixis.Materialize(chunk, s.fetch, deixis.Holding(strict), nil)
	expect(t, "holding", err, refusedAs(deixis.CodeNonCanonicalPayload))
	_, err = deixis.Flatten(chunk, s.fetch, deixis.Holding(strict), nil)
	expect(t, "flattened, holding", err, refusedAs(deixis.CodeNonCanonicalPayload))
	_, err = deixis.Materialize[coarse](chunk, s.fetch, nil, nil)
	expect(t, "blind", err, refusedAs(deixis.CodeUnsupportedSlotCodec))
	// The closure-checker decodes no payload: an opaque closure is present.
	if err := deixis.CheckClosure(chunk, s.fetch, nil); err != nil {
		t.Fatalf("checked: %s", verdict(err))
	}
	// A framing fault anywhere in the closure outranks a payload judgment made earlier in
	// the traversal: the root's payload is outside im(e), and its child is badly framed.
	child := s.put(rawChunk{id: coarseID, payload: []byte("ok"), count: -1, trailing: []byte{0}}.octets())
	bad := s.put(rawChunk{id: coarseID, payload: []byte{0xff}, links: []deixis.Address{child}, count: -1, entries: entries(rawLentry{"a", 0})}.octets())
	_, err = deixis.DecodeLinked(bad, s.fetch, deixis.Holding(strict), nil)
	expect(t, "a bad payload at the root, a bad frame below", err, refusedAs(deixis.CodeTrailingBytes))
}

func TestSharedChunksDecodeToIndependentPayloads(t *testing.T) {
	c := deixis.IdentityBytes()
	leaf := mustCompose(t, []byte{8}, nil)
	n := mustCompose(t, []byte{7}, []deixis.Entry[[]byte]{{Key: []byte("x"), Node: leaf}, {Key: []byte("y"), Node: leaf}})
	root, s := encodeLinked(t, n, c)
	if len(s) != 2 {
		t.Fatalf("two equal children are one chunk: %d chunks", len(s))
	}
	v, err := deixis.DecodeLinked(root, s.fetch, deixis.Holding(c), nil)
	if err != nil {
		t.Fatal(verdict(err))
	}
	x, _ := v.Node.Get([]byte("x"))
	y, _ := v.Node.Get([]byte("y"))
	x.Own()[0] = 9
	if y.Own()[0] != 8 {
		t.Fatal("mutating one occurrence's payload changed another's: sharing became observable")
	}
}

// --- the envelope (§12) --------------------------------------------------------------

// bomb is a closure of depth+1 chunks denoting a tree of 2^(depth+1) − 1 nodes: each
// chunk has two entries, both pointing at the next.
func bomb(depth int) (deixis.Address, store) {
	id := deixis.IdentityBytes().ID()
	s := store{}
	next := s.put(rawChunk{id: id, count: -1}.octets())
	for range depth {
		next = s.put(rawChunk{id: id, links: []deixis.Address{next}, count: -1, entries: entries(rawLentry{"a", 0}, rawLentry{"b", 0})}.octets())
	}
	return next, s
}

func TestASharingBombIsRefusedBeforeMaterialization(t *testing.T) {
	c := deixis.IdentityBytes()
	start := time.Now()
	root, s := bomb(70)
	chunk := resolveRoot(t, root, s, nil)
	u, err := deixis.EstimateUnfolded(chunk, s.fetch, nil)
	if err != nil || u.Nodes != math.MaxUint64 || u.FlatOctets != math.MaxUint64 {
		t.Fatalf("2^71 − 1 nodes must saturate: %+v %v", u, err)
	}
	_, err = deixis.Materialize(chunk, s.fetch, deixis.Holding(c), nil)
	expect(t, "materialized", err, limitOn(deixis.DimensionUnfoldedNodeCount))
	_, err = deixis.Flatten(chunk, s.fetch, deixis.Holding(c), nil)
	expect(t, "flattened", err, limitOn(deixis.DimensionUnfoldedFlatOctets))
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("refusing took %v: the estimate must not unfold", elapsed)
	}

	// A small bomb fits the budget, and its value is the tree it denotes.
	root, s = bomb(10)
	chunk = resolveRoot(t, root, s, nil)
	got, err := deixis.Materialize(chunk, s.fetch, deixis.Holding(c), nil)
	if err != nil || countNodes(got.Node) != 1<<11-1 {
		t.Fatalf("a bomb of depth 10 is %d nodes (%s)", countNodes(got.Node), verdict(err))
	}
	flat, err := deixis.Flatten(chunk, s.fetch, deixis.Holding(c), nil)
	if err != nil || !bytes.Equal(flat, encodeFlat(t, got.Node, c)) {
		t.Fatalf("a shared DAG must flatten to its tree's flat octets (%s)", verdict(err))
	}
	again, _ := encodeLinked(t, got.Node, c)
	if again != root {
		t.Fatal("re-encoding the materialized tree must give the DAG's own root address")
	}
}

func lowered(d deixis.Dimension, limit uint64) *deixis.Limits {
	l := deixis.DefaultLimits()
	if !l.Set(d, limit) {
		panic("not a dimension: " + d)
	}
	return &l
}

// atAndOver checks that a limit equal to the measure accepts and one below refuses on
// that dimension.
func atAndOver(t *testing.T, what string, d deixis.Dimension, measure uint64, run func(*deixis.Limits) error) {
	t.Helper()
	if err := run(lowered(d, measure)); err != nil {
		t.Errorf("%s at its %s limit %d: %s", what, d, measure, verdict(err))
	}
	expect(t, fmt.Sprintf("%s over its %s limit %d", what, d, measure-1), run(lowered(d, measure-1)), limitOn(d))
}

func TestFlatLimits(t *testing.T) {
	c := deixis.IdentityBytes()
	registry := deixis.Holding(c)
	decode := func(b []byte) func(*deixis.Limits) error {
		return func(l *deixis.Limits) error {
			_, err := deixis.DecodeFlat(b, registry, l)
			return err
		}
	}
	key := mustCompose(t, nil, []deixis.Entry[[]byte]{{Key: []byte("fivek"), Node: mustCompose[[]byte](t, nil, nil)}})
	atAndOver(t, "a five-octet key", deixis.DimensionKeyLength, 5, decode(encodeFlat(t, key, c)))
	payload := mustCompose(t, []byte("seven p"), []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose(t, []byte("seven p"), nil)}})
	atAndOver(t, "a seven-octet payload", deixis.DimensionPayloadLength, 7, decode(encodeFlat(t, payload, c)))
	three := wide(t, 3, func(int) []byte { return nil })
	atAndOver(t, "three entries", deixis.DimensionEntriesPerNode, 3, decode(encodeFlat(t, three, c)))
	deep := chain(t, 10, []byte("d"), func(int) []byte { return nil })
	atAndOver(t, "ten keys deep", deixis.DimensionLogicalDepth, 10, decode(encodeFlat(t, deep, c)))
	enc := encodeFlat(t, byteTrees(t)[6], c)
	atAndOver(t, "a whole artifact", deixis.DimensionFlatArtifactOctets, uint64(len(enc)), decode(enc))
	big := mustCompose(t, bytes.Repeat([]byte{1}, 300), nil)
	atAndOver(t, "a length of 300", deixis.DimensionVarintValue, 300, decode(encodeFlat(t, big, c)))
	atAndOver(t, "an 18-octet id", deixis.DimensionSlotCodecIDLength, 18, func(l *deixis.Limits) error {
		_, err := deixis.DecodeFlat(encodeFlat[coarse](t, mustCompose(t, coarse{class: "c"}, nil), coarseCodec{}), deixis.Holding[coarse](coarseCodec{}), l)
		return err
	})
	// Octets past a complete root are trailing_bytes wherever the limit lies.
	_, err := deixis.DecodeFlat(append(bytes.Clone(enc), 0x00), registry, lowered(deixis.DimensionFlatArtifactOctets, uint64(len(enc))))
	expect(t, "a trailing octet beyond the limit", err, refusedAs(deixis.CodeTrailingBytes))
	// A limit refusal is final to a streaming decoder, and the same for every split.
	l := lowered(deixis.DimensionFlatArtifactOctets, uint64(len(enc)-1))
	for cut := range len(enc) + 1 {
		d := deixis.NewFlatDecoder(registry, l)
		d.Feed(enc[:cut])
		d.Feed(enc[cut:])
		_, err := d.Finish()
		expect(t, fmt.Sprint("over the artifact limit, split at ", cut), err, limitOn(deixis.DimensionFlatArtifactOctets))
	}
}

// §12 (I10): a remainder is noticed without being read. After a root that ends exactly
// at flat_artifact_octets, a further octet is trailing_bytes, not limit_exceeded: whole,
// streamed at every split, and already while the stream is open. An octet past the limit
// that the parse needs, mid-structure, stays limit_exceeded.
func TestARemainderAtTheLimitIsTrailingBytes(t *testing.T) {
	c := deixis.IdentityBytes()
	registry := deixis.Holding(c)
	trailing := refusedAs(deixis.CodeTrailingBytes)
	over := limitOn(deixis.DimensionFlatArtifactOctets)
	for i, n := range fitting(t, byteTrees(t), c, 12) {
		enc := encodeFlat(t, n, c)
		atRootEnd := lowered(deixis.DimensionFlatArtifactOctets, uint64(len(enc)))
		insideRoot := lowered(deixis.DimensionFlatArtifactOctets, uint64(len(enc)-1))
		for _, extra := range [][]byte{{0x00}, {0xff, 0xff, 0xff}} {
			b := append(bytes.Clone(enc), extra...)
			name := fmt.Sprintf("tree %d and %d octets after it", i, len(extra))
			_, err := deixis.DecodeFlat(b, registry, atRootEnd)
			expect(t, name+", the limit at the root's end", err, trailing)
			_, err = deixis.DecodeFlat(b, registry, insideRoot)
			expect(t, name+", the limit inside the root", err, over)
			for cut := range len(b) + 1 {
				for _, run := range []struct {
					limits *deixis.Limits
					want   string
				}{{atRootEnd, trailing}, {insideRoot, over}} {
					d := deixis.NewFlatDecoder(registry, run.limits)
					d.Feed(b[:cut])
					// Every octet is present, so the verdict is final before the end.
					expect(t, fmt.Sprint(name, ", split at ", cut, ", open"), d.Feed(b[cut:]), run.want)
					_, err := d.Finish()
					expect(t, fmt.Sprint(name, ", split at ", cut, ", ended"), err, run.want)
				}
			}
		}
	}
}

// §12 (I8): a declared length or count above its limit is met at that field, before
// the octets it announces — even when the input ends before them, and at once in a
// stream.
func TestDeclaredLengthsAreMetAtTheirField(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	flat := func(fields ...uint64) []byte {
		b := header(id)
		for _, v := range fields {
			b = deixis.AppendCuvarint(b, v)
		}
		return b
	}
	for name, c := range map[string]struct {
		b     []byte
		d     deixis.Dimension
		limit uint64
	}{
		"a payload length, the payload cut off": {flat(8), deixis.DimensionPayloadLength, 7},
		"a count, the entries cut off":          {flat(0, 3), deixis.DimensionEntriesPerNode, 2},
		"a key length, the key cut off":         {flat(0, 1, 5), deixis.DimensionKeyLength, 4},
	} {
		_, err := deixis.DecodeFlat(c.b, registry, nil)
		expect(t, name+", within the floors", err, refusedAs(deixis.CodeUnexpectedEOF))
		_, err = deixis.DecodeFlat(c.b, registry, lowered(c.d, c.limit))
		expect(t, name, err, limitOn(c.d))
		d := deixis.NewFlatDecoder(registry, lowered(c.d, c.limit))
		expect(t, name+", streamed and open", d.Feed(c.b), limitOn(c.d))
	}
	// In a chunk, whose end is the end of input.
	chunk := func(fields ...uint64) []byte {
		b := append(deixis.AppendCuvarint([]byte("dxl2"), uint64(len(id))), id...)
		for _, v := range fields {
			b = deixis.AppendCuvarint(b, v)
		}
		return b
	}
	s := store{}
	for name, c := range map[string]struct {
		b     []byte
		d     deixis.Dimension
		limit uint64
	}{
		"nlinks, the hashes cut off":            {chunk(3), deixis.DimensionLinksPerChunk, 2},
		"a payload length, the payload cut off": {chunk(0, 8), deixis.DimensionPayloadLength, 7},
		"a count, the entries cut off":          {chunk(0, 0, 3), deixis.DimensionEntriesPerNode, 2},
		"a key length, the key cut off":         {chunk(0, 0, 1, 5), deixis.DimensionKeyLength, 4},
	} {
		root := s.put(c.b)
		_, err := deixis.ResolveRoot(root, s.fetch, nil)
		expect(t, name+", a chunk within the floors", err, refusedAs(deixis.CodeUnexpectedEOF))
		_, err = deixis.ResolveRoot(root, s.fetch, lowered(c.d, c.limit))
		expect(t, name+", a chunk", err, limitOn(c.d))
	}
}

// §12 (I6): a chunk is verified before it is parsed, so its size is met at its fetch —
// chunk_octets, and its share of unique_octets — before the hash check and the parse.
// No fault inside a chunk precedes them, at the root or below it.
func TestAChunkSizeIsMetAtItsFetch(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	// Octets with a framing fault inside: a trailing octet after a long payload.
	broken := rawChunk{id: id, payload: bytes.Repeat([]byte{7}, 100), count: -1, trailing: []byte{0}}.octets()
	size := uint64(len(broken))
	s := store{}
	malformed := s.put(broken)
	mismatched := address([]byte("not these octets"))
	s[mismatched] = broken // served under an address the octets do not hash to
	resolve := func(root deixis.Address, l *deixis.Limits) error {
		_, err := deixis.DecodeLinked(root, s.fetch, registry, l)
		return err
	}
	faults := map[deixis.Address]string{
		malformed:  refusedAs(deixis.CodeTrailingBytes),
		mismatched: storeFault(deixis.CodeHashMismatch, mismatched),
	}
	for chunk, fault := range faults {
		expect(t, "a root at the floors", resolve(chunk, nil), fault)
		for _, d := range []deixis.Dimension{deixis.DimensionChunkOctets, deixis.DimensionUniqueOctets} {
			expect(t, fmt.Sprintf("a root (%s) over %s", fault, d), resolve(chunk, lowered(d, size-1)), limitOn(d))
		}
		// The same octets one level down: the parent is small and sound.
		parent := s.put(rawChunk{id: id, links: []deixis.Address{chunk}, count: -1, entries: entries(rawLentry{"a", 0})}.octets())
		unique := uint64(len(s[parent])) + size - 1
		expect(t, "a child at the floors", resolve(parent, nil), fault)
		expect(t, fmt.Sprintf("a child (%s) over chunk_octets", fault), resolve(parent, lowered(deixis.DimensionChunkOctets, size-1)), limitOn(deixis.DimensionChunkOctets))
		expect(t, fmt.Sprintf("a child (%s) over unique_octets", fault), resolve(parent, lowered(deixis.DimensionUniqueOctets, unique)), limitOn(deixis.DimensionUniqueOctets))
		err := deixis.CheckClosure(resolveRoot(t, parent, s, nil), s.fetch, lowered(deixis.DimensionUniqueOctets, unique))
		expect(t, fmt.Sprintf("a child (%s) over unique_octets, checked", fault), err, limitOn(deixis.DimensionUniqueOctets))
	}
}

func TestLinkedLimits(t *testing.T) {
	c := deixis.IdentityBytes()
	registry := deixis.Holding(c)
	materialize := func(n deixis.Node[[]byte]) func(*deixis.Limits) error {
		root, s := encodeLinked(t, n, c)
		return func(l *deixis.Limits) error {
			_, err := deixis.DecodeLinked(root, s.fetch, registry, l)
			return err
		}
	}
	key := mustCompose(t, nil, []deixis.Entry[[]byte]{{Key: []byte("fivek"), Node: mustCompose[[]byte](t, nil, nil)}})
	atAndOver(t, "a five-octet key", deixis.DimensionKeyLength, 5, materialize(key))
	payload := mustCompose(t, []byte("seven p"), nil)
	atAndOver(t, "a seven-octet payload", deixis.DimensionPayloadLength, 7, materialize(payload))
	three := wide(t, 3, func(i int) []byte { return []byte{byte(i)} })
	atAndOver(t, "three entries", deixis.DimensionEntriesPerNode, 3, materialize(three))
	atAndOver(t, "three links", deixis.DimensionLinksPerChunk, 3, materialize(three))
	deep := chain(t, 10, []byte("d"), func(i int) []byte { return []byte{byte(i)} })
	atAndOver(t, "ten keys deep", deixis.DimensionLogicalDepth, 10, materialize(deep))

	// A shared subtree met first shallow, then deep: its depth is judged where it is
	// deepest, although it is fetched once.
	x := chain(t, 5, []byte("x"), func(i int) []byte { return []byte{byte(i)} })
	d := mustCompose(t, []byte("d"), []deixis.Entry[[]byte]{{Key: []byte("x"), Node: x}})
	cc := mustCompose(t, []byte("c"), []deixis.Entry[[]byte]{{Key: []byte("d"), Node: d}})
	b := mustCompose(t, []byte("b"), []deixis.Entry[[]byte]{{Key: []byte("c"), Node: cc}})
	dag := mustCompose(t, []byte("r"), []deixis.Entry[[]byte]{{Key: []byte("a"), Node: x}, {Key: []byte("b"), Node: b}})
	atAndOver(t, "a subtree reached twice", deixis.DimensionLogicalDepth, 9, materialize(dag))
	atAndOver(t, "the same tree, flat", deixis.DimensionLogicalDepth, 9, func(l *deixis.Limits) error {
		_, err := deixis.DecodeFlat(encodeFlat(t, dag, c), registry, l)
		return err
	})

	n := byteTrees(t)[8] // two identical subtrees
	root, s := encodeLinked(t, n, c)
	unique := uint64(0)
	for _, octets := range s {
		unique += uint64(len(octets))
	}
	atAndOver(t, "a closure's chunks", deixis.DimensionUniqueChunks, uint64(len(s)), materialize(n))
	atAndOver(t, "a closure's octets", deixis.DimensionUniqueOctets, unique, materialize(n))
	atAndOver(t, "a closure's unfolded nodes", deixis.DimensionUnfoldedNodeCount, countNodes(n), materialize(n))
	flat := uint64(len(encodeFlat(t, n, c)))
	atAndOver(t, "a closure's unfolded octets", deixis.DimensionUnfoldedFlatOctets, flat, materialize(n))
	atAndOver(t, "a flattening", deixis.DimensionUnfoldedFlatOctets, flat, func(l *deixis.Limits) error {
		_, err := deixis.Flatten(resolveRoot(t, root, s, nil), s.fetch, registry, l)
		return err
	})
	atAndOver(t, "a root chunk", deixis.DimensionChunkOctets, uint64(len(s[root])), func(l *deixis.Limits) error {
		_, err := deixis.ResolveRoot(root, s.fetch, l)
		return err
	})
	// Limits never refuse as invalid, and never in the closure-checker's stead.
	if err := deixis.CheckClosure(resolveRoot(t, root, s, nil), s.fetch, lowered(deixis.DimensionUnfoldedNodeCount, 1)); err != nil {
		t.Errorf("the closure-checker materializes nothing: %s", verdict(err))
	}
}

func TestLimitsSetEveryDimension(t *testing.T) {
	for _, d := range []deixis.Dimension{
		deixis.DimensionVarintValue, deixis.DimensionSlotCodecIDLength, deixis.DimensionKeyLength,
		deixis.DimensionPayloadLength, deixis.DimensionEntriesPerNode, deixis.DimensionLinksPerChunk,
		deixis.DimensionFlatArtifactOctets, deixis.DimensionChunkOctets, deixis.DimensionUniqueChunks,
		deixis.DimensionUniqueOctets, deixis.DimensionLogicalDepth, deixis.DimensionUnfoldedNodeCount,
		deixis.DimensionUnfoldedFlatOctets,
	} {
		l := deixis.DefaultLimits()
		if !l.Set(d, 7) || l == deixis.DefaultLimits() {
			t.Errorf("%s does not set a limit", d)
		}
	}
	var l deixis.Limits
	if l.Set("leaf_payload_length", 1) {
		t.Error("a token that is not §12's must be refused")
	}
}
