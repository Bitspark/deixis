//! §4's slot codec, the two codecs the contract itself defines (§13), the registry a
//! decoder is handed, and the decoded value that keeps the codec it was decoded under.

use core::fmt;

use crate::Node;

use super::id::{IdRef, OPTION_OF};

/// `SlotCodec(T) = { id, ≈, e, D }` (§4). The four travel as one unit, and a decoder uses
/// them together: it never takes an equality and an encoder from separate sources.
///
/// The codec covers the **whole** payload type. `e` and `D` are applied to the complete
/// value at every node, childless or not; a slot whose `T` is `Option[U]` is served by
/// [`OptionOf`], never by a presence convention in the tree.
pub trait SlotCodec {
    /// The carrier `T`.
    type Value;

    /// The slot-codec-id (§13), which the encoders write into the octets. An encoder
    /// refuses locally when it is not one well-formed whole id.
    fn id(&self) -> &[u8];

    /// `e`: total, and lawful — `x ≈ y ⟺ e(x) = e(y)`.
    fn encode(&self, value: &Self::Value) -> Vec<u8>;

    /// `D`, the exact partial inverse of `e`: `Some` exactly when `payload ∈ im(e)`, and
    /// then a value `v` with `e(v) = payload`. A non-canonical spelling is refused, never
    /// repaired.
    fn decode(&self, payload: &[u8]) -> Option<Self::Value>;

    /// `≈`, the slot's equivalence, which node identity lifts. The default is the relation
    /// lawfulness already fixes, `e(x) = e(y)`; a codec may compute it more cheaply, never
    /// differently.
    fn equivalent(&self, a: &Self::Value, b: &Self::Value) -> bool {
        self.encode(a) == self.encode(b)
    }
}

impl<C: SlotCodec + ?Sized> SlotCodec for &C {
    type Value = C::Value;
    fn id(&self) -> &[u8] {
        (**self).id()
    }
    fn encode(&self, value: &C::Value) -> Vec<u8> {
        (**self).encode(value)
    }
    fn decode(&self, payload: &[u8]) -> Option<C::Value> {
        (**self).decode(payload)
    }
    fn equivalent(&self, a: &C::Value, b: &C::Value) -> bool {
        (**self).equivalent(a, b)
    }
}

impl<C: SlotCodec + ?Sized> SlotCodec for Box<C> {
    type Value = C::Value;
    fn id(&self) -> &[u8] {
        (**self).id()
    }
    fn encode(&self, value: &C::Value) -> Vec<u8> {
        (**self).encode(value)
    }
    fn decode(&self, payload: &[u8]) -> Option<C::Value> {
        (**self).decode(payload)
    }
    fn equivalent(&self, a: &C::Value, b: &C::Value) -> bool {
        (**self).equivalent(a, b)
    }
}

/// `00 01`, `deixis/identity-bytes`: carrier `Bytes`, octet equality, `e = id`, `D = id`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IdentityBytes;

impl IdentityBytes {
    /// Its registered id.
    pub const ID: [u8; 2] = [0x00, 0x01];
}

impl SlotCodec for IdentityBytes {
    type Value = Vec<u8>;
    fn id(&self) -> &[u8] {
        &Self::ID
    }
    fn encode(&self, value: &Vec<u8>) -> Vec<u8> {
        value.clone()
    }
    fn decode(&self, payload: &[u8]) -> Option<Vec<u8>> {
        Some(payload.to_vec())
    }
    fn equivalent(&self, a: &Vec<u8>, b: &Vec<u8>) -> bool {
        a == b
    }
}

/// `option-of(c)`, id `0x02 ‖ id(c)` (§13): carrier `Option[T_c]`, with
/// `e(None) = 0x00`, `e(Some(x)) = 0x01 ‖ e_c(x)`, and `D` defined exactly on `0x00` and on
/// `0x01 ‖ b` with `b ∈ im(e_c)`.
///
/// It is lawful, and its `im(e)` decidable, whenever `c`'s are. No self-delimitation is
/// asked of `c`, because the node grammar frames every payload by its length.
///
/// The id is not bounded here: nesting `option-of` until the id passes 32 octets builds a
/// codec whose id no reader accepts, and an encoder refuses it locally.
#[derive(Clone, Debug)]
pub struct OptionOf<C> {
    inner: C,
    id: Box<[u8]>,
}

impl<C: SlotCodec> OptionOf<C> {
    /// `option-of(inner)`.
    pub fn new(inner: C) -> Self {
        let mut id = Vec::with_capacity(1 + inner.id().len());
        id.push(OPTION_OF);
        id.extend_from_slice(inner.id());
        OptionOf {
            inner,
            id: id.into(),
        }
    }

    /// The codec this one is `option-of`.
    pub fn inner(&self) -> &C {
        &self.inner
    }
}

const NONE: u8 = 0x00;
const SOME: u8 = 0x01;

impl<C: SlotCodec> SlotCodec for OptionOf<C> {
    type Value = Option<C::Value>;

    fn id(&self) -> &[u8] {
        &self.id
    }

