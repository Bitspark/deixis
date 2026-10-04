//! §9's result classes and codes, and §12's dimension tokens.
//!
//! A verdict is either acceptance or exactly one of four classes, and the classes are
//! kept apart in the types: [`Refusal`] is terminal non-acceptance, [`Progress`] carries
//! the one non-terminal state, and the store layer's facts ([`StoreCode`]) are no
//! decoder's verdict at all.

use core::fmt;

/// A §9 **invalid** code: these octets are not canonical `deixis-codec-v2`, now or ever.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Fault {
    /// A `cuvarint` whose continuation runs past ten octets, or past the end of its input.
    MalformedUvarint,
    /// A well-formed, in-range `cuvarint` that is not the shortest spelling of its value.
    NonShortestUvarint,
    /// A well-formed spelling of a value of `2^64` or more.
    UvarintOverflow,
    /// Four octets were read and they are not the form's magic.
    UnknownMagic,
    /// An entry key equal to its predecessor.
    DuplicateKey,
    /// An entry key preceding its predecessor.
    UnsortedKeys,
    /// Octets after the root node, or after a chunk's last entry.
    TrailingBytes,
    /// Input ended mid-structure.
    UnexpectedEof,
    /// A link index at or beyond `nlinks`.
    BadLinkIndex,
    /// A listed hash that no entry references.
    UnusedLink,
    /// The same hash listed twice in one links header.
    DuplicateLinkHash,
    /// A link index used for the first time out of first-use order.
    LinksOutOfOrder,
    /// A child chunk whose slot-codec-id differs from its parent's.
    SlotCodecMismatch,
    /// An id that cannot be one id of its form (§13).
    MalformedSlotCodecId,
    /// A node payload outside `im(e)`.
    NonCanonicalPayload,
}

impl Fault {
    /// Every invalid code, in §9's order.
    pub const ALL: [Fault; 15] = [
        Fault::MalformedUvarint,
        Fault::NonShortestUvarint,
        Fault::UvarintOverflow,
        Fault::UnknownMagic,
        Fault::DuplicateKey,
        Fault::UnsortedKeys,
        Fault::TrailingBytes,
        Fault::UnexpectedEof,
        Fault::BadLinkIndex,
        Fault::UnusedLink,
        Fault::DuplicateLinkHash,
        Fault::LinksOutOfOrder,
        Fault::SlotCodecMismatch,
        Fault::MalformedSlotCodecId,
        Fault::NonCanonicalPayload,
    ];

    /// The code exactly as §9 spells it.
    pub fn code(self) -> &'static str {
        match self {
            Fault::MalformedUvarint => "malformed_uvarint",
            Fault::NonShortestUvarint => "non_shortest_uvarint",
            Fault::UvarintOverflow => "uvarint_overflow",
            Fault::UnknownMagic => "unknown_magic",
            Fault::DuplicateKey => "duplicate_key",
            Fault::UnsortedKeys => "unsorted_keys",
            Fault::TrailingBytes => "trailing_bytes",
            Fault::UnexpectedEof => "unexpected_eof",
            Fault::BadLinkIndex => "bad_link_index",
            Fault::UnusedLink => "unused_link",
            Fault::DuplicateLinkHash => "duplicate_link_hash",
            Fault::LinksOutOfOrder => "links_out_of_order",
            Fault::SlotCodecMismatch => "slot_codec_mismatch",
            Fault::MalformedSlotCodecId => "malformed_slot_codec_id",
            Fault::NonCanonicalPayload => "non_canonical_payload",
        }
    }
}

/// A §12 dimension, named by its stable token.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dimension {
    VarintValue,
    SlotCodecIdLength,
    KeyLength,
    PayloadLength,
    EntriesPerNode,
    LinksPerChunk,
    FlatArtifactOctets,
    ChunkOctets,
    UniqueChunks,
    UniqueOctets,
    LogicalDepth,
    UnfoldedNodeCount,
    UnfoldedFlatOctets,
}

impl Dimension {
    /// Every dimension, in §12's order.
    pub const ALL: [Dimension; 13] = [
        Dimension::VarintValue,
        Dimension::SlotCodecIdLength,
        Dimension::KeyLength,
        Dimension::PayloadLength,
        Dimension::EntriesPerNode,
        Dimension::LinksPerChunk,
        Dimension::FlatArtifactOctets,
        Dimension::ChunkOctets,
        Dimension::UniqueChunks,
        Dimension::UniqueOctets,
        Dimension::LogicalDepth,
        Dimension::UnfoldedNodeCount,
        Dimension::UnfoldedFlatOctets,
    ];

    /// The token exactly as §12 spells it.
    pub fn token(self) -> &'static str {
        match self {
            Dimension::VarintValue => "varint_value",
            Dimension::SlotCodecIdLength => "slot_codec_id_length",
            Dimension::KeyLength => "key_length",
            Dimension::PayloadLength => "payload_length",
            Dimension::EntriesPerNode => "entries_per_node",
            Dimension::LinksPerChunk => "links_per_chunk",
            Dimension::FlatArtifactOctets => "flat_artifact_octets",
            Dimension::ChunkOctets => "chunk_octets",
            Dimension::UniqueChunks => "unique_chunks",
            Dimension::UniqueOctets => "unique_octets",
            Dimension::LogicalDepth => "logical_depth",
            Dimension::UnfoldedNodeCount => "unfolded_node_count",
            Dimension::UnfoldedFlatOctets => "unfolded_flat_octets",
        }
    }

    /// The dimension a §12 token names, or `None` for a string §12 does not declare.
    pub fn from_token(token: &str) -> Option<Dimension> {
        Dimension::ALL.into_iter().find(|d| d.token() == token)
    }
}

