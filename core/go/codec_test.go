package deixis_test

// Tests of deixis-codec-v2 (docs/CODEC.md) through the public API.
//
// The independence rule of the codec work holds here: no test states the octets of an
// encoded node or chunk. Encoder output is judged by laws — round trip, canonical
// re-encoding, identity iff =_≈, exactness under mutation, split-invariance — and
// refusals by the verdict a rule assigns to an input built to break that rule. Integer
// and slot-codec-id spellings are derived from §3's and §13's rules by the helpers
// below; the only node octets a test assembles itself are rawFlat's and rawChunk's
// deliberately faulty inputs, and nothing is ever compared with them.

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"math/bits"
	"math/rand/v2"
	"testing"
	"unicode/utf8"

	deixis "github.com/bitspark/deixis/core/go"
)

// --- verdicts ------------------------------------------------------------------------

// verdict spells a result as one comparable string: "accepted", class/code for a
// refusal, class/code/dimension for a limit, or store/code/address for a store fault.
func verdict(err error) string {
	if err == nil {
		return "accepted"
	}
	var limit *deixis.LimitError
	if errors.As(err, &limit) {
		return fmt.Sprintf("%s/%s/%s", limit.Class(), limit.Code(), limit.Dimension())
	}
	var store *deixis.StoreError
	if errors.As(err, &store) {
		return fmt.Sprintf("store/%s/%s", store.Code(), store.Address())
	}
	var refusal deixis.Refusal
	if errors.As(err, &refusal) {
		return fmt.Sprintf("%s/%s", refusal.Class(), refusal.Code())
	}
	return "unexpected error: " + err.Error()
}

func refusedAs(code deixis.Code) string { return fmt.Sprintf("%s/%s", code.Class(), code) }

func limitOn(d deixis.Dimension) string {
	return fmt.Sprintf("%s/%s/%s", deixis.ClassResourceRefused, deixis.CodeLimitExceeded, d)
}

func storeFault(code deixis.Code, a deixis.Address) string {
	return fmt.Sprintf("store/%s/%s", code, a)
}

func expect(t *testing.T, what string, err error, want string) {
	t.Helper()
	if got := verdict(err); got != want {
		t.Errorf("%s: %s, want %s", what, got, want)
	}
}

// --- test codecs ---------------------------------------------------------------------

// privateID is 0x01 ‖ the first 16 octets of SHA-256(ns) ‖ cuvarint(k): a private id
// whose namespace is derived from a distinctive string, as §13 prefers.
func privateID(ns string, k uint64) []byte {
	h := sha256.Sum256([]byte(ns))
	return deixis.AppendCuvarint(append([]byte{0x01}, h[:16]...), k)
}

var coarseID = privateID("deixis core/go codec tests: a coarse setoid", 1)

// coarse is a slot whose equivalence is deliberately coarser than its representation:
// ≈ compares class, e is the UTF-8 of class, and D decodes UTF-8 strictly. A codec that
// reached for native equality, or a decoder that repaired a spelling, fails with it.
type coarse struct {
	class, rep string
}

type coarseCodec struct{}

func (coarseCodec) ID() []byte                 { return bytes.Clone(coarseID) }
func (coarseCodec) Equal(a, b coarse) bool     { return a.class == b.class }
func (coarseCodec) Encode(value coarse) []byte { return []byte(value.class) }
func (coarseCodec) Decode(payload []byte) (coarse, bool) {
	if !utf8.Valid(payload) {
		return coarse{}, false
	}
	return coarse{class: string(payload)}, true
}

// lenientTwin writes any payload octets under the coarse codec's id. Encoding a byte
// tree with it produces artifacts whose payloads may lie outside the coarse im(e) —
// inputs for non_canonical_payload, built by an encoder rather than by hand.
type lenientTwin struct{}

func (lenientTwin) ID() []byte                           { return bytes.Clone(coarseID) }
func (lenientTwin) Equal(a, b []byte) bool               { return bytes.Equal(a, b) }
func (lenientTwin) Encode(value []byte) []byte           { return value }
func (lenientTwin) Decode(payload []byte) ([]byte, bool) { return bytes.Clone(payload), true }

// renamed is identity-bytes under another id: an unregistered public ordinal, or any
// other id a test needs.
type renamed struct{ id []byte }

func (r renamed) ID() []byte                         { return bytes.Clone(r.id) }
func (renamed) Equal(a, b []byte) bool               { return bytes.Equal(a, b) }
func (renamed) Encode(value []byte) []byte           { return value }
func (renamed) Decode(payload []byte) ([]byte, bool) { return bytes.Clone(payload), true }

// publicID is 0x00 ‖ cuvarint(n).
func publicID(n uint64) []byte { return deixis.AppendCuvarint([]byte{0x00}, n) }

// --- generated trees -----------------------------------------------------------------

type gen struct{ r *rand.Rand }

func newGen(seed uint64) *gen { return &gen{r: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))} }

// Keys are drawn from a small alphabet so that prefix pairs, the empty key, octets that
// are not UTF-8 and octets equal to length and count spellings all occur.
var keyAlphabet = []byte{0x00, 0x01, 0x02, 0x61, 0x62, 0x7f, 0x80, 0xff}

func (g *gen) key() []byte {
	k := make([]byte, g.r.IntN(4))
	for i := range k {
		k[i] = keyAlphabet[g.r.IntN(len(keyAlphabet))]
	}
	return k
}

func (g *gen) bytes() []byte {
	b := make([]byte, g.r.IntN(4))
	for i := range b {
		b[i] = byte(g.r.IntN(256))
	}
	return b
}

func (g *gen) option() deixis.Option[[]byte] {
	if g.r.IntN(3) == 0 {
		return deixis.None[[]byte]()
	}
	return deixis.Some(g.bytes())
}

func mustCompose[T any](t testing.TB, own T, entries []deixis.Entry[T]) deixis.Node[T] {
	t.Helper()
	n, err := deixis.Compose(own, entries)
	if err != nil {
		t.Fatalf("Compose: %v", err)
	}
	return n
}

// tree is a random tree at most depth levels deep and width wide.
func tree[T any](t testing.TB, g *gen, depth, width int, own func() T) deixis.Node[T] {
	t.Helper()
	var entries []deixis.Entry[T]
	seen := map[string]bool{}
	if depth > 0 {
		for range g.r.IntN(width + 1) {
			k := g.key()
			if seen[string(k)] {
				continue
			}
			seen[string(k)] = true
			entries = append(entries, deixis.Entry[T]{Key: k, Node: tree(t, g, depth-1, width, own)})
		}
	}
	return mustCompose(t, own(), entries)
}

