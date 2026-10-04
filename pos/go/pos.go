// Package pos implements deixis-pos-v1 — the spelling of positions into deixis keys.
//
//	κ(i) = ff^(len(mag(i)) − 1) ‖ 00 ‖ mag(i)
//
// where mag(i) is the shortest unsigned big-endian encoding of i, with mag(0) = 00.
// See docs/design/0002-positional-keys.md. The spelling is injective, prefix-free, and
// order-preserving: i < j iff κ(i) sorts before κ(j) in unsigned lexicographic byte
// order — so a positionally-keyed struct's canonical entry order is sequence order, and
// a consumer walking a sequence never parses a key.
//
// The profile is total over ℕ; this implementation spells the uint64 range, which
// bounds nothing about the profile (a wider integer spells wider positions with the
// same rule).
//
// There is deliberately no decoder: consumers recognize positional structure by
// generating Key(0) ‖ Key(1) ‖ … and comparing octets, or test membership with
// [IsKey]. Normalizing a non-canonical spelling to its index would be a repair pass,
// and a repair pass coarsens identity.
package pos

// Profile is the name of the profile this package implements.
const Profile = "deixis-pos-v1"

// Key is κ(i) — the key bytes spelling position i.
func Key(i uint64) []byte {
	// mag(i): shortest big-endian, one 00 byte for zero.
	var be [8]byte
	for b := 7; b >= 0; b-- {
		be[b] = byte(i)
		i >>= 8
	}
	skip := 0
	for skip < 7 && be[skip] == 0 {
		skip++
	}
	mag := be[skip:]

	k := make([]byte, 0, 2*len(mag))
	for range len(mag) - 1 {
		k = append(k, 0xff)
	}
	k = append(k, 0x00)
	return append(k, mag...)
}

// IsKey reports whether b is κ(i) for some i — exact membership, no normalization.
//
// Rejects truncation, a malformed run/terminator, a non-shortest magnitude, and
// trailing bytes. IsKey(Key(i)) holds for every i.
func IsKey(b []byte) bool {
	// The ff-run promises the magnitude length; 00 terminates it.
	run := 0
	for run < len(b) && b[run] == 0xff {
		run++
	}
	if run >= len(b) {
		return false // all ff (or empty): no terminator
	}
	if b[run] != 0x00 {
		return false // run must end in 00
	}
	mag := b[run+1:]
	if len(mag) != run+1 {
		return false // truncated magnitude, or trailing bytes
	}
	// Shortest form: no leading zero, except the single-byte magnitude 00 (position 0).
	return len(mag) == 1 || mag[0] != 0x00
}
