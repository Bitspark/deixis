//! §5's flat form: `dxf2`, one contiguous octet string per tree.
//!
//! ```text
//! flat   := header ‖ node
//! header := "dxf2" ‖ cuvarint(len(id)) ‖ id
//! node   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*
//! entry  := cuvarint(len(key)) ‖ key ‖ node
//! ```
//!
//! Decoding runs in the three phases law 4 and §11 fix, so a fault is reported where the
//! single-pass parser first cannot continue canonically:
//!
//! 1. **Framing**, codec-blind and in parse order: the magic, the id, then every node's
//!    fields depth-first, with the key-order rules at each entry and `trailing_bytes`
//!    after the root. Payloads are length-framed, so they are recorded, not judged.
//! 2. **Capability**: the registry is asked about the id. No codec is
//!    `unsupported_slot_codec`, which outranks every payload judgment.
//! 3. **Payloads**, in parse order: the first outside `im(e)` is `non_canonical_payload`.
//!
//! One framing parser serves every entry point. It moves past a field only once all of it
//! is present, judges a `cuvarint` as far as its present octets already prove, never
//! judges a length-framed field before its stated extent is read, and holds offsets into
//! the input rather than octets — so the whole-buffer decoder, the streaming decoder and
//! the header validator are the same parse fed differently, and §14's split invariance
//! holds by construction rather than by care. The node structure lives on explicit
//! stacks: no input can make it recurse.

use core::cmp::Ordering;
use core::ops::Range;

use crate::Node;

use super::cuvarint::{self, Scan};
use super::id::{judge, write_head, EncodeError, IdRef, SlotCodecId, LENGTHS};
use super::slot::{lend, Decoded, Registry, SlotCodec};
use super::{Dimension, Fault, Limits, Progress, Refusal};

pub(crate) const MAGIC: &[u8; 4] = b"dxf2";

/// The most octets a header can take before its verdict is certain: the magic, a length
/// `cuvarint` decided within ten octets, and an id of at most 32.
const HEADER_OCTETS: usize = 4 + 10 + 32;

// --- encoding -------------------------------------------------------------------------

/// `encF(n)`: the canonical flat octets of `node` under `codec` (the `flat-encoder`
/// profile). Refuses locally only when the codec's id is not a well-formed whole id.
///
/// Every child is spelled inline, in ascending key order, so a subtree that occurs twice
/// is spelled twice: the flat form has no sharing, and those are the canonical octets.
pub fn encode_flat<C: SlotCodec + ?Sized>(
    node: &Node<C::Value>,
    codec: &C,
) -> Result<Vec<u8>, EncodeError> {
    let mut out = Vec::new();
    write_head(MAGIC, codec.id(), &mut out)?;
    write_fields(node, codec, &mut out);
    let mut open = vec![node.children().iter()];
    while let Some(entries) = open.last_mut() {
        match entries.next() {
            Some((key, child)) => {
                cuvarint::encode(key.len() as u64, &mut out);
                out.extend_from_slice(key);
                write_fields(child, codec, &mut out);
                open.push(child.children().iter());
            }
            None => {
                open.pop();
            }
        }
    }
    Ok(out)
}

/// A node's own fields: its framed payload `e(own)`, then its child count.
fn write_fields<C: SlotCodec + ?Sized>(node: &Node<C::Value>, codec: &C, out: &mut Vec<u8>) {
    let payload = codec.encode(node.own());
    cuvarint::encode(payload.len() as u64, out);
    out.extend_from_slice(&payload);
    cuvarint::encode(node.children().len() as u64, out);
}

// --- decoding entry points ------------------------------------------------------------

/// `decF`: decode one whole flat artifact under full validation (the `flat-decoder`
/// profile), codec-holding for exactly the ids `registry` holds.
///
/// Acceptance is the decoded node together with the codec it was decoded under. A
/// refusal is exactly one §9 code: the first framing fault; else
/// `unsupported_slot_codec`; else the first payload outside `im(e)`; with
/// `limit_exceeded` wherever a limit is met first in parse order.
pub fn decode_flat<'r, R: Registry + ?Sized>(
    octets: &[u8],
    registry: &'r R,
    limits: &Limits,
) -> Result<Decoded<'r, R::Value>, Refusal> {
    let mut framer = Framer::new(false);
    match framer.advance(octets, true, limits) {
        Step::Root => framer.finish(octets, registry),
        Step::Refused(refusal) => Err(refusal),
        Step::NeedMore | Step::Header => unreachable!("a parse of closed input settles"),
    }
}

