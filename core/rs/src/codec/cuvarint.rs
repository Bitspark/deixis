//! §3's integer domain: `cuvarint`, the canonical production of unsigned LEB128.
//!
//! Seven bits per octet, least-significant group first, the high bit set on every octet
//! but the last — and three rules on top of that syntax, which every reader enforces:
//! the value is in `[0, 2^64 − 1]` (`uvarint_overflow`), the spelling is at most ten
//! octets (`malformed_uvarint`), and it is the unique shortest spelling of its value
//! (`non_shortest_uvarint`). A second spelling of one integer would be a second address
//! for one value (§7), so the shortest-form rule is load-bearing rather than tidy.

use super::Fault;

/// Append `C(value)`, the unique shortest spelling of `value`, to `out`.
pub fn encode(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let group = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(group);
            return;
        }
        out.push(group | 0x80);
    }
}

/// The length of `C(value)`, in octets: 1 to 10.
pub fn encoded_len(value: u64) -> u64 {
    let bits = u64::from(u64::BITS - value.leading_zeros());
    bits.div_ceil(7).max(1)
}

/// Decode one `cuvarint` from the front of `input`, which is all the input there is.
///
/// Returns the value and the number of octets it took. Input that ends before the
/// integer's first octet is `unexpected_eof`; input that ends after one or more octets
/// with the continuation bit set is `malformed_uvarint` (§3 rule 2, §5 rule 6).
pub fn decode(input: &[u8]) -> Result<(u64, usize), Fault> {
    match scan(input) {
        Scan::Value(value, width) => Ok((value, width)),
        Scan::Short(0) => Err(Fault::UnexpectedEof),
        Scan::Short(_) => Err(Fault::MalformedUvarint),
        Scan::Fault(fault) => Err(fault),
    }
}

/// What the octets of a window show about the `cuvarint` at its front.
pub(crate) enum Scan {
    /// The value and the octets it took: a complete, canonical spelling.
    Value(u64, usize),
    /// The window ended after this many octets, every one with its continuation bit set,
    /// and nothing they show is already a fault. What that means is the caller's
    /// question: end of input, the end of an id, or a stream that is still open.
    Short(usize),
    /// A fault the present octets already prove, whatever follows them.
    Fault(Fault),
}

/// Read the `cuvarint` at the front of `window`, deciding as early as the octets allow.
pub(crate) fn scan(window: &[u8]) -> Scan {
    let mut value = 0u64;
    for index in 0..10 {
        let Some(&octet) = window.get(index) else {
            return Scan::Short(index);
        };
        value |= u64::from(octet & 0x7f) << (7 * index);
        if octet & 0x80 == 0 {
            // The tenth octet carries bit 63 alone: any larger group is 2^64 or more.
            if index == 9 && octet > 1 {
                return Scan::Fault(Fault::UvarintOverflow);
            }
            // A final group of zero adds nothing, so a shorter spelling exists.
            if index > 0 && octet == 0 {
                return Scan::Fault(Fault::NonShortestUvarint);
            }
            return Scan::Value(value, index + 1);
        }
    }
    // Ten octets, each with its continuation bit set: the spelling needs an eleventh.
    Scan::Fault(Fault::MalformedUvarint)
}
