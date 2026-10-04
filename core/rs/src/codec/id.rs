//! §13's slot-codec-id: its grammar, judged as a bounded input.
//!
//! ```text
//! id := 0x00 ‖ cuvarint(n)              # PUBLIC, n ≥ 1
//!     | 0x01 ‖ ns{16} ‖ cuvarint(k)     # PRIVATE
//!     | 0x02 ‖ id                       # OPTION-OF the codec the inner id names
//!                                       # 0x03..0xff RESERVED
//! ```
//!
//! The bound of 2..32 octets is on the **whole** id and is judged where its length is
//! read, so it also bounds option-of nesting; an inner id has no bound of its own beyond
//! what its form requires. The id's stated end is where its octets end: nothing inside it
//! is read past that end. A `cuvarint` already begun when the end arrives is
//! `malformed_uvarint`, and a field that would begin at or past the end is missing,
//! `malformed_slot_codec_id`. Neither is ever `need_more_input`, because the whole id is
//! present before it is judged (§5's field-extent rule).

use core::fmt;

use super::cuvarint::{self, Scan};
use super::Fault;

pub(crate) const PUBLIC: u8 = 0x00;
pub(crate) const PRIVATE: u8 = 0x01;
pub(crate) const OPTION_OF: u8 = 0x02;
pub(crate) const NAMESPACE: usize = 16;
/// The whole id's length bound (§13).
pub(crate) const LENGTHS: core::ops::RangeInclusive<u64> = 2..=32;

/// Judge `octets` — exactly one id's stated extent — against §13's grammar.
///
/// Returns the base form's ordinal (`n` or `k`), or `None` for a reserved form, whose
/// first octet ends the structural judgment: the octets after it belong to a form not yet
/// defined, and the id is unsupported rather than malformed.
pub(crate) fn judge(octets: &[u8]) -> Result<Option<u64>, Fault> {
    let mut at = 0;
    loop {
        // An option-of id with nothing after its `02`, or an empty extent: a missing field.
        let Some(&first) = octets.get(at) else {
            return Err(Fault::MalformedSlotCodecId);
        };
        at += 1;
        let ordinal = match first {
            OPTION_OF => continue,
            PUBLIC => {
                let n = ordinal(octets, &mut at)?;
                // `n = 0` is permanently reserved and can never name a codec.
                if n == 0 {
                    return Err(Fault::MalformedSlotCodecId);
                }
                n
            }
            PRIVATE => {
                if octets.len() - at < NAMESPACE {
                    return Err(Fault::MalformedSlotCodecId);
                }
                at += NAMESPACE;
                ordinal(octets, &mut at)?
            }
            _ => return Ok(None),
        };
        // A public or private id is its form and nothing more: octets left over are not
        // part of any id of that form.
        return if at == octets.len() {
            Ok(Some(ordinal))
        } else {
            Err(Fault::MalformedSlotCodecId)
        };
    }
}

/// Read the `cuvarint` at `at`, bounded by the id's end.
fn ordinal(octets: &[u8], at: &mut usize) -> Result<u64, Fault> {
    match cuvarint::scan(&octets[*at..]) {
        Scan::Value(value, width) => {
            *at += width;
            Ok(value)
        }
        // The field would begin at the id's end: it is missing.
        Scan::Short(0) => Err(Fault::MalformedSlotCodecId),
        // Begun, and cut off by the id's end with its continuation bit set.
        Scan::Short(_) => Err(Fault::MalformedUvarint),
        Scan::Fault(fault) => Err(fault),
    }
}

/// A whole slot-codec-id: 2 to 32 octets that are exactly one id of their form (§13).
///
/// A reserved form is structurally well formed as far as it can be judged, so it parses;
/// no reader holds it, which makes it unsupported rather than invalid.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SlotCodecId {
    octets: Box<[u8]>,
}

impl SlotCodecId {
    /// Judge `octets` as a whole id: the length bound, then the grammar. Integer faults
    /// inside the id keep their §3 codes.
    pub fn parse(octets: &[u8]) -> Result<SlotCodecId, Fault> {
        if !LENGTHS.contains(&(octets.len() as u64)) {
            return Err(Fault::MalformedSlotCodecId);
        }
        judge(octets)?;
        Ok(SlotCodecId::judged(octets))
    }