// chain is a path of depth keys, each node carrying own(i) for its depth i.
func chain[T any](t testing.TB, depth int, key []byte, own func(int) T) deixis.Node[T] {
	t.Helper()
	n := mustCompose[T](t, own(depth), nil)
	for i := depth - 1; i >= 0; i-- {
		n = mustCompose(t, own(i), []deixis.Entry[T]{{Key: key, Node: n}})
	}
	return n
}

// wide is one node with n childless children under distinct two-octet keys.
func wide[T any](t testing.TB, n int, own func(int) T) deixis.Node[T] {
	t.Helper()
	entries := make([]deixis.Entry[T], n)
	for i := range entries {
		entries[i] = deixis.Entry[T]{Key: []byte{byte(i >> 8), byte(i)}, Node: mustCompose[T](t, own(i), nil)}
	}
	return mustCompose(t, own(-1), entries)
}

// byteTrees is the shape corpus under identity-bytes: empty and non-empty payloads at
// childless nodes and at parents, the empty key, keys that are prefixes of each other,
// keys that are not UTF-8, a wide node, a deep path, and random trees.
func byteTrees(t testing.TB) []deixis.Node[[]byte] {
	t.Helper()
	leaf := func(own []byte) deixis.Node[[]byte] { return mustCompose[[]byte](t, own, nil) }
	entry := func(key string, n deixis.Node[[]byte]) deixis.Entry[[]byte] {
		return deixis.Entry[[]byte]{Key: []byte(key), Node: n}
	}
	shared := mustCompose(t, []byte{1}, []deixis.Entry[[]byte]{entry("c", leaf(nil))})
	trees := []deixis.Node[[]byte]{
		leaf(nil),
		leaf([]byte{}),
		leaf([]byte{0}),
		leaf([]byte("payload")),
		mustCompose(t, []byte{0xaa}, []deixis.Entry[[]byte]{entry("a", leaf([]byte{1}))}),
		mustCompose(t, nil, []deixis.Entry[[]byte]{entry("", leaf([]byte{1}))}),
		mustCompose(t, nil, []deixis.Entry[[]byte]{
			entry("ab", leaf(nil)), entry("a", leaf(nil)), entry("", leaf(nil)), entry("abc", leaf([]byte{2})), entry("b", leaf(nil)),
		}),
		mustCompose(t, nil, []deixis.Entry[[]byte]{
			{Key: []byte{0xff}, Node: leaf([]byte{0x80})}, {Key: []byte{0x80, 0x00}, Node: leaf(nil)}, {Key: []byte{0x01}, Node: leaf([]byte{0x01})},
		}),
		mustCompose(t, nil, []deixis.Entry[[]byte]{entry("a", shared), entry("b", shared)}),
		wide(t, 300, func(i int) []byte { return []byte{byte(i)} }),
		chain(t, 200, []byte("k"), func(i int) []byte { return []byte{byte(i)} }),
	}
	g := newGen(1)
	for range 40 {
		trees = append(trees, tree(t, g, 4, 3, g.bytes))
	}
	return trees
}

func optionTrees(t testing.TB) []deixis.Node[deixis.Option[[]byte]] {
	t.Helper()
	g := newGen(2)
	trees := []deixis.Node[deixis.Option[[]byte]]{
		mustCompose[deixis.Option[[]byte]](t, deixis.None[[]byte](), nil),
		mustCompose[deixis.Option[[]byte]](t, deixis.Some([]byte{}), nil),
		chain(t, 50, []byte{0}, func(i int) deixis.Option[[]byte] {
			if i%2 == 0 {
				return deixis.None[[]byte]()
			}
			return deixis.Some([]byte{byte(i)})
		}),
	}
	for range 25 {
		trees = append(trees, tree(t, g, 3, 3, g.option))
	}
	return trees
}

var coarseClasses = []string{"", "a", "b", "ab", "é"}

func (g *gen) coarse() coarse {
	return coarse{class: coarseClasses[g.r.IntN(len(coarseClasses))], rep: fmt.Sprint(g.r.IntN(1000))}
}

func coarseTrees(t testing.TB) []deixis.Node[coarse] {
	t.Helper()
	g := newGen(3)
	var trees []deixis.Node[coarse]
	for range 25 {
		trees = append(trees, tree(t, g, 3, 3, g.coarse))
	}
	return trees
}

// representation re-draws every representation in n: a node =_≈ to n under the coarse
// codec and, in all likelihood, different from it natively.
func representation(t testing.TB, g *gen, n deixis.Node[coarse]) deixis.Node[coarse] {
	t.Helper()
	own, entries := n.Decompose()
	for i := range entries {
		entries[i].Node = representation(t, g, entries[i].Node)
	}
	own.rep = fmt.Sprint("r", g.r.IntN(1000))
	return mustCompose(t, own, entries)
}

func encodeFlat[T any](t testing.TB, n deixis.Node[T], c deixis.SlotCodec[T]) []byte {
	t.Helper()
	b, err := deixis.EncodeFlat(n, c)
	if err != nil {
		t.Fatalf("EncodeFlat: %v", err)
	}
	return b
}

// --- the integer domain (§3) ---------------------------------------------------------

func integerBoundaries() []uint64 {
	values := []uint64{0, 1, math.MaxUint64}
	for w := 1; w <= 9; w++ {
		edge := uint64(1) << (7 * w)
		values = append(values, edge-1, edge)
	}
	return append(values, 1<<63-1, 1<<63)
}

func TestCuvarintWidthBoundariesRoundTrip(t *testing.T) {
	for _, v := range integerBoundaries() {
		spelling := deixis.AppendCuvarint(nil, v)
		width := (max(bits.Len64(v), 1) + 6) / 7
		if len(spelling) != width {
			t.Errorf("%d: spelled in %d octets, want the shortest, %d", v, len(spelling), width)
		}
		got, n, err := deixis.ReadCuvarint(append(spelling, 0x55))
		if err != nil || got != v || n != len(spelling) {
			t.Errorf("%d: read back %d over %d octets (%v)", v, got, n, err)
		}
	}
}

func TestCuvarintRefusesEveryLongerSpelling(t *testing.T) {
	for _, v := range integerBoundaries() {
		spelling := deixis.AppendCuvarint(nil, v)
		// Pad with continuing zero groups: the same value, more octets.
		for longer := bytes.Clone(spelling); len(longer) < 10; {
			longer[len(longer)-1] |= 0x80
			longer = append(longer, 0x00)
			_, _, err := deixis.ReadCuvarint(longer)
			expect(t, fmt.Sprintf("%d padded to %d octets", v, len(longer)), err, refusedAs(deixis.CodeNonShortestUvarint))
		}
	}
}

