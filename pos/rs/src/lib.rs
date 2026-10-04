//! deixis-pos-v1 — the spelling of positions into deixis keys.
//!
//! ```text
//! κ(i) = ff^(len(mag(i)) − 1) ‖ 00 ‖ mag(i)
//! ```
//!
//! where `mag(i)` is the shortest unsigned big-endian encoding of `i`, with
//! `mag(0) = 00`. See `docs/design/0002-positional-keys.md`. The spelling is injective,
//! prefix-free, and order-preserving: `i < j` iff `κ(i)` sorts before `κ(j)` in unsigned
//! lexicographic byte order — so a positionally-keyed struct's canonical entry order *is*
//! sequence order, and a consumer walking a sequence never parses a key.
//!
//! The profile is total over ℕ; this implementation spells the `u64` range, which bounds
//! nothing about the profile (a wider integer spells wider positions with the same rule).
//!
//! There is deliberately no decoder: consumers recognize positional structure by
//! generating `key(0) ‖ key(1) ‖ …` and comparing octets, or test membership with
//! [`is_key`]. Normalizing a non-canonical spelling to its index would be a repair pass,
//! and a repair pass coarsens identity.

#![forbid(unsafe_code)]

/// The name of the profile this crate implements.
pub const PROFILE: &str = "deixis-pos-v1";

/// `κ(i)` — the key bytes spelling position `i`.
pub fn key(i: u64) -> Vec<u8> {
    // mag(i): shortest big-endian, one 00 byte for zero.
    let be = i.to_be_bytes();
    let skip = be.iter().take_while(|&&b| b == 0).count().min(7);
    let mag = &be[skip..];

    let mut k = Vec::with_capacity(2 * mag.len());
    k.resize(mag.len() - 1, 0xff);
    k.push(0x00);
    k.extend_from_slice(mag);
    k
}

/// Whether `bytes` is `κ(i)` for some `i` — exact membership, no normalization.
///
/// Rejects truncation, a malformed run/terminator, a non-shortest magnitude, and
/// trailing bytes. `is_key(&key(i))` holds for every `i`.
pub fn is_key(bytes: &[u8]) -> bool {
    // The ff-run promises the magnitude length; 00 terminates it.
    let run = bytes.iter().take_while(|&&b| b == 0xff).count();
    let Some(&terminator) = bytes.get(run) else {
        return false; // all ff (or empty): no terminator
    };
    if terminator != 0x00 {
        return false; // run must end in 00
    }
    let mag = &bytes[run + 1..];
    if mag.len() != run + 1 {
        return false; // truncated magnitude, or trailing bytes
    }
    // Shortest form: no leading zero, except the single-byte magnitude 00 (position 0).
    mag.len() == 1 || mag[0] != 0x00
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_spec_examples() {
        assert_eq!(key(0), [0x00, 0x00]);
        assert_eq!(key(1), [0x00, 0x01]);
        assert_eq!(key(255), [0x00, 0xff]);
        assert_eq!(key(256), [0xff, 0x00, 0x01, 0x00]);
        assert_eq!(key(65535), [0xff, 0x00, 0xff, 0xff]);
    }

    #[test]
    fn order_preserving_across_boundaries() {
        // Adjacent pairs around every magnitude-length boundary in u64.
        let boundaries: &[u64] = &[
            0,
            1,
            255,
            256,
            65535,
            65536,
            u32::MAX as u64,
            u32::MAX as u64 + 1,
            u64::MAX - 1,
        ];
        for &i in boundaries {
            assert!(key(i) < key(i + 1), "κ({i}) must sort before κ({})", i + 1);
        }
    }

    #[test]
    fn injective_and_prefix_free_over_a_dense_range() {
        let keys: Vec<Vec<u8>> = (0..600).map(key).collect();
        for (i, a) in keys.iter().enumerate() {
            for (j, b) in keys.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "κ({i}) = κ({j})");
                    assert!(!b.starts_with(a), "κ({i}) is a prefix of κ({j})");
                }
            }
        }
    }

    #[test]
    fn membership_accepts_exactly_the_image() {
        for i in (0..600).chain([65535, 65536, u64::MAX]) {
            assert!(is_key(&key(i)), "is_key(κ({i}))");
        }
    }

    // ----- vector replay (../../vectors/positional.json), hand-authored oracle -----
    //
    // A minimal extractor rather than a JSON dependency, per the family discipline of
    // dependency-free cores. The vector file is regular; this reads exactly its shape.

    const VECTORS: &str = include_str!("../../../vectors/positional.json");

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|k| u8::from_str_radix(&s[k..k + 2], 16).unwrap())
            .collect()
    }

    /// Extract every `{ "<a>": "<x>", "<b>": "<y>" }`-shaped pair list under `section`.
    fn pairs(section: &str, first: &str, second: &str) -> Vec<(String, String)> {
        let body = VECTORS.split(&format!("\"{section}\"")).nth(1).unwrap();
        let body = &body[..body.find(']').unwrap()];
        body.split('{')
            .skip(1)
            .map(|entry| {
                let field = |name: &str| {
                    let after = entry.split(&format!("\"{name}\"")).nth(1).unwrap();
                    let after = &after[after.find(':').unwrap() + 1..];
                    let open = after.find('"').unwrap();
                    after[open + 1..open + 1 + after[open + 1..].find('"').unwrap()].to_string()
                };
                (field(first), field(second))
            })
            .collect()
    }

    #[test]
    fn vectors_keys_replay() {
        let cases = pairs("keys", "position", "key");
        assert!(cases.len() >= 15, "vector file shrank?");
        let mut previous: Option<Vec<u8>> = None;
        for (position, expected) in cases {
            let i: u64 = position.parse().expect("position fits u64");
            let k = key(i);
            assert_eq!(k, hex(&expected), "κ({position})");
            assert!(is_key(&k));
            // File order is ascending positions; keys must ascend with it.
            if let Some(p) = previous {
                assert!(p < k, "order preservation visible in file order");
            }
            previous = Some(k);
        }
    }

    #[test]
    fn vectors_invalid_replay() {
        let cases = pairs("invalid", "bytes", "reason");
        assert!(cases.len() >= 9, "vector file shrank?");
        for (bytes, reason) in cases {
            assert!(!is_key(&hex(&bytes)), "must reject {bytes:?}: {reason}");
        }
    }
}
