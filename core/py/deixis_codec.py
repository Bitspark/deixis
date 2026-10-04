"""
deixis-codec-v2 — canonical octets for Node[T], in two forms over one value semantics.

    flat   := "dxf2" ‖ cuvarint(len(id)) ‖ id ‖ node
    node   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ entry*
    entry  := cuvarint(len(key)) ‖ key ‖ node

    chunk  := "dxl2" ‖ cuvarint(len(id)) ‖ id ‖ cuvarint(nlinks) ‖ hash{32}* ‖ body
    body   := cuvarint(len(payload)) ‖ payload ‖ cuvarint(count) ‖ lentry*
    lentry := cuvarint(len(key)) ‖ key ‖ cuvarint(link-index)

The normative contract is docs/CODEC.md, and §N below is its section N. The codec is a
combinator: a slot codec ``{id, ≈, e, D}`` for the whole payload type (§4) yields
canonical octets and an exact decoder for every node, and the node grammar never reads
a payload. Payloads are length-prefixed, so every framing question is decided without
the slot codec (§11), and every decoder here runs three phases: framing in parse order,
then capability, then payloads in parse order. That order is the whole of §10's and
§11's precedence — a framing fault outranks ``unsupported_slot_codec``, which outranks
``non_canonical_payload``.

Scoped claim (§16): flat-encoder, flat-decoder (whole-buffer and streaming),
flat-header-validator, linked-resolver and closure-checker; codec-holding for exactly
the ids a caller's registry holds and option-of over them, codec-blind for every other
id. It is not a chunk-store: chunks arrive through a caller's fetch and are verified,
never trusted. This is a CANDIDATE implementation of a CANDIDATE contract: it claims no
frozen conformance, the ``dxl2`` addresses it computes are not stable identities until
the freeze, and it is not the clean-room implementation of docs/design/0007.

Standard library only; SHA-256 is ``hashlib``'s. Nothing here recurses on the depth of
its input: parsers and encoders keep explicit stacks, and what a decoder builds is
bounded by :class:`Limits` (§12).
"""

from __future__ import annotations

import hashlib
from bisect import bisect_left
from collections.abc import Callable, Generator, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, fields
from itertools import pairwise
from typing import Any, ClassVar, Literal, Protocol

from deixis_core import DuplicateKeyError, Node, Some

FLAT_MAGIC = b"dxf2"
"""The flat form's magic (§5 rule 1)."""

LINKED_MAGIC = b"dxl2"
"""The linked form's magic (§6 rule 1)."""

ADDRESS_SPACE: Literal["dxl2"] = "dxl2"
"""The one address space of this version (§7)."""

MAX_UVARINT = 2**64 - 1
"""The top of the integer domain (§3 rule 1)."""

DIGEST_OCTETS = 32
"""SHA-256, pinned by the version (§7)."""

# The id's forms (§13). 03..ff are reserved for forms not yet defined.
PUBLIC, PRIVATE, OPTION_OF = 0x00, 0x01, 0x02
NAMESPACE_OCTETS = 16
MIN_ID_OCTETS, MAX_ID_OCTETS = 2, 32

# A saturated unfolded measure (§12): one past the integer domain, so that it exceeds
# every limit a Limits can hold and a comparison against a limit stays exact.
SATURATED = 2**64


# --- verdicts (§9) --------------------------------------------------------------------

type VerdictClass = Literal["invalid", "unsupported", "incomplete", "resource-refused"]
"""The four non-acceptance classes of §9. They license different actions, so each has
its own type below and none is collapsed into another (§14)."""

type InvalidCode = Literal[
    "malformed_uvarint",
    "non_shortest_uvarint",
    "uvarint_overflow",
    "unknown_magic",
    "duplicate_key",
    "unsorted_keys",
    "trailing_bytes",
    "unexpected_eof",
    "bad_link_index",
    "unused_link",
    "duplicate_link_hash",
    "links_out_of_order",
    "slot_codec_mismatch",
    "malformed_slot_codec_id",
    "non_canonical_payload",
]
"""§9's invalid codes, exactly as spelled there."""

INVALID_CODES: frozenset[str] = frozenset(
    {
        "malformed_uvarint",
        "non_shortest_uvarint",
        "uvarint_overflow",
        "unknown_magic",
        "duplicate_key",
        "unsorted_keys",
        "trailing_bytes",
        "unexpected_eof",
        "bad_link_index",
        "unused_link",
        "duplicate_link_hash",
        "links_out_of_order",
        "slot_codec_mismatch",
        "malformed_slot_codec_id",
        "non_canonical_payload",
    }
)
"""The members of :data:`InvalidCode`, for code that holds a string."""

type Dimension = Literal[
    "varint_value",
    "slot_codec_id_length",
    "key_length",
    "payload_length",
    "entries_per_node",
    "links_per_chunk",
    "flat_artifact_octets",
    "chunk_octets",
    "unique_chunks",
    "unique_octets",
    "logical_depth",
    "unfolded_node_count",
    "unfolded_flat_octets",
]
"""The dimension tokens of §12, the name a ``limit_exceeded`` refusal carries."""

type StoreCode = Literal["missing_chunk", "hash_mismatch", "address_conflict"]
"""The store / traversal outcomes of §9: facts about a store, never decoder
verdicts."""


@dataclass(frozen=True, slots=True)
class Invalid:
    """**invalid** (§9): these octets are not canonical deixis-codec-v2, now or ever."""

    code: InvalidCode
    verdict_class: ClassVar[VerdictClass] = "invalid"


@dataclass(frozen=True, slots=True)
class Unsupported:
    """**unsupported** (§9): well-formed framing, absent capability — the octets may be
    a value, and this reader cannot say. It is only ever reported after the framing it
    scopes was judged well formed (§11), and a later registry addition does not undo
    that judgment."""

    code: Literal["unsupported_slot_codec"] = "unsupported_slot_codec"
    verdict_class: ClassVar[VerdictClass] = "unsupported"


@dataclass(frozen=True, slots=True)
class Incomplete:
    """**incomplete** (§9): streaming only, and the one non-terminal state (§14). More
    input may arrive; it resolves only when the caller declares the end of input."""

    code: Literal["need_more_input"] = "need_more_input"
    verdict_class: ClassVar[VerdictClass] = "incomplete"


@dataclass(frozen=True, slots=True)
class ResourceRefused:
    """**resource-refused** (§9, §12): valid so far, and beyond a local limit. The
    octets may be a value; this reader declines to spend on finding out. Never
    invalidity."""

    dimension: Dimension
    code: Literal["limit_exceeded"] = "limit_exceeded"
    verdict_class: ClassVar[VerdictClass] = "resource-refused"


type Refusal = Invalid | Unsupported | Incomplete | ResourceRefused
"""Every non-acceptance a decoder can report."""

UNSUPPORTED = Unsupported()
NEED_MORE_INPUT = Incomplete()


def class_of(code: str) -> VerdictClass:
    """The §9 class of a decoder verdict code. Raises :class:`ValueError` for anything
    else — the store-layer codes included, which are not decoder verdicts."""
    if code in INVALID_CODES:
        return "invalid"
    if code == "unsupported_slot_codec":
        return "unsupported"
    if code == "need_more_input":
        return "incomplete"
    if code == "limit_exceeded":
        return "resource-refused"
    raise ValueError(f"not a decoder verdict code: {code!r}")


@dataclass(frozen=True, slots=True)
class Accepted[T]:
    """**accepted**: the decoded node, together with the slot codec it was decoded under
    — §4's codec context, retained with the artifact."""

    value: Node[T]
    codec: SlotCodec[T]