func TestCuvarintLengthBeforeDomain(t *testing.T) {
	ten := bytes.Repeat([]byte{0x80}, 10)
	for _, last := range []byte{0x00, 0x01, 0x7f} {
		_, _, err := deixis.ReadCuvarint(append(bytes.Clone(ten), last))
		expect(t, "eleven octets", err, refusedAs(deixis.CodeMalformedUvarint))
	}
	// Past 2^64 and eleven octets long: the length bound is judged first (§10).
	_, _, err := deixis.ReadCuvarint(append(bytes.Repeat([]byte{0xff}, 10), 0x01))
	expect(t, "eleven octets past 2^64", err, refusedAs(deixis.CodeMalformedUvarint))
	// Ten octets, terminated, past 2^64: the domain rule alone.
	for last := byte(0x02); last < 0x80; last++ {
		_, _, err := deixis.ReadCuvarint(append(bytes.Repeat([]byte{0xff}, 9), last))
		expect(t, fmt.Sprintf("ten octets ending %02x", last), err, refusedAs(deixis.CodeUvarintOverflow))
	}
}

func TestCuvarintEndingMidIntegerIsMalformed(t *testing.T) {
	_, _, err := deixis.ReadCuvarint(nil)
	expect(t, "no octets", err, refusedAs(deixis.CodeUnexpectedEOF))
	for _, v := range integerBoundaries() {
		spelling := deixis.AppendCuvarint(nil, v)
		for cut := 1; cut < len(spelling); cut++ {
			// §3 rule 2: input that ends while the continuation bit is set.
			_, _, err := deixis.ReadCuvarint(spelling[:cut])
			expect(t, fmt.Sprintf("%d cut at %d", v, cut), err, refusedAs(deixis.CodeMalformedUvarint))
		}
	}
}

func TestCodesKeepTheirClasses(t *testing.T) {
	invalid := []deixis.Code{
		deixis.CodeMalformedUvarint, deixis.CodeNonShortestUvarint, deixis.CodeUvarintOverflow,
		deixis.CodeUnknownMagic, deixis.CodeDuplicateKey, deixis.CodeUnsortedKeys,
		deixis.CodeTrailingBytes, deixis.CodeUnexpectedEOF, deixis.CodeBadLinkIndex,
		deixis.CodeUnusedLink, deixis.CodeDuplicateLinkHash, deixis.CodeLinksOutOfOrder,
		deixis.CodeSlotCodecMismatch, deixis.CodeMalformedSlotCodecID, deixis.CodeNonCanonicalPayload,
	}
	for _, c := range invalid {
		if c.Class() != deixis.ClassInvalid {
			t.Errorf("%s is %q, want invalid", c, c.Class())
		}
	}
	for c, want := range map[deixis.Code]deixis.Class{
		deixis.CodeUnsupportedSlotCodec: deixis.ClassUnsupported,
		deixis.CodeNeedMoreInput:        deixis.ClassIncomplete,
		deixis.CodeLimitExceeded:        deixis.ClassResourceRefused,
		deixis.CodeMissingChunk:         deixis.ClassStore,
		deixis.CodeHashMismatch:         deixis.ClassStore,
		deixis.CodeAddressConflict:      deixis.ClassStore,
		"unknown_tag":                   "", // v1's code, retired in v2
	} {
		if c.Class() != want {
			t.Errorf("%s is %q, want %q", c, c.Class(), want)
		}
	}
}

// --- slot codecs (§4, §13) -----------------------------------------------------------

func TestOptionOfIsTheSection13Codec(t *testing.T) {
	inner := deixis.IdentityBytes()
	c := deixis.OptionOf(inner)
	if !bytes.Equal(c.ID(), append([]byte{0x02}, inner.ID()...)) {
		t.Fatalf("option-of id %x is not 0x02 ‖ the inner id", c.ID())
	}
	g := newGen(4)
	values := []deixis.Option[[]byte]{deixis.None[[]byte](), deixis.Some([]byte{}), deixis.Some([]byte{0})}
	for range 50 {
		values = append(values, g.option())
	}
	for _, x := range values {
		e := c.Encode(x)
		if inner, some := x.Get(); some {
			if !bytes.Equal(e, append([]byte{0x01}, inner...)) {
				t.Errorf("e(Some(%x)) = %x, want 0x01 ‖ e_c", inner, e)
			}
		} else if !bytes.Equal(e, []byte{0x00}) {
			t.Errorf("e(None) = %x, want 0x00", e)
		}
		back, ok := c.Decode(e)
		if !ok || !c.Equal(back, x) {
			t.Errorf("D(e(%v)) is not ≈ to it", x)
		}
		for _, y := range values {
			if c.Equal(x, y) != bytes.Equal(e, c.Encode(y)) {
				t.Errorf("lawfulness: x ≈ y must hold exactly when e(x) = e(y)")
			}
		}
	}
	// D is defined on 0x00 and on 0x01 ‖ anything, and nowhere else.
	for first := range 256 {
		for _, rest := range [][]byte{nil, {0x00}, {0x01, 0x02}} {
			b := append([]byte{byte(first)}, rest...)
			_, ok := c.Decode(b)
			want := first == 1 || (first == 0 && len(rest) == 0)
			if ok != want {
				t.Errorf("D(%x) defined = %v, want %v", b, ok, want)
			}
		}
	}
	if _, ok := c.Decode(nil); ok {
		t.Error("D must refuse the empty payload")
	}
	// Some over an inner codec that refuses: the refusal is inherited.
	strict := deixis.OptionOf[coarse](coarseCodec{})
	if _, ok := strict.Decode([]byte{0x01, 0xff}); ok {
		t.Error("option-of must refuse Some of an octet string outside the inner im(e)")
	}
}

func TestEncodersFailLocallyOnIdsOfNoV2Form(t *testing.T) {
	leaf := mustCompose[[]byte](t, nil, nil)
	for _, id := range [][]byte{
		publicID(0),                    // n = 0 names nothing
		{0x00},                         // too short
		append(publicID(1), 0x00),      // left over
		{0x03, 0x01},                   // a reserved form
		{0x02, 0x03},                   // option-of over a reserved form
		bytes.Repeat([]byte{0x02}, 31), // no inner id at the end
	} {
		if _, err := deixis.EncodeFlat[[]byte](leaf, renamed{id}); !errors.Is(err, deixis.ErrSlotCodecID) {
			t.Errorf("EncodeFlat under %x: %v, want ErrSlotCodecID", id, err)
		}
		if _, _, err := deixis.EncodeLinked[[]byte](leaf, renamed{id}); !errors.Is(err, deixis.ErrSlotCodecID) {
			t.Errorf("EncodeLinked under %x: %v, want ErrSlotCodecID", id, err)
		}
	}
}