/// Validate a flat artifact's header only — its magic and id (the
/// `flat-header-validator` profile) — and report the id when `registry` holds its codec.
///
/// It reads nothing past the id, so it owes nothing about the body.
pub fn read_header<R: Registry + ?Sized>(
    octets: &[u8],
    registry: &R,
    limits: &Limits,
) -> Result<SlotCodecId, Refusal> {
    let mut framer = Framer::new(true);
    match framer.advance(octets, true, limits) {
        Step::Header => held(&octets[framer.id.clone()], registry),
        Step::Refused(refusal) => Err(refusal),
        Step::NeedMore | Step::Root => unreachable!("a parse of closed input settles"),
    }
}

/// The streaming `flat-decoder` (§14): octets arrive in any pieces, and the final verdict
/// is the one [`decode_flat`] reaches on their concatenation, for every split.
///
/// [`FlatDecoder::feed`] answers [`Progress::NeedMoreInput`] until a verdict is certain.
/// A framing fault is certain as soon as its octets are present, and so is
/// `trailing_bytes`; acceptance, `unsupported_slot_codec` and the payload judgments wait
/// for end of input, since one more octet would make any complete root `trailing_bytes`.
/// [`FlatDecoder::finish`] declares end of input and returns the final verdict.
pub struct FlatDecoder<'r, R: Registry + ?Sized> {
    registry: &'r R,
    limits: Limits,
    buffer: Vec<u8>,
    framer: Framer,
}

impl<'r, R: Registry + ?Sized> FlatDecoder<'r, R> {
    /// A decoder holding `registry`'s codecs, refusing beyond `limits`.
    pub fn new(registry: &'r R, limits: Limits) -> Self {
        FlatDecoder {
            registry,
            limits,
            buffer: Vec::new(),
            framer: Framer::new(false),
        }
    }

    /// Take the next piece of the artifact. Never answers acceptance, which only end of
    /// input can decide; a `Done` refusal is final, and later pieces cannot change it.
    pub fn feed(&mut self, octets: &[u8]) -> Progress<Decoded<'r, R::Value>> {
        if let Some(refusal) = self.framer.settled {
            return Progress::Done(Err(refusal));
        }
        retain(&mut self.buffer, octets, &self.limits, usize::MAX);
        match self.framer.advance(&self.buffer, false, &self.limits) {
            Step::Refused(refusal) => Progress::Done(Err(refusal)),
            Step::NeedMore | Step::Header | Step::Root => Progress::NeedMoreInput,
        }
    }

    /// Declare end of input: the accepted node with its codec, or the §9 verdict. An
    /// incomplete root resolves to §5's end-of-input verdict — `malformed_uvarint` inside a
    /// `cuvarint` already begun, `unexpected_eof` anywhere else.
    pub fn finish(mut self) -> Result<Decoded<'r, R::Value>, Refusal> {
        match self.framer.advance(&self.buffer, true, &self.limits) {
            Step::Root => self.framer.finish(&self.buffer, self.registry),
            Step::Refused(refusal) => Err(refusal),
            Step::NeedMore | Step::Header => unreachable!("a parse of closed input settles"),
        }
    }
}

/// The streaming `flat-header-validator`: [`read_header`] fed in pieces. Its verdict is
/// certain once the id's extent has arrived, before end of input.
pub struct HeaderDecoder<'r, R: Registry + ?Sized> {
    registry: &'r R,
    limits: Limits,
    buffer: Vec<u8>,
    framer: Framer,
}

impl<'r, R: Registry + ?Sized> HeaderDecoder<'r, R> {
    /// A header validator holding `registry`'s codecs, refusing beyond `limits`.
    pub fn new(registry: &'r R, limits: Limits) -> Self {
        HeaderDecoder {
            registry,
            limits,
            buffer: Vec::new(),
            framer: Framer::new(true),
        }
    }

