"""The codec.* operations of the conformance protocol, over core/py/deixis_codec.py.

The CLI answers and the harness judges: nothing here holds an expected octet string or
verdict. Payloads are spelled in the carrier of the codec an id names —
``deixis/identity-bytes`` (``00 01``) as a hex string, the fixture setoid as
``{class, representation}``, and option-of either as ``{"none": {}}`` or
``{"some": inner}`` — and a node as ``{"own": payload, "children": [[hex key, node]]}``.

``holding`` lists the base ids this request's decoder holds; option-of over a held id
is held (§13), which the core derives, and a list naming anything else is a request
this CLI cannot serve. ``cuts`` are strictly ascending interior offsets. Store outcomes
travel under ``store``, never as a verdict, because they are not decoder verdicts (§9).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from itertools import pairwise
from typing import Any

from deixis_codec import (
    DIMENSIONS,
    FLOORS,
    IDENTITY_BYTES,
    OPTION_OF,
    UNSUPPORTED,
    Accepted,
    Address,
    Chunk,
    ClosurePresent,
    FlatDecoder,
    Header,
    HeaderReader,
    Incomplete,
    Invalid,
    Limits,
    NonCanonicalPayload,
    ResourceRefused,
    SlotCodec,
    StoreFault,
    Unsupported,
    check_closure,
    decode_flat,
    encode_flat,
    encode_linked,
    flatten,
    lookup,
    materialize,
    option_of,
    read_header,
    resolve_child,
    resolve_root,
)
from deixis_core import DuplicateKeyError, Node, Some

Fixture = tuple[str, str]  # (class, representation); ≈ compares the class

FIXTURE_ID = bytes.fromhex("01fb44faaf3a9db590cbc4cb1abfdadb0201")
"""The fixture setoid's private id, as the protocol names it."""

UNSUPPORTED_OP: dict[str, Any] = {"error": "unsupported"}


@dataclass(frozen=True)
class FixtureSetoid:
    """The fixture setoid: ≈ compares the class; e is the class's UTF-8; D decodes
    UTF-8 strictly — an ill-formed payload is outside im(e) — to a representation-less
    value."""

    id: bytes = FIXTURE_ID

    def equal(self, a: Fixture, b: Fixture) -> bool:
        return a[0] == b[0]

    def encode(self, value: Fixture) -> bytes:
        return value[0].encode("utf-8")

    def decode(self, payload: bytes) -> Fixture:
        try:
            return (payload.decode("utf-8"), "")
        except UnicodeDecodeError as refusal:
            raise NonCanonicalPayload from refusal


FIXTURE = FixtureSetoid()


@dataclass(frozen=True)
class Carrier:
    """A codec this CLI can build, with its payload spelling both ways."""

    codec: SlotCodec[Any]
    read: Callable[[Any], Any]
    spell: Callable[[Any], Any]


def _read_fixture(spelling: Any) -> Fixture:
    return (spelling["class"], spelling["representation"])


def _spell_fixture(value: Fixture) -> Any:
    return {"class": value[0], "representation": value[1]}


def _read_hex(spelling: Any) -> bytes:
    return bytes.fromhex(spelling)


def _spell_hex(value: bytes) -> Any:
    return value.hex()


def _option(inner: Carrier) -> Carrier:
    def read(spelling: Any) -> Some[Any] | None:
        if not isinstance(spelling, dict) or len(spelling) != 1:
            raise ValueError(f"an option payload is none or some: {spelling!r}")
        return None if "none" in spelling else Some(inner.read(spelling["some"]))

    def spell(value: Some[Any] | None) -> Any:
        return {"none": {}} if value is None else {"some": inner.spell(value.value)}

    return Carrier(option_of(inner.codec), read, spell)


def carrier(slot_codec_id: bytes) -> Carrier | None:
    """The codec an id names, if this CLI can build it: identity-bytes, the fixture
    setoid, and option-of over either, to any nesting the 32-octet bound allows."""
    if slot_codec_id == IDENTITY_BYTES.id:
        return Carrier(IDENTITY_BYTES, _read_hex, _spell_hex)
    if slot_codec_id == FIXTURE_ID:
        return Carrier(FIXTURE, _read_fixture, _spell_fixture)
    if slot_codec_id[:1] == b"\x02":
        inner = carrier(slot_codec_id[1:])
        if inner is None:
            return None
        try:
            return _option(inner)
        except ValueError:
            return None  # past the id's length bound
    return None