func TestHoldingRefusesAmbiguity(t *testing.T) {
	for name, codecs := range map[string][]deixis.SlotCodec[[]byte]{
		"a shared id":     {deixis.IdentityBytes(), renamed{publicID(1)}},
		"a malformed id":  {renamed{publicID(0)}},
		"a reserved form": {renamed{[]byte{0xfe, 0x00}}},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("Holding with %s must panic", name)
				}
			}()
			deixis.Holding(codecs...)
		}()
	}
}

// --- the slot-codec-id (§13) through the header validator ----------------------------

// header is "dxf2" ‖ cuvarint(len(id)) ‖ id.
func header(id []byte) []byte {
	return append(deixis.AppendCuvarint([]byte("dxf2"), uint64(len(id))), id...)
}

// optionOf nests option-of m times over id.
func optionOf(m int, id []byte) []byte { return append(bytes.Repeat([]byte{0x02}, m), id...) }

// holdAll is a registry that answers yes to every id it is asked about.
func holdAll(id []byte) (deixis.SlotCodec[[]byte], bool) { return renamed{id}, true }

func TestSlotCodecIDsOfEveryForm(t *testing.T) {
	ns := sha256.Sum256([]byte("deixis core/go codec tests: id namespace"))
	private := func(k uint64) []byte { return deixis.AppendCuvarint(append([]byte{0x01}, ns[:16]...), k) }
	var valid [][]byte
	for _, n := range []uint64{1, 2, 127, 128, 300, 1 << 32, math.MaxUint64} {
		valid = append(valid, publicID(n))
	}
	for _, k := range []uint64{0, 1, 128, math.MaxUint64} {
		valid = append(valid, private(k))
	}
	valid = append(valid, optionOf(1, publicID(1)), optionOf(30, publicID(1)), optionOf(13, private(1)))
	for _, id := range valid {
		held, err := deixis.ReadFlatHeader(header(id), holdAll, nil)
		if err != nil || !bytes.Equal(held.ID(), id) {
			t.Errorf("%x held: %s", id, verdict(err))
		}
		_, err = deixis.ReadFlatHeader(header(id), deixis.Holding[[]byte](), nil)
		expect(t, fmt.Sprintf("%x blind", id), err, refusedAs(deixis.CodeUnsupportedSlotCodec))
		// The validator reads nothing past the id.
		_, err = deixis.ReadFlatHeader(append(header(id), 0xff, 0xff, 0xff), holdAll, nil)
		expect(t, fmt.Sprintf("%x with octets after it", id), err, "accepted")
	}
}

func TestMalformedSlotCodecIDs(t *testing.T) {
	ns := bytes.Repeat([]byte{0x5a}, 16)
	malformed := refusedAs(deixis.CodeMalformedSlotCodecID)
	for name, c := range map[string]struct {
		id   []byte
		want string
	}{
		"public n = 0":                     {publicID(0), malformed},
		"public, an octet left over":       {append(publicID(1), 0x00), malformed},
		"private, k left out":              {append([]byte{0x01}, ns...), malformed},
		"private, a namespace octet short": {append(append([]byte{0x01}, ns[:15]...), 0x01), malformed},
		"private, an octet left over":      {append(deixis.AppendCuvarint(append([]byte{0x01}, ns...), 1), 0x07), malformed},
		"option-of over 00 alone":          {[]byte{0x02, 0x00}, malformed},
		"option-of over 02 alone":          {[]byte{0x02, 0x02}, malformed},
		"option-of, an octet left over":    {append(optionOf(1, publicID(1)), 0x01), malformed},
		"option-of over n = 0":             {optionOf(2, publicID(0)), malformed},
		"thirty-one option-of octets":      {bytes.Repeat([]byte{0x02}, 32), malformed},
		"n spelled long":                   {[]byte{0x00, 0x81, 0x00}, refusedAs(deixis.CodeNonShortestUvarint)},
		"n reaching the id's end":          {[]byte{0x00, 0x80, 0x80}, refusedAs(deixis.CodeMalformedUvarint)},
		"k reaching the id's end":          {append(append([]byte{0x01}, ns...), 0xff), refusedAs(deixis.CodeMalformedUvarint)},
		"n of eleven octets":               {append(append([]byte{0x00}, bytes.Repeat([]byte{0x80}, 10)...), 0x01), refusedAs(deixis.CodeMalformedUvarint)},
		"n past 2^64":                      {append(append([]byte{0x00}, bytes.Repeat([]byte{0xff}, 9)...), 0x02), refusedAs(deixis.CodeUvarintOverflow)},
		"a reserved form":                  {[]byte{0x03, 0x00}, refusedAs(deixis.CodeUnsupportedSlotCodec)},
		"a reserved form, long":            {append([]byte{0xff}, bytes.Repeat([]byte{0x80}, 31)...), refusedAs(deixis.CodeUnsupportedSlotCodec)},
		"option-of a reserved form":        {[]byte{0x02, 0x03}, refusedAs(deixis.CodeUnsupportedSlotCodec)},
		"deep option-of a reserved form":   {optionOf(5, []byte{0x7f, 0x00, 0x00}), refusedAs(deixis.CodeUnsupportedSlotCodec)},
	} {
		// A reserved form is unsupported even to a registry that holds everything: it is
		// never asked.
		_, err := deixis.ReadFlatHeader(header(c.id), holdAll, nil)
		expect(t, name, err, c.want)
	}
	// The length is judged when it is read: outside 2..32, before any octet of the id.
	for _, n := range []uint64{0, 1, 33, 1000, math.MaxUint64} {
		_, err := deixis.ReadFlatHeader(deixis.AppendCuvarint([]byte("dxf2"), n), holdAll, nil)
		expect(t, fmt.Sprintf("id length %d", n), err, malformed)
	}
}