    /// An id whose octets were already judged whole and well formed.
    pub(crate) fn judged(octets: &[u8]) -> SlotCodecId {
        SlotCodecId {
            octets: octets.into(),
        }
    }

    /// The id's octets, as they appear in an artifact.
    pub fn as_bytes(&self) -> &[u8] {
        &self.octets
    }

    /// The id as a borrowed view, as a [`super::Registry`] is asked about it.
    pub fn view(&self) -> IdRef<'_> {
        IdRef {
            octets: &self.octets,
        }
    }

    /// The id's form.
    pub fn form(&self) -> IdForm<'_> {
        self.view().form()
    }
}

impl fmt::Display for SlotCodecId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.view(), f)
    }
}

/// A borrowed id, whole or inner, whose octets are known to be one id of their form.
///
/// An inner id — what follows an option-of's `02` — is not bound to 2..32 octets on its
/// own: `02 03` is option-of over the one-octet reserved form `03`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct IdRef<'a> {
    octets: &'a [u8],
}

impl<'a> IdRef<'a> {
    /// A view of octets the caller has already judged well formed.
    pub(crate) fn judged(octets: &'a [u8]) -> IdRef<'a> {
        IdRef { octets }
    }

    /// The id's octets.
    pub fn as_bytes(self) -> &'a [u8] {
        self.octets
    }

    /// The id's form. For option-of, the inner id's own view.
    pub fn form(self) -> IdForm<'a> {
        let octets = self.octets;
        match octets[0] {
            PUBLIC => IdForm::Public(integer(&octets[1..])),
            PRIVATE => IdForm::Private {
                namespace: octets[1..1 + NAMESPACE]
                    .try_into()
                    .expect("a judged private id has sixteen namespace octets"),
                k: integer(&octets[1 + NAMESPACE..]),
            },
            OPTION_OF => IdForm::OptionOf(IdRef {
                octets: &octets[1..],
            }),
            reserved => IdForm::Reserved(reserved),
        }
    }
}

impl fmt::Display for IdRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for octet in self.octets {
            write!(f, "{octet:02x}")?;
        }
        Ok(())
    }
}

fn integer(octets: &[u8]) -> u64 {
    cuvarint::decode(octets)
        .expect("a judged id spells its ordinal canonically")
        .0
}

/// The form of a slot-codec-id (§13).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IdForm<'a> {
    /// `0x00 ‖ cuvarint(n)`, `n ≥ 1`: registry-assigned.
    Public(u64),
    /// `0x01 ‖ ns{16} ‖ cuvarint(k)`: self-scoped.
    Private { namespace: &'a [u8; 16], k: u64 },
    /// `0x02 ‖ id`: `option-of` over the codec the inner id names.
    OptionOf(IdRef<'a>),
    /// A first octet in `0x03..=0xff`, reserved for forms not yet defined.
    Reserved(u8),
}

/// Why an encoder declined to emit: its codec's id is not one well-formed whole
/// slot-codec-id (§13), so what it would write could name no codec. An encoder has no
/// verdict channel (§2.1): it emits, or it fails locally, and this is how it fails.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EncodeError {
    fault: Fault,
}

impl EncodeError {
    /// What is wrong with the id, as the code a decoder would report on reading it.
    pub fn fault(&self) -> Fault {
        self.fault
    }
}

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the codec's id is not a slot-codec-id: {}",
            self.fault.code()
        )
    }
}

impl std::error::Error for EncodeError {}

/// Write `magic ‖ cuvarint(len(id)) ‖ id`, the head both forms share, after judging `id`.
pub(crate) fn write_head(magic: &[u8; 4], id: &[u8], out: &mut Vec<u8>) -> Result<(), EncodeError> {
    SlotCodecId::parse(id).map_err(|fault| EncodeError { fault })?;
    out.extend_from_slice(magic);
    cuvarint::encode(id.len() as u64, out);
    out.extend_from_slice(id);
    Ok(())
}