    fn encode(&self, value: &Option<C::Value>) -> Vec<u8> {
        match value {
            None => vec![NONE],
            Some(inner) => {
                let encoded = self.inner.encode(inner);
                let mut out = Vec::with_capacity(1 + encoded.len());
                out.push(SOME);
                out.extend_from_slice(&encoded);
                out
            }
        }
    }

    fn decode(&self, payload: &[u8]) -> Option<Option<C::Value>> {
        match payload.split_first() {
            Some((&NONE, [])) => Some(None),
            Some((&SOME, inner)) => self.inner.decode(inner).map(Some),
            // Empty, `00` with a tail, or a first octet that is neither tag.
            _ => None,
        }
    }

    fn equivalent(&self, a: &Option<C::Value>, b: &Option<C::Value>) -> bool {
        match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => self.inner.equivalent(a, b),
            _ => false,
        }
    }
}

/// The codecs a decoder holds, by id (§2.1's codec-holding modifier).
///
/// A decoder asks once per artifact, after the framing parse, with the artifact's
/// structurally well-formed id: `None` makes the artifact `unsupported_slot_codec`, and
/// `Some` makes the decoder codec-holding for it. A registry that holds a codec for an id
/// must hand back that codec, whose [`SlotCodec::id`] is the same octets; a codec for any
/// other id is not held for this one, and the decoder treats the answer as `None`.
///
/// Every [`SlotCodec`] is itself a registry holding exactly its own id. A registry that
/// holds several base codecs derives `option-of` over them from [`super::IdForm::OptionOf`]
/// (§13: an option-of id is unsupported exactly when its inner id is).
pub trait Registry {
    /// The carrier every held codec decodes into.
    type Value;

    /// The codec held for `id`, or `None` when this registry holds none.
    fn codec(&self, id: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = Self::Value> + '_>>;
}

impl<C: SlotCodec> Registry for C {
    type Value = C::Value;

    fn codec(&self, id: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = C::Value> + '_>> {
        if id.as_bytes() == self.id() {
            Some(Box::new(self))
        } else {
            None
        }
    }
}

/// The codec `registry` lends for `id`: held only when the codec's own id is exactly `id`.
pub(crate) fn lend<'r, R: Registry + ?Sized>(
    registry: &'r R,
    id: IdRef<'_>,
) -> Option<Box<dyn SlotCodec<Value = R::Value> + 'r>> {
    registry
        .codec(id)
        .filter(|codec| codec.id() == id.as_bytes())
}

/// An accepted artifact: the decoded node **and** the slot codec it was decoded under —
/// the codec context §4 asks a decoded artifact to retain.
///
/// The four parts of a slot codec are used together, so this value's identity is lifted
/// from its own codec's `≈` and from no other relation: [`Decoded::equal`] and
/// [`Decoded::equal_decoded`] compare it that way. The codec is the one the decoder's
/// registry lent for the artifact's id, borrowed from that registry for `'r`; its
/// [`SlotCodec::id`] is exactly the id the octets carried. Splitting the two is an explicit
/// act, [`Decoded::into_parts`].
pub struct Decoded<'r, V> {
    node: Node<V>,
    codec: Box<dyn SlotCodec<Value = V> + 'r>,
}

impl<'r, V> Decoded<'r, V> {
    pub(crate) fn new(node: Node<V>, codec: Box<dyn SlotCodec<Value = V> + 'r>) -> Self {
        Decoded { node, codec }
    }

    /// The decoded value.
    pub fn node(&self) -> &Node<V> {
        &self.node
    }

    /// The slot codec it was decoded under: its id, `≈`, `e` and `D`.
    pub fn codec(&self) -> &(dyn SlotCodec<Value = V> + 'r) {
        &*self.codec
    }

    /// The slot-codec-id it was decoded under, exactly as the artifact spelled it.
    pub fn slot_codec_id(&self) -> &[u8] {
        self.codec.id()
    }

    /// Node identity (§2) against `other`, lifted from this value's own codec's `≈`.
    pub fn equal(&self, other: &Node<V>) -> bool {
        self.node
            .equal_by(other, &|a, b| self.codec.equivalent(a, b))
    }

    /// Node identity against another decoded value. Values decoded under different
    /// slot-codec-ids are values of different slots, and never the same value (§7: one
    /// value under two slot codecs has two addresses).
    pub fn equal_decoded(&self, other: &Decoded<'_, V>) -> bool {
        self.slot_codec_id() == other.slot_codec_id() && self.equal(&other.node)
    }

    /// The node and its codec, apart.
    pub fn into_parts(self) -> (Node<V>, Box<dyn SlotCodec<Value = V> + 'r>) {
        (self.node, self.codec)
    }
}

impl<V: fmt::Debug> fmt::Debug for Decoded<'_, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let id: String = self
            .slot_codec_id()
            .iter()
            .map(|octet| format!("{octet:02x}"))
            .collect();
        f.debug_struct("Decoded")
            .field("node", &self.node)
            .field("slot_codec", &id)
            .finish()
    }
}
