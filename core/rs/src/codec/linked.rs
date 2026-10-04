//! §6's linked form (`dxl2`), §7's addresses, §12's closure walk and budgets, and §14's
//! two retrieval constructors.
//!
//! ```text
//! chunk  := "dxl2" ‖ cuvarint(len(id)) ‖ id
//!         ‖ cuvarint(nlinks) ‖ hash{32}*                 # the links header
//!         ‖ body
//! body   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ lentry*
//! lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)
//! ```
//!
//! One node is one chunk, and a child is referenced by the SHA-256 of its whole chunk.
//! The links header lists each distinct child hash once, in first-use order over the
//! entries in key order, so a subtree occurring twice is stored once: a closure is a
//! DAG, and every measure of the tree it denotes is computed over the DAG with
//! saturating arithmetic, never by unfolding it.
//!
//! A closure is judged in the order law 4 and §11 fix: every reachable chunk's framing,
//! links and digest as the walk meets it; then the capability judgment; then every
//! payload. The materialize and flatten budgets guard the build and are checked last.

use core::cmp::Ordering;
use core::fmt;
use core::ops::Range;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::BuildHasher;

use crate::sha256;
use crate::Node;

use super::cuvarint::{self, Scan};
use super::flat;
use super::id::{judge, write_head, EncodeError, IdRef, LENGTHS};
use super::slot::{lend, Decoded, Registry, SlotCodec};
use super::{Dimension, Fault, Limits, Refusal, StoreCode};

pub(crate) const MAGIC: &[u8; 4] = b"dxl2";
const DIGEST: usize = 32;

/// How a chunk's octets are hashed to its address. Always SHA-256, except in this
/// module's tests, which need a function under which a hash cycle can be built.
type Digest = fn(&[u8]) -> [u8; 32];

// --- addresses --------------------------------------------------------------------------

/// An address space (§7). `deixis-codec-v2` has one; a successor is a new space, and no
/// address in one space is ever equivalent to an address in another.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AddressSpace {
    Dxl2,
}

impl AddressSpace {
    /// The space's name as addresses carry it.
    pub fn as_str(self) -> &'static str {
        match self {
            AddressSpace::Dxl2 => "dxl2",
        }
    }
}

/// A content address: the pair `(address-space, digest{32})` (§7). A bare 32-octet digest
/// is not an address, so there is no conversion from one.
///
/// The address of a value is the SHA-256 of its linked-form root chunk and nothing else.
/// Under this candidate contract it is not a stable identity (§16): a pre-freeze change
/// to the contract changes addresses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Address {
    space: AddressSpace,
    digest: [u8; DIGEST],
}

impl Address {
    /// The address `digest` in `space`.
    pub fn new(space: AddressSpace, digest: [u8; DIGEST]) -> Address {
        Address { space, digest }
    }

    /// The address of a chunk's octets: their SHA-256, in `dxl2`. Says nothing about
    /// whether the octets are a well-formed chunk.
    pub fn of_chunk(octets: &[u8]) -> Address {
        Address::new(AddressSpace::Dxl2, sha256::digest(octets))
    }

    pub fn space(&self) -> AddressSpace {
        self.space
    }

    pub fn digest(&self) -> &[u8; DIGEST] {
        &self.digest
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:", self.space.as_str())?;
        for octet in self.digest {
            write!(f, "{octet:02x}")?;
        }
        Ok(())
    }
}

// --- the store, and what it can say --------------------------------------------------------

/// Where a resolver fetches chunks by address: the read side of a `chunk-store`.
///
/// It is **untrusted**. Whatever it returns is verified against the hash by which the
/// chunk was reached — the root against the address requested, a child against its
/// parent's link — even where the store claims to have verified it already (§14).
pub trait ChunkStore {
    /// The octets held under `address`, or `None` when the store holds none.
    fn fetch(&self, address: &Address) -> Option<Vec<u8>>;
}

impl<S: ChunkStore + ?Sized> ChunkStore for &S {
    fn fetch(&self, address: &Address) -> Option<Vec<u8>> {
        (**self).fetch(address)
    }
}

impl ChunkStore for BTreeMap<Address, Vec<u8>> {
    fn fetch(&self, address: &Address) -> Option<Vec<u8>> {
        self.get(address).cloned()
    }
}

impl<H: BuildHasher> ChunkStore for HashMap<Address, Vec<u8>, H> {
    fn fetch(&self, address: &Address) -> Option<Vec<u8>> {
        self.get(address).cloned()
    }
}

