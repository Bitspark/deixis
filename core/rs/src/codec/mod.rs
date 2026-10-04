//! `deixis-codec-v2`: canonical octets for `Node[T]` — `docs/CODEC.md`, the normative
//! contract; `docs/CODEC-proofs.md`, its proofs.
//!
//! **A candidate implementation of a candidate contract** (§16). Nothing here is frozen
//! conformance, and a `dxl2` address computed here is not a stable identity: a pre-freeze
//! change to the contract changes addresses. It is an in-house implementation, written
//! with the independent corpus in view, and is not the clean-room implementation of
//! design/0007.
//!
//! The codec is a combinator, not a serializer: given a lawful [`SlotCodec`] for the
//! whole payload type, it gives canonical octets and an exact decoder for every node —
//! each node's own payload and its complete child map. It reads nothing into a tree or a
//! payload.
//!
//! Two forms over one value semantics, each canonical on its own (§8): the **flat** form
//! ([`encode_flat`], [`decode_flat`]) and the **linked** form ([`encode_linked`],
//! [`resolve`]). Their octets and digests do not correspond, by design; decoding agrees up
//! to node identity.
//!
//! Profiles (§2.1), stated as §16 requires a scoped claim to state them:
//! `flat-encoder` ([`encode_flat`]), `flat-decoder` ([`decode_flat`], [`FlatDecoder`]),
//! `flat-header-validator` ([`read_header`], [`HeaderDecoder`]), `linked-resolver`
//! ([`Chunk::resolve_root`], [`Chunk::resolve_child`], [`resolve`], [`Closure::validate`],
//! [`Closure::materialize`], [`Closure::flatten`]) and `closure-checker`
//! ([`Closure::check`]); codec-holding for exactly the ids the caller's
//! [`Registry`] holds, and codec-blind for every other. `chunk-store` is not implemented:
//! [`ChunkStore`] is the untrusted read side a resolver is handed.
//!
//! Verdicts keep §9's four classes apart in the types: acceptance is a [`Decoded`] value,
//! which keeps the codec it was decoded under (§4), terminal
//! non-acceptance is a [`Refusal`] (invalid, unsupported or resource-refused), the one
//! non-terminal state is [`Progress::NeedMoreInput`], and the store layer's facts are
//! [`StoreFault`]s, never a decoder's verdict.

pub mod cuvarint;
mod flat;
mod id;
mod limits;
mod linked;
mod slot;
mod verdict;

pub use flat::{decode_flat, encode_flat, read_header, FlatDecoder, HeaderDecoder};
pub use id::{EncodeError, IdForm, IdRef, SlotCodecId};
pub use limits::Limits;
pub use linked::{
    encode_linked, flatten, resolve, Address, AddressSpace, Chunk, ChunkStore, Closure, Linked,
    LinkedError, StoreFault, Unfolded,
};
pub use slot::{Decoded, IdentityBytes, OptionOf, Registry, SlotCodec};
pub use verdict::{
    Class, Dimension, Fault, Progress, Refusal, StoreCode, LIMIT_EXCEEDED, NEED_MORE_INPUT,
    UNSUPPORTED_SLOT_CODEC,
};
