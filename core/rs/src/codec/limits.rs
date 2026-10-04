//! §12's resource envelope: a reader's local limits.

use super::Dimension;

/// The limits a reader applies, one per §12 dimension. Each is the largest value the
/// reader accepts, so an input exceeds a limit when it goes **above** it.
///
/// [`Limits::FLOORS`] (the default) sets every limit at its MUST-accept floor, the least
/// a conforming reader may set. Raising a limit is a local choice; lowering one below its
/// floor makes the reader non-conforming, and is offered only so the refusal path can be
/// exercised. Exceeding a limit is always `limit_exceeded` naming the dimension, never
/// invalidity.
///
/// Limits are met in parse order: at the first field or octet that exceeds them, with an
/// earlier fault winning. Nothing is refused up front on the length of a buffer the
/// reader happens to hold, because a streaming reader could not know it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limits {
    /// The largest `cuvarint` value. Its floor is the whole domain, so a conforming
    /// reader never refuses on it; a value beyond the domain is `uvarint_overflow`.
    pub varint_value: u64,
    /// The longest slot-codec-id, in octets.
    pub slot_codec_id_length: u64,
    /// The longest entry key, in octets.
    pub key_length: u64,
    /// The longest node payload, in octets.
    pub payload_length: u64,
    /// The most entries one node may declare.
    pub entries_per_node: u64,
    /// The most hashes one links header may declare.
    pub links_per_chunk: u64,
    /// The longest flat artifact, in octets.
    pub flat_artifact_octets: u64,
    /// The longest single chunk, in octets.
    pub chunk_octets: u64,
    /// The most distinct chunks one closure walk may reach.
    pub unique_chunks: u64,
    /// The most octets, summed over distinct chunks, one closure walk may reach.
    pub unique_octets: u64,
    /// The deepest node, counted in edges: the root is at depth 0.
    pub logical_depth: u64,
    /// The most node occurrences in the tree an artifact or closure denotes.
    pub unfolded_node_count: u64,
    /// The longest flat artifact a closure flattens to, header included.
    pub unfolded_flat_octets: u64,
}

impl Limits {
    /// Every limit at its §12 floor.
    pub const FLOORS: Limits = Limits {
        varint_value: u64::MAX,
        slot_codec_id_length: 32,
        key_length: 4_096,
        payload_length: 16 << 20,
        entries_per_node: 65_536,
        links_per_chunk: 65_536,
        flat_artifact_octets: 64 << 20,
        chunk_octets: 32 << 20,
        unique_chunks: 1_000_000,
        unique_octets: 1 << 30,
        logical_depth: 256,
        unfolded_node_count: 16_777_216,
        unfolded_flat_octets: 1 << 30,
    };

    /// The limit on `dimension`.
    pub fn get(&self, dimension: Dimension) -> u64 {
        match dimension {
            Dimension::VarintValue => self.varint_value,
            Dimension::SlotCodecIdLength => self.slot_codec_id_length,
            Dimension::KeyLength => self.key_length,
            Dimension::PayloadLength => self.payload_length,
            Dimension::EntriesPerNode => self.entries_per_node,
            Dimension::LinksPerChunk => self.links_per_chunk,
            Dimension::FlatArtifactOctets => self.flat_artifact_octets,
            Dimension::ChunkOctets => self.chunk_octets,
            Dimension::UniqueChunks => self.unique_chunks,
            Dimension::UniqueOctets => self.unique_octets,
            Dimension::LogicalDepth => self.logical_depth,
            Dimension::UnfoldedNodeCount => self.unfolded_node_count,
            Dimension::UnfoldedFlatOctets => self.unfolded_flat_octets,
        }
    }

    /// These limits with `dimension` set to `limit`.
    pub fn with(mut self, dimension: Dimension, limit: u64) -> Limits {
        *match dimension {
            Dimension::VarintValue => &mut self.varint_value,
            Dimension::SlotCodecIdLength => &mut self.slot_codec_id_length,
            Dimension::KeyLength => &mut self.key_length,
            Dimension::PayloadLength => &mut self.payload_length,
            Dimension::EntriesPerNode => &mut self.entries_per_node,
            Dimension::LinksPerChunk => &mut self.links_per_chunk,
            Dimension::FlatArtifactOctets => &mut self.flat_artifact_octets,
            Dimension::ChunkOctets => &mut self.chunk_octets,
            Dimension::UniqueChunks => &mut self.unique_chunks,
            Dimension::UniqueOctets => &mut self.unique_octets,
            Dimension::LogicalDepth => &mut self.logical_depth,
            Dimension::UnfoldedNodeCount => &mut self.unfolded_node_count,
            Dimension::UnfoldedFlatOctets => &mut self.unfolded_flat_octets,
        } = limit;
        self
    }
}

impl Default for Limits {
    fn default() -> Self {
        Limits::FLOORS
    }
}