/// A store-layer outcome at one address (§9): a fact about a store, never a decoder's
/// verdict on octets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StoreFault {
    pub code: StoreCode,
    pub address: Address,
}

impl fmt::Display for StoreFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "store: {} at {}", self.code.code(), self.address)
    }
}

/// Why a linked operation produced no result: a decoder verdict on some chunk of the
/// closure, or a fact about the store. The two never mix, because §9 excludes the store
/// layer's codes from every decoder verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkedError {
    Refused(Refusal),
    Store(StoreFault),
}

impl From<Refusal> for LinkedError {
    fn from(refusal: Refusal) -> Self {
        LinkedError::Refused(refusal)
    }
}

impl From<Fault> for LinkedError {
    fn from(fault: Fault) -> Self {
        LinkedError::Refused(Refusal::Invalid(fault))
    }
}

impl fmt::Display for LinkedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LinkedError::Refused(refusal) => fmt::Display::fmt(refusal, f),
            LinkedError::Store(fault) => fmt::Display::fmt(fault, f),
        }
    }
}

impl std::error::Error for LinkedError {}

fn limit(dimension: Dimension) -> LinkedError {
    LinkedError::Refused(Refusal::LimitExceeded(dimension))
}

// --- encoding --------------------------------------------------------------------------

/// A value in the linked form: its root address and every chunk of its closure, each once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Linked {
    pub root: Address,
    pub chunks: BTreeMap<Address, Vec<u8>>,
}

/// The closure of `node` under `codec`: one chunk per distinct subtree value, keyed by
/// address. Equal subtrees give equal chunks, so the chunk set is a function of the value
/// (law 2). Refuses locally only when the codec's id is not a well-formed whole id.
pub fn encode_linked<C: SlotCodec + ?Sized>(
    node: &Node<C::Value>,
    codec: &C,
) -> Result<Linked, EncodeError> {
    let mut head = Vec::new();
    write_head(MAGIC, codec.id(), &mut head)?;
    let mut chunks = BTreeMap::new();

    // Post-order: a chunk can be written once the hashes of its children are known.
    let mut open = vec![(node, node.children().iter(), Vec::new())];
    loop {
        let top = open
            .last_mut()
            .expect("the root stays open until it is written");
        if let Some((_, child)) = top.1.next() {
            open.push((child, child.children().iter(), Vec::new()));
            continue;
        }
        let (done, _, hashes) = open.pop().expect("an open node");
        let octets = write_chunk(&head, done, &hashes, codec);
        let address = Address::of_chunk(&octets);
        chunks.entry(address).or_insert(octets);
        match open.last_mut() {
            Some(parent) => parent.2.push(address.digest),
            None => {
                return Ok(Linked {
                    root: address,
                    chunks,
                })
            }
        }
    }
}

/// One node's chunk, given the hashes of its children in key order.
fn write_chunk<C: SlotCodec + ?Sized>(
    head: &[u8],
    node: &Node<C::Value>,
    hashes: &[[u8; DIGEST]],
    codec: &C,
) -> Vec<u8> {
    // First-use order: scanning the entries in key order, each distinct hash is appended
    // at its first reference, and every entry points at its hash's position.
    let mut links: Vec<[u8; DIGEST]> = Vec::new();
    let mut position: HashMap<[u8; DIGEST], u64> = HashMap::new();
    let indices: Vec<u64> = hashes
        .iter()
        .map(|hash| {
            *position.entry(*hash).or_insert_with(|| {
                links.push(*hash);
                links.len() as u64 - 1
            })
        })
        .collect();

    let mut out = head.to_vec();
    cuvarint::encode(links.len() as u64, &mut out);
    for hash in &links {
        out.extend_from_slice(hash);
    }
    let payload = codec.encode(node.own());
    cuvarint::encode(payload.len() as u64, &mut out);
    out.extend_from_slice(&payload);
    cuvarint::encode(indices.len() as u64, &mut out);
    for ((key, _), index) in node.children().iter().zip(indices) {
        cuvarint::encode(key.len() as u64, &mut out);
        out.extend_from_slice(key);
        cuvarint::encode(index, &mut out);
    }
    out
}

// --- one chunk ---------------------------------------------------------------------------

/// A chunk's framing, as offsets into its octets.
#[derive(Debug)]
struct Frame {
    id: Range<usize>,
    links: Vec<[u8; DIGEST]>,
    payload: Range<usize>,
    /// Each entry's key and link index, in key order.
    entries: Vec<(Range<usize>, usize)>,
}