def read_node(spelling: Any, read: Callable[[Any], Any]) -> Node[Any]:
    """A node from its spelling, without recursion. Children reach the core in file
    order; it sorts them, and refuses a repeated key."""
    order: list[tuple[Any, int, bytes]] = [(spelling, -1, b"")]
    index = 0
    while index < len(order):
        for key, child in order[index][0]["children"]:
            order.append((child, index, bytes.fromhex(key)))
        index += 1
    children: list[list[tuple[bytes, Node[Any]]]] = [[] for _ in order]
    built: Node[Any] | None = None
    for index in range(len(order) - 1, -1, -1):
        node_spelling, parent, key = order[index]
        built = Node.compose(read(node_spelling["own"]), reversed(children[index]))
        if parent >= 0:
            children[parent].append((key, built))
    assert built is not None
    return built


def spell_node(node: Node[Any], spell: Callable[[Any], Any]) -> Any:
    """A node's spelling, children in key order, without recursion."""
    root: dict[str, Any] = {"own": spell(node.own), "children": []}
    stack: list[tuple[Node[Any], dict[str, Any]]] = [(node, root)]
    while stack:
        current, out = stack.pop()
        for key, child in current.entries():
            spelled: dict[str, Any] = {"own": spell(child.own), "children": []}
            out["children"].append([key.hex(), spelled])
            stack.append((child, spelled))
    return root


def holding(request: dict[str, Any]) -> dict[bytes, SlotCodec[Any]] | None:
    """The registry a request's decoder holds, or None if the list names anything but
    a base id this CLI implements, a request it cannot serve. §13 grants one direction
    only: option-of over a held id is held, which the core derives. Holding option-of(c)
    does not imply holding c, so an option-of id in the list is not read as its base."""
    held: dict[bytes, SlotCodec[Any]] = {}
    for spelled in request.get("holding", []):
        base = bytes.fromhex(spelled)
        found = None if base[:1] == bytes([OPTION_OF]) else carrier(base)
        if found is None:
            return None
        held[base] = found.codec
    return held


def answer(result: object) -> dict[str, Any]:
    """A judgment, spelled."""
    if isinstance(result, Accepted):
        found = carrier(result.codec.id)
        assert found is not None, "a held codec is always one this CLI built"
        return {"value": spell_node(result.value, found.spell)}
    if isinstance(result, Header):
        return {"header": {"slot_codec": result.slot_codec_id.hex()}}
    if isinstance(result, ClosurePresent):
        return {"ok": True}
    if isinstance(result, bytes):
        return {"bytes": result.hex()}
    if isinstance(result, StoreFault):
        return {"store": {"code": result.code, "digest": result.address.digest.hex()}}
    if isinstance(result, Invalid | Unsupported | Incomplete | ResourceRefused):
        verdict: dict[str, Any] = {"class": result.verdict_class, "code": result.code}
        if isinstance(result, ResourceRefused):
            verdict["dimension"] = result.dimension
        return {"verdict": verdict}
    raise TypeError(f"no spelling for {result!r}")


def pieces(data: bytes, cuts: list[Any]) -> list[bytes]:
    """The input cut at strictly ascending interior offsets, so no piece is empty.
    Anything else is a malformed request, refused like any other."""
    interior = all(type(cut) is int and 0 < cut < len(data) for cut in cuts)
    if not interior or any(left >= right for left, right in pairwise(cuts)):
        raise ValueError(f"cuts must be strictly ascending interior offsets: {cuts}")
    return [data[start:end] for start, end in pairwise([0, *cuts, len(data)])]


def address(spelling: Any) -> Address:
    return Address(spelling["space"], bytes.fromhex(spelling["digest"]))


def budget(request: dict[str, Any]) -> Limits:
    """§12 limits from decimal strings keyed by dimension token; floors elsewhere."""
    spelled: dict[str, Any] = request.get("budget", {})
    unknown = set(spelled) - set(DIMENSIONS)
    if unknown:
        raise ValueError(f"not §12 dimension tokens: {sorted(unknown)}")
    return replace(FLOORS, **{token: int(value) for token, value in spelled.items()})