    /// Take the next piece of the artifact.
    pub fn feed(&mut self, octets: &[u8]) -> Progress<SlotCodecId> {
        if let Some(refusal) = self.framer.settled {
            return Progress::Done(Err(refusal));
        }
        retain(&mut self.buffer, octets, &self.limits, HEADER_OCTETS);
        match self.framer.advance(&self.buffer, false, &self.limits) {
            Step::Header => {
                Progress::Done(held(&self.buffer[self.framer.id.clone()], self.registry))
            }
            Step::Refused(refusal) => Progress::Done(Err(refusal)),
            Step::NeedMore | Step::Root => Progress::NeedMoreInput,
        }
    }

    /// Declare end of input and return the final verdict.
    pub fn finish(mut self) -> Result<SlotCodecId, Refusal> {
        match self.framer.advance(&self.buffer, true, &self.limits) {
            Step::Header => held(&self.buffer[self.framer.id.clone()], self.registry),
            Step::Refused(refusal) => Err(refusal),
            Step::NeedMore | Step::Root => unreachable!("a parse of closed input settles"),
        }
    }
}

/// Append to a stream's buffer only what a parse can still use: at most one octet past
/// the artifact limit (once that octet is held, every parse settles), and at most
/// `bound` octets in all.
fn retain(buffer: &mut Vec<u8>, octets: &[u8], limits: &Limits, bound: usize) {
    let keep = usize::try_from(limits.flat_artifact_octets)
        .unwrap_or(usize::MAX)
        .saturating_add(1)
        .min(bound);
    let room = keep.saturating_sub(buffer.len()).min(octets.len());
    buffer.extend_from_slice(&octets[..room]);
}

/// The capability judgment on a header: the id when `registry` holds its codec.
fn held<R: Registry + ?Sized>(id: &[u8], registry: &R) -> Result<SlotCodecId, Refusal> {
    match lend(registry, IdRef::judged(id)) {
        Some(_) => Ok(SlotCodecId::judged(id)),
        None => Err(Refusal::Unsupported),
    }
}

// --- the framing parse ----------------------------------------------------------------

/// The next field a framing parse will read.
#[derive(Clone, Copy, Debug)]
enum Next {
    Magic,
    IdLength,
    Id(usize),
    /// The header has been read; a header-only parse stops here.
    Header,
    PayloadLength,
    Payload(usize),
    Count,
    KeyLength,
    Key(usize),
    /// The root is complete; what remains is whether anything follows it.
    AfterRoot,
}

/// A node's framing, recorded in parse order (pre-order).
struct Framed {
    /// The payload's extent. Recorded, never judged here.
    payload: Range<usize>,
    /// The key the node hangs under in its parent; empty for the root.
    key: Range<usize>,
    /// The entry count it declared — and, once the parse is complete, has.
    count: u64,
}

/// A node whose entries are still being read.
struct Open {
    remaining: u64,
    /// The last key read in this node, against which the next is ordered.
    previous: Option<Range<usize>>,
}

pub(crate) enum Step {
    /// The octets so far are a valid prefix; the parse needs more of them.
    NeedMore,
    /// A header-only parse has read a well-formed header.
    Header,
    /// The root is complete and input is closed with nothing after it.
    Root,
    Refused(Refusal),
}

/// What a parse may read: the octets present up to the artifact limit.
struct Window<'b> {
    readable: &'b [u8],
    /// Octets exist past the limit, so needing one is meeting the limit.
    beyond: bool,
    closed: bool,
}

impl Window<'_> {
    /// The verdict when a field needs octets past the end of what may be read: the limit
    /// if the octets exist beyond it, §5's end-of-input verdict if input is closed, and
    /// otherwise more input.
    fn short(&self, at_end: Fault) -> Step {
        if self.beyond {
            Step::Refused(Refusal::LimitExceeded(Dimension::FlatArtifactOctets))
        } else if self.closed {
            Step::Refused(Refusal::Invalid(at_end))
        } else {
            Step::NeedMore
        }
    }
}

fn refused(fault: Fault) -> Step {
    Step::Refused(Refusal::Invalid(fault))
}

fn limited(dimension: Dimension) -> Step {
    Step::Refused(Refusal::LimitExceeded(dimension))
}

/// The framing parse (phase 1), resumable: it holds offsets into a buffer it is handed
/// again on each advance, and it reads each field atomically, so a field cut off by the
/// end of the octets present is simply read again once more have arrived.
pub(crate) struct Framer {
    header_only: bool,
    next: Next,
    /// Where the next field begins.
    pos: usize,
    id: Range<usize>,
    nodes: Vec<Framed>,
    open: Vec<Open>,
    /// The key of the entry whose node is read next.
    key: Range<usize>,
    /// A refusal, once reached: final.
    settled: Option<Refusal>,
}