/// A chunk that was fetched, verified against the hash by which it was reached, and
/// found canonical in its framing and links (§6 rules 1–7, payload excepted).
///
/// There are exactly two ways to get one, and they are separate constructors because
/// they anchor different things (§14): [`Chunk::resolve_root`] takes its hash from the
/// caller and establishes that this is the value asked for; [`Chunk::resolve_child`]
/// takes it from an already-verified parent's links header.
#[derive(Debug)]
pub struct Chunk {
    address: Address,
    octets: Box<[u8]>,
    frame: Frame,
}

impl Chunk {
    /// **resolve-root**: fetch the chunk at `address` and verify it against that address
    /// — the one hash in a traversal that comes from outside the closure.
    pub fn resolve_root<S: ChunkStore + ?Sized>(
        address: &Address,
        store: &S,
        limits: &Limits,
    ) -> Result<Chunk, LinkedError> {
        Chunk::load(*address, store, limits, sha256::digest, &mut 0)
    }

    /// **resolve-child**: fetch the child this chunk holds under `key`, verify it against
    /// the hash its links header lists for that entry, and refuse it as
    /// `slot_codec_mismatch` when its id is not this chunk's. `None` when `key` is not one
    /// of this chunk's keys.
    pub fn resolve_child<S: ChunkStore + ?Sized>(
        &self,
        key: &[u8],
        store: &S,
        limits: &Limits,
    ) -> Option<Result<Chunk, LinkedError>> {
        let link = self.link(key)?;
        Some(self.child(link, store, limits, sha256::digest, &mut 0))
    }

    /// The links-header position of the entry under `key`. Entries are strictly
    /// ascending by key, which the parse checked, so a binary search finds it.
    fn link(&self, key: &[u8]) -> Option<usize> {
        let entries = &self.frame.entries;
        let at = entries
            .binary_search_by(|(entry, _)| self.octets[entry.clone()].cmp(key))
            .ok()?;
        Some(entries[at].1)
    }

    /// The child at links-header position `link`, which the caller took from this
    /// chunk's own entries or links header.
    fn child<S: ChunkStore + ?Sized>(
        &self,
        link: usize,
        store: &S,
        limits: &Limits,
        digest: Digest,
        reached: &mut u64,
    ) -> Result<Chunk, LinkedError> {
        let address = Address::new(AddressSpace::Dxl2, self.frame.links[link]);
        let child = Chunk::load(address, store, limits, digest, reached)?;
        // Read first, ruled last: the child's own framing was judged, whole, before its
        // id is compared with its parent's.
        if child.slot_codec_id() != self.slot_codec_id() {
            return Err(Fault::SlotCodecMismatch.into());
        }
        Ok(child)
    }

    /// Fetch, meet the size limits, verify, parse. `reached` sums the octets of every
    /// distinct chunk the caller's walk has reached.
    fn load<S: ChunkStore + ?Sized>(
        address: Address,
        store: &S,
        limits: &Limits,
        digest: Digest,
        reached: &mut u64,
    ) -> Result<Chunk, LinkedError> {
        let Some(octets) = store.fetch(&address) else {
            return Err(LinkedError::Store(StoreFault {
                code: StoreCode::MissingChunk,
                address,
            }));
        };
        let length = octets.len() as u64;
        if length > limits.chunk_octets {
            return Err(limit(Dimension::ChunkOctets));
        }
        *reached = reached.saturating_add(length);
        if *reached > limits.unique_octets {
            return Err(limit(Dimension::UniqueOctets));
        }
        if digest(&octets) != address.digest {
            return Err(LinkedError::Store(StoreFault {
                code: StoreCode::HashMismatch,
                address,
            }));
        }
        let frame = parse(&octets, limits)?;
        Ok(Chunk {
            address,
            octets: octets.into_boxed_slice(),
            frame,
        })
    }

    /// The address it was reached by, which its octets hash to.
    pub fn address(&self) -> &Address {
        &self.address
    }

    /// Its whole octets.
    pub fn octets(&self) -> &[u8] {
        &self.octets
    }