@dataclass(frozen=True, slots=True)
class StoreFault:
    """A store / traversal outcome (§9): ``missing_chunk``, ``hash_mismatch`` or
    ``address_conflict``, with the address it concerns. It is not a decoder verdict: it
    is a fact about the store a closure was read from, never about any octets."""

    code: StoreCode
    address: Address


class _Stop(Exception):
    """Internal: a parse ended in a final refusal. Converted to a verdict at every
    public boundary and never raised out of one."""

    def __init__(self, verdict: Invalid | ResourceRefused) -> None:
        super().__init__(verdict.code)
        self.verdict = verdict


# --- the resource envelope (§12) ------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Limits:
    """A reader's local resource limits: one field per §12 dimension, named by its
    token.

    The defaults are §12's MUST-accept floors (:data:`FLOORS`), and a limit is never a
    validity rule: exceeding one is :class:`ResourceRefused` naming the dimension, never
    invalidity. Limits are met in parse order (§12): at the first field or octet that
    exceeds one, so a fault met earlier wins. A declared length or count above its own
    limit is met at that field, before the octets it announces; a flat decoder never
    refuses up front on its buffer's length, since a streaming one could not know it,
    and a remainder after a root that ends exactly at ``flat_artifact_octets`` is
    ``trailing_bytes``. Chunks are never streamed: a chunk is verified before it is
    parsed, so ``chunk_octets`` and its share of ``unique_octets`` are met on its
    fetched length, before its hash check and before any fault inside it. A closure
    walk meets its own dimensions as it goes (``chunk_octets``, ``links_per_chunk``,
    ``unique_chunks``, ``unique_octets``, ``logical_depth`` and the per-field ones);
    ``unfolded_node_count`` and ``unfolded_flat_octets`` are then the budget that
    guards materializing or flattening it, judged after its framing, capability and
    payloads. A flat artifact is its own unfolding, so the flat decoder meets
    ``unfolded_node_count`` in parse order like any other limit. Lower limits below the
    floors only to test those refusals; a reader configured so is not conforming.

    ``logical_depth`` counts edges: the root is at depth 0, and at the floor a node with
    256 ancestors is within the envelope and one with 257 beyond it (§12).
    """

    varint_value: int = MAX_UVARINT
    slot_codec_id_length: int = 32
    key_length: int = 4096
    payload_length: int = 16 * 2**20
    entries_per_node: int = 65_536
    links_per_chunk: int = 65_536
    flat_artifact_octets: int = 64 * 2**20
    chunk_octets: int = 32 * 2**20
    unique_chunks: int = 1_000_000
    unique_octets: int = 2**30
    logical_depth: int = 256
    unfolded_node_count: int = 16_777_216
    unfolded_flat_octets: int = 2**30

    def __post_init__(self) -> None:
        for dimension in fields(self):
            value = getattr(self, dimension.name)
            if type(value) is not int or not 0 <= value <= MAX_UVARINT:
                raise ValueError(
                    f"{dimension.name}: a limit is an integer in [0, 2^64 - 1], "
                    f"not {value!r}"
                )


FLOORS = Limits()
"""§12's MUST-accept floors, the default everywhere a :class:`Limits` is taken."""

DIMENSIONS: tuple[str, ...] = tuple(dimension.name for dimension in fields(Limits))
"""The §12 tokens, in the table's order."""


# --- the integer domain (§3) ----------------------------------------------------------

_SMALL = tuple(bytes([value]) for value in range(0x80))