func TestHeaderFramingBeforeContent(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	full := header(id)
	for cut := range len(full) {
		_, err := deixis.ReadFlatHeader(full[:cut], holdAll, nil)
		want := refusedAs(deixis.CodeUnexpectedEOF)
		expect(t, fmt.Sprintf("header cut at %d", cut), err, want)
	}
	// Fewer than four octets is unexpected_eof whatever they are; four read and not the
	// magic is unknown_magic.
	for _, b := range [][]byte{{0xff}, {0xff, 0xff}, []byte("dxl"), []byte("xf2")} {
		_, err := deixis.ReadFlatHeader(b, holdAll, nil)
		expect(t, fmt.Sprintf("%x", b), err, refusedAs(deixis.CodeUnexpectedEOF))
	}
	for _, magic := range []string{"dxl2", "dxf1", "DXF2", "\x00xf2"} {
		_, err := deixis.ReadFlatHeader(append([]byte(magic), full[4:]...), holdAll, nil)
		expect(t, magic, err, refusedAs(deixis.CodeUnknownMagic))
	}
	// A truncated id is judged for availability first: the id is a length-framed field.
	long := optionOf(3, publicID(300))
	truncated := header(long)[:5+2]
	_, err := deixis.ReadFlatHeader(truncated, holdAll, nil)
	expect(t, "an id shorter than its stated length", err, refusedAs(deixis.CodeUnexpectedEOF))
	// A lowered id-length limit refuses on resource, but never ahead of the 2..32 rule.
	lowered := deixis.DefaultLimits()
	lowered.SlotCodecIDLength = 2
	_, err = deixis.ReadFlatHeader(header(coarseID), holdAll, &lowered)
	expect(t, "an id over the lowered limit", err, limitOn(deixis.DimensionSlotCodecIDLength))
	_, err = deixis.ReadFlatHeader(deixis.AppendCuvarint([]byte("dxf2"), 40), holdAll, &lowered)
	expect(t, "an id over 32 and the limit", err, malformedID)
}

var malformedID = refusedAs(deixis.CodeMalformedSlotCodecID)

func TestHeaderValidatorIsSplitInvariant(t *testing.T) {
	for _, id := range [][]byte{publicID(1), coarseID, optionOf(4, publicID(1<<40)), {0x02, 0x03}, publicID(0), {0x00, 0x80}} {
		b := append(header(id), 0x00, 0x00)
		_, whole := deixis.ReadFlatHeader(b, holdAll, nil)
		for cut := range len(b) + 1 {
			v := deixis.NewFlatHeaderValidator[[]byte](holdAll, nil)
			first := v.Feed(b[:cut])
			v.Feed(b[cut:])
			_, err := v.Finish()
			if verdict(err) != verdict(whole) {
				t.Errorf("%x split at %d: %s, whole: %s", b, cut, verdict(err), verdict(whole))
			}
			var incomplete *deixis.IncompleteError
			if !errors.As(first, &incomplete) && verdict(first) != verdict(whole) {
				t.Errorf("%x: an early verdict %s differs from the whole's %s", b, verdict(first), verdict(whole))
			}
		}
	}
}

// --- the flat form (§5) --------------------------------------------------------------

func TestFlatRoundTripAndCanonicalReencoding(t *testing.T) {
	check := func(name string, enc []byte, decodeAgain func() ([]byte, bool)) {
		t.Helper()
		again, equal := decodeAgain()
		if !equal {
			t.Errorf("%s: the decoded value is not =_≈ to the encoded one", name)
		}
		if !bytes.Equal(again, enc) {
			t.Errorf("%s: accepted octets do not re-encode identically", name)
		}
	}
	for i, n := range byteTrees(t) {
		c := deixis.IdentityBytes()
		enc := encodeFlat(t, n, c)
		got, err := deixis.DecodeFlat(enc, deixis.Holding(c), nil)
		if err != nil {
			t.Fatalf("byte tree %d: %s", i, verdict(err))
		}
		check(fmt.Sprint("byte tree ", i), enc, func() ([]byte, bool) {
			return encodeFlat(t, got.Node, got.Codec), got.Node.EqualBy(n, c.Equal)
		})
		// Codec-blind: the framing is judged and the verdict is unsupported, never a value.
		_, err = deixis.DecodeFlat[[]byte](enc, nil, nil)
		var unsupported *deixis.UnsupportedError
		if !errors.As(err, &unsupported) || !bytes.Equal(unsupported.SlotCodecID(), c.ID()) {
			t.Errorf("byte tree %d blind: %s", i, verdict(err))
		}
	}
	for i, n := range optionTrees(t) {
		c := deixis.OptionOf(deixis.IdentityBytes())
		enc := encodeFlat(t, n, c)
		got, err := deixis.DecodeFlat(enc, deixis.Holding(c), nil)
		if err != nil {
			t.Fatalf("option tree %d: %s", i, verdict(err))
		}
		check(fmt.Sprint("option tree ", i), enc, func() ([]byte, bool) {
			return encodeFlat(t, got.Node, got.Codec), got.Node.EqualBy(n, c.Equal)
		})
		// An option-of artifact is not an identity-bytes one: a decoder holding only the
		// inner codec does not hold option-of over it unless it says so.
		_, err = deixis.DecodeFlat(enc, deixis.Holding(deixis.IdentityBytes()), nil)
		expect(t, fmt.Sprint("option tree ", i, " under the inner codec"), err, refusedAs(deixis.CodeUnsupportedSlotCodec))
	}
	for i, n := range coarseTrees(t) {
		c := deixis.SlotCodec[coarse](coarseCodec{})
		enc := encodeFlat(t, n, c)
		got, err := deixis.DecodeFlat(enc, deixis.Holding(c), nil)
		if err != nil {
			t.Fatalf("coarse tree %d: %s", i, verdict(err))
		}
		check(fmt.Sprint("coarse tree ", i), enc, func() ([]byte, bool) {
			return encodeFlat(t, got.Node, got.Codec), got.Node.EqualBy(n, c.Equal)
		})
	}
}

func TestFlatDecodedValuesAreIndependentOfTheInput(t *testing.T) {
	n := mustCompose(t, []byte("own"), []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose(t, []byte("child"), nil)}})
	enc := encodeFlat(t, n, deixis.IdentityBytes())
	got, err := deixis.DecodeFlat(enc, deixis.Holding(deixis.IdentityBytes()), nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := range enc {
		enc[i] = 0xee
	}
	if !got.Node.EqualBy(n, bytes.Equal) {
		t.Fatal("overwriting the input octets must not change a decoded value")
	}
}

// Law 1, both directions, under a slot whose ≈ is coarser than its representation.
func TestFlatOctetsEqualExactlyWhenValuesAreEqual(t *testing.T) {
	c := deixis.SlotCodec[coarse](coarseCodec{})
	g := newGen(5)
	var trees []deixis.Node[coarse]
	var encodings [][]byte
	for range 400 {
		n := tree(t, g, 2, 2, g.coarse)
		twin := representation(t, g, n)
		enc := encodeFlat(t, n, c)
		if !bytes.Equal(enc, encodeFlat(t, twin, c)) || !n.EqualBy(twin, c.Equal) {
			t.Fatal("two representations of one value must encode identically")
		}
		trees = append(trees, n)
		encodings = append(encodings, enc)
	}
	equalPairs, unequalPairs := 0, 0
	for i := range trees {
		for j := range trees {
			same := bytes.Equal(encodings[i], encodings[j])
			if same != trees[i].EqualBy(trees[j], c.Equal) {
				t.Fatalf("trees %d and %d: octets equal = %v, values =_≈ = %v", i, j, same, !same)
			}
			if i < j && same {
				equalPairs++
			} else if i < j {
				unequalPairs++
			}
		}
	}
	if equalPairs < 50 || unequalPairs < 50 {
		t.Fatalf("the generator must produce both kinds of pair: %d equal, %d unequal", equalPairs, unequalPairs)
	}
}