    /// Its slot-codec-id, structurally well formed.
    pub fn slot_codec_id(&self) -> IdRef<'_> {
        IdRef::judged(&self.octets[self.frame.id.clone()])
    }

    /// Its own payload: framed, and not judged. Only a codec-holding reader can say
    /// whether it is in `im(e)`.
    pub fn payload(&self) -> &[u8] {
        &self.octets[self.frame.payload.clone()]
    }

    /// The addresses in its links header, in first-use order.
    pub fn links(&self) -> impl Iterator<Item = Address> + '_ {
        self.frame
            .links
            .iter()
            .map(|digest| Address::new(AddressSpace::Dxl2, *digest))
    }

    /// Its entries in key order: each key, and the links-header position of its child.
    pub fn entries(&self) -> impl Iterator<Item = (&[u8], usize)> + '_ {
        self.frame
            .entries
            .iter()
            .map(|(key, link)| (&self.octets[key.clone()], *link))
    }
}

/// Reads one chunk's octets, which are complete: running out is end of input.
struct Cursor<'a> {
    octets: &'a [u8],
    pos: usize,
    limits: &'a Limits,
}

impl Cursor<'_> {
    fn take(&mut self, length: u64) -> Result<Range<usize>, Refusal> {
        let end = usize::try_from(length)
            .ok()
            .and_then(|length| self.pos.checked_add(length))
            .filter(|&end| end <= self.octets.len())
            .ok_or(Refusal::Invalid(Fault::UnexpectedEof))?;
        let range = self.pos..end;
        self.pos = end;
        Ok(range)
    }

    fn integer(&mut self) -> Result<u64, Refusal> {
        match cuvarint::scan(&self.octets[self.pos..]) {
            Scan::Value(value, width) => {
                if value > self.limits.varint_value {
                    return Err(Refusal::LimitExceeded(Dimension::VarintValue));
                }
                self.pos += width;
                Ok(value)
            }
            Scan::Short(0) => Err(Fault::UnexpectedEof.into()),
            Scan::Short(_) => Err(Fault::MalformedUvarint.into()),
            Scan::Fault(fault) => Err(fault.into()),
        }
    }
}

/// Parse one chunk's framing and links (§6), in order, reporting the first fault.
fn parse(octets: &[u8], limits: &Limits) -> Result<Frame, Refusal> {
    let mut at = Cursor {
        octets,
        pos: 0,
        limits,
    };

    let magic = at.take(MAGIC.len() as u64)?;
    if octets[magic] != MAGIC[..] {
        return Err(Fault::UnknownMagic.into());
    }
    let id_length = at.integer()?;
    if !LENGTHS.contains(&id_length) {
        return Err(Fault::MalformedSlotCodecId.into());
    }
    if id_length > limits.slot_codec_id_length {
        return Err(Refusal::LimitExceeded(Dimension::SlotCodecIdLength));
    }
    let id = at.take(id_length)?;
    match judge(&octets[id.clone()]) {
        Err(fault) => return Err(fault.into()),
        Ok(Some(ordinal)) if ordinal > limits.varint_value => {
            return Err(Refusal::LimitExceeded(Dimension::VarintValue))
        }
        Ok(_) => {}
    }

    let nlinks = at.integer()?;
    if nlinks > limits.links_per_chunk {
        return Err(Refusal::LimitExceeded(Dimension::LinksPerChunk));
    }
    let mut links = Vec::new();
    let mut listed = HashSet::new();
    for _ in 0..nlinks {
        let hash = at.take(DIGEST as u64)?;
        let hash: [u8; DIGEST] = octets[hash].try_into().expect("a hash is 32 octets");
        if !listed.insert(hash) {
            return Err(Fault::DuplicateLinkHash.into());
        }
        links.push(hash);
    }

    let payload_length = at.integer()?;
    if payload_length > limits.payload_length {
        return Err(Refusal::LimitExceeded(Dimension::PayloadLength));
    }
    let payload = at.take(payload_length)?;
    let count = at.integer()?;
    if count > limits.entries_per_node {
        return Err(Refusal::LimitExceeded(Dimension::EntriesPerNode));
    }

    let mut entries = Vec::new();
    let mut previous: Option<Range<usize>> = None;
    // Link indices first seen must appear as 0, 1, 2, …, so the indices in use are
    // always exactly those below `unused`.
    let mut unused = 0u64;
    for _ in 0..count {
        let key_length = at.integer()?;
        if key_length > limits.key_length {
            return Err(Refusal::LimitExceeded(Dimension::KeyLength));
        }
        let key = at.take(key_length)?;
        if let Some(previous) = &previous {
            match octets[key.clone()].cmp(&octets[previous.clone()]) {
                Ordering::Equal => return Err(Fault::DuplicateKey.into()),
                Ordering::Less => return Err(Fault::UnsortedKeys.into()),
                Ordering::Greater => {}
            }
        }
        let index = at.integer()?;
        if index >= nlinks {
            return Err(Fault::BadLinkIndex.into());
        }
        match index.cmp(&unused) {
            Ordering::Greater => return Err(Fault::LinksOutOfOrder.into()),
            Ordering::Equal => unused += 1,
            Ordering::Less => {}
        }
        // Below nlinks, and every one of the nlinks hashes is held in `links`.
        entries.push((key.clone(), index as usize));
        previous = Some(key);
    }
    if unused < nlinks {
        return Err(Fault::UnusedLink.into());
    }
    if at.pos < octets.len() {
        return Err(Fault::TrailingBytes.into());
    }
    Ok(Frame {
        id,
        links,
        payload,
        entries,
    })
}