impl Framer {
    fn new(header_only: bool) -> Self {
        Framer {
            header_only,
            next: Next::Magic,
            pos: 0,
            id: 0..0,
            nodes: Vec::new(),
            open: Vec::new(),
            key: 0..0,
            settled: None,
        }
    }

    /// Parse as far as `buf` allows. `buf` extends the previous call's buffer; `closed`
    /// says no more octets will follow.
    fn advance(&mut self, buf: &[u8], closed: bool, limits: &Limits) -> Step {
        if let Some(refusal) = self.settled {
            return Step::Refused(refusal);
        }
        let step = self.run(buf, closed, limits);
        if let Step::Refused(refusal) = step {
            self.settled = Some(refusal);
        }
        step
    }

    fn run(&mut self, buf: &[u8], closed: bool, limits: &Limits) -> Step {
        let cap = usize::try_from(limits.flat_artifact_octets).unwrap_or(usize::MAX);
        let window = Window {
            readable: &buf[..buf.len().min(cap)],
            beyond: buf.len() > cap,
            closed,
        };
        loop {
            match self.next {
                Next::Magic => {
                    // Fewer than four octets is end of input, never `unknown_magic`.
                    let Some(magic) = self.field(&window, MAGIC.len()) else {
                        return window.short(Fault::UnexpectedEof);
                    };
                    if window.readable[magic] != MAGIC[..] {
                        return refused(Fault::UnknownMagic);
                    }
                    self.next = Next::IdLength;
                }
                Next::IdLength => {
                    let length = match self.integer(&window, limits) {
                        Ok(length) => length,
                        Err(step) => return step,
                    };
                    // Judged where the length is read, before any of the id arrives.
                    if !LENGTHS.contains(&length) {
                        return refused(Fault::MalformedSlotCodecId);
                    }
                    if length > limits.slot_codec_id_length {
                        return limited(Dimension::SlotCodecIdLength);
                    }
                    self.next = Next::Id(length as usize);
                }
                Next::Id(length) => {
                    // Judged only once its whole stated extent is present.
                    let Some(id) = self.field(&window, length) else {
                        return window.short(Fault::UnexpectedEof);
                    };
                    match judge(&window.readable[id.clone()]) {
                        Err(fault) => return refused(fault),
                        Ok(Some(ordinal)) if ordinal > limits.varint_value => {
                            return limited(Dimension::VarintValue)
                        }
                        Ok(_) => {}
                    }
                    self.id = id;
                    self.next = if self.header_only {
                        Next::Header
                    } else {
                        Next::PayloadLength
                    };
                }
                Next::Header => return Step::Header,
                Next::PayloadLength => {
                    let length = match self.integer(&window, limits) {
                        Ok(length) => length,
                        Err(step) => return step,
                    };
                    if length > limits.payload_length {
                        return limited(Dimension::PayloadLength);
                    }
                    if self.nodes.len() as u64 >= limits.unfolded_node_count {
                        return limited(Dimension::UnfoldedNodeCount);
                    }
                    self.next = Next::Payload(usize::try_from(length).unwrap_or(usize::MAX));
                }
                Next::Payload(length) => {
                    let Some(payload) = self.field(&window, length) else {
                        return window.short(Fault::UnexpectedEof);
                    };
                    let key = core::mem::replace(&mut self.key, 0..0);
                    self.nodes.push(Framed {
                        payload,
                        key,
                        count: 0,
                    });
                    self.next = Next::Count;
                }
                Next::Count => {
                    let count = match self.integer(&window, limits) {
                        Ok(count) => count,
                        Err(step) => return step,
                    };
                    if count > limits.entries_per_node {
                        return limited(Dimension::EntriesPerNode);
                    }
                    self.nodes
                        .last_mut()
                        .expect("a count follows a payload")
                        .count = count;
                    self.open.push(Open {
                        remaining: count,
                        previous: None,
                    });
                    self.close_complete();
                }
                Next::KeyLength => {
                    let length = match self.integer(&window, limits) {
                        Ok(length) => length,
                        Err(step) => return step,
                    };
                    if length > limits.key_length {
                        return limited(Dimension::KeyLength);
                    }
                    self.next = Next::Key(usize::try_from(length).unwrap_or(usize::MAX));
                }
                Next::Key(length) => {
                    // Ordered only once its whole stated extent is present.
                    let Some(key) = self.field(&window, length) else {
                        return window.short(Fault::UnexpectedEof);
                    };
                    // The child this key introduces sits one edge below the open node.
                    let depth = self.open.len() as u64;
                    let node = self
                        .open
                        .last_mut()
                        .expect("a key is read inside an open node");
                    if let Some(previous) = &node.previous {
                        match window.readable[key.clone()].cmp(&window.readable[previous.clone()]) {
                            Ordering::Equal => return refused(Fault::DuplicateKey),
                            Ordering::Less => return refused(Fault::UnsortedKeys),
                            Ordering::Greater => {}
                        }
                    }
                    node.previous = Some(key.clone());
                    node.remaining -= 1;
                    if depth > limits.logical_depth {
                        return limited(Dimension::LogicalDepth);
                    }
                    self.key = key;
                    self.next = Next::PayloadLength;
                }
                Next::AfterRoot => {
                    // A remainder is noticed without being read, so the artifact limit,
                    // which bounds what is read, does not apply to it: an octet after a
                    // root that ends exactly at the limit is trailing_bytes (§12).
                    return if buf.len() > self.pos {
                        refused(Fault::TrailingBytes)
                    } else if closed {
                        Step::Root
                    } else {
                        // A complete root with the stream open: one more octet would make
                        // it trailing_bytes, so nothing is final yet.
                        Step::NeedMore
                    };
                }
            }
        }
    }