// fitting is the first few trees whose flat encoding under c fits in 200 octets.
func fitting[T any](t testing.TB, trees []deixis.Node[T], c deixis.SlotCodec[T], few int) []deixis.Node[T] {
	t.Helper()
	var out []deixis.Node[T]
	for _, n := range trees {
		if len(out) < few && len(encodeFlat(t, n, c)) <= 200 {
			out = append(out, n)
		}
	}
	return out
}

// mutations are every single-octet change of b at every position: all 255 other values
// for short artifacts, a fixed sample of them for long ones.
func mutations(b []byte, each func(i int, m []byte)) {
	values := make([]byte, 0, 256)
	for i := range b {
		values = values[:0]
		if len(b) <= 64 {
			for v := range 256 {
				values = append(values, byte(v))
			}
		} else {
			values = append(values, 0x00, 0x01, 0x02, 0x7f, 0x80, 0xff, b[i]^0x01, b[i]^0x80, b[i]+1, b[i]-1)
		}
		for _, v := range values {
			if v == b[i] {
				continue
			}
			m := bytes.Clone(b)
			m[i] = v
			each(i, m)
		}
	}
}

// Law 1's third clause: every accepted input re-encodes octet-identically, so a
// mutation either refuses or yields a value whose encoding is the mutated octets. And
// §11: framing is judged without the codec, so a codec-blind decoder refuses a mutation
// exactly as a holding one does whenever the fault is one of framing.
func TestEveryMutationRefusesOrReencodesExactly(t *testing.T) {
	run := func(name string, enc []byte, holding func([]byte) ([]byte, error), blind func([]byte) error) {
		t.Helper()
		accepted := 0
		mutations(enc, func(i int, m []byte) {
			reencoded, err := holding(m)
			if err == nil {
				accepted++
				if !bytes.Equal(reencoded, m) {
					t.Fatalf("%s: mutated at %d, accepted, and re-encoded differently", name, i)
				}
			}
			var refusal deixis.Refusal
			if err != nil && !errors.As(err, &refusal) {
				t.Fatalf("%s: a decoder answered with a non-verdict: %v", name, err)
			}
			blindErr := blind(m)
			switch verdict(blindErr) {
			case "accepted":
				t.Fatalf("%s: a codec-blind decoder accepted", name)
			case refusedAs(deixis.CodeUnsupportedSlotCodec):
				if err != nil && verdict(err) != refusedAs(deixis.CodeNonCanonicalPayload) && verdict(err) != refusedAs(deixis.CodeUnsupportedSlotCodec) {
					t.Fatalf("%s at %d: well framed to a blind decoder, %s to a holding one", name, i, verdict(err))
				}
			default:
				if verdict(blindErr) != verdict(err) {
					t.Fatalf("%s at %d: blind %s, holding %s: framing must not depend on the codec", name, i, verdict(blindErr), verdict(err))
				}
			}
		})
		if accepted == 0 && name != "" {
			t.Logf("%s: no mutation was accepted", name)
		}
	}
	// Bounded to keep the suite quick: every shape of the corpus that fits in 200 octets,
	// up to 16 byte trees and 6 of each other slot. The wide and deep shapes are covered
	// by the round trip and the splits.
	for i, n := range fitting(t, byteTrees(t), deixis.IdentityBytes(), 16) {
		c := deixis.IdentityBytes()
		enc := encodeFlat(t, n, c)
		run(fmt.Sprint("byte tree ", i), enc, func(m []byte) ([]byte, error) {
			got, err := deixis.DecodeFlat(m, deixis.Holding(c), nil)
			if err != nil {
				return nil, err
			}
			return encodeFlat(t, got.Node, got.Codec), nil
		}, func(m []byte) error {
			_, err := deixis.DecodeFlat[[]byte](m, nil, nil)
			return err
		})
	}
	for i, n := range fitting(t, optionTrees(t), deixis.OptionOf(deixis.IdentityBytes()), 6) {
		c := deixis.OptionOf(deixis.IdentityBytes())
		enc := encodeFlat(t, n, c)
		run(fmt.Sprint("option tree ", i), enc, func(m []byte) ([]byte, error) {
			got, err := deixis.DecodeFlat(m, deixis.Holding(c), nil)
			if err != nil {
				return nil, err
			}
			return encodeFlat(t, got.Node, got.Codec), nil
		}, func(m []byte) error {
			_, err := deixis.DecodeFlat[deixis.Option[[]byte]](m, nil, nil)
			return err
		})
	}
	for i, n := range fitting(t, coarseTrees(t), deixis.SlotCodec[coarse](coarseCodec{}), 6) {
		c := deixis.SlotCodec[coarse](coarseCodec{})
		enc := encodeFlat(t, n, c)
		run(fmt.Sprint("coarse tree ", i), enc, func(m []byte) ([]byte, error) {
			got, err := deixis.DecodeFlat(m, deixis.Holding(c), nil)
			if err != nil {
				return nil, err
			}
			return encodeFlat(t, got.Node, got.Codec), nil
		}, func(m []byte) error {
			_, err := deixis.DecodeFlat[coarse](m, nil, nil)
			return err
		})
	}
}

// --- streaming (§14) -----------------------------------------------------------------

// streamed feeds pieces to a streaming decoder and declares the end. It also checks the
// non-terminal contract on the way: every Feed answers need_more_input or the final
// verdict, and a terminal verdict never changes.
func streamed[T any](t *testing.T, registry deixis.Registry[T], pieces [][]byte) (deixis.Decoded[T], error) {
	t.Helper()
	d := deixis.NewFlatDecoder(registry, nil)
	var terminal error
	for _, piece := range pieces {
		err := d.Feed(piece)
		var incomplete *deixis.IncompleteError
		if errors.As(err, &incomplete) {
			if terminal != nil {
				t.Fatalf("a terminal verdict %s became need_more_input", verdict(terminal))
			}
			continue
		}
		if terminal != nil && verdict(err) != verdict(terminal) {
			t.Fatalf("a terminal verdict %s changed to %s", verdict(terminal), verdict(err))
		}
		terminal = err
	}
	got, err := d.Finish()
	if terminal != nil && verdict(err) != verdict(terminal) {
		t.Fatalf("Finish said %s after Feed said %s", verdict(err), verdict(terminal))
	}
	return got, err
}