// --- a closure -------------------------------------------------------------------------

/// Measures of the tree a closure denotes, computed over its DAG with saturating
/// arithmetic, never by unfolding it (§12).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unfolded {
    /// Node occurrences in the denoted tree.
    pub nodes: u64,
    /// Octets of the flat artifact the closure flattens to, header included.
    pub flat_octets: u64,
    /// Logical depth, in edges: the root is at depth 0.
    pub depth: u64,
}

/// A closure every reachable chunk of which is present, hash-matching, and canonical in
/// its framing and links: what §15 calls an *opaque closure present*, and the result of
/// the `closure-checker` profile. It is **not** a validated value — no payload has been
/// judged — until [`Closure::validate`], [`Closure::materialize`] or [`Closure::flatten`]
/// judges them.
#[derive(Debug)]
pub struct Closure {
    /// Distinct chunks in the order the walk reached them; the root first.
    chunks: Vec<Chunk>,
    /// Per chunk, per links-header position: the index of the chunk that link names.
    children: Vec<Vec<usize>>,
    unfolded: Unfolded,
}

impl Closure {
    /// Walk the closure rooted at `root`: resolve the root against `root`, then every
    /// reachable child against its parent's link, depth-first in first-use order, each
    /// distinct chunk once.
    ///
    /// The walk meets `chunk_octets`, `unique_octets`, `unique_chunks`, `logical_depth`
    /// and every per-field limit as it goes. Reaching a chunk still on the current path —
    /// an ancestor — is a hash cycle, which denotes no finite tree: `limit_exceeded`
    /// naming `logical_depth`.
    pub fn check<S: ChunkStore + ?Sized>(
        root: &Address,
        store: &S,
        limits: &Limits,
    ) -> Result<Closure, LinkedError> {
        Closure::walk(*root, store, limits, sha256::digest)
    }

    fn walk<S: ChunkStore + ?Sized>(
        root: Address,
        store: &S,
        limits: &Limits,
        digest: Digest,
    ) -> Result<Closure, LinkedError> {
        let mut reached = 0u64;
        if limits.unique_chunks == 0 {
            return Err(limit(Dimension::UniqueChunks));
        }
        let first = Chunk::load(root, store, limits, digest, &mut reached)?;

        let mut index: HashMap<[u8; DIGEST], usize> = HashMap::new();
        index.insert(root.digest, 0);
        let mut chunks = vec![first];
        let mut children: Vec<Vec<usize>> = vec![Vec::new()];
        let mut measures: Vec<Option<Unfolded>> = vec![None];
        let mut on_path = vec![true];
        // The current path, as (chunk, next links-header position to follow).
        let mut path: Vec<(usize, usize)> = vec![(0, 0)];

        while let Some(&(current, link)) = path.last() {
            if link == chunks[current].frame.links.len() {
                measures[current] = Some(measure(&chunks[current], &children[current], &measures));
                on_path[current] = false;
                path.pop();
                continue;
            }
            path.last_mut().expect("the current chunk is on the path").1 += 1;
            let hash = chunks[current].frame.links[link];

            if let Some(&known) = index.get(&hash) {
                if on_path[known] {
                    return Err(limit(Dimension::LogicalDepth));
                }
                children[current].push(known);
                continue;
            }
            // The chunk about to be reached sits one edge below the current one.
            if path.len() as u64 > limits.logical_depth {
                return Err(limit(Dimension::LogicalDepth));
            }
            if chunks.len() as u64 >= limits.unique_chunks {
                return Err(limit(Dimension::UniqueChunks));
            }
            let child = chunks[current].child(link, store, limits, digest, &mut reached)?;
            let next = chunks.len();
            index.insert(hash, next);
            chunks.push(child);
            children.push(Vec::new());
            measures.push(None);
            on_path.push(true);
            children[current].push(next);
            path.push((next, 0));
        }

        let tree = measures[0].expect("the root is the last chunk to finish");
        let id = chunks[0].frame.id.len() as u64;
        let header = (flat::MAGIC.len() as u64) + cuvarint::encoded_len(id) + id;
        let unfolded = Unfolded {
            flat_octets: header.saturating_add(tree.flat_octets),
            ..tree
        };
        // A deeper path than the walk itself took can run through a shared chunk.
        if unfolded.depth > limits.logical_depth {
            return Err(limit(Dimension::LogicalDepth));
        }
        Ok(Closure {
            chunks,
            children,
            unfolded,
        })
    }