    /// The next `length` octets, when all of them may be read.
    fn field(&mut self, window: &Window<'_>, length: usize) -> Option<Range<usize>> {
        let end = self
            .pos
            .checked_add(length)
            .filter(|&end| end <= window.readable.len())?;
        let range = self.pos..end;
        self.pos = end;
        Some(range)
    }

    /// The next `cuvarint`, judged by §3 as far as its present octets allow.
    fn integer(&mut self, window: &Window<'_>, limits: &Limits) -> Result<u64, Step> {
        match cuvarint::scan(&window.readable[self.pos..]) {
            Scan::Value(value, width) => {
                if value > limits.varint_value {
                    return Err(limited(Dimension::VarintValue));
                }
                self.pos += width;
                Ok(value)
            }
            Scan::Short(0) => Err(window.short(Fault::UnexpectedEof)),
            Scan::Short(_) => Err(window.short(Fault::MalformedUvarint)),
            Scan::Fault(fault) => Err(refused(fault)),
        }
    }

    /// Close every node whose entries are all read, and say what comes next.
    fn close_complete(&mut self) {
        while let Some(node) = self.open.last() {
            if node.remaining > 0 {
                self.next = Next::KeyLength;
                return;
            }
            self.open.pop();
        }
        self.next = Next::AfterRoot;
    }

    /// Phases 2 and 3 over a complete framing, then the node with its codec.
    fn finish<'r, R: Registry + ?Sized>(
        self,
        buf: &[u8],
        registry: &'r R,
    ) -> Result<Decoded<'r, R::Value>, Refusal> {
        let codec =
            lend(registry, IdRef::judged(&buf[self.id.clone()])).ok_or(Refusal::Unsupported)?;

        let mut values = Vec::with_capacity(self.nodes.len());
        for node in &self.nodes {
            match codec.decode(&buf[node.payload.clone()]) {
                Some(value) => values.push(value),
                None => return Err(Fault::NonCanonicalPayload.into()),
            }
        }

        // Build bottom-up, in reverse parse order: when a node is reached, its children
        // were the last nodes built, and sit on top of the stack, last key first.
        let mut built: Vec<(Range<usize>, Node<R::Value>)> = Vec::new();
        for node in self.nodes.iter().rev() {
            let value = values.pop().expect("one value per framed node");
            let count = usize::try_from(node.count).expect("no more entries than were read");
            let mut children = built.split_off(built.len() - count);
            children.reverse();
            let composed = Node::compose(
                value,
                children.into_iter().map(|(key, child)| (&buf[key], child)),
            )
            .expect("keys were read in strictly ascending order");
            built.push((node.key.clone(), composed));
        }
        let (_, root) = built
            .pop()
            .expect("the root is framed first and built last");
        Ok(Decoded::new(root, codec))
    }
}