/// §9's four non-acceptance classes. They license different actions, so they are never
/// collapsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Class {
    /// Not canonical `deixis-codec-v2`: not a value, now or ever.
    Invalid,
    /// Well-formed framing, absent capability: the octets may be a value.
    Unsupported,
    /// Streaming only: more input may arrive, and nothing can be concluded yet.
    Incomplete,
    /// Valid so far, beyond a local limit: the reader declines to spend.
    ResourceRefused,
}

impl Class {
    /// The class name as the conformance protocol spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Class::Invalid => "invalid",
            Class::Unsupported => "unsupported",
            Class::Incomplete => "incomplete",
            Class::ResourceRefused => "resource-refused",
        }
    }

    /// The class of a §9 decoder code. `None` for the store layer's codes — which are
    /// facts about a store and no decoder's verdict — and for a name §9 does not declare.
    pub fn of_code(code: &str) -> Option<Class> {
        if Fault::ALL.iter().any(|fault| fault.code() == code) {
            return Some(Class::Invalid);
        }
        match code {
            UNSUPPORTED_SLOT_CODEC => Some(Class::Unsupported),
            NEED_MORE_INPUT => Some(Class::Incomplete),
            LIMIT_EXCEEDED => Some(Class::ResourceRefused),
            _ => None,
        }
    }
}

/// §9's unsupported code.
pub const UNSUPPORTED_SLOT_CODEC: &str = "unsupported_slot_codec";
/// §9's resource-refused code; a refusal carrying it also names its [`Dimension`].
pub const LIMIT_EXCEEDED: &str = "limit_exceeded";
/// §14's one non-terminal state, as a code of the incomplete class.
pub const NEED_MORE_INPUT: &str = "need_more_input";

/// A decoder's terminal non-acceptance: one code in exactly one of the three terminal
/// classes. The fourth class, incomplete, is not terminal and is [`Progress`]'s.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Refusal {
    /// A §9 invalid code.
    Invalid(Fault),
    /// `unsupported_slot_codec`: the framing was well formed, and this reader does not
    /// hold the codec its id names. The framing judgment stands permanently.
    Unsupported,
    /// `limit_exceeded`, naming the dimension a local limit refused on. Never invalidity.
    LimitExceeded(Dimension),
}

impl Refusal {
    /// The refusal's class.
    pub fn class(self) -> Class {
        match self {
            Refusal::Invalid(_) => Class::Invalid,
            Refusal::Unsupported => Class::Unsupported,
            Refusal::LimitExceeded(_) => Class::ResourceRefused,
        }
    }

    /// The code exactly as §9 spells it.
    pub fn code(self) -> &'static str {
        match self {
            Refusal::Invalid(fault) => fault.code(),
            Refusal::Unsupported => UNSUPPORTED_SLOT_CODEC,
            Refusal::LimitExceeded(_) => LIMIT_EXCEEDED,
        }
    }

    /// The dimension a `limit_exceeded` names; `None` for every other code.
    pub fn dimension(self) -> Option<Dimension> {
        match self {
            Refusal::LimitExceeded(dimension) => Some(dimension),
            _ => None,
        }
    }
}

impl From<Fault> for Refusal {
    fn from(fault: Fault) -> Self {
        Refusal::Invalid(fault)
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.dimension() {
            Some(dimension) => write!(
                f,
                "{}: {} ({})",
                self.class().as_str(),
                self.code(),
                dimension.token()
            ),
            None => write!(f, "{}: {}", self.class().as_str(), self.code()),
        }
    }
}

impl std::error::Error for Refusal {}

/// Where a streaming decode stands (§14).
///
/// `NeedMoreInput` is the one non-terminal state: the decoder cannot yet give a final
/// verdict. It covers an incomplete artifact and also a complete one while the stream is
/// still open, since an octet arriving after a complete root would make it
/// `trailing_bytes`. `Done` is final, and feeding more input never changes it.
#[derive(Debug)]
pub enum Progress<T> {
    NeedMoreInput,
    Done(Result<T, Refusal>),
}

/// The store / traversal layer's codes (§9). They are facts about a store, not about
/// octets, and are never a decoder's verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StoreCode {
    /// The store holds nothing under a referenced address.
    MissingChunk,
    /// The octets a store returned do not hash to the address they were reached by.
    HashMismatch,
    /// Unequal octets offered under one digest (§15). A store raises it on insertion; a
    /// resolver, which only reads, never does.
    AddressConflict,
}

impl StoreCode {
    /// The code exactly as §9 spells it.
    pub fn code(self) -> &'static str {
        match self {
            StoreCode::MissingChunk => "missing_chunk",
            StoreCode::HashMismatch => "hash_mismatch",
            StoreCode::AddressConflict => "address_conflict",
        }
    }
}