    /// The root chunk.
    pub fn root(&self) -> &Chunk {
        &self.chunks[0]
    }

    /// Every distinct chunk, root first, in the order the walk reached them.
    pub fn chunks(&self) -> impl Iterator<Item = &Chunk> + '_ {
        self.chunks.iter()
    }

    /// The denoted tree's measures, as computed over the DAG.
    pub fn unfolded(&self) -> Unfolded {
        self.unfolded
    }

    /// Materialize the value (the `linked-resolver`'s result) together with the codec it
    /// was decoded under, codec-holding for exactly the ids `registry` holds.
    ///
    /// The capability judgment and then every payload are judged first; only a closure
    /// that passes them meets the budget — `unfolded_node_count` and
    /// `unfolded_flat_octets` — and it is met before anything is built.
    pub fn materialize<'r, R: Registry + ?Sized>(
        &self,
        registry: &'r R,
        limits: &Limits,
    ) -> Result<Decoded<'r, R::Value>, Refusal> {
        let codec = self.capability(registry)?;
        // The first occurrence of each chunk takes the value its judgment decoded; a
        // shared chunk's later occurrences decode again, so no bound is asked of T.
        let mut first = Vec::with_capacity(self.chunks.len());
        for chunk in &self.chunks {
            match codec.decode(chunk.payload()) {
                Some(value) => first.push(Some(value)),
                None => return Err(Fault::NonCanonicalPayload.into()),
            }
        }
        self.budget(limits, true)?;

        struct Occurrence<'c, V> {
            chunk: usize,
            value: V,
            next: usize,
            key: &'c [u8],
            children: Vec<(&'c [u8], Node<V>)>,
        }
        let value = |index: usize, first: &mut Vec<Option<R::Value>>| match first[index].take() {
            Some(value) => Ok(value),
            None => codec
                .decode(self.chunks[index].payload())
                .ok_or(Refusal::Invalid(Fault::NonCanonicalPayload)),
        };

        let root = value(0, &mut first)?;
        let mut stack = vec![Occurrence {
            chunk: 0,
            value: root,
            next: 0,
            key: &[],
            children: Vec::new(),
        }];
        let node = loop {
            let (current, next) = {
                let top = stack.last().expect("the root stays until it is built");
                (top.chunk, top.next)
            };
            let chunk = &self.chunks[current];
            if let Some((key, link)) = chunk.frame.entries.get(next) {
                stack.last_mut().expect("the current occurrence").next += 1;
                let child = self.children[current][*link];
                let child_value = value(child, &mut first)?;
                stack.push(Occurrence {
                    chunk: child,
                    value: child_value,
                    next: 0,
                    key: &chunk.octets[key.clone()],
                    children: Vec::new(),
                });
                continue;
            }
            let done = stack.pop().expect("the current occurrence");
            let node = Node::compose(done.value, done.children)
                .expect("chunk keys are strictly ascending");
            match stack.last_mut() {
                Some(parent) => parent.children.push((done.key, node)),
                None => break node,
            }
        };
        Ok(Decoded::new(node, codec))
    }

    /// The flat artifact this closure denotes: `encF` of its value, written from the
    /// chunks' own octets once every payload is judged to be in `im(e)` — which is what
    /// makes the octets canonical. The budget is `unfolded_flat_octets`, header
    /// included, and it is met after the judgments and before anything is written.
    pub fn flatten<R: Registry + ?Sized>(
        &self,
        registry: &R,
        limits: &Limits,
    ) -> Result<Vec<u8>, Refusal> {
        self.validate(registry)?;
        self.budget(limits, false)?;

        let root = self.root();
        let mut out = Vec::new();
        let id = root.slot_codec_id().as_bytes();
        out.extend_from_slice(flat::MAGIC);
        cuvarint::encode(id.len() as u64, &mut out);
        out.extend_from_slice(id);
        write_fields(root, &mut out);
        let mut stack = vec![(0usize, 0usize)];
        while let Some(&(current, next)) = stack.last() {
            let chunk = &self.chunks[current];
            match chunk.frame.entries.get(next) {
                Some((key, link)) => {
                    stack.last_mut().expect("the current chunk").1 += 1;
                    let key = &chunk.octets[key.clone()];
                    cuvarint::encode(key.len() as u64, &mut out);
                    out.extend_from_slice(key);
                    let child = self.children[current][*link];
                    write_fields(&self.chunks[child], &mut out);
                    stack.push((child, 0));
                }
                None => {
                    stack.pop();
                }
            }
        }
        Ok(out)
    }

    /// Validate the closure as a value without building anything (§14's "validate the
    /// closure"): the capability judgment, then every distinct chunk's payload, in the
    /// order the walk reached them. What passes is a validated value, no longer only an
    /// opaque closure present.
    pub fn validate<R: Registry + ?Sized>(&self, registry: &R) -> Result<(), Refusal> {
        let codec = self.capability(registry)?;
        for chunk in &self.chunks {
            if codec.decode(chunk.payload()).is_none() {
                return Err(Fault::NonCanonicalPayload.into());
            }
        }
        Ok(())
    }

    /// The capability judgment: every chunk carries the root's id, so one question.
    fn capability<'r, R: Registry + ?Sized>(
        &self,
        registry: &'r R,
    ) -> Result<Box<dyn SlotCodec<Value = R::Value> + 'r>, Refusal> {
        lend(registry, self.root().slot_codec_id()).ok_or(Refusal::Unsupported)
    }

    /// The build budget, met after every judgment and before anything is built.
    fn budget(&self, limits: &Limits, nodes: bool) -> Result<(), Refusal> {
        let over = |dimension| Err(Refusal::LimitExceeded(dimension));
        if self.unfolded.depth > limits.logical_depth {
            return over(Dimension::LogicalDepth);
        }
        if nodes && self.unfolded.nodes > limits.unfolded_node_count {
            return over(Dimension::UnfoldedNodeCount);
        }
        if self.unfolded.flat_octets > limits.unfolded_flat_octets {
            return over(Dimension::UnfoldedFlatOctets);
        }
        Ok(())
    }
}