def store(
    request: dict[str, Any],
) -> tuple[Callable[[Address], bytes | None], dict[str, Any] | None]:
    """The chunks list as an untrusted store: filed by the digest given, verified by the
    resolver, never here. Two different chunks filed under one digest are an
    address_conflict (§15), refused before anything is read."""
    chunks: dict[bytes, bytes] = {}
    for digest, octets in request["chunks"]:
        key, value = bytes.fromhex(digest), bytes.fromhex(octets)
        if chunks.get(key, value) != value:
            return (lambda _: None), {
                "store": {"code": "address_conflict", "digest": digest}
            }
        chunks[key] = value
    return (lambda at: chunks.get(at.digest)), None


def handle(request: dict[str, Any]) -> dict[str, Any]:
    op = request["op"]

    if op in ("codec.encodeFlat", "codec.encodeLinked"):
        found = carrier(bytes.fromhex(request["slot_codec"]))
        if found is None:
            return UNSUPPORTED_OP
        try:
            node = read_node(request["node"], found.read)
        except DuplicateKeyError as refusal:
            return {"error": refusal.code, "key": refusal.key.hex()}
        if op == "codec.encodeFlat":
            return {"bytes": encode_flat(node, found.codec).hex()}
        linked = encode_linked(node, found.codec)
        return {
            "root": {"space": linked.root.space, "digest": linked.root.digest.hex()},
            "chunks": [
                [at.digest.hex(), chunk.hex()] for at, chunk in linked.chunks.items()
            ],
        }

    registry = holding(request)
    if registry is None:
        return UNSUPPORTED_OP

    if op in ("codec.decodeFlat", "codec.readHeader"):
        data = bytes.fromhex(request["bytes"])
        header = op == "codec.readHeader"
        if "cuts" not in request and "end" not in request:
            return answer(
                read_header(data, registry) if header else decode_flat(data, registry)
            )
        reader = HeaderReader(registry) if header else FlatDecoder(registry)
        state: object = None
        for piece in pieces(data, request.get("cuts", [])):
            state = reader.feed(piece)
        return answer(reader.finish() if request.get("end") is True else state)

    if op in ("codec.resolve", "codec.checkClosure", "codec.flatten"):
        fetch, conflict = store(request)
        if conflict is not None:
            return conflict
        root = address(request["root"])
        if op == "codec.checkClosure":
            return answer(check_closure(root, fetch))
        limits = budget(request)
        if op == "codec.resolve":
            return answer(materialize(root, fetch, registry, limits))
        return answer(flatten(root, fetch, registry, limits))

    if op == "codec.navigate":
        return navigate(request, registry)

    return UNSUPPORTED_OP


def navigate(
    request: dict[str, Any], registry: dict[bytes, SlotCodec[Any]]
) -> dict[str, Any]:
    """§14's two constructors and nothing else: resolve-root once, then resolve-child
    per key of the path, nothing fetched off it and nothing materialized. The answer is
    the reached chunk's own value and its entries, each with its link digest;
    ``absent`` at the first key no entry has; or the verdict or store fault that
    stopped the walk."""
    fetch, conflict = store(request)
    if conflict is not None:
        return conflict
    reached: object = resolve_root(address(request["root"]), fetch)
    for index, key in enumerate(request["path"]):
        if not isinstance(reached, Chunk):
            break
        child = resolve_child(reached, bytes.fromhex(key), fetch)
        if child is None:
            return {"absent": index}
        reached = child
    if not isinstance(reached, Chunk):
        return answer(reached)
    # The slot codec enters only here, at the chunk answered with (§14).
    codec = lookup(registry, reached.slot_codec_id)
    found = carrier(reached.slot_codec_id)
    if codec is None or found is None:
        return answer(UNSUPPORTED)
    try:
        own = codec.decode(reached.payload)
    except NonCanonicalPayload:
        return answer(Invalid("non_canonical_payload"))
    return {
        "node": {
            "own": found.spell(own),
            "children": [
                [key.hex(), child.digest.hex()] for key, child in reached.children
            ],
        }
    }