// splitInvariant checks that every split of b in two, and b fed one octet at a time,
// reach the whole-buffer verdict, and that an accepted value re-encodes to b.
func splitInvariant[T any](t *testing.T, name string, b []byte, c deixis.SlotCodec[T], registry deixis.Registry[T]) {
	t.Helper()
	_, whole := deixis.DecodeFlat(b, registry, nil)
	agree := func(how string, got deixis.Decoded[T], err error) {
		t.Helper()
		if verdict(err) != verdict(whole) {
			t.Fatalf("%s %s: %s, whole buffer: %s", name, how, verdict(err), verdict(whole))
		}
		if err == nil && !bytes.Equal(encodeFlat(t, got.Node, c), b) {
			t.Fatalf("%s %s: accepted a different value", name, how)
		}
	}
	for cut := range len(b) + 1 {
		got, err := streamed(t, registry, [][]byte{b[:cut], b[cut:]})
		agree(fmt.Sprint("split at ", cut), got, err)
	}
	octets := make([][]byte, len(b))
	for i := range b {
		octets[i] = b[i : i+1]
	}
	got, err := streamed(t, registry, octets)
	agree("fed an octet at a time", got, err)
}

func TestStreamingIsSplitInvariant(t *testing.T) {
	c := deixis.IdentityBytes()
	registry := deixis.Holding(c)
	g := newGen(6)
	for i, n := range byteTrees(t) {
		enc := encodeFlat(t, n, c)
		splitInvariant(t, fmt.Sprint("byte tree ", i), enc, c, registry)
		if len(enc) > 200 || i >= 24 {
			continue // every split once is enough for the wide, the deep and the rest
		}
		splitInvariant(t, fmt.Sprint("byte tree ", i, " blind"), enc, c, nil)
		// Truncations, trailing octets and mutations: faults of every kind, split.
		for cut := 0; cut < len(enc); cut += 1 + len(enc)/4 {
			splitInvariant(t, fmt.Sprint("byte tree ", i, " cut at ", cut), enc[:cut], c, registry)
		}
		splitInvariant(t, fmt.Sprint("byte tree ", i, " with a trailing octet"), append(bytes.Clone(enc), 0x00), c, registry)
		for range 3 {
			m := bytes.Clone(enc)
			m[g.r.IntN(len(m))] = byte(g.r.IntN(256))
			splitInvariant(t, fmt.Sprint("byte tree ", i, " mutated"), m, c, registry)
		}
	}
	coarseCodec := deixis.SlotCodec[coarse](coarseCodec{})
	for i, n := range coarseTrees(t)[:8] {
		enc := encodeFlat(t, n, coarseCodec)
		splitInvariant(t, fmt.Sprint("coarse tree ", i), enc, coarseCodec, deixis.Holding(coarseCodec))
	}
	// Non-canonical payloads are judged last, and still identically for every split.
	bad := mustCompose(t, []byte{0xff}, []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose[[]byte](t, []byte("fine"), nil)}})
	enc := encodeFlat[[]byte](t, bad, lenientTwin{})
	splitInvariant(t, "a non-canonical payload", enc, coarseCodec, deixis.Holding(coarseCodec))
}

func TestStreamingNeverDecidesAcceptanceBeforeTheEnd(t *testing.T) {
	c := deixis.IdentityBytes()
	for i, n := range byteTrees(t)[:12] {
		enc := encodeFlat(t, n, c)
		d := deixis.NewFlatDecoder(deixis.Holding(c), nil)
		var incomplete *deixis.IncompleteError
		if err := d.Feed(enc); !errors.As(err, &incomplete) {
			t.Fatalf("tree %d: a complete root is %s before the end: trailing octets may still arrive", i, verdict(err))
		}
		// And after them, trailing_bytes is final at once.
		if err := d.Feed([]byte{0x00}); verdict(err) != refusedAs(deixis.CodeTrailingBytes) {
			t.Fatalf("tree %d: an octet after the root: %s", i, verdict(err))
		}
		if _, err := d.Finish(); verdict(err) != refusedAs(deixis.CodeTrailingBytes) {
			t.Fatalf("tree %d: Finish changed the verdict to %s", i, verdict(err))
		}
		// A fresh decoder, ended: accepted, and Feed after Finish reports the verdict.
		d = deixis.NewFlatDecoder(deixis.Holding(c), nil)
		d.Feed(enc)
		if _, err := d.Finish(); err != nil {
			t.Fatalf("tree %d: %s", i, verdict(err))
		}
		if err := d.Feed([]byte{0x00}); err != nil {
			t.Fatalf("tree %d: Feed after Finish: %s", i, verdict(err))
		}
	}
	// A framing fault already in view is final at once.
	d := deixis.NewFlatDecoder(deixis.Holding(c), nil)
	if err := d.Feed([]byte("dxl2")); verdict(err) != refusedAs(deixis.CodeUnknownMagic) {
		t.Fatalf("four octets of the wrong magic: %s", verdict(err))
	}
	// Fewer than four octets of anything are not yet a fault.
	d = deixis.NewFlatDecoder(deixis.Holding(c), nil)
	var incomplete *deixis.IncompleteError
	if err := d.Feed([]byte{0xff, 0xff}); !errors.As(err, &incomplete) {
		t.Fatalf("two octets: %s, want need_more_input", verdict(err))
	}
	if _, err := d.Finish(); verdict(err) != refusedAs(deixis.CodeUnexpectedEOF) {
		t.Fatalf("two octets, ended: %s", verdict(err))
	}
}

// --- faults and their precedence (§5, §10, §11) --------------------------------------

// rawNode spells a node field by field with nothing checked or sorted. The tests build
// octets with it only to break a named rule, and assert the verdict that rule assigns;
// no test compares any encoder's output with it.
type rawNode struct {
	payload []byte
	count   int // written instead of len(entries) when not -1
	entries []rawEntry
}

type rawEntry struct {
	key  []byte
	node rawNode
}

func rawLeaf(payload []byte) rawNode { return rawNode{payload: payload, count: -1} }

func rawParent(payload []byte, entries ...rawEntry) rawNode {
	return rawNode{payload: payload, count: -1, entries: entries}
}

func (n rawNode) appendTo(out []byte) []byte {
	out = deixis.AppendCuvarint(out, uint64(len(n.payload)))
	out = append(out, n.payload...)
	count := len(n.entries)
	if n.count >= 0 {
		count = n.count
	}
	out = deixis.AppendCuvarint(out, uint64(count))
	for _, e := range n.entries {
		out = deixis.AppendCuvarint(out, uint64(len(e.key)))
		out = append(out, e.key...)
		out = e.node.appendTo(out)
	}
	return out
}

func rawFlat(id []byte, n rawNode) []byte { return n.appendTo(header(id)) }

