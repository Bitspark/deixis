package pos_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"

	pos "github.com/bitspark/deixis/pos/go"
)

func TestTheSpecExamples(t *testing.T) {
	for _, c := range []struct {
		i    uint64
		want []byte
	}{
		{0, []byte{0x00, 0x00}},
		{1, []byte{0x00, 0x01}},
		{255, []byte{0x00, 0xff}},
		{256, []byte{0xff, 0x00, 0x01, 0x00}},
		{65535, []byte{0xff, 0x00, 0xff, 0xff}},
	} {
		if got := pos.Key(c.i); !bytes.Equal(got, c.want) {
			t.Errorf("κ(%d) = %x, want %x", c.i, got, c.want)
		}
	}
}

func TestOrderPreservingAcrossBoundaries(t *testing.T) {
	// Adjacent pairs around every magnitude-length boundary in uint64.
	boundaries := []uint64{
		0, 1, 255, 256, 65535, 65536, math.MaxUint32, math.MaxUint32 + 1, math.MaxUint64 - 1,
	}
	for _, i := range boundaries {
		if bytes.Compare(pos.Key(i), pos.Key(i+1)) >= 0 {
			t.Errorf("κ(%d) must sort before κ(%d)", i, i+1)
		}
	}
}

func TestInjectiveAndPrefixFreeOverADenseRange(t *testing.T) {
	keys := make([][]byte, 600)
	for i := range keys {
		keys[i] = pos.Key(uint64(i))
	}
	for i, a := range keys {
		for j, b := range keys {
			if i == j {
				continue
			}
			if bytes.Equal(a, b) {
				t.Fatalf("κ(%d) = κ(%d)", i, j)
			}
			if bytes.HasPrefix(b, a) {
				t.Fatalf("κ(%d) is a prefix of κ(%d)", i, j)
			}
		}
	}
}

func TestMembershipAcceptsExactlyTheImage(t *testing.T) {
	for _, i := range append(make([]uint64, 0, 603),
		append([]uint64{65535, 65536, math.MaxUint64}, seq(600)...)...) {
		if !pos.IsKey(pos.Key(i)) {
			t.Errorf("IsKey(κ(%d))", i)
		}
	}
}

func seq(n uint64) []uint64 {
	out := make([]uint64, n)
	for i := range out {
		out[i] = uint64(i)
	}
	return out
}

// ----- vector replay (../../vectors/positional.json), hand-authored oracle -----

func TestVectorsKeysReplay(t *testing.T) {
	var file struct {
		Keys []struct {
			Position string `json:"position"`
			Key      string `json:"key"`
		} `json:"keys"`
		Invalid []struct {
			Bytes  string `json:"bytes"`
			Reason string `json:"reason"`
		} `json:"invalid"`
	}
	data, err := os.ReadFile("../../vectors/positional.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}

	if len(file.Keys) < 15 {
		t.Fatalf("vector file shrank? %d key cases", len(file.Keys))
	}
	var previous []byte
	for _, c := range file.Keys {
		i, err := strconv.ParseUint(c.Position, 10, 64)
		if err != nil {
			t.Fatalf("position %q: %v", c.Position, err)
		}
		want, err := hex.DecodeString(c.Key)
		if err != nil {
			t.Fatalf("key %q: %v", c.Key, err)
		}
		got := pos.Key(i)
		if !bytes.Equal(got, want) {
			t.Errorf("κ(%s) = %x, want %x", c.Position, got, want)
		}
		if !pos.IsKey(got) {
			t.Errorf("IsKey(κ(%s))", c.Position)
		}
		// File order is ascending positions; keys must ascend with it.
		if previous != nil && bytes.Compare(previous, got) >= 0 {
			t.Errorf("order preservation visible in file order broke at position %s", c.Position)
		}
		previous = got
	}

	if len(file.Invalid) < 9 {
		t.Fatalf("vector file shrank? %d invalid cases", len(file.Invalid))
	}
	for _, c := range file.Invalid {
		b, err := hex.DecodeString(c.Bytes)
		if err != nil {
			t.Fatalf("bytes %q: %v", c.Bytes, err)
		}
		if pos.IsKey(b) {
			t.Errorf("must reject %q: %s", c.Bytes, c.Reason)
		}
	}
}