/// A chunk's contribution to the tree it roots, from its children's finished measures.
fn measure(chunk: &Chunk, children: &[usize], measures: &[Option<Unfolded>]) -> Unfolded {
    let payload = chunk.frame.payload.len() as u64;
    let entries = chunk.frame.entries.len() as u64;
    let mut unfolded = Unfolded {
        nodes: 1,
        flat_octets: cuvarint::encoded_len(payload)
            .saturating_add(payload)
            .saturating_add(cuvarint::encoded_len(entries)),
        depth: 0,
    };
    for (key, link) in &chunk.frame.entries {
        let child = measures[children[*link]].expect("a child finishes before its parent");
        let key = key.len() as u64;
        unfolded.nodes = unfolded.nodes.saturating_add(child.nodes);
        unfolded.flat_octets = unfolded
            .flat_octets
            .saturating_add(cuvarint::encoded_len(key))
            .saturating_add(key)
            .saturating_add(child.flat_octets);
        unfolded.depth = unfolded.depth.max(child.depth.saturating_add(1));
    }
    unfolded
}

/// A node's own flat fields, from its chunk: the framed payload, then the child count.
fn write_fields(chunk: &Chunk, out: &mut Vec<u8>) {
    let payload = chunk.payload();
    cuvarint::encode(payload.len() as u64, out);
    out.extend_from_slice(payload);
    cuvarint::encode(chunk.frame.entries.len() as u64, out);
}

/// Resolve the value at `root` (the `linked-resolver` profile): walk and check the
/// closure, then judge capability and payloads, then materialize within the budget. The
/// value comes back with the codec it was decoded under.
pub fn resolve<'r, S: ChunkStore + ?Sized, R: Registry + ?Sized>(
    root: &Address,
    store: &S,
    registry: &'r R,
    limits: &Limits,
) -> Result<Decoded<'r, R::Value>, LinkedError> {
    Ok(Closure::check(root, store, limits)?.materialize(registry, limits)?)
}