func TestKeyOrderIsJudgedNeverRepaired(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	leaf := rawLeaf(nil)
	for name, c := range map[string]struct {
		keys []string
		want string
	}{
		"descending":              {[]string{"b", "a"}, refusedAs(deixis.CodeUnsortedKeys)},
		"the longer first":        {[]string{"ab", "a"}, refusedAs(deixis.CodeUnsortedKeys)},
		"equal":                   {[]string{"a", "a"}, refusedAs(deixis.CodeDuplicateKey)},
		"equal and empty":         {[]string{"", ""}, refusedAs(deixis.CodeDuplicateKey)},
		"ascending, prefix first": {[]string{"", "a", "ab", "b"}, "accepted"},
		"unsorted late":           {[]string{"a", "c", "b"}, refusedAs(deixis.CodeUnsortedKeys)},
	} {
		var entries []rawEntry
		for _, k := range c.keys {
			entries = append(entries, rawEntry{key: []byte(k), node: leaf})
		}
		b := rawFlat(id, rawParent(nil, entries...))
		_, err := deixis.DecodeFlat(b, registry, nil)
		expect(t, name, err, c.want)
		// One level down, and codec-blind: framing faults do not depend on the codec.
		b = rawFlat(id, rawParent(nil, rawEntry{key: []byte("p"), node: rawParent([]byte{1}, entries...)}))
		_, err = deixis.DecodeFlat[[]byte](b, nil, nil)
		if c.want == "accepted" {
			c.want = refusedAs(deixis.CodeUnsupportedSlotCodec)
		}
		expect(t, name+", nested and blind", err, c.want)
	}
}

func TestCountAndEndOfInput(t *testing.T) {
	id := deixis.IdentityBytes().ID()
	registry := deixis.Holding(deixis.IdentityBytes())
	one := rawEntry{key: []byte("a"), node: rawLeaf(nil)}
	short := rawParent(nil, one)
	short.count = 2
	_, err := deixis.DecodeFlat(rawFlat(id, short), registry, nil)
	expect(t, "a count above the entries present", err, refusedAs(deixis.CodeUnexpectedEOF))
	long := rawParent(nil, one, rawEntry{key: []byte("b"), node: rawLeaf(nil)})
	long.count = 1
	_, err = deixis.DecodeFlat(rawFlat(id, long), registry, nil)
	expect(t, "a count below the entries present", err, refusedAs(deixis.CodeTrailingBytes))
	// A payload length reaching past the end.
	b := append(header(id), deixis.AppendCuvarint(nil, 5)...)
	_, err = deixis.DecodeFlat(append(b, 1, 2), registry, nil)
	expect(t, "a payload past the end", err, refusedAs(deixis.CodeUnexpectedEOF))
	// A payload length cut mid-integer: §3 rule 2, not unexpected_eof.
	_, err = deixis.DecodeFlat(append(header(id), 0x80), registry, nil)
	expect(t, "a length that ends continuing", err, refusedAs(deixis.CodeMalformedUvarint))
	// Nothing after the header.
	_, err = deixis.DecodeFlat(header(id), registry, nil)
	expect(t, "no root", err, refusedAs(deixis.CodeUnexpectedEOF))
	// Eleven octets past 2^64 in the payload length: the length bound wins.
	_, err = deixis.DecodeFlat(append(append(header(id), bytes.Repeat([]byte{0xff}, 10)...), 0x01), registry, nil)
	expect(t, "an eleven-octet length", err, refusedAs(deixis.CodeMalformedUvarint))
}

// §10 ⭐ and §11: read first, ruled last. A slot-codec-id is read before the body, and
// the judgment that turns on it comes after every framing question.
func TestFramingOutranksCapabilityOutranksPayload(t *testing.T) {
	stranger := renamed{publicID(1 << 20)} // an unassigned public ordinal
	n := mustCompose(t, []byte{1}, []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose(t, []byte{2}, nil)}})
	enc := encodeFlat[[]byte](t, n, stranger)
	_, err := deixis.DecodeFlat(enc, deixis.Holding(deixis.IdentityBytes()), nil)
	expect(t, "an unknown id, well framed", err, refusedAs(deixis.CodeUnsupportedSlotCodec))
	_, err = deixis.DecodeFlat(append(bytes.Clone(enc), 0x00), deixis.Holding(deixis.IdentityBytes()), nil)
	expect(t, "an unknown id and a trailing octet", err, refusedAs(deixis.CodeTrailingBytes))
	_, err = deixis.DecodeFlat(enc[:len(enc)-1], deixis.Holding(deixis.IdentityBytes()), nil)
	expect(t, "an unknown id and a missing octet", err, refusedAs(deixis.CodeUnexpectedEOF))

	// A payload outside the coarse im(e), at a node WITH children (§5.5: every node).
	strict := deixis.SlotCodec[coarse](coarseCodec{})
	for name, n := range map[string]deixis.Node[[]byte]{
		"at the root, which has children": mustCompose(t, []byte{0xc0, 0x80}, []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose(t, []byte("ok"), nil)}}),
		"at a childless node":             mustCompose(t, []byte("ok"), []deixis.Entry[[]byte]{{Key: []byte("k"), Node: mustCompose(t, []byte{0xff}, nil)}}),
		"an encoded surrogate":            mustCompose(t, []byte{0xed, 0xa0, 0x80}, nil),
	} {
		enc := encodeFlat[[]byte](t, n, lenientTwin{})
		_, err := deixis.DecodeFlat(enc, deixis.Holding(strict), nil)
		expect(t, name+", holding", err, refusedAs(deixis.CodeNonCanonicalPayload))
		_, err = deixis.DecodeFlat[coarse](enc, nil, nil)
		expect(t, name+", blind", err, refusedAs(deixis.CodeUnsupportedSlotCodec))
		_, err = deixis.DecodeFlat(append(bytes.Clone(enc), 0x00), deixis.Holding(strict), nil)
		expect(t, name+", and a trailing octet", err, refusedAs(deixis.CodeTrailingBytes))
	}
}

// A codec whose D repairs a spelling still cannot make the decoder accept octets it
// would not emit: exactness is checked by re-encoding.
type repairing struct{ coarseCodec }

func (repairing) Decode(payload []byte) (coarse, bool) {
	return coarse{class: string(bytes.ToValidUTF8(payload, []byte("?")))}, true
}

func TestALenientDecoderCannotWidenTheAcceptSet(t *testing.T) {
	enc := encodeFlat[[]byte](t, mustCompose[[]byte](t, []byte{0xff}, nil), lenientTwin{})
	_, err := deixis.DecodeFlat(enc, deixis.Holding[coarse](repairing{}), nil)
	expect(t, "a repaired payload", err, refusedAs(deixis.CodeNonCanonicalPayload))
}