def encode_uvarint(value: int) -> bytes:
    """``cuvarint(value)``: the unique shortest unsigned LEB128 spelling (§3). Raises
    :class:`ValueError` outside the integer domain ``[0, 2^64 − 1]``."""
    if not 0 <= value <= MAX_UVARINT:
        raise ValueError(f"outside the integer domain [0, 2^64 - 1]: {value}")
    if value < 0x80:
        return _SMALL[value]
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _uvarint_size(value: int) -> int:
    """``len(cuvarint(value))``, without spelling it."""
    return max(1, (value.bit_length() + 6) // 7)


def _uvarint(
    buffer: bytes | bytearray, start: int, stop: int
) -> tuple[int, int] | None:
    """Scan the cuvarint at ``start`` in ``buffer[:stop]``: ``(value, end)``, or None if
    ``stop`` comes first. What reaching ``stop`` means is the caller's to say. The three
    rules of §3 are judged here, and only here:

    - an octet at width 10 whose continuation bit is set is an eleventh continuation
      octet: ``malformed_uvarint``, decided without reading the eleventh;
    - a ten-octet spelling whose last group exceeds 1 denotes at least ``2^64``:
      ``uvarint_overflow``;
    - a spelling longer than one octet whose last octet is zero has a shorter spelling:
      ``non_shortest_uvarint``. The two are disjoint (§10), since a last group of zero
      cannot exceed 1.
    """
    value = 0
    for width in range(10):
        at = start + width
        if at >= stop:
            return None
        octet = buffer[at]
        value |= (octet & 0x7F) << (7 * width)
        if octet < 0x80:
            if width == 9 and octet > 1:
                raise _Stop(Invalid("uvarint_overflow"))
            if width > 0 and octet == 0:
                raise _Stop(Invalid("non_shortest_uvarint"))
            return value, at + 1
    raise _Stop(Invalid("malformed_uvarint"))


def read_uvarint(
    data: bytes | bytearray | memoryview, offset: int = 0
) -> tuple[int, int] | Invalid:
    """Read one cuvarint at ``offset``: ``(value, end offset)``, or its §3 fault. Cut
    off by the end of the input after one or more octets with the continuation bit set,
    it is ``malformed_uvarint``; absent altogether, ``unexpected_eof`` (§5)."""
    buffer = data if isinstance(data, bytes | bytearray) else bytes(data)
    try:
        read = _uvarint(buffer, offset, len(buffer))
    except _Stop as stop:
        assert isinstance(stop.verdict, Invalid)
        return stop.verdict
    if read is None:
        return Invalid(
            "malformed_uvarint" if offset < len(buffer) else "unexpected_eof"
        )
    return read


# --- slot codecs (§4, §13) ------------------------------------------------------------


class NonCanonicalPayload(Exception):
    """Raised by a slot codec's ``D`` for octets outside ``im(e)`` (§4): it refuses a
    non-canonical spelling rather than repairing it. A decoder reports it as the verdict
    ``non_canonical_payload``."""

    code = "non_canonical_payload"


class SlotCodec[T](Protocol):
    """``SlotCodec(T) = {id, ≈, e, D}`` (§4): supplied together, used together.

    Lawfulness is the supplier's entire obligation — ``x ≈ y ⟺ e(x) = e(y)``, ``D``
    exact on ``im(e)`` with ``D(e(x)) ≈ x`` — and this module does not check it.
    """

    @property
    def id(self) -> bytes:
        """The slot-codec-id (§13). It travels inside the octets, and so inside every
        address (§7)."""
        ...

    def equal(self, a: T, b: T) -> bool:
        """``≈``, the slot's equivalence, which node identity lifts."""
        ...

    def encode(self, value: T) -> bytes:
        """``e``: total, computable and lawful."""
        ...

    def decode(self, payload: bytes) -> T:
        """``D``: defined exactly on ``im(e)``. Raises :class:`NonCanonicalPayload`
        everywhere else, and never repairs."""
        ...


@dataclass(frozen=True, slots=True)
class _IdentityBytes:
    id: bytes = b"\x00\x01"

    def equal(self, a: bytes, b: bytes) -> bool:
        return a == b

    def encode(self, value: bytes) -> bytes:
        return bytes(value)

    def decode(self, payload: bytes) -> bytes:
        return bytes(payload)


IDENTITY_BYTES: SlotCodec[bytes] = _IdentityBytes()
"""``00 01 deixis/identity-bytes`` (§13): carrier ``Bytes``, octet equality,
``e = D = id``. Every octet string is in ``im(e)``."""


@dataclass(frozen=True, slots=True)
class _OptionOf[T]:
    inner: SlotCodec[T]

    @property
    def id(self) -> bytes:
        return bytes([OPTION_OF]) + self.inner.id

    def equal(self, a: Some[T] | None, b: Some[T] | None) -> bool:
        if a is None or b is None:
            return a is None and b is None
        return self.inner.equal(a.value, b.value)

    def encode(self, value: Some[T] | None) -> bytes:
        return b"\x00" if value is None else b"\x01" + self.inner.encode(value.value)

    def decode(self, payload: bytes) -> Some[T] | None:
        if payload == b"\x00":
            return None
        if payload[:1] == b"\x01":
            return Some(self.inner.decode(payload[1:]))
        raise NonCanonicalPayload


def option_of[T](inner: SlotCodec[T]) -> SlotCodec[Some[T] | None]:
    """``option-of(inner)`` (§13): id ``02 ‖ inner.id``, carrier ``Option[T]`` spelled
    :class:`deixis_core.Some` or ``None``; ``e(None) = 00``, ``e(Some(x)) = 01 ‖ e(x)``;
    ``D`` accepts exactly those two shapes. ``None`` is a legal payload like any other —
    it denotes no missing node. Raises :class:`ValueError` when the whole id would break
    the 32-octet bound, which is what bounds nesting."""
    codec = _OptionOf(inner)
    _require_id(codec.id)
    return codec


type Registry = Mapping[bytes, SlotCodec[Any]]
"""What a decoder holds: base slot codecs keyed by their ids. Build one with
:func:`registry_of`. Applications pin the codecs they accept — *registered* is never
*authorized* (§13) — so no decoder here holds anything by default."""


def registry_of(*codecs: SlotCodec[Any]) -> dict[bytes, SlotCodec[Any]]:
    """A registry holding ``codecs``, keyed by their own ids so the two cannot disagree.

    Only public and private ids are registered. An option-of id is held exactly when its
    inner id is (§13), so it is derived rather than registered: :class:`ValueError` for
    one, and for two codecs under one id.
    """
    held: dict[bytes, SlotCodec[Any]] = {}
    for codec in codecs:
        slot_codec_id = _require_id(codec.id)
        if slot_codec_id[0] == OPTION_OF:
            raise ValueError(
                "an option-of id is held through its inner id (§13); "
                "register the inner codec"
            )
        if slot_codec_id in held:
            raise ValueError(f"two codecs for the id {slot_codec_id.hex()}")
        held[slot_codec_id] = codec
    return held


def lookup(registry: Registry, slot_codec_id: bytes) -> SlotCodec[Any] | None:
    """The codec a decoder holding ``registry`` has for a well-formed id, or None if it
    is codec-blind for it. An option-of id is held exactly when its inner id is, and a
    reserved form is never held (§13)."""
    first = slot_codec_id[0] if slot_codec_id else None
    if first == OPTION_OF:
        inner = lookup(registry, slot_codec_id[1:])
        return None if inner is None else option_of(inner)
    if first in (PUBLIC, PRIVATE):
        return registry.get(slot_codec_id)
    return None


def _judge_id(octets: bytes, max_value: int = MAX_UVARINT) -> bool:
    """Judge an id's structure within its stated length (§13): True for one id of a
    defined form, False where a reserved first octet ends the judgment — the octets
    after it belong to a form not yet defined, so the id is unsupported, never invalid.

    The stated length is where the id's octets end, and no field is read past it: a form
    whose next required field would begin at or past the end (``00`` alone, ``02`` with
    nothing after it, a namespace cut short), and octets left over after one whole id,
    are ``malformed_slot_codec_id``; ``n = 0`` is too. Integer faults keep their §3
    codes, and an integer the id's end cuts off is ``malformed_uvarint``. An option-of
    id is malformed exactly when its inner id is, since the inner id is judged by this
    same loop inside the same bound.
    """
    position, end = 0, len(octets)
    while True:
        if position >= end:
            raise _Stop(Invalid("malformed_slot_codec_id"))
        form = octets[position]
        position += 1
        if form == OPTION_OF:
            continue
        if form > OPTION_OF:
            return False
        if form == PRIVATE:
            position += NAMESPACE_OCTETS
            if position > end:
                raise _Stop(Invalid("malformed_slot_codec_id"))
        if position >= end:
            raise _Stop(Invalid("malformed_slot_codec_id"))
        read = _uvarint(octets, position, end)
        if read is None:
            raise _Stop(Invalid("malformed_uvarint"))
        ordinal, position = read
        if ordinal > max_value:
            raise _Stop(ResourceRefused("varint_value"))
        if form == PUBLIC and ordinal == 0:
            raise _Stop(Invalid("malformed_slot_codec_id"))
        if position != end:
            raise _Stop(Invalid("malformed_slot_codec_id"))
        return True


def _require_id(slot_codec_id: bytes) -> bytes:
    """An encoder's or registry's check of its own id: exactly one id of a defined form,
    2..32 octets. A flat-encoder emits or fails locally (§2.1), so this raises."""
    slot_codec_id = bytes(slot_codec_id)
    if not MIN_ID_OCTETS <= len(slot_codec_id) <= MAX_ID_OCTETS:
        raise ValueError(f"a slot-codec-id is 2..32 octets: {slot_codec_id.hex()}")
    try:
        defined = _judge_id(slot_codec_id)
    except _Stop as stop:
        raise ValueError(
            f"not a slot-codec-id ({stop.verdict.code}): {slot_codec_id.hex()}"
        ) from None
    if not defined:
        raise ValueError(f"a reserved id form is not encodable: {slot_codec_id.hex()}")
    return slot_codec_id


# --- reading octets -------------------------------------------------------------------


class _Source:
    """The octets of one artifact, read front to back as they arrive.

    ``bound`` is the resource limit on the artifact's extent, named ``dimension``, and
    it is met at the first octet past it that the parse needs (§12): once every octet
    before the bound has arrived and the parse needs another, it refuses, whether or
    not that octet has arrived — so the refusal is the same for every split of the
    input. A declared length alone never meets it: input that ends before the bound is
    judged as input that ends, and a fault met first wins. A parser that needs an octet
    which has not arrived gets None and waits, unless the end of input has been
    declared (see :meth:`uvarint` and :meth:`take` for what it is then). Declared
    lengths are never trusted for allocation (§15): nothing is reserved before its
    octets are here.
    """

    __slots__ = ("bound", "buffer", "dimension", "ended", "max_value", "position")

    def __init__(self, bound: int, dimension: Dimension, max_value: int) -> None:
        self.buffer = bytearray()
        self.position = 0
        self.ended = False
        self.bound = bound
        self.dimension: Dimension = dimension
        self.max_value = max_value

    def append(self, data: bytes | bytearray | memoryview) -> None:
        # Nothing past bound + 1 is ever examined: a parse either ends by then or
        # refuses on the bound, and a trailing octet need only be seen to exist.
        room = self.bound + 1 - len(self.buffer)
        if room > 0:
            self.buffer += memoryview(data)[:room]

    def uvarint(self) -> int | None:
        """The next cuvarint's value (§3), or None to wait for more input. Once the end
        of input is declared, a cuvarint it cuts off after one or more octets is
        ``malformed_uvarint``, and one it leaves absent is ``unexpected_eof`` (§5): a
        cuvarint states no length, so it is judged by the octets that are there."""
        stop = min(len(self.buffer), self.bound)
        read = _uvarint(self.buffer, self.position, stop)
        if read is None:
            if stop == self.bound:
                raise _Stop(ResourceRefused(self.dimension))
            if not self.ended:
                return None
            cut = self.position < len(self.buffer)
            raise _Stop(Invalid("malformed_uvarint" if cut else "unexpected_eof"))
        value, self.position = read
        if value > self.max_value:
            raise _Stop(ResourceRefused("varint_value"))
        return value

    def _reach(self, count: int) -> int | None:
        end = self.position + count
        have = len(self.buffer)
        if end <= have and end <= self.bound:
            return end
        if end > self.bound and have >= self.bound:
            raise _Stop(ResourceRefused(self.dimension))
        if self.ended:
            raise _Stop(Invalid("unexpected_eof"))
        return None

    def take(self, count: int) -> bytes | None:
        """The next ``count`` octets, or None to wait for more input. A length-framed
        field is judged only once its stated extent is here: cut off by the declared
        end of input, it is ``unexpected_eof`` whatever its present octets show (§5)."""
        end = self._reach(count)
        if end is None:
            return None
        octets = bytes(self.buffer[self.position : end])
        self.position = end
        return octets

    def skip(self, count: int) -> int | None:
        """Pass over the next ``count`` octets, returning where they start; None to
        wait for more input."""
        end = self._reach(count)
        if end is None:
            return None
        start, self.position = self.position, end
        return start

    def trailing(self) -> bool:
        """Whether an octet has arrived past the parse position."""
        return self.position < len(self.buffer)


def _read_id(source: _Source, limits: Limits) -> Generator[None, None, bytes]:
    """``cuvarint(len(id)) ‖ id`` (§5, §6, §13). The length is judged when it is read —
    outside 2..32 is ``malformed_slot_codec_id`` before any id octet is waited for. The
    id is length-framed, so its structure is judged only once all of its stated octets
    are here; cut off earlier it is ``unexpected_eof`` even if the octets present
    already spell an impossible id (§5). Inside it, its own end plays the end of input.
    Capability is not judged here: that is phase B, after framing."""
    while (length := source.uvarint()) is None:
        yield
    if not MIN_ID_OCTETS <= length <= MAX_ID_OCTETS:
        raise _Stop(Invalid("malformed_slot_codec_id"))
    if length > limits.slot_codec_id_length:
        raise _Stop(ResourceRefused("slot_codec_id_length"))
    while (octets := source.take(length)) is None:
        yield
    _judge_id(octets, limits.varint_value)
    return octets


# --- the flat form (§5) ---------------------------------------------------------------


def _prefix(magic: bytes, slot_codec_id: bytes) -> bytes:
    return magic + encode_uvarint(len(slot_codec_id)) + slot_codec_id


def encode_flat[T](node: Node[T], codec: SlotCodec[T]) -> bytes:
    """``encF(node)`` (§5): the node's canonical flat octets under ``codec``.

    Every node's payload is ``e`` of its own value — at nodes with children too — and
    every child is spelled in full, each time: the flat form has no sharing, and an
    encoder that emitted a back-reference would break law 1. Keys are in the core's
    order, which is §2's. Raises :class:`ValueError` when the codec's id is not one id
    of a defined form (a flat-encoder emits or fails locally, §2.1).
    """
    out = bytearray(_prefix(FLAT_MAGIC, _require_id(codec.id)))

    def head(current: Node[T]) -> Iterator[tuple[bytes, Node[T]]]:
        payload = codec.encode(current.own)
        entries = current.entries()
        out.extend(encode_uvarint(len(payload)))
        out.extend(payload)
        out.extend(encode_uvarint(len(entries)))
        return iter(entries)

    stack = [head(node)]
    while stack:
        entry = next(stack[-1], None)
        if entry is None:
            stack.pop()
            continue
        key, child = entry
        out.extend(encode_uvarint(len(key)))
        out.extend(key)
        stack.append(head(child))
    return bytes(out)


@dataclass(slots=True)
class _Record:
    """One node as framing found it: where its payload lies, and its entries as
    (key, index of the child's record)."""

    start: int
    length: int
    entries: list[tuple[bytes, int]]


@dataclass(slots=True)
class _Open:
    """A node whose entries are being read."""

    record: _Record
    remaining: int
    previous: bytes | None


@dataclass(frozen=True, slots=True)
class _Framing:
    slot_codec_id: bytes
    records: list[_Record]  # pre-order, which is parse order


def _parse_flat(
    source: _Source, limits: Limits, header_only: bool
) -> Generator[None, None, _Framing]:
    """Phase A over one flat artifact: framing, codec-blind, in parse order (§5).

    Yields whenever it needs an octet that has not arrived, and resumes exactly where it
    stopped, so its steps are a function of the octets and never of how they were cut
    (§14). Returns once the end of input is declared right after the root, or with
    ``header_only`` once the id is read. Every framing fault is raised the moment it is
    seen, ``trailing_bytes`` included. The explicit stack holds the open ancestors of
    the node being read; nothing recurses on depth.
    """
    while (magic := source.take(len(FLAT_MAGIC))) is None:
        yield
    if magic != FLAT_MAGIC:
        raise _Stop(Invalid("unknown_magic"))
    slot_codec_id = yield from _read_id(source, limits)
    records: list[_Record] = []
    if header_only:
        return _Framing(slot_codec_id, records)

    stack: list[_Open] = []
    key = b""  # the key the next node is read under; the root has none
    while True:
        # Read one node: the root first, then each child under its key.
        if len(stack) > limits.logical_depth:
            raise _Stop(ResourceRefused("logical_depth"))
        if len(records) >= limits.unfolded_node_count:
            raise _Stop(ResourceRefused("unfolded_node_count"))
        while (length := source.uvarint()) is None:
            yield
        if length > limits.payload_length:
            raise _Stop(ResourceRefused("payload_length"))
        while (start := source.skip(length)) is None:
            yield
        while (count := source.uvarint()) is None:
            yield
        if count > limits.entries_per_node:
            raise _Stop(ResourceRefused("entries_per_node"))
        record = _Record(start, length, [])
        if stack:
            stack[-1].record.entries.append((key, len(records)))
        records.append(record)
        if count:
            stack.append(_Open(record, count, None))

        # Close every node whose `count` entries are all read (rule 3), then read the
        # next entry's key and judge it against its predecessor (rule 4).
        while stack and not stack[-1].remaining:
            stack.pop()
        if not stack:
            break
        parent = stack[-1]
        while (length := source.uvarint()) is None:
            yield
        if length > limits.key_length:
            raise _Stop(ResourceRefused("key_length"))
        while (read := source.take(length)) is None:
            yield
        key = read
        if parent.previous is not None:
            if key == parent.previous:
                raise _Stop(Invalid("duplicate_key"))
            if key < parent.previous:
                raise _Stop(Invalid("unsorted_keys"))
        parent.previous = key
        parent.remaining -= 1

    # Rule 6: nothing after the root. A trailing octet is final the moment it arrives.
    while not source.ended:
        if source.trailing():
            raise _Stop(Invalid("trailing_bytes"))
        yield
    if source.trailing():
        raise _Stop(Invalid("trailing_bytes"))
    return _Framing(slot_codec_id, records)


def _conclude_flat(
    framing: _Framing, buffer: bytearray, registry: Registry
) -> Accepted[Any] | Invalid | Unsupported:
    """Phases B and C over well-framed octets: capability, then every node's payload in
    parse order (§5 rule 5, at nodes with children too), then the value."""
    codec = lookup(registry, framing.slot_codec_id)
    if codec is None:
        return UNSUPPORTED
    values: list[Any] = []
    for record in framing.records:
        payload = bytes(buffer[record.start : record.start + record.length])
        try:
            values.append(codec.decode(payload))
        except NonCanonicalPayload:
            return Invalid("non_canonical_payload")
    # A child's record follows its parent's in pre-order, so building in reverse finds
    # every child built; `built[total - 1 - i]` is record i's node.
    total = len(framing.records)
    built: list[Node[Any]] = []
    for index in range(total - 1, -1, -1):
        built.append(
            Node.compose(
                values[index],
                [
                    (key, built[total - 1 - child])
                    for key, child in framing.records[index].entries
                ],
            )
        )
    return Accepted(built[-1], codec)


class FlatDecoder:
    """A streaming flat-decoder (§14): feed the octets in any pieces, then finish.

    :meth:`feed` answers ``need_more_input`` — the one non-terminal state — until a
    verdict is certain, and that includes a complete root while the stream is open,
    since one more octet would make it ``trailing_bytes``. A framing fault
    (``trailing_bytes`` included) or a resource refusal is final the moment it is seen;
    ``unsupported_slot_codec``, ``non_canonical_payload`` and acceptance wait for the
    end of input, because a framing fault further on would outrank each of them.
    :meth:`finish` declares the end of input and returns the final verdict. For every
    split of an artifact, the final verdict is :func:`decode_flat`'s on the whole.
    """

    def __init__(self, registry: Registry, limits: Limits = FLOORS) -> None:
        self._registry = registry
        self._source = _Source(
            limits.flat_artifact_octets, "flat_artifact_octets", limits.varint_value
        )
        self._parse = _parse_flat(self._source, limits, header_only=False)
        self._framing: _Framing | None = None
        self._refused: Invalid | ResourceRefused | None = None
        self._result: Accepted[Any] | Invalid | Unsupported | ResourceRefused | None = (
            None
        )
        self._step()

    def _step(self) -> None:
        try:
            next(self._parse)
        except StopIteration as done:
            self._framing = done.value
        except _Stop as stop:
            self._refused = stop.verdict

    def feed(
        self, data: bytes | bytearray | memoryview
    ) -> Incomplete | Invalid | ResourceRefused:
        """Take the next piece of the artifact. Returns ``need_more_input`` or a final
        refusal; after a final refusal, further input is ignored."""
        if self._source.ended:
            raise ValueError("the end of input was already declared")
        if self._refused is None:
            self._source.append(data)
            self._step()
        return NEED_MORE_INPUT if self._refused is None else self._refused

    def finish(self) -> Accepted[Any] | Invalid | Unsupported | ResourceRefused:
        """Declare the end of input, resolving ``need_more_input`` (§14): the value or
        the verdict the remaining checks reach if the root is complete; if it is not,
        ``unexpected_eof`` — or ``malformed_uvarint`` where the end cuts a cuvarint
        after one or more of its octets (§5). Idempotent."""
        if self._result is None:
            if self._refused is None and self._framing is None:
                self._source.ended = True
                self._step()
            if self._refused is not None:
                self._result = self._refused
            else:
                assert self._framing is not None
                self._result = _conclude_flat(
                    self._framing, self._source.buffer, self._registry
                )
        return self._result


def decode_flat(
    data: bytes | bytearray | memoryview,
    registry: Registry,
    limits: Limits = FLOORS,
) -> Accepted[Any] | Invalid | Unsupported | ResourceRefused:
    """``decF`` (§5), whole-buffer: the value, or one verdict of §9.

    ``registry`` is what this decoder holds. Codec-blind for the artifact's id — an
    empty registry, say — it still judges all of the framing, reports any framing fault,
    and otherwise ``unsupported_slot_codec``, never a value (§11). It is the streaming
    decoder fed once, so the two cannot disagree.
    """
    decoder = FlatDecoder(registry, limits)
    decoder.feed(data)
    return decoder.finish()


@dataclass(frozen=True, slots=True)
class Header:
    """A flat artifact's header as a flat-header-validator judges it (§2.1): the magic,
    and a well-formed id this reader holds. It says nothing about the body, which the
    validator never reads."""

    slot_codec_id: bytes
    codec: SlotCodec[Any]


class HeaderReader:
    """A streaming flat-header-validator (§2.1): magic and id only.

    Its verdict is certain as soon as the header is read, so :meth:`feed` returns the
    :class:`Header` — or ``unsupported_slot_codec`` for an id this reader does not hold
    — without waiting for the end of input; before that, ``need_more_input``.
    """

    def __init__(self, registry: Registry, limits: Limits = FLOORS) -> None:
        self._registry = registry
        self._source = _Source(
            limits.flat_artifact_octets, "flat_artifact_octets", limits.varint_value
        )
        self._parse = _parse_flat(self._source, limits, header_only=True)
        self._result: Header | Invalid | Unsupported | ResourceRefused | None = None
        self._step()

    def _step(self) -> None:
        try:
            next(self._parse)
        except StopIteration as done:
            framing: _Framing = done.value
            codec = lookup(self._registry, framing.slot_codec_id)
            self._result = (
                UNSUPPORTED if codec is None else Header(framing.slot_codec_id, codec)
            )
        except _Stop as stop:
            self._result = stop.verdict

    def feed(self, data: bytes | bytearray | memoryview) -> Header | Refusal:
        """Take the next piece: the header's verdict once certain, else
        ``need_more_input``."""
        if self._source.ended:
            raise ValueError("the end of input was already declared")
        if self._result is None:
            self._source.append(data)
            self._step()
        return NEED_MORE_INPUT if self._result is None else self._result

    def finish(self) -> Header | Invalid | Unsupported | ResourceRefused:
        """Declare the end of input: ``unexpected_eof`` if the header is incomplete, or
        ``malformed_uvarint`` where the end cuts the id's length after one octet or
        more (§5)."""
        if self._result is None:
            self._source.ended = True
            self._step()
        assert self._result is not None
        return self._result


def read_header(
    data: bytes | bytearray | memoryview,
    registry: Registry,
    limits: Limits = FLOORS,
) -> Header | Invalid | Unsupported | ResourceRefused:
    """The flat-header-validator (§2.1) over a whole buffer: the header, or its verdict.
    Octets after the id are not read."""
    reader = HeaderReader(registry, limits)
    reader.feed(data)
    return reader.finish()


# --- the linked form (§6, §7) ---------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Address:
    """A content address, version-qualified (§7): the pair ``(address-space, digest)``.

    Everywhere an address leaves a chunk it travels as this pair; a bare 32-octet digest
    is not an address, and no function here takes or returns one as such. The content
    address of a value is the SHA-256 of its linked root chunk and nothing else — a flat
    artifact's digest never names a value. Before the freeze, an address is not a stable
    identity (§16).
    """

    space: Literal["dxl2"]
    digest: bytes

    def __post_init__(self) -> None:
        if self.space != ADDRESS_SPACE:
            raise ValueError(f"not an address space of this version: {self.space!r}")
        if type(self.digest) is not bytes or len(self.digest) != DIGEST_OCTETS:
            raise ValueError("a digest is exactly 32 octets of bytes")

    def __str__(self) -> str:
        return f"{self.space}:{self.digest.hex()}"


def _address(digest: bytes) -> Address:
    return Address(ADDRESS_SPACE, digest)


def _sha256(octets: bytes) -> bytes:
    """The one hash of this version (§7), and the only place a digest is computed. A
    test stands a weaker hash in here to build a closure with a cycle: §12 forbids a
    walk's termination resting on SHA-256 making one infeasible, so the refusal has to
    be exercised without breaking SHA-256."""
    return hashlib.sha256(octets).digest()


@dataclass(frozen=True, slots=True)
class Linked:
    """A value in the linked form (§6): its root address, and its closure — one chunk
    per distinct node, keyed by address. The chunk set is a function of the value
    (law 2): equal subtrees are one chunk."""

    root: Address
    chunks: Mapping[Address, bytes]


type Fetch = Callable[[Address], bytes | None]
"""How a resolver reads a store: the octets filed under an address, or None if there
are none. Nothing it returns is trusted; every chunk is verified against the hash it was
reached by (§14)."""


def _chunk_octets(
    prefix: bytes, payload: bytes, entries: Sequence[tuple[bytes, bytes]]
) -> bytes:
    """A chunk from its prefix (magic and id), its payload octets, and its entries in
    key order as (key, child digest). The links header lists each distinct child digest
    once, at its first reference in key order (§6, first-use order)."""
    links: list[bytes] = []
    index_of: dict[bytes, int] = {}
    body = bytearray(encode_uvarint(len(payload)))
    body += payload
    body += encode_uvarint(len(entries))
    for key, digest in entries:
        index = index_of.get(digest)
        if index is None:
            index = index_of[digest] = len(links)
            links.append(digest)
        body += encode_uvarint(len(key))
        body += key
        body += encode_uvarint(index)
    return b"".join((prefix, encode_uvarint(len(links)), *links, body))


def encode_chunk(
    slot_codec_id: bytes,
    payload: bytes,
    children: Iterable[tuple[bytes | bytearray | memoryview, Address]],
) -> bytes:
    """One node's chunk (§6), from its encoded payload and its children's addresses, in
    any order. The building block of a store that updates one node without re-encoding
    the rest — a changed node retransmits exactly its own chunk (§6). Raises
    :class:`deixis_core.DuplicateKeyError` for a repeated key, and :class:`ValueError`
    for an id that is not one id of a defined form."""
    owned = sorted(
        ((bytes(key), address) for key, address in children), key=lambda e: e[0]
    )
    for previous, current in pairwise(owned):
        if previous[0] == current[0]:
            raise DuplicateKeyError(current[0])
    return _chunk_octets(
        _prefix(LINKED_MAGIC, _require_id(slot_codec_id)),
        bytes(payload),
        [(key, address.digest) for key, address in owned],
    )


def encode_linked[T](node: Node[T], codec: SlotCodec[T]) -> Linked:
    """The linked form of ``node`` under ``codec`` (§6): one chunk per node, children by
    hash, the root's hash its address (§7).

    A node object met twice — a shared subtree in memory — is encoded once, so a value
    held with sharing costs its distinct nodes, not its unfolded size. That sharing is
    representation only: the chunks are the same as for the unshared tree.
    """
    prefix = _prefix(LINKED_MAGIC, _require_id(codec.id))
    chunks: dict[bytes, bytes] = {}
    # By object identity. Every node stays reachable from `node` while this runs, so no
    # identity can be reused mid-way.
    done: dict[int, bytes] = {}
    stack: list[tuple[Node[T], bool]] = [(node, False)]
    while stack:
        current, expanded = stack.pop()
        if id(current) in done:
            continue
        entries = current.entries()
        if not expanded:
            stack.append((current, True))
            stack.extend(
                (child, False)
                for _, child in reversed(entries)
                if id(child) not in done
            )
            continue
        chunk = _chunk_octets(
            prefix,
            codec.encode(current.own),
            [(key, done[id(child)]) for key, child in entries],
        )
        digest = _sha256(chunk)
        chunks.setdefault(digest, chunk)
        done[id(current)] = digest
    return Linked(
        _address(done[id(node)]),
        {_address(digest): chunk for digest, chunk in chunks.items()},
    )


@dataclass(frozen=True, slots=True)
class _ChunkFraming:
    slot_codec_id: bytes
    links: tuple[bytes, ...]
    payload: bytes
    entries: tuple[tuple[bytes, int], ...]  # (key, link index), key order


def _parse_chunk(
    source: _Source, limits: Limits
) -> Generator[None, None, _ChunkFraming]:
    """Framing of one chunk (§6), codec-blind, in parse order.

    The links rules are judged where they are observable: a repeated hash as the header
    is read; each ``link-index`` as it is read — out of range first, then out of
    first-use order (§10's order within the group); an unused hash once the body's
    entries are all read, which is before ``trailing_bytes`` is observable.
    """
    while (magic := source.take(len(LINKED_MAGIC))) is None:
        yield
    if magic != LINKED_MAGIC:
        raise _Stop(Invalid("unknown_magic"))
    slot_codec_id = yield from _read_id(source, limits)
    while (nlinks := source.uvarint()) is None:
        yield
    if nlinks > limits.links_per_chunk:
        raise _Stop(ResourceRefused("links_per_chunk"))
    links: list[bytes] = []
    listed: set[bytes] = set()
    for _ in range(nlinks):
        while (digest := source.take(DIGEST_OCTETS)) is None:
            yield
        if digest in listed:
            raise _Stop(Invalid("duplicate_link_hash"))
        listed.add(digest)
        links.append(digest)

    while (length := source.uvarint()) is None:
        yield
    if length > limits.payload_length:
        raise _Stop(ResourceRefused("payload_length"))
    while (payload := source.take(length)) is None:
        yield
    while (count := source.uvarint()) is None:
        yield
    if count > limits.entries_per_node:
        raise _Stop(ResourceRefused("entries_per_node"))
    entries: list[tuple[bytes, int]] = []
    previous: bytes | None = None
    used = 0  # links[:used] have been referenced, in first-use order
    for _ in range(count):
        while (length := source.uvarint()) is None:
            yield
        if length > limits.key_length:
            raise _Stop(ResourceRefused("key_length"))
        while (key := source.take(length)) is None:
            yield
        if previous is not None:
            if key == previous:
                raise _Stop(Invalid("duplicate_key"))
            if key < previous:
                raise _Stop(Invalid("unsorted_keys"))
        previous = key
        while (index := source.uvarint()) is None:
            yield
        if index >= nlinks:
            raise _Stop(Invalid("bad_link_index"))
        if index > used:
            raise _Stop(Invalid("links_out_of_order"))
        if index == used:
            used += 1
        entries.append((key, index))
    if used < nlinks:
        raise _Stop(Invalid("unused_link"))
    if source.trailing():
        raise _Stop(Invalid("trailing_bytes"))
    return _ChunkFraming(slot_codec_id, tuple(links), payload, tuple(entries))


def _frame_chunk(octets: bytes, limits: Limits) -> _ChunkFraming:
    """Framing of one whole chunk, already measured and verified (§12). Its size was
    met when it was fetched, so its parse is bounded by its own end, and within it
    parse order governs as in a flat artifact: each per-field limit is met at its
    field. Raises :class:`_Stop` with its verdict."""
    source = _Source(len(octets) + 1, "chunk_octets", limits.varint_value)
    source.append(octets)
    source.ended = True
    try:
        next(_parse_chunk(source, limits))
    except StopIteration as done:
        framing: _ChunkFraming = done.value
        return framing
    raise AssertionError("a parse over ended input never waits")


def _retrieve(
    address: Address, fetch: Fetch, limits: Limits, spent: int | None
) -> tuple[_ChunkFraming, int] | StoreFault:
    """Fetch the chunk filed under ``address``, measure it, verify it against that
    address (§14), then judge its framing — in that order (§12). Chunks are never
    streamed: a chunk is verified before it is parsed, and the check reads every octet,
    so ``chunk_octets``, and the chunk's share of ``unique_octets``, are met on the
    fetched length, before the hash check and before any fault inside the chunk.
    ``spent`` is the traversal's unique octets so far, when it keeps that budget.
    Raises :class:`_Stop` with a decoder verdict."""
    fetched = fetch(address)
    if fetched is None:
        return StoreFault("missing_chunk", address)
    if len(fetched) > limits.chunk_octets:
        raise _Stop(ResourceRefused("chunk_octets"))
    if spent is not None and spent + len(fetched) > limits.unique_octets:
        raise _Stop(ResourceRefused("unique_octets"))
    octets = bytes(fetched)
    if _sha256(octets) != address.digest:
        return StoreFault("hash_mismatch", address)
    return _frame_chunk(octets, limits), len(octets)


@dataclass(frozen=True, slots=True)
class Chunk:
    """One chunk, retrieved and verified: canonically framed (§6), and hashing to the
    address it was reached by (§14). Its payload is undecoded — apply the slot codec's
    ``D`` to it.

    Only :func:`resolve_root` and :func:`resolve_child` make one, the two retrievals §14
    keeps apart: the root against the address a caller asked for, and a child against a
    hash in a parent that was itself verified.
    """

    address: Address
    slot_codec_id: bytes
    payload: bytes
    links: tuple[Address, ...]
    """The links header: each distinct child, in first-use order."""
    children: tuple[tuple[bytes, Address], ...]
    """Every entry as (key, the child's address), in key order."""

    def child(self, key: bytes | bytearray | memoryview) -> Address | None:
        """The address of the child at ``key``, or None if the key is not in the
        domain."""
        wanted = bytes(key)
        index = bisect_left(self.children, wanted, key=lambda entry: entry[0])
        if index < len(self.children) and self.children[index][0] == wanted:
            return self.children[index][1]
        return None


def _chunk_of(address: Address, framing: _ChunkFraming) -> Chunk:
    links = tuple(_address(digest) for digest in framing.links)
    return Chunk(
        address,
        framing.slot_codec_id,
        framing.payload,
        links,
        tuple((key, links[index]) for key, index in framing.entries),
    )


def resolve_root(
    address: Address, fetch: Fetch, limits: Limits = FLOORS
) -> Chunk | Invalid | ResourceRefused | StoreFault:
    """Resolve-root (§14): retrieve the chunk a caller asked for, verified against the
    address the caller supplied — the one place a caller's question enters a traversal,
    and the only verification that anchors a closure to it."""
    try:
        retrieved = _retrieve(address, fetch, limits, None)
    except _Stop as stop:
        return stop.verdict
    if isinstance(retrieved, StoreFault):
        return retrieved
    return _chunk_of(address, retrieved[0])


def resolve_child(
    parent: Chunk,
    key: bytes | bytearray | memoryview,
    fetch: Fetch,
    limits: Limits = FLOORS,
) -> Chunk | Invalid | ResourceRefused | StoreFault | None:
    """Resolve-child (§14): retrieve the child at ``key`` of an already-verified parent,
    verified against the hash in the parent's links header. None if the key is not in
    the parent's domain. A child whose id differs from its parent's is
    ``slot_codec_mismatch`` — judged only after the child's own framing, which outranks
    it (§10, read first, ruled last)."""
    address = parent.child(key)
    if address is None:
        return None
    try:
        retrieved = _retrieve(address, fetch, limits, None)
    except _Stop as stop:
        return stop.verdict
    if isinstance(retrieved, StoreFault):
        return retrieved
    framing = retrieved[0]
    if framing.slot_codec_id != parent.slot_codec_id:
        return Invalid("slot_codec_mismatch")
    return _chunk_of(address, framing)


@dataclass(slots=True)
class _Visit:
    """A distinct chunk of a closure, and its unfolded measures once its children are
    measured: depth below it in edges, and its subtree's node count and flat octets,
    saturating."""

    framing: _ChunkFraming
    height: int = 0
    nodes: int = 0
    flat: int = 0


@dataclass(frozen=True, slots=True)
class _Closure:
    root: bytes
    visits: dict[bytes, _Visit]
    first_seen: list[bytes]  # distinct chunks in parse order
    finished: list[bytes]  # distinct chunks, every child before its parents

    @property
    def header_octets(self) -> int:
        slot_codec_id = self.visits[self.root].framing.slot_codec_id
        return len(FLAT_MAGIC) + _uvarint_size(len(slot_codec_id)) + len(slot_codec_id)

    @property
    def flat_octets(self) -> int:
        return min(self.header_octets + self.visits[self.root].flat, SATURATED)


def _measure(visits: dict[bytes, _Visit], digest: bytes) -> None:
    """Measure one chunk from its already-measured children, with saturating arithmetic
    (§12) — the DAG is never unfolded to find out."""
    visit = visits[digest]
    framing = visit.framing
    height, nodes = 0, 1
    flat = (
        _uvarint_size(len(framing.payload))
        + len(framing.payload)
        + _uvarint_size(len(framing.entries))
    )
    for key, index in framing.entries:
        child = visits[framing.links[index]]
        height = max(height, child.height + 1)
        nodes = min(nodes + child.nodes, SATURATED)
        flat = min(flat + _uvarint_size(len(key)) + len(key) + child.flat, SATURATED)
    visit.height, visit.nodes, visit.flat = height, nodes, flat


def _traverse(root: Address, fetch: Fetch, limits: Limits) -> _Closure | StoreFault:
    """Phase A over a closure: every reachable chunk retrieved once, verified, framed
    and measured, and the walk's own limits met as the walk meets them (§12).

    Depth first, children in first-use order — which is key order — so the chunks are
    met in the order a flat parse meets their nodes. The visited-hash set is what
    terminates the walk, never the presumed difficulty of hash cycles (§12).

    Depth counts edges, the root at 0, and is met on every edge of the denoted tree: a
    new child is one deeper than its parent; a chunk already measured reaches its depth
    plus the height below it, since its subtree recurs there; and one of the current
    chunk's own ancestors — itself included — is a hash cycle, which denotes no finite
    tree and exceeds every depth limit. Each is ``limit_exceeded`` naming
    ``logical_depth``. Raises :class:`_Stop` with a decoder verdict.
    """
    if limits.unique_chunks < 1:
        raise _Stop(ResourceRefused("unique_chunks"))
    retrieved = _retrieve(root, fetch, limits, 0)
    if isinstance(retrieved, StoreFault):
        return retrieved
    framing, spent = retrieved
    visits = {root.digest: _Visit(framing)}
    first_seen = [root.digest]
    finished: list[bytes] = []
    open_: set[bytes] = {root.digest}  # the current chunk and its ancestors
    stack: list[tuple[bytes, Iterator[bytes]]] = [(root.digest, iter(framing.links))]
    while stack:
        digest, links = stack[-1]
        child = next(links, None)
        if child is None:
            stack.pop()
            open_.discard(digest)
            _measure(visits, digest)
            finished.append(digest)
            continue
        depth = len(stack)  # the child's, in edges: one past its parent's
        if child in open_:
            raise _Stop(ResourceRefused("logical_depth"))
        if child in visits:
            if depth + visits[child].height > limits.logical_depth:
                raise _Stop(ResourceRefused("logical_depth"))
            continue
        if depth > limits.logical_depth:
            raise _Stop(ResourceRefused("logical_depth"))
        if len(visits) >= limits.unique_chunks:
            raise _Stop(ResourceRefused("unique_chunks"))
        retrieved = _retrieve(_address(child), fetch, limits, spent)
        if isinstance(retrieved, StoreFault):
            return retrieved
        framing, size = retrieved
        spent += size
        # Read first, ruled last: the child's own framing was judged above.
        if framing.slot_codec_id != visits[digest].framing.slot_codec_id:
            raise _Stop(Invalid("slot_codec_mismatch"))
        visits[child] = _Visit(framing)
        first_seen.append(child)
        open_.add(child)
        stack.append((child, iter(framing.links)))
    return _Closure(root.digest, visits, first_seen, finished)


@dataclass(frozen=True, slots=True)
class ClosurePresent:
    """What a closure-checker certifies (§2.1, §15): *opaque closure present* — every
    reachable chunk present, hash-matching and canonically framed, one slot-codec-id
    throughout. Not *value validated*: no payload was decoded, so no claim is made that
    the root is a canonical value, and this must not be presented as one."""

    root: Address
    slot_codec_id: bytes
    unique_chunks: int


def check_closure(
    address: Address, fetch: Fetch, limits: Limits = FLOORS
) -> ClosurePresent | Invalid | ResourceRefused | StoreFault:
    """The closure-checker (§2.1): validate the closure's framing, links and digests,
    without decoding a payload — so never ``non_canonical_payload``, and never
    ``unsupported_slot_codec``: it needs no slot codec. The walk meets its own limits,
    so a hash cycle, or a tree deeper than ``logical_depth``, is refused."""
    try:
        closure = _traverse(address, fetch, limits)
    except _Stop as stop:
        return stop.verdict
    if isinstance(closure, StoreFault):
        return closure
    root = closure.visits[closure.root].framing
    return ClosurePresent(address, root.slot_codec_id, len(closure.visits))


@dataclass(frozen=True, slots=True)
class Unfolded:
    """A closure's unfolded measures (§12), computed over the DAG without unfolding it.
    ``node_count`` and ``flat_octets`` saturate at :data:`SATURATED`, which means "at
    least that many"; ``flat_octets`` is the flat artifact's, header included, and
    ``depth`` counts edges."""

    node_count: int
    flat_octets: int
    depth: int


def estimate_unfolded(
    address: Address, fetch: Fetch, limits: Limits = FLOORS
) -> Unfolded | Invalid | ResourceRefused | StoreFault:
    """Estimate unfolded size (§14): saturating arithmetic over the verified closure,
    no materialization. The walk it needs meets its own limits, ``logical_depth``
    among them; the unfolded measures themselves are reported, not judged."""
    try:
        closure = _traverse(address, fetch, limits)
    except _Stop as stop:
        return stop.verdict
    if isinstance(closure, StoreFault):
        return closure
    root = closure.visits[closure.root]
    return Unfolded(root.nodes, closure.flat_octets, root.height)


def _budget(closure: _Closure, limits: Limits, output: bool) -> None:
    """The explicit budget of materialize and flatten (§12, §14): it guards the build,
    not the judgments, so it is judged after the closure's framing, capability and
    payloads, and before anything is built or written. Either exceeded dimension may be
    named (§12): materialization names nodes first, flattening its output octets."""
    root = closure.visits[closure.root]
    over_nodes = root.nodes > limits.unfolded_node_count
    over_octets = closure.flat_octets > limits.unfolded_flat_octets
    if output and over_octets:
        raise _Stop(ResourceRefused("unfolded_flat_octets"))
    if over_nodes:
        raise _Stop(ResourceRefused("unfolded_node_count"))
    if over_octets:
        raise _Stop(ResourceRefused("unfolded_flat_octets"))


class _Blind(Exception):
    """Internal: the closure is well framed and its id is not held."""


def _decode_payloads(
    closure: _Closure, registry: Registry
) -> tuple[SlotCodec[Any], dict[bytes, Any]]:
    """Phases B and C over a verified closure: capability for its one id, then every
    distinct chunk's payload in parse order. Raises :class:`_Stop`, or returns the
    codec and the decoded payloads."""
    codec = lookup(registry, closure.visits[closure.root].framing.slot_codec_id)
    if codec is None:
        raise _Blind
    values: dict[bytes, Any] = {}
    for digest in closure.first_seen:
        try:
            values[digest] = codec.decode(closure.visits[digest].framing.payload)
        except NonCanonicalPayload:
            raise _Stop(Invalid("non_canonical_payload")) from None
    return codec, values


def materialize(
    address: Address,
    fetch: Fetch,
    registry: Registry,
    limits: Limits = FLOORS,
) -> Accepted[Any] | Invalid | Unsupported | ResourceRefused | StoreFault:
    """Resolve a closure to its value (§14's materialize): walk and verify every
    reachable chunk from the root the caller asked for, judge capability and every
    payload, and only then hold the value to its budget before building anything.

    The walk meets its own limits as it goes (``logical_depth`` among them). The budget
    — ``unfolded_node_count`` and ``unfolded_flat_octets`` in ``limits``, estimated with
    saturating arithmetic over the DAG — guards the build and not the judgments (§12):
    an over-budget closure that is invalid or unsupported gets that verdict, and a
    sharing bomb of a few dozen chunks costs time in its chunks, never its unfolding.
    The value may share equal subtrees internally; nodes are immutable and deixis
    compares them only through the supplied ``≈``, so the sharing is not observable
    through them.
    """
    try:
        closure = _traverse(address, fetch, limits)
        if isinstance(closure, StoreFault):
            return closure
        codec, values = _decode_payloads(closure, registry)
        _budget(closure, limits, output=False)
    except _Stop as stop:
        return stop.verdict
    except _Blind:
        return UNSUPPORTED
    built: dict[bytes, Node[Any]] = {}
    for digest in closure.finished:
        framing = closure.visits[digest].framing
        built[digest] = Node.compose(
            values[digest],
            [(key, built[framing.links[index]]) for key, index in framing.entries],
        )
    return Accepted(built[closure.root], codec)


def flatten(
    address: Address,
    fetch: Fetch,
    registry: Registry,
    limits: Limits = FLOORS,
) -> bytes | Invalid | Unsupported | ResourceRefused | StoreFault:
    """The bridge (§14's flatten): a verified closure's value as canonical flat octets.

    Fully validated first — framing, capability and every payload — so the output is
    ``encF`` of the closure's value, never an unvalidated copy. Its explicit output-size
    budget is ``limits.unfolded_flat_octets``: the whole flat artifact's octets, header
    included, estimated after those judgments and before one octet is written (§12).
    """
    try:
        closure = _traverse(address, fetch, limits)
        if isinstance(closure, StoreFault):
            return closure
        _decode_payloads(closure, registry)
        _budget(closure, limits, output=True)
    except _Stop as stop:
        return stop.verdict
    except _Blind:
        return UNSUPPORTED
    visits = closure.visits
    out = bytearray(_prefix(FLAT_MAGIC, visits[closure.root].framing.slot_codec_id))

    def head(digest: bytes) -> tuple[Iterator[tuple[bytes, int]], _ChunkFraming]:
        framing = visits[digest].framing
        out.extend(encode_uvarint(len(framing.payload)))
        out.extend(framing.payload)
        out.extend(encode_uvarint(len(framing.entries)))
        return iter(framing.entries), framing

    stack = [head(closure.root)]
    while stack:
        entries, framing = stack[-1]
        entry = next(entries, None)
        if entry is None:
            stack.pop()
            continue
        key, index = entry
        out.extend(encode_uvarint(len(key)))
        out.extend(key)
        stack.append(head(framing.links[index]))
    return bytes(out)