/// Flatten the value at `root` to its flat artifact, within the budget.
pub fn flatten<S: ChunkStore + ?Sized, R: Registry + ?Sized>(
    root: &Address,
    store: &S,
    registry: &R,
    limits: &Limits,
) -> Result<Vec<u8>, LinkedError> {
    Ok(Closure::check(root, store, limits)?.flatten(registry, limits)?)
}

#[cfg(test)]
mod tests {
    //! The one arm the public API cannot reach: a hash cycle. SHA-256 makes one
    //! infeasible to build, and §12 forbids relying on that, so the walk is run here
    //! under a digest that ignores the links header — under which a chunk can name
    //! itself, or two chunks each other.

    use super::*;
    use crate::codec::IdentityBytes;

    /// SHA-256 of the chunk with every links-header hash zeroed.
    fn links_blind(octets: &[u8]) -> [u8; 32] {
        let frame = parse(octets, &Limits::FLOORS).expect("a well-formed chunk");
        let mut blinded = octets.to_vec();
        let start = frame.id.end + cuvarint::encoded_len(frame.links.len() as u64) as usize;
        blinded[start..start + DIGEST * frame.links.len()].fill(0);
        sha256::digest(&blinded)
    }

    /// The encoder's root chunk for a node with payload `own` and one childless child,
    /// its single link repointed to `target`.
    fn one_link_chunk(own: &[u8], target: [u8; 32]) -> Vec<u8> {
        let leaf = Node::compose(Vec::new(), Vec::<(Vec<u8>, _)>::new()).unwrap();
        let node = Node::compose(own.to_vec(), [(b"k".to_vec(), leaf)]).unwrap();
        let linked = encode_linked(&node, &IdentityBytes).unwrap();
        let mut octets = linked.chunks[&linked.root].clone();
        let frame = parse(&octets, &Limits::FLOORS).unwrap();
        assert_eq!(frame.links.len(), 1);
        let start = frame.id.end + 1;
        octets[start..start + DIGEST].copy_from_slice(&target);
        octets
    }

    fn walk(root: [u8; 32], chunks: &[Vec<u8>]) -> Result<Closure, LinkedError> {
        let store: BTreeMap<Address, Vec<u8>> = chunks
            .iter()
            .map(|octets| {
                (
                    Address::new(AddressSpace::Dxl2, links_blind(octets)),
                    octets.clone(),
                )
            })
            .collect();
        Closure::walk(
            Address::new(AddressSpace::Dxl2, root),
            &store,
            &Limits::FLOORS,
            links_blind,
        )
    }

    #[test]
    fn a_chunk_naming_itself_is_a_cycle_refused_on_logical_depth() {
        let placeholder = one_link_chunk(b"p", [0; 32]);
        let own = links_blind(&placeholder);
        let looped = one_link_chunk(b"p", own);
        assert_eq!(links_blind(&looped), own);
        assert_eq!(
            walk(own, &[looped]).unwrap_err(),
            LinkedError::Refused(Refusal::LimitExceeded(Dimension::LogicalDepth))
        );
    }

    #[test]
    fn two_chunks_naming_each_other_are_a_cycle_refused_on_logical_depth() {
        let a = links_blind(&one_link_chunk(b"a", [0; 32]));
        let b = links_blind(&one_link_chunk(b"b", [0; 32]));
        assert_ne!(a, b);
        let chunks = [one_link_chunk(b"a", b), one_link_chunk(b"b", a)];
        assert_eq!(
            walk(a, &chunks).unwrap_err(),
            LinkedError::Refused(Refusal::LimitExceeded(Dimension::LogicalDepth))
        );
    }

    /// The control: under the same digest, a chain that ends is walked to its end, so the
    /// refusals above are the cycle's and not the digest's.
    #[test]
    fn under_the_same_digest_an_acyclic_chain_is_walked() {
        let leaf = Node::compose(Vec::new(), Vec::<(Vec<u8>, _)>::new()).unwrap();
        let linked = encode_linked(&leaf, &IdentityBytes).unwrap();
        let tail = linked.chunks[&linked.root].clone();
        let head = one_link_chunk(b"h", links_blind(&tail));
        let closure = walk(links_blind(&head), &[head, tail]).unwrap();
        assert_eq!(closure.unfolded().nodes, 2);
        assert_eq!(closure.unfolded().depth, 1);
    }
}
