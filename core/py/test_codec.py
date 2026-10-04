"""Unit and property tests for core/py/deixis_codec.py, through its public API.

No expected codec byte string appears in this file. Every assertion is a law over octets
the encoder produced — round trip, canonical re-encoding, identity iff ≈, exactness
under every single-octet mutation, split invariance, framing judged without the slot
codec — or a verdict that a rule of docs/CODEC.md fixes for an input built by mutating
such octets. The integer and slot-codec-id spellings below are assembled from the rules
of §3 and §13, field by field; neither is a node or chunk encoding. The independent
corpus is replayed through the conformance CLI (conformance/py/codec.py), never here.

The code and token sets are read from docs/CODEC.md itself, so a code renamed in the
text and not here fails.
"""

from __future__ import annotations

import hashlib
import random
import re
import sys
import time
import typing
import unittest
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from unittest import mock

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import deixis_codec  # noqa: E402
from deixis_codec import (  # noqa: E402
    DIMENSIONS,
    FLAT_MAGIC,
    FLOORS,
    IDENTITY_BYTES,
    INVALID_CODES,
    LINKED_MAGIC,
    MAX_UVARINT,
    NEED_MORE_INPUT,
    SATURATED,
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
    InvalidCode,
    Limits,
    NonCanonicalPayload,
    ResourceRefused,
    StoreFault,
    Unfolded,
    Unsupported,
    check_closure,
    class_of,
    decode_flat,
    encode_chunk,
    encode_flat,
    encode_linked,
    encode_uvarint,
    estimate_unfolded,
    flatten,
    lookup,
    materialize,
    option_of,
    read_header,
    read_uvarint,
    registry_of,
    resolve_child,
    resolve_root,
)
from deixis_core import DuplicateKeyError, Node, Some  # noqa: E402

_CODEC_MD = _HERE.parent.parent / "docs" / "CODEC.md"


# --- slot codecs for the tests --------------------------------------------------------


@dataclass(frozen=True)
class Coarse:
    """A payload whose ≈ is deliberately coarser than its representation: two values of
    one class are ≈ whatever their representations. An implementation that compared
    representations, or encoded them, would fail every identity law below."""

    class_: str
    representation: str


def _private_id(label: str, ordinal: int) -> bytes:
    # §13: a namespace derived from a distinctive published string.
    namespace = hashlib.sha256(label.encode()).digest()[:16]
    return bytes([0x01]) + namespace + encode_uvarint(ordinal)


@dataclass(frozen=True)
class CoarseCodec:
    """Test-only setoid: ≈ compares the class; e is the class's UTF-8; D decodes UTF-8
    strictly, so an ill-formed payload is outside im(e)."""

    id: bytes = _private_id("deixis core/py test_codec.py coarse setoid", 1)

    def equal(self, a: Coarse, b: Coarse) -> bool:
        return a.class_ == b.class_

    def encode(self, value: Coarse) -> bytes:
        return value.class_.encode("utf-8")

    def decode(self, payload: bytes) -> Coarse:
        try:
            return Coarse(payload.decode("utf-8"), "")
        except UnicodeDecodeError as refusal:
            raise NonCanonicalPayload from refusal


@dataclass(frozen=True)
class UnheldCodec:
    """Identity bytes under a public id no registry here holds: for codec-blind runs."""

    id: bytes = bytes([0x00]) + encode_uvarint(1000)

    def equal(self, a: bytes, b: bytes) -> bool:
        return a == b

    def encode(self, value: bytes) -> bytes:
        return value

    def decode(self, payload: bytes) -> bytes:
        return payload


COARSE = CoarseCodec()
UNHELD = UnheldCodec()
OPTION_BYTES = option_of(IDENTITY_BYTES)
OPTION_OPTION_BYTES = option_of(OPTION_BYTES)
REGISTRY = registry_of(IDENTITY_BYTES, COARSE)


# --- generated trees ------------------------------------------------------------------

# Keys with the edges §2's order has to get right: the empty key, prefixes of each
# other, octets past 0x7f, ill-formed UTF-8, and a key octet equal to a length octet.
KEYS: tuple[bytes, ...] = (
    b"",
    b"a",
    b"ab",
    b"abc",
    b"b",
    bytes([0x00]),
    bytes([0x00, 0x00]),
    bytes([0x01]),
    bytes([0x02]),
    bytes([0x7F]),
    bytes([0x80]),
    bytes([0xFF]),
    bytes([0xFF, 0xFF]),
    bytes([0xC3, 0x28]),
    bytes([0xED, 0xA0, 0x80]),
    bytes(range(130)),
)


def bytes_payload(rng: random.Random) -> bytes:
    # Lengths either side of the one-octet length boundary, and the empty payload.
    return rng.choice(
        [
            b"",
            rng.randbytes(1),
            rng.randbytes(rng.randrange(2, 12)),
            rng.randbytes(127),
            rng.randbytes(128),
        ]
    )


def option_payload(rng: random.Random) -> Some[bytes] | None:
    return None if rng.random() < 0.4 else Some(bytes_payload(rng))


def option_option_payload(rng: random.Random) -> Some[Some[bytes] | None] | None:
    return None if rng.random() < 0.3 else Some(option_payload(rng))


def coarse_payload(rng: random.Random) -> Coarse:
    return Coarse(rng.choice(["", "a", "b", "é", "zz"]), rng.choice(["", "x", "y"]))


def random_tree[T](
    rng: random.Random, payload: Callable[[random.Random], T], depth: int, width: int
) -> Node[T]:
    count = rng.randrange(width + 1) if depth > 0 else 0
    return Node.compose(
        payload(rng),
        [
            (key, random_tree(rng, payload, depth - 1, width))
            for key in rng.sample(KEYS, min(count, len(KEYS)))
        ],
    )


def chain[T](depth: int, own: Callable[[int], T]) -> Node[T]:
    """A path of ``depth`` edges, built bottom-up without recursion."""
    node = Node.compose(own(depth), [])
    for level in range(depth - 1, -1, -1):
        node = Node.compose(own(level), [(encode_uvarint(level), node)])
    return node


def wide(count: int) -> Node[bytes]:
    """One node with ``count`` children: a count past the one-octet boundary."""
    return Node.compose(
        b"wide",
        [
            (index.to_bytes(2, "big"), Node.compose(bytes([index % 7]), []))
            for index in range(count)
        ],
    )


@dataclass(frozen=True)
class Case:
    name: str
    codec: Any
    tree: Node[Any]


def generated_cases(seed: int = 2026) -> list[Case]:
    rng = random.Random(seed)
    cases = [
        Case("empty payload, no children", IDENTITY_BYTES, Node.compose(b"", [])),
        Case("option None, no children", OPTION_BYTES, Node.compose(None, [])),
        Case(
            "every key edge",
            IDENTITY_BYTES,
            Node.compose(b"", [(key, Node.compose(key, [])) for key in KEYS]),
        ),
        Case("wide", IDENTITY_BYTES, wide(300)),
        Case("deep", IDENTITY_BYTES, chain(200, lambda level: bytes([level % 5]))),
        Case("deep option", OPTION_BYTES, chain(200, lambda level: None)),
    ]
    for index in range(12):
        cases.append(
            Case(
                f"bytes {index}", IDENTITY_BYTES, random_tree(rng, bytes_payload, 3, 4)
            )
        )
        cases.append(
            Case(
                f"option {index}", OPTION_BYTES, random_tree(rng, option_payload, 3, 3)
            )
        )
        cases.append(
            Case(
                f"option-of-option {index}",
                OPTION_OPTION_BYTES,
                random_tree(rng, option_option_payload, 2, 3),
            )
        )
        cases.append(
            Case(f"coarse {index}", COARSE, random_tree(rng, coarse_payload, 3, 3))
        )
    return cases


def small_cases() -> list[Case]:
    """Small encodings, for the laws that try every octet of every artifact."""
    rng = random.Random(7)
    leaf = Node.compose(b"x", [])
    return [
        Case(
            "bytes",
            IDENTITY_BYTES,
            Node.compose(
                b"r", [(b"", leaf), (b"a", Node.compose(b"", [(b"k", leaf)]))]
            ),
        ),
        Case(
            "option",
            OPTION_BYTES,
            Node.compose(
                None,
                [
                    (b"a", Node.compose(Some(b"v"), [])),
                    (
                        b"b",
                        Node.compose(
                            Some(b""), [(bytes([0xFF]), Node.compose(None, []))]
                        ),
                    ),
                ],
            ),
        ),
        Case(
            "coarse",
            COARSE,
            Node.compose(
                Coarse("zz", "r"),
                [
                    (b"k", Node.compose(Coarse("é", ""), [])),
                    (b"l", Node.compose(Coarse("", ""), [])),
                ],
            ),
        ),
        Case("random coarse", COARSE, random_tree(rng, coarse_payload, 2, 2)),
        Case("random option", OPTION_BYTES, random_tree(rng, option_payload, 2, 2)),
    ]


def node_count(tree: Node[Any]) -> int:
    total, stack = 0, [tree]
    while stack:
        current = stack.pop()
        total += 1
        stack.extend(child for _, child in current.entries())
    return total


def depth_of(tree: Node[Any]) -> int:
    """The depth of the tree a value denotes, in edges, over every occurrence."""
    deepest, stack = 0, [(tree, 0)]
    while stack:
        current, depth = stack.pop()
        deepest = max(deepest, depth)
        stack.extend((child, depth + 1) for _, child in current.entries())
    return deepest


def subtrees(tree: Node[Any]) -> Iterable[Node[Any]]:
    stack = [tree]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(child for _, child in current.entries())


def summary(result: object) -> object:
    """A verdict in a comparable form: an accepted value by its canonical re-encoding,
    which law 1 makes a function of its ≈-class."""
    if isinstance(result, Accepted):
        return ("accepted", encode_flat(result.value, result.codec))
    return result


def splits(data: bytes) -> Iterable[list[bytes]]:
    """Every two-piece split, the three-piece split at the thirds, and one octet at a
    time."""
    for cut in range(len(data) + 1):
        yield [data[:cut], data[cut:]]
    third = len(data) // 3
    yield [data[:third], data[third : 2 * third], data[2 * third :]]
    yield [data[index : index + 1] for index in range(len(data))]


def streamed(pieces: Iterable[bytes], registry: Any, limits: Limits = FLOORS) -> object:
    decoder = FlatDecoder(registry, limits)
    for piece in pieces:
        decoder.feed(piece)
    return decoder.finish()


def flat_header(slot_codec_id: bytes) -> bytes:
    """``"dxf2" ‖ cuvarint(len(id)) ‖ id`` for an id spelled by §13's rules."""
    return FLAT_MAGIC + encode_uvarint(len(slot_codec_id)) + slot_codec_id


def digest_address(octets: bytes) -> Address:
    return Address("dxl2", hashlib.sha256(octets).digest())


def varint_spans(tree: Node[Any], codec: Any) -> list[tuple[int, int]]:
    """Where every cuvarint of ``encF(tree)`` lies, found by this test's own walk of
    §5's grammar rather than by decoding: the extents a closed prefix is judged by."""
    spans: list[tuple[int, int]] = []
    offset = len(FLAT_MAGIC)

    def integer(value: int) -> None:
        nonlocal offset
        size = len(encode_uvarint(value))
        spans.append((offset, offset + size))
        offset += size

    def framed(octets: bytes) -> None:
        nonlocal offset
        integer(len(octets))
        offset += len(octets)

    def head(node: Node[Any]) -> Iterator[tuple[bytes, Node[Any]]]:
        framed(codec.encode(node.own))
        entries = node.entries()
        integer(len(entries))
        return iter(entries)

    framed(codec.id)
    stack = [head(tree)]
    while stack:
        entry = next(stack[-1], None)
        if entry is None:
            stack.pop()
            continue
        framed(entry[0])
        stack.append(head(entry[1]))
    return spans


# --- §3: the integer domain -----------------------------------------------------------


class IntegerTests(unittest.TestCase):
    def test_every_width_boundary_round_trips(self) -> None:
        values = {0, 1, MAX_UVARINT}
        for width in range(1, 11):
            top = 2 ** (7 * width)
            values.update(v for v in (top - 1, top) if v <= MAX_UVARINT)
        for value in sorted(values):
            spelled = encode_uvarint(value)
            self.assertEqual(len(spelled), max(1, -(-value.bit_length() // 7)), value)
            self.assertEqual(read_uvarint(spelled), (value, len(spelled)), value)
            # The spelling ends where its last octet has a clear high bit, so what
            # follows is not read.
            self.assertEqual(
                read_uvarint(spelled + bytes([0x80])), (value, len(spelled))
            )

    def test_a_longer_spelling_of_a_value_is_non_shortest(self) -> None:
        for value in (0, 1, 127, 128, 16383, 2**56, 2**62):
            spelled = bytearray(encode_uvarint(value))
            while len(spelled) < 10:
                # One more zero group: the same value, one octet longer.
                spelled[-1] |= 0x80
                spelled.append(0x00)
                self.assertEqual(
                    read_uvarint(bytes(spelled)),
                    Invalid("non_shortest_uvarint"),
                    spelled.hex(),
                )

    def test_an_eleventh_continuation_octet_is_malformed(self) -> None:
        ten_continuing = bytes([0x80] * 10)
        self.assertEqual(read_uvarint(ten_continuing), Invalid("malformed_uvarint"))
        # Decided at the tenth octet, whatever would follow it.
        self.assertEqual(
            read_uvarint(ten_continuing + bytes([0x00])), Invalid("malformed_uvarint")
        )
        self.assertEqual(
            read_uvarint(bytes([0xFF] * 10) + bytes([0x01])),
            Invalid("malformed_uvarint"),
        )

    def test_a_value_past_the_domain_overflows(self) -> None:
        for last in range(0x02, 0x80):
            self.assertEqual(
                read_uvarint(bytes([0xFF] * 9 + [last])), Invalid("uvarint_overflow")
            )
        # The tenth group may be 1 — 2^63 and up — and no more.
        self.assertEqual(read_uvarint(bytes([0xFF] * 9 + [0x01])), (MAX_UVARINT, 10))

    def test_input_ending_inside_an_integer(self) -> None:
        # §5: cut off by the end of input after one or more octets with the
        # continuation bit set, a cuvarint is malformed_uvarint; absent altogether, it
        # is unexpected_eof.
        self.assertEqual(read_uvarint(b""), Invalid("unexpected_eof"))
        for value in (128, 2**35, MAX_UVARINT):
            spelled = encode_uvarint(value)
            self.assertEqual(
                read_uvarint(spelled, len(spelled)), Invalid("unexpected_eof")
            )
            for cut in range(1, len(spelled)):
                self.assertEqual(
                    read_uvarint(spelled[:cut]), Invalid("malformed_uvarint"), cut
                )

    def test_the_encoder_refuses_outside_the_domain(self) -> None:
        for value in (-1, 2**64, 2**70):
            with self.assertRaises(ValueError):
                encode_uvarint(value)


# --- §9, §12: codes and classes -------------------------------------------------------


def _section(number: int) -> str:
    text = _CODEC_MD.read_text(encoding="utf-8")
    start = text.index(f"\n## {number}. ")
    return text[start : text.index(f"\n## {number + 1}. ", start)]


class VerdictTests(unittest.TestCase):
    def test_the_invalid_codes_are_section_9s(self) -> None:
        section = _section(9)
        invalid = section[
            section.index("**invalid:**") : section.index("**unsupported:**")
        ]
        codes = set(re.findall(r"`([a-z_]+)`", invalid))
        self.assertEqual(codes, set(INVALID_CODES))
        self.assertEqual(
            set(typing.get_args(InvalidCode.__value__)), set(INVALID_CODES)
        )

    def test_the_dimensions_are_section_12s(self) -> None:
        tokens = re.findall(r"^\| [^|]+ \| `([a-z_]+)` \|", _section(12), re.MULTILINE)
        self.assertEqual(tuple(tokens), DIMENSIONS)
        self.assertEqual(len(DIMENSIONS), 13)

    def test_every_code_has_exactly_its_class(self) -> None:
        for code in INVALID_CODES:
            self.assertEqual(class_of(code), "invalid")
            self.assertEqual(Invalid(code).verdict_class, "invalid")  # type: ignore[arg-type]
        self.assertEqual(class_of("unsupported_slot_codec"), "unsupported")
        self.assertEqual(class_of("need_more_input"), "incomplete")
        self.assertEqual(class_of("limit_exceeded"), "resource-refused")
        self.assertEqual(UNSUPPORTED.verdict_class, "unsupported")
        self.assertEqual(NEED_MORE_INPUT.verdict_class, "incomplete")
        self.assertEqual(
            ResourceRefused("key_length").verdict_class, "resource-refused"
        )

    def test_store_codes_are_not_decoder_verdicts(self) -> None:
        for code in (
            "missing_chunk",
            "hash_mismatch",
            "address_conflict",
            "unknown_tag",
        ):
            with self.assertRaises(ValueError):
                class_of(code)

    def test_the_four_classes_are_four_types(self) -> None:
        kinds = {Invalid, Unsupported, Incomplete, ResourceRefused}
        self.assertEqual(len(kinds), 4)
        for left in kinds:
            for right in kinds - {left}:
                self.assertFalse(issubclass(left, right))

    def test_limits_default_to_the_floors_and_stay_in_the_domain(self) -> None:
        self.assertEqual(FLOORS, Limits())
        self.assertEqual(FLOORS.slot_codec_id_length, 32)
        self.assertEqual(FLOORS.logical_depth, 256)
        for bad in (-1, 2**64, True):
            with self.assertRaises(ValueError):
                Limits(key_length=bad)


# --- §5, §8 law 1: the flat form ------------------------------------------------------


class FlatLawTests(unittest.TestCase):
    def test_round_trip_and_canonical_re_encoding(self) -> None:
        for case in generated_cases():
            with self.subTest(case.name):
                data = encode_flat(case.tree, case.codec)
                decoded = decode_flat(data, REGISTRY)
                assert isinstance(decoded, Accepted), decoded
                self.assertTrue(decoded.value.equal_by(case.tree, case.codec.equal))
                self.assertEqual(decoded.codec.id, case.codec.id)
                self.assertEqual(encode_flat(decoded.value, decoded.codec), data)

    def test_sibling_order_is_not_observable(self) -> None:
        rng = random.Random(3)
        for case in generated_cases()[:20]:
            own, children = case.tree.decompose()
            rng.shuffle(children)
            self.assertEqual(
                encode_flat(Node.compose(own, children), case.codec),
                encode_flat(case.tree, case.codec),
            )

    def test_equal_octets_iff_equivalent_values(self) -> None:
        # Exhaustive over small trees: ≈ merges representations, never classes, keys
        # or shapes.
        values = [Coarse(c, r) for c in ("a", "b") for r in ("x", "y")]
        leaves = [Node.compose(v, []) for v in values]
        trees: list[Node[Coarse]] = list(leaves)
        for v in values:
            for child in leaves:
                trees.append(Node.compose(v, [(b"", child)]))
                trees.append(Node.compose(v, [(b"k", child)]))
                for other in leaves:
                    trees.append(Node.compose(v, [(b"", child), (b"k", other)]))
        encoded = [encode_flat(tree, COARSE) for tree in trees]
        merged = 0
        for i, left in enumerate(trees):
            for j, right in enumerate(trees):
                same = left.equal_by(right, COARSE.equal)
                self.assertEqual(encoded[i] == encoded[j], same, (i, j))
                merged += same and i != j
        self.assertGreater(merged, 0, "no ≈-equal pair of distinct representatives")

    def test_every_payload_is_judged_at_nodes_with_children_too(self) -> None:
        # §5 rule 5: im(e) at every node. The root has children here.
        tree = Node.compose(
            Coarse("zz", ""), [(b"k", Node.compose(Coarse("a", ""), []))]
        )
        data = encode_flat(tree, COARSE)
        at = data.index(b"zz")
        broken = data[:at] + bytes([0xFF, 0xFF]) + data[at + 2 :]
        self.assertEqual(
            decode_flat(broken, REGISTRY), Invalid("non_canonical_payload")
        )
        # A codec-blind reader cannot see it, and says so rather than accept.
        self.assertEqual(decode_flat(broken, {}), UNSUPPORTED)

    def test_option_of_accepts_exactly_its_two_shapes(self) -> None:
        tree = Node.compose(Some(b"v"), [])
        data = encode_flat(tree, OPTION_BYTES)
        tag_at = len(flat_header(OPTION_BYTES.id)) + 1  # after the payload's length
        for tag in range(256):
            mutated = data[:tag_at] + bytes([tag]) + data[tag_at + 1 :]
            verdict = decode_flat(mutated, REGISTRY)
            if tag == 0x01:
                self.assertIsInstance(verdict, Accepted)
            else:
                # 00 is None only as the whole payload; here one octet follows it.
                self.assertEqual(verdict, Invalid("non_canonical_payload"), tag)

    def test_a_blind_reader_judges_all_framing_and_then_says_unsupported(self) -> None:
        for case in generated_cases()[:30]:
            self.assertEqual(
                decode_flat(encode_flat(case.tree, case.codec), {}), UNSUPPORTED
            )

    def test_the_encoder_fails_locally_on_an_id_it_cannot_write(self) -> None:
        @dataclass(frozen=True)
        class BadId:
            id: bytes

            def equal(self, a: bytes, b: bytes) -> bool:
                return a == b

            def encode(self, value: bytes) -> bytes:
                return value

            def decode(self, payload: bytes) -> bytes:
                return payload

        for bad in (
            bytes([0x00]),  # too short
            bytes([0x00, 0x00]),  # n = 0
            bytes([0x00, 0x01, 0x00]),  # left over
            bytes([0x03, 0x01]),  # reserved form
            bytes([0x00, 0x81, 0x00]),  # n = 1, not in shortest form
            bytes([0x02] * 31 + [0x00, 0x01]),  # 33 octets
        ):
            with self.assertRaises(ValueError, msg=bad.hex()):
                encode_flat(Node.compose(b"", []), BadId(bad))
        with self.assertRaises(ValueError):
            option_of(BadId(bytes([0x02] * 30 + [0x00, 0x01])))  # 1 + 32 octets
        self.assertEqual(
            len(option_of(BadId(bytes([0x02] * 29 + [0x00, 0x01]))).id), 32
        )


# --- mutation: law 1's exactness, and framing without the codec (§11) -----------------


class MutationTests(unittest.TestCase):
    def test_every_single_octet_change_refuses_or_re_encodes_exactly(self) -> None:
        for case in small_cases():
            data = encode_flat(case.tree, case.codec)
            for at in range(len(data)):
                for octet in range(256):
                    if octet == data[at]:
                        continue
                    mutated = data[:at] + bytes([octet]) + data[at + 1 :]
                    verdict = decode_flat(mutated, REGISTRY)
                    if isinstance(verdict, Accepted):
                        self.assertEqual(
                            encode_flat(verdict.value, verdict.codec),
                            mutated,
                            f"{case.name}: {mutated.hex()}",
                        )
                    else:
                        self.assertNotIsInstance(verdict, Incomplete)
                    # §11: framing is decided without the codec. A blind reader reports
                    # every framing fault the holding one does, else unsupported.
                    blind = decode_flat(mutated, {})
                    if isinstance(
                        verdict, Accepted | Unsupported
                    ) or verdict == Invalid("non_canonical_payload"):
                        self.assertEqual(blind, UNSUPPORTED, mutated.hex())
                    else:
                        self.assertEqual(blind, verdict, mutated.hex())

    def test_every_closed_proper_prefix_and_any_extra_octet(self) -> None:
        # §5: a closed prefix cut inside a cuvarint, after one or more of its octets, is
        # malformed_uvarint; cut anywhere else it is unexpected_eof — inside a
        # length-framed field too, whatever the field's present octets show.
        for case in small_cases() + generated_cases()[:8]:
            data = encode_flat(case.tree, case.codec)
            spans = varint_spans(case.tree, case.codec)
            self.assertEqual(spans[-1][1], len(data))
            for cut in range(len(data)):
                inside = any(start < cut < end for start, end in spans)
                self.assertEqual(
                    decode_flat(data[:cut], REGISTRY),
                    Invalid("malformed_uvarint" if inside else "unexpected_eof"),
                    f"{case.name}: cut {cut}",
                )
            for octet in (0x00, 0x01, 0x80, 0xFF):
                self.assertEqual(
                    decode_flat(data + bytes([octet]), REGISTRY),
                    Invalid("trailing_bytes"),
                )

    def test_every_single_octet_change_of_a_chunk_refuses_or_re_encodes_exactly(
        self,
    ) -> None:
        # The chunk analogue of law 1's exactness (§6 rules 2-7): a mutated chunk that
        # frames canonically is exactly the chunk its parsed parts re-encode to.
        tree = Node.compose(
            b"r",
            [
                (b"a", Node.compose(b"x", [])),
                (b"b", Node.compose(b"x", [])),
                (b"c", Node.compose(b"y", [])),
            ],
        )
        linked = encode_linked(tree, IDENTITY_BYTES)
        root = linked.chunks[linked.root]
        stand_in = encode_chunk(IDENTITY_BYTES.id, b"", [])
        stand_in_prefix = len(LINKED_MAGIC) + 1 + len(IDENTITY_BYTES.id)
        accepted = 0
        for at in range(len(root)):
            for octet in range(256):
                if octet == root[at]:
                    continue
                mutated = root[:at] + bytes([octet]) + root[at + 1 :]
                address = digest_address(mutated)
                verdict = resolve_root(address, {address: mutated}.get)
                if not isinstance(verdict, Chunk):
                    self.assertIsInstance(verdict, Invalid | ResourceRefused)
                    continue
                accepted += 1
                # Re-encode under a defined id, then put the parsed id back: a reserved
                # form frames, but no encoder writes one.
                rebuilt = encode_chunk(
                    IDENTITY_BYTES.id, verdict.payload, verdict.children
                )
                prefix = (
                    LINKED_MAGIC
                    + encode_uvarint(len(verdict.slot_codec_id))
                    + verdict.slot_codec_id
                )
                self.assertEqual(
                    prefix + rebuilt[stand_in_prefix:], mutated, mutated.hex()
                )
        self.assertGreater(accepted, 0)
        self.assertEqual(len(stand_in), stand_in_prefix + 3)


# --- §14: streaming -------------------------------------------------------------------


class StreamingTests(unittest.TestCase):
    def _inputs(self) -> list[bytes]:
        inputs: list[bytes] = []
        rng = random.Random(11)
        for case in small_cases() + generated_cases()[6:30]:
            data = encode_flat(case.tree, case.codec)
            if len(data) > 200:
                continue  # every split of every input is quadratic; keep them small
            inputs.append(data)
            inputs.append(data + bytes([0x00]))
            inputs.extend(
                data[:cut] for cut in range(0, len(data), max(1, len(data) // 6))
            )
            for _ in range(12):
                at = rng.randrange(len(data))
                inputs.append(data[:at] + bytes([rng.randrange(256)]) + data[at + 1 :])
        return inputs

    def test_every_split_reaches_the_whole_buffer_verdict(self) -> None:
        for data in self._inputs():
            for registry in (REGISTRY, {}):
                whole = summary(decode_flat(data, registry))
                for pieces in splits(data):
                    self.assertEqual(
                        summary(streamed(pieces, registry)),
                        whole,
                        f"{data.hex()} cut {[len(p) for p in pieces]}",
                    )

    def test_every_split_agrees_under_limits_too(self) -> None:
        case = small_cases()[0]
        data = encode_flat(case.tree, case.codec)
        for bound in range(len(data) + 2):
            limits = replace(FLOORS, flat_artifact_octets=bound)
            whole = summary(decode_flat(data, REGISTRY, limits))
            for pieces in splits(data):
                self.assertEqual(
                    summary(streamed(pieces, REGISTRY, limits)), whole, bound
                )
            if bound < len(data):
                self.assertEqual(whole, ResourceRefused("flat_artifact_octets"))

    def test_need_more_input_until_the_end_is_declared(self) -> None:
        for case in small_cases():
            data = encode_flat(case.tree, case.codec)
            decoder = FlatDecoder(REGISTRY)
            for index in range(len(data)):
                self.assertEqual(decoder.feed(data[index : index + 1]), NEED_MORE_INPUT)
            # The whole artifact is here, and still undecided: one more octet would make
            # it trailing_bytes.
            self.assertEqual(decoder.feed(b""), NEED_MORE_INPUT)
            self.assertIsInstance(decoder.finish(), Accepted)
            with self.assertRaises(ValueError):
                decoder.feed(b"")

    def test_a_trailing_octet_is_final_at_once(self) -> None:
        data = encode_flat(small_cases()[0].tree, IDENTITY_BYTES)
        decoder = FlatDecoder(REGISTRY)
        self.assertEqual(decoder.feed(data), NEED_MORE_INPUT)
        self.assertEqual(decoder.feed(bytes([0x00])), Invalid("trailing_bytes"))
        self.assertEqual(decoder.feed(data), Invalid("trailing_bytes"))
        self.assertEqual(decoder.finish(), Invalid("trailing_bytes"))

    def test_a_framing_fault_is_final_at_once(self) -> None:
        tree = Node.compose(
            b"", [(b"a", Node.compose(b"", [])), (b"b", Node.compose(b"", []))]
        )
        data = encode_flat(tree, IDENTITY_BYTES)
        key_at = data.index(b"b")
        # Rewrite the second key to equal the first: duplicate_key at that entry.
        broken = data[:key_at] + b"a" + data[key_at + 1 :]
        decoder = FlatDecoder(REGISTRY)
        self.assertEqual(decoder.feed(broken[: key_at + 1]), Invalid("duplicate_key"))
        self.assertEqual(decoder.finish(), Invalid("duplicate_key"))
        # And one preceding it is unsorted_keys.
        unsorted = data[:key_at] + bytes([ord("a") - 1]) + data[key_at + 1 :]
        self.assertEqual(decode_flat(unsorted, REGISTRY), Invalid("unsorted_keys"))

    def test_a_cut_cuvarint_is_malformed_once_the_end_is_declared(self) -> None:
        # §5: a cuvarint states no length, so it is judged by the octets present:
        # absent, unexpected_eof; cut after one continuation octet, malformed_uvarint.
        # Open, both are need_more_input (§14).
        data = encode_flat(Node.compose(bytes(200), []), IDENTITY_BYTES)
        at = len(flat_header(IDENTITY_BYTES.id))  # the payload's two-octet length
        self.assertEqual(decode_flat(data[:at], REGISTRY), Invalid("unexpected_eof"))
        self.assertEqual(
            decode_flat(data[: at + 1], REGISTRY), Invalid("malformed_uvarint")
        )
        for cut, final in ((at, "unexpected_eof"), (at + 1, "malformed_uvarint")):
            decoder = FlatDecoder(REGISTRY)
            self.assertEqual(decoder.feed(data[:cut]), NEED_MORE_INPUT)
            self.assertEqual(decoder.finish(), Invalid(final))  # type: ignore[arg-type]

    def test_a_length_framed_field_is_judged_only_at_its_stated_extent(self) -> None:
        # §5: cut off before its stated extent, the id, a payload or a key is
        # unexpected_eof whatever its present octets already show.
        id_so_far = FLAT_MAGIC + encode_uvarint(3) + bytes([0x00, 0x00])  # n = 0 ...
        self.assertEqual(decode_flat(id_so_far, REGISTRY), Invalid("unexpected_eof"))
        self.assertEqual(read_header(id_so_far, REGISTRY), Invalid("unexpected_eof"))
        self.assertEqual(
            read_header(id_so_far + bytes([0x01]), REGISTRY),
            Invalid("malformed_slot_codec_id"),
        )
        tree = Node.compose(
            b"", [(b"b", Node.compose(b"", [])), (b"cc", Node.compose(b"", []))]
        )
        data = encode_flat(tree, IDENTITY_BYTES)
        at = data.index(b"cc")
        unsorted = data[:at] + b"a" + data[at + 1 :]  # "ac" sorts before "b"
        self.assertEqual(decode_flat(unsorted, REGISTRY), Invalid("unsorted_keys"))
        self.assertEqual(
            decode_flat(unsorted[: at + 1], REGISTRY), Invalid("unexpected_eof")
        )
        self.assertEqual(
            FlatDecoder(REGISTRY).feed(unsorted[: at + 1]), NEED_MORE_INPUT
        )

    def test_fewer_than_four_octets_is_never_unknown_magic(self) -> None:
        for prefix in (b"", b"d", b"dx", b"dxf", b"x", b"ab", b"abc"):
            decoder = FlatDecoder(REGISTRY)
            self.assertEqual(decoder.feed(prefix), NEED_MORE_INPUT, prefix)
            self.assertEqual(decoder.finish(), Invalid("unexpected_eof"), prefix)
        for wrong in (b"dxf1", b"dxl2", b"abcd", b"DXF2"):
            self.assertEqual(
                FlatDecoder(REGISTRY).feed(wrong), Invalid("unknown_magic")
            )


# --- §2.1, §13: the header and the id grammar -----------------------------------------


class HeaderTests(unittest.TestCase):
    def test_the_header_of_every_encoding(self) -> None:
        for case in generated_cases()[:24]:
            data = encode_flat(case.tree, case.codec)
            header = read_header(data, REGISTRY)
            assert isinstance(header, Header), header
            self.assertEqual(header.slot_codec_id, case.codec.id)
            self.assertEqual(read_header(data, {}), UNSUPPORTED)
            head = flat_header(case.codec.id)
            # Decided as soon as the header is read, and not before.
            reader = HeaderReader(REGISTRY)
            for index in range(len(head) - 1):
                self.assertEqual(reader.feed(head[index : index + 1]), NEED_MORE_INPUT)
            self.assertIsInstance(reader.feed(head[-1:]), Header)
            for cut in range(len(head)):
                self.assertEqual(
                    read_header(head[:cut], REGISTRY), Invalid("unexpected_eof")
                )

    def test_the_id_grammar(self) -> None:
        namespace = bytes(range(0x10, 0x20))
        expectations: list[tuple[bytes, object]] = [
            # §13's forms, well formed.
            (IDENTITY_BYTES.id, "held"),
            (OPTION_BYTES.id, "held"),
            (OPTION_OPTION_BYTES.id, "held"),
            (COARSE.id, "held"),
            (
                bytes([0x02] * 30 + [0x00, 0x01]),
                "held",
            ),  # nesting at the 32-octet bound
            (bytes([0x00, 0x02]), UNSUPPORTED),  # assigned, not implemented here
            (bytes([0x00]) + encode_uvarint(2**64 - 1), UNSUPPORTED),
            (bytes([0x01]) + namespace + bytes([0x01]), UNSUPPORTED),
            (bytes([0x02, 0x00, 0x05]), UNSUPPORTED),  # option-of an unheld id
            # Reserved first octets end the structural judgment: unsupported, never
            # invalid, whatever follows.
            (bytes([0x03, 0x00]), UNSUPPORTED),
            (bytes([0xFF] * 32), UNSUPPORTED),
            (bytes([0x02, 0x03]), UNSUPPORTED),
            (bytes([0x02, 0x02, 0x7F, 0x80]), UNSUPPORTED),
            # Impossible ids.
            (bytes([0x00, 0x00]), Invalid("malformed_slot_codec_id")),  # n = 0
            (bytes([0x02, 0x00, 0x00]), Invalid("malformed_slot_codec_id")),
            (
                bytes([0x00, 0x01, 0x00]),
                Invalid("malformed_slot_codec_id"),
            ),  # left over
            (bytes([0x02, 0x00]), Invalid("malformed_slot_codec_id")),  # 00 alone
            (
                bytes([0x02, 0x02]),
                Invalid("malformed_slot_codec_id"),
            ),  # 02, nothing after
            (bytes([0x01]) + namespace[:14], Invalid("malformed_slot_codec_id")),
            (bytes([0x01]) + namespace[:15], Invalid("malformed_slot_codec_id")),
            (
                bytes([0x01]) + namespace,
                Invalid("malformed_slot_codec_id"),
            ),  # k missing
            (
                bytes([0x01]) + namespace + bytes([0x01, 0x01]),
                Invalid("malformed_slot_codec_id"),
            ),
            # Integer faults inside the id keep their §3 codes.
            (bytes([0x00, 0x80]), Invalid("malformed_uvarint")),  # cut by the id's end
            (bytes([0x02, 0x00, 0x81]), Invalid("malformed_uvarint")),
            (bytes([0x01]) + namespace + bytes([0xFF]), Invalid("malformed_uvarint")),
            (bytes([0x00] + [0x80] * 10), Invalid("malformed_uvarint")),  # 11 octets
            (bytes([0x00, 0x81, 0x00]), Invalid("non_shortest_uvarint")),
            (bytes([0x00, 0x80, 0x00]), Invalid("non_shortest_uvarint")),
            (bytes([0x00] + [0xFF] * 9 + [0x02]), Invalid("uvarint_overflow")),
        ]
        for slot_codec_id, expected in expectations:
            with self.subTest(slot_codec_id.hex()):
                verdict = read_header(flat_header(slot_codec_id), REGISTRY)
                if expected == "held":
                    assert isinstance(verdict, Header), verdict
                    self.assertEqual(verdict.codec.id, slot_codec_id)
                else:
                    self.assertEqual(verdict, expected)

    def test_the_length_bound_is_judged_when_the_length_is_read(self) -> None:
        for length in (0, 1, 33, 1000, 2**64 - 1):
            head = FLAT_MAGIC + encode_uvarint(length)
            # No id octet has arrived, and none is waited for.
            self.assertEqual(
                HeaderReader(REGISTRY).feed(head), Invalid("malformed_slot_codec_id")
            )
            self.assertEqual(
                FlatDecoder(REGISTRY).feed(head), Invalid("malformed_slot_codec_id")
            )
        self.assertEqual(
            read_header(FLAT_MAGIC + bytes([0x80, 0x00]), REGISTRY),
            Invalid("non_shortest_uvarint"),
        )

    def test_framing_outranks_unsupported_at_the_artifact_scale(self) -> None:
        # Read first, ruled last: the unheld id is read before the body, and the body's
        # framing fault still wins.
        tree = Node.compose(b"p", [(b"k", Node.compose(b"q", []))])
        data = encode_flat(tree, UNHELD)
        self.assertEqual(decode_flat(data, REGISTRY), UNSUPPORTED)
        self.assertEqual(decode_flat(data[:-1], REGISTRY), Invalid("unexpected_eof"))
        self.assertEqual(decode_flat(data + b"x", REGISTRY), Invalid("trailing_bytes"))
        reserved = FLAT_MAGIC + encode_uvarint(2) + bytes([0x03, 0x00])
        body = data[len(flat_header(UNHELD.id)) :]
        self.assertEqual(decode_flat(reserved + body, REGISTRY), UNSUPPORTED)
        self.assertEqual(
            decode_flat(reserved + body[:-1], REGISTRY), Invalid("unexpected_eof")
        )

    def test_lookup_derives_option_of_and_never_holds_a_reserved_form(self) -> None:
        held = lookup(REGISTRY, bytes([0x02, 0x02]) + COARSE.id)
        assert held is not None
        self.assertEqual(held.id, bytes([0x02, 0x02]) + COARSE.id)
        self.assertIsNone(
            lookup({bytes([0x03, 0x00]): IDENTITY_BYTES}, bytes([0x03, 0x00]))
        )
        self.assertIsNone(lookup(REGISTRY, bytes([0x02, 0x00, 0x05])))
        with self.assertRaises(ValueError):
            registry_of(OPTION_BYTES)
        with self.assertRaises(ValueError):
            registry_of(IDENTITY_BYTES, IDENTITY_BYTES)


# --- §6, §7, §12, §14, law 2: the linked form -----------------------------------------


class LinkedTests(unittest.TestCase):
    def test_round_trip_through_chunks_and_the_bridge(self) -> None:
        for case in generated_cases():
            with self.subTest(case.name):
                linked = encode_linked(case.tree, case.codec)
                fetch = linked.chunks.get
                value = materialize(linked.root, fetch, REGISTRY)
                assert isinstance(value, Accepted), value
                self.assertTrue(value.value.equal_by(case.tree, case.codec.equal))
                flat = encode_flat(case.tree, case.codec)
                # The bridge (law 2): decoding a closure agrees with flat decoding, and
                # flattening writes the flat form's octets.
                self.assertEqual(flatten(linked.root, fetch, REGISTRY), flat)
                self.assertEqual(
                    estimate_unfolded(linked.root, fetch),
                    Unfolded(node_count(case.tree), len(flat), depth_of(case.tree)),
                )
                self.assertEqual(
                    check_closure(linked.root, fetch),
                    ClosurePresent(linked.root, case.codec.id, len(linked.chunks)),
                )

    def test_one_chunk_per_distinct_subtree(self) -> None:
        for case in generated_cases():
            distinct = {encode_flat(sub, case.codec) for sub in subtrees(case.tree)}
            linked = encode_linked(case.tree, case.codec)
            self.assertEqual(len(linked.chunks), len(distinct), case.name)
            for address, chunk in linked.chunks.items():
                self.assertEqual(address, digest_address(chunk))
        # Equal subtrees under different keys, as distinct objects: one chunk.
        twice = Node.compose(
            b"", [(b"a", Node.compose(b"s", [])), (b"b", Node.compose(b"s", []))]
        )
        self.assertEqual(len(encode_linked(twice, IDENTITY_BYTES).chunks), 2)

    def test_equal_addresses_iff_equivalent_values(self) -> None:
        rng = random.Random(5)
        trees = [random_tree(rng, coarse_payload, 2, 2) for _ in range(60)]
        roots = [encode_linked(tree, COARSE).root for tree in trees]
        merged = 0
        for i, left in enumerate(trees):
            for j, right in enumerate(trees):
                same = left.equal_by(right, COARSE.equal)
                self.assertEqual(roots[i] == roots[j], same, (i, j))
                merged += same and i != j
        self.assertGreater(merged, 0)

    def test_an_address_is_a_version_qualified_pair_and_a_flat_digest_is_none(
        self,
    ) -> None:
        tree = generated_cases()[6].tree  # under identity-bytes
        linked = encode_linked(tree, IDENTITY_BYTES)
        self.assertEqual(linked.root.space, "dxl2")
        self.assertEqual(linked.root, digest_address(linked.chunks[linked.root]))
        flat_digest = hashlib.sha256(encode_flat(tree, IDENTITY_BYTES)).digest()
        self.assertNotEqual(flat_digest, linked.root.digest)
        with self.assertRaises(ValueError):
            Address("dxl2", linked.root.digest[:31])
        with self.assertRaises(ValueError):
            Address("dxl1", linked.root.digest)  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            Address("dxl2", bytearray(linked.root.digest))  # type: ignore[arg-type]

    def test_a_tampered_chunk_is_hash_mismatch_and_a_missing_one_missing_chunk(
        self,
    ) -> None:
        tree = Node.compose(
            b"r", [(b"a", Node.compose(b"x", [(b"k", Node.compose(b"y", []))]))]
        )
        linked = encode_linked(tree, IDENTITY_BYTES)
        for address, chunk in linked.chunks.items():
            tampered = dict(linked.chunks)
            tampered[address] = chunk[:-1] + bytes([chunk[-1] ^ 0x01])
            missing = {a: c for a, c in linked.chunks.items() if a != address}
            for operation in (
                lambda fetch: materialize(linked.root, fetch, REGISTRY),
                lambda fetch: flatten(linked.root, fetch, REGISTRY),
                lambda fetch: check_closure(linked.root, fetch),
                lambda fetch: estimate_unfolded(linked.root, fetch),
            ):
                self.assertEqual(
                    operation(tampered.get), StoreFault("hash_mismatch", address)
                )
                self.assertEqual(
                    operation(missing.get), StoreFault("missing_chunk", address)
                )
        # The root is verified against the address the caller asked for.
        self.assertEqual(
            resolve_root(
                linked.root, lambda _: encode_chunk(IDENTITY_BYTES.id, b"r", [])
            ),
            StoreFault("hash_mismatch", linked.root),
        )

    def test_navigation_verifies_each_chunk_against_the_hash_that_reached_it(
        self,
    ) -> None:
        tree = Node.compose(
            b"r", [(b"a", Node.compose(b"x", [])), (b"b", Node.compose(b"y", []))]
        )
        linked = encode_linked(tree, IDENTITY_BYTES)
        root = resolve_root(linked.root, linked.chunks.get)
        assert isinstance(root, Chunk), root
        self.assertEqual(root.payload, b"r")
        self.assertEqual([key for key, _ in root.children], [b"a", b"b"])
        child = resolve_child(root, b"b", linked.chunks.get)
        assert isinstance(child, Chunk), child
        self.assertEqual(IDENTITY_BYTES.decode(child.payload), b"y")
        self.assertIsNone(resolve_child(root, b"c", linked.chunks.get))
        swapped = dict(linked.chunks)
        a, b = root.child(b"a"), root.child(b"b")
        assert a is not None and b is not None
        swapped[b] = linked.chunks[a]
        self.assertEqual(
            resolve_child(root, b"b", swapped.get), StoreFault("hash_mismatch", b)
        )

    def test_a_child_under_another_id_is_slot_codec_mismatch_ruled_last(self) -> None:
        none_payload = OPTION_BYTES.encode(None)
        registry = registry_of(IDENTITY_BYTES)

        def closure(child: bytes) -> tuple[Address, dict[Address, bytes]]:
            parent = encode_chunk(
                OPTION_BYTES.id, none_payload, [(b"k", digest_address(child))]
            )
            return digest_address(parent), {
                digest_address(parent): parent,
                digest_address(child): child,
            }

        foreign = encode_chunk(IDENTITY_BYTES.id, b"c", [])
        root, store = closure(foreign)
        self.assertEqual(
            materialize(root, store.get, registry), Invalid("slot_codec_mismatch")
        )
        self.assertEqual(check_closure(root, store.get), Invalid("slot_codec_mismatch"))
        parent = resolve_root(root, store.get)
        assert isinstance(parent, Chunk)
        self.assertEqual(
            resolve_child(parent, b"k", store.get), Invalid("slot_codec_mismatch")
        )
        # Read first, ruled last: the child's own framing fault outranks the mismatch,
        # under an id no reader holds as much as under a held one.
        for child_id in (IDENTITY_BYTES.id, UNHELD.id):
            trailing = encode_chunk(child_id, b"c", []) + bytes([0x00])
            root, store = closure(trailing)
            self.assertEqual(
                materialize(root, store.get, registry), Invalid("trailing_bytes")
            )
            self.assertEqual(check_closure(root, store.get), Invalid("trailing_bytes"))
            truncated = encode_chunk(child_id, b"c", [])[:-1]
            root, store = closure(truncated)
            self.assertEqual(
                materialize(root, store.get, registry), Invalid("unexpected_eof")
            )

    def test_payloads_are_judged_by_a_holding_resolver_only(self) -> None:
        good = encode_chunk(COARSE.id, COARSE.encode(Coarse("a", "")), [])
        bad = encode_chunk(COARSE.id, bytes([0xC0, 0x80]), [])  # overlong: not UTF-8
        parent = encode_chunk(
            COARSE.id,
            COARSE.encode(Coarse("p", "")),
            [(b"g", digest_address(good)), (b"h", digest_address(bad))],
        )
        store = {digest_address(c): c for c in (good, bad, parent)}
        root = digest_address(parent)
        self.assertEqual(
            materialize(root, store.get, REGISTRY), Invalid("non_canonical_payload")
        )
        self.assertEqual(
            flatten(root, store.get, REGISTRY), Invalid("non_canonical_payload")
        )
        # A closure-checker reads no payload: the closure is present, not validated.
        self.assertEqual(
            check_closure(root, store.get), ClosurePresent(root, COARSE.id, 3)
        )
        self.assertEqual(materialize(root, store.get, {}), UNSUPPORTED)
        self.assertEqual(flatten(root, store.get, {}), UNSUPPORTED)

    def test_links_header_rules(self) -> None:
        # §6 rules 3-6 through the chunk mutation law above; here, the precedence
        # within the links group where two are observable at one step (§10).
        tree = Node.compose(
            b"r", [(b"a", Node.compose(b"x", [])), (b"b", Node.compose(b"y", []))]
        )
        linked = encode_linked(tree, IDENTITY_BYTES)
        chunk = linked.chunks[linked.root]
        root = resolve_root(linked.root, linked.chunks.get)
        assert isinstance(root, Chunk)
        first, second = root.links

        def verdict(octets: bytes) -> object:
            address = digest_address(octets)
            return resolve_root(address, {address: octets}.get)

        # The same hash twice: duplicate_link_hash.
        self.assertEqual(
            verdict(chunk.replace(second.digest, first.digest)),
            Invalid("duplicate_link_hash"),
        )
        # Swapping only the header re-points the entries: the canonical chunk of
        # another value, not a fault.
        at = chunk.index(first.digest)
        reheaded = chunk[:at] + second.digest + first.digest + chunk[at + 64 :]
        other = verdict(reheaded)
        assert isinstance(other, Chunk), other
        self.assertEqual(other.children, ((b"a", second), (b"b", first)))
        # The body ends in its two lentries, `cuvarint(1) ‖ key ‖ cuvarint(index)` each,
        # so its indices are the last octet and the fourth from last. Swapped, the first
        # entry uses index 1 before index 0: links_out_of_order.
        reindexed = bytearray(chunk)
        reindexed[-4], reindexed[-1] = reindexed[-1], reindexed[-4]
        self.assertEqual(verdict(bytes(reindexed)), Invalid("links_out_of_order"))
        # The last entry's index past the header: bad_link_index.
        self.assertEqual(verdict(chunk[:-1] + bytes([0x02])), Invalid("bad_link_index"))
        # Both entries on index 0: index 1 is listed and never used.
        self.assertEqual(verdict(chunk[:-1] + bytes([0x00])), Invalid("unused_link"))

    def test_a_sharing_bomb_is_refused_before_materialization(self) -> None:
        node = Node.compose(b"", [])
        for _ in range(70):
            node = Node.compose(b"", [(b"a", node), (b"b", node)])
        started = time.perf_counter()
        linked = encode_linked(node, IDENTITY_BYTES)
        self.assertEqual(len(linked.chunks), 71)
        fetch = linked.chunks.get
        self.assertEqual(
            materialize(linked.root, fetch, REGISTRY),
            ResourceRefused("unfolded_node_count"),
        )
        self.assertEqual(
            flatten(linked.root, fetch, REGISTRY),
            ResourceRefused("unfolded_flat_octets"),
        )
        self.assertEqual(
            estimate_unfolded(linked.root, fetch), Unfolded(SATURATED, SATURATED, 70)
        )
        self.assertEqual(
            check_closure(linked.root, fetch),
            ClosurePresent(linked.root, IDENTITY_BYTES.id, 71),
        )
        self.assertLess(time.perf_counter() - started, 5.0)

    def test_encode_chunk_orders_children_and_refuses_duplicates(self) -> None:
        a = digest_address(encode_chunk(IDENTITY_BYTES.id, b"a", []))
        b = digest_address(encode_chunk(IDENTITY_BYTES.id, b"b", []))
        self.assertEqual(
            encode_chunk(IDENTITY_BYTES.id, b"", [(b"y", b), (b"x", a)]),
            encode_chunk(IDENTITY_BYTES.id, b"", [(b"x", a), (b"y", b)]),
        )
        with self.assertRaises(DuplicateKeyError):
            encode_chunk(IDENTITY_BYTES.id, b"", [(b"x", a), (b"x", b)])

    def test_encode_chunk_orders_keys_as_unsigned_octets(self) -> None:
        # §2's order is unsigned octets. Permuting the input cannot show a wrong order,
        # since a wrong comparator is permutation-invariant too; these keys can, because
        # signed octets and host strings each disagree with 7f < 80 < c3a9. The chunk is
        # read back by the parser, which refuses keys out of order.
        child = digest_address(encode_chunk(IDENTITY_BYTES.id, b"c", []))
        keys = [b"\xc3\xa9", b"\x80", b"\x7f"]
        built = encode_chunk(IDENTITY_BYTES.id, b"", [(key, child) for key in keys])
        opened = resolve_root(digest_address(built), lambda _: built)
        assert isinstance(opened, Chunk), opened
        self.assertEqual([key for key, _ in opened.children], sorted(keys))


# --- §12: the resource envelope -------------------------------------------------------


class LimitTests(unittest.TestCase):
    def _flat(self, tree: Node[Any], codec: Any, dimension: str, at: int) -> None:
        data = encode_flat(tree, codec)
        registry = registry_of(IDENTITY_BYTES)
        self.assertIsInstance(
            decode_flat(data, registry, replace(FLOORS, **{dimension: at})),
            Accepted,
            dimension,
        )
        self.assertEqual(
            decode_flat(data, registry, replace(FLOORS, **{dimension: at - 1})),
            ResourceRefused(dimension),  # type: ignore[arg-type]
        )

    def test_flat_dimensions(self) -> None:
        leaf = Node.compose(b"", [])
        self._flat(
            Node.compose(b"", [(b"12345", leaf)]), IDENTITY_BYTES, "key_length", 5
        )
        self._flat(Node.compose(b"12345", []), IDENTITY_BYTES, "payload_length", 5)
        three = Node.compose(b"", [(b"a", leaf), (b"b", leaf), (b"c", leaf)])
        self._flat(three, IDENTITY_BYTES, "entries_per_node", 3)
        self._flat(three, IDENTITY_BYTES, "unfolded_node_count", 4)
        self._flat(Node.compose(None, []), OPTION_BYTES, "slot_codec_id_length", 3)
        self._flat(chain(9, lambda _: b""), IDENTITY_BYTES, "logical_depth", 9)
        self._flat(Node.compose(bytes(200), []), IDENTITY_BYTES, "varint_value", 200)
        data = encode_flat(three, IDENTITY_BYTES)
        self._flat(three, IDENTITY_BYTES, "flat_artifact_octets", len(data))

    def test_the_floors_are_accepted(self) -> None:
        # Floor numbers belong in implementation tests (vectors/CODEC-PLAN.md).
        registry = registry_of(IDENTITY_BYTES)
        # 256 edges, 257 levels: the depth floor under either way of counting it.
        floor = chain(256, lambda _: b"")
        self.assertIsInstance(
            decode_flat(encode_flat(floor, IDENTITY_BYTES), registry), Accepted
        )
        linked = encode_linked(floor, IDENTITY_BYTES)
        self.assertIsInstance(
            materialize(linked.root, linked.chunks.get, registry), Accepted
        )
        # One edge more is past the floor under either counting, and may be refused.
        past = chain(257, lambda _: b"")
        self.assertEqual(
            decode_flat(encode_flat(past, IDENTITY_BYTES), registry),
            ResourceRefused("logical_depth"),
        )
        long_key = Node.compose(b"", [(bytes(4096), Node.compose(b"", []))])
        self.assertIsInstance(
            decode_flat(encode_flat(long_key, IDENTITY_BYTES), registry), Accepted
        )

    def _linked(
        self, tree: Node[Any], dimension: str, at: int, operation: str = "materialize"
    ) -> None:
        linked = encode_linked(tree, IDENTITY_BYTES)
        registry = registry_of(IDENTITY_BYTES)

        def run(limit: int) -> object:
            limits = replace(FLOORS, **{dimension: limit})
            if operation == "flatten":
                return flatten(linked.root, linked.chunks.get, registry, limits)
            return materialize(linked.root, linked.chunks.get, registry, limits)

        self.assertNotIsInstance(run(at), ResourceRefused, dimension)
        self.assertEqual(run(at - 1), ResourceRefused(dimension))  # type: ignore[arg-type]

    def test_linked_dimensions(self) -> None:
        leaf = Node.compose(b"", [])
        three = Node.compose(
            b"",
            [
                (b"a", Node.compose(b"1", [])),
                (b"b", Node.compose(b"2", [])),
                (b"c", leaf),
            ],
        )
        self._linked(three, "links_per_chunk", 3)
        self._linked(three, "unique_chunks", 4)
        linked = encode_linked(three, IDENTITY_BYTES)
        sizes = [len(chunk) for chunk in linked.chunks.values()]
        self._linked(three, "chunk_octets", max(sizes))
        self._linked(three, "unique_octets", sum(sizes))
        self._linked(three, "unfolded_node_count", 4)
        self._linked(chain(9, lambda _: b""), "logical_depth", 9)
        flat = encode_flat(three, IDENTITY_BYTES)
        self._linked(three, "unfolded_flat_octets", len(flat), "flatten")
        self._linked(three, "unfolded_flat_octets", len(flat))
        self._linked(Node.compose(bytes(200), []), "varint_value", 200)

    def test_shared_subtrees_count_once_per_occurrence_when_unfolded(self) -> None:
        shared = Node.compose(b"s", [(b"x", Node.compose(b"", []))])
        tree = Node.compose(b"", [(b"a", shared), (b"b", shared)])
        linked = encode_linked(tree, IDENTITY_BYTES)
        self.assertEqual(len(linked.chunks), 3)
        self._linked(tree, "unfolded_node_count", 5)
        self._linked(tree, "unique_chunks", 3)


# --- §12 as pinned: depth, hash cycles, parse order, and the build budget -------------


def label(name: str) -> bytes:
    """A 32-octet digest chosen by name, for chunks filed under a stand-in hash."""
    return hashlib.sha256(name.encode()).digest()


def path_to[T](edges: int, below: Node[T], own: T) -> Node[T]:
    """``edges`` nodes above ``below``, one child each: ``below`` at that depth."""
    node = below
    for _ in range(edges):
        node = Node.compose(own, [(b"k", node)])
    return node


def bomb(
    levels: int, leaf: bytes, codec_id: bytes, payload: bytes
) -> tuple[Address, dict[Address, bytes]]:
    """A sharing bomb built chunk by chunk: ``levels`` chunks above ``leaf``, each
    naming the one below it under two keys. It denotes a tree of 2^levels leaves."""
    below = digest_address(leaf)
    store = {below: leaf}
    for _ in range(levels):
        chunk = encode_chunk(codec_id, payload, [(b"a", below), (b"b", below)])
        below = digest_address(chunk)
        store[below] = chunk
    return below, store


class EnvelopeOrderTests(unittest.TestCase):
    def test_a_hash_cycle_is_refused_as_logical_depth(self) -> None:
        # §12: a walk that reaches one of the current chunk's own ancestors has found a
        # hash cycle, which denotes no finite tree. SHA-256 makes one infeasible, and
        # §12 forbids relying on that, so the walk runs under a stand-in hash that files
        # these chunks under chosen digests; every other octet string keeps SHA-256.
        a, b, s, r = (label(name) for name in "absr")
        filed = {
            a: encode_chunk(IDENTITY_BYTES.id, b"a", [(b"k", Address("dxl2", b))]),
            b: encode_chunk(IDENTITY_BYTES.id, b"b", [(b"k", Address("dxl2", a))]),
            s: encode_chunk(IDENTITY_BYTES.id, b"s", [(b"k", Address("dxl2", s))]),
            r: encode_chunk(IDENTITY_BYTES.id, b"r", [(b"k", Address("dxl2", a))]),
        }
        stand_in = {chunk: digest for digest, chunk in filed.items()}

        def weak(octets: bytes) -> bytes:
            return stand_in.get(octets) or hashlib.sha256(octets).digest()

        def fetch(at: Address) -> bytes | None:
            return filed.get(at.digest)

        with mock.patch.object(deixis_codec, "_sha256", weak):
            # a → b → a; s → s (itself); r → a → b → a, the cycle below the root.
            for root in (a, s, r):
                address = Address("dxl2", root)
                for verdict in (
                    materialize(address, fetch, REGISTRY),
                    flatten(address, fetch, REGISTRY),
                    check_closure(address, fetch),
                    estimate_unfolded(address, fetch),
                ):
                    self.assertEqual(verdict, ResourceRefused("logical_depth"))
            # Navigation is not a walk: each step verifies one chunk, and the caller
            # decides whether to take the next.
            first = resolve_root(Address("dxl2", a), fetch)
            assert isinstance(first, Chunk), first
            second = resolve_child(first, b"k", fetch)
            assert isinstance(second, Chunk), second
            again = resolve_child(second, b"k", fetch)
            assert isinstance(again, Chunk), again
            self.assertEqual(again.address, first.address)
            # Sharing is not a cycle: a chunk reached twice, never from below itself.
            shared = Node.compose(b"x", [])
            diamond = Node.compose(
                b"d", [(b"l", path_to(1, shared, b"")), (b"r", path_to(2, shared, b""))]
            )
            linked = encode_linked(diamond, IDENTITY_BYTES)
            self.assertIsInstance(
                materialize(linked.root, linked.chunks.get, REGISTRY), Accepted
            )

    def test_depth_counts_edges_at_the_deepest_occurrence(self) -> None:
        # §12: depth counts edges, root at 0, in the tree the closure denotes. A chunk
        # first met shallow recurs deeper, and the walk meets the limit there, whichever
        # key reaches it first, as the flat decoder meets it in parse order.
        for first, second, below in ((1, 4, 3), (4, 1, 3), (2, 2, 5), (0, 6, 1)):
            shared = chain(below, lambda _: b"c")
            tree = Node.compose(
                b"r",
                [
                    (b"a", path_to(first, shared, b"")),
                    (b"b", path_to(second, shared, b"")),
                ],
            )
            depth = depth_of(tree)
            linked = encode_linked(tree, IDENTITY_BYTES)
            flat = encode_flat(tree, IDENTITY_BYTES)
            fetch = linked.chunks.get
            self.assertEqual(estimate_unfolded(linked.root, fetch).depth, depth)  # type: ignore[union-attr]
            for limit in (depth - 1, depth):
                limits = replace(FLOORS, logical_depth=limit)
                verdicts = [
                    decode_flat(flat, REGISTRY, limits),
                    materialize(linked.root, fetch, REGISTRY, limits),
                    flatten(linked.root, fetch, REGISTRY, limits),
                    check_closure(linked.root, fetch, limits),
                ]
                for verdict in verdicts:
                    if limit < depth:
                        self.assertEqual(verdict, ResourceRefused("logical_depth"))
                    else:
                        self.assertNotIsInstance(verdict, ResourceRefused)

    def test_a_decoder_never_refuses_up_front_on_its_buffers_length(self) -> None:
        # §12: limits are met in parse order. The root ends within the bound, so what
        # follows it is trailing_bytes, however far past the bound it runs — and a fault
        # met before the bound wins over it.
        for case in small_cases():
            data = encode_flat(case.tree, case.codec)
            longer = data + bytes(64)
            at_root_end = replace(FLOORS, flat_artifact_octets=len(data))
            self.assertEqual(
                decode_flat(longer, REGISTRY, at_root_end), Invalid("trailing_bytes")
            )
            for pieces in ([longer[: len(data)], longer[len(data) :]], [longer]):
                self.assertEqual(
                    streamed(pieces, REGISTRY, at_root_end), Invalid("trailing_bytes")
                )
            inside_root = replace(FLOORS, flat_artifact_octets=len(data) - 1)
            self.assertEqual(
                decode_flat(longer, REGISTRY, inside_root),
                ResourceRefused("flat_artifact_octets"),
            )
            wrong_magic = bytes([data[0] ^ 0x01]) + longer[1:]
            for bound, verdict in ((4, Invalid("unknown_magic")), (3, None)):
                limits = replace(FLOORS, flat_artifact_octets=bound)
                self.assertEqual(
                    decode_flat(wrong_magic, REGISTRY, limits),
                    verdict or ResourceRefused("flat_artifact_octets"),
                )

    def test_every_bound_refuses_or_reaches_the_unbounded_verdict(self) -> None:
        # Parse order, as a property: over growing bounds the verdict is a run of
        # refusals and then, from one bound on, exactly the unbounded verdict.
        rng = random.Random(13)
        refused = ResourceRefused("flat_artifact_octets")
        for case in small_cases():
            data = encode_flat(case.tree, case.codec)
            inputs = [data, data + bytes([0x00]), data[:-1]]
            for _ in range(16):
                at = rng.randrange(len(data))
                inputs.append(data[:at] + bytes([rng.randrange(256)]) + data[at + 1 :])
            for octets in inputs:
                final = summary(decode_flat(octets, REGISTRY))
                seen = [
                    summary(
                        decode_flat(
                            octets,
                            REGISTRY,
                            replace(FLOORS, flat_artifact_octets=bound),
                        )
                    )
                    for bound in range(len(octets) + 2)
                ]
                step = next(i for i, verdict in enumerate(seen) if verdict != refused)
                self.assertEqual(
                    seen[step:], [final] * (len(seen) - step), octets.hex()
                )

    def test_a_chunk_is_measured_when_fetched_before_its_hash_and_parse(self) -> None:
        # §12: chunks are never streamed. A chunk is verified before it is parsed, and
        # the check reads every octet, so chunk_octets, and the chunk's share of
        # unique_octets, are met on the fetched length: before the hash check, and
        # before any fault inside the chunk.
        chunk = encode_chunk(IDENTITY_BYTES.id, b"payload", [])
        size = len(chunk)
        early_fault = bytes([chunk[0] ^ 0x01]) + chunk[1:]  # unknown_magic
        elsewhere = digest_address(encode_chunk(IDENTITY_BYTES.id, b"other", []))
        for dimension in ("chunk_octets", "unique_octets"):
            limits = replace(FLOORS, **{dimension: size})
            over = ResourceRefused(dimension)  # type: ignore[arg-type]
            # One octet or more past the limit: refused whatever the octets hold, and
            # whatever they hash to, filed under their own digest or another's.
            for octets in (early_fault + bytes(1), chunk + bytes(1), chunk + bytes(8)):
                for address in (digest_address(octets), elsewhere):
                    fetch = {address: octets}.get
                    self.assertEqual(check_closure(address, fetch, limits), over)
                    self.assertEqual(
                        materialize(address, fetch, REGISTRY, limits), over
                    )
            # At the limit the chunk is fetched whole, verified, and then parsed.
            address = digest_address(chunk)
            self.assertIsInstance(
                check_closure(address, {address: chunk}.get, limits), ClosurePresent
            )
            address = digest_address(early_fault)
            self.assertEqual(
                check_closure(address, {address: early_fault}.get, limits),
                Invalid("unknown_magic"),
            )
            self.assertEqual(
                check_closure(elsewhere, {elsewhere: chunk}.get, limits),
                StoreFault("hash_mismatch", elsewhere),
            )
        # A child's share of unique_octets is met on its fetched length too, before
        # its hash: the parent names a child, and the store files longer octets there.
        child = encode_chunk(IDENTITY_BYTES.id, b"c", [])
        parent = encode_chunk(IDENTITY_BYTES.id, b"p", [(b"k", digest_address(child))])
        both = replace(FLOORS, unique_octets=len(parent) + len(child))
        root = digest_address(parent)
        store = {root: parent, digest_address(child): child + bytes(4)}
        self.assertEqual(
            check_closure(root, store.get, both), ResourceRefused("unique_octets")
        )
        store[digest_address(child)] = child
        self.assertIsInstance(check_closure(root, store.get, both), ClosurePresent)
        # The lazy constructors measure first too.
        longer = chunk + bytes(8)
        address = digest_address(longer)
        self.assertEqual(
            resolve_root(
                address, {address: longer}.get, replace(FLOORS, chunk_octets=size)
            ),
            ResourceRefused("chunk_octets"),
        )
        # Within a verified chunk parse order governs, bounded by the chunk's own end:
        # one at exactly the limit that ends early is unexpected_eof, not a refusal.
        cut = chunk[:-1]
        address = digest_address(cut)
        self.assertEqual(
            check_closure(
                address, {address: cut}.get, replace(FLOORS, chunk_octets=len(cut))
            ),
            Invalid("unexpected_eof"),
        )

    def test_a_declared_length_above_its_limit_is_met_at_that_field(self) -> None:
        # §12: a declared length or count above its own limit is met at that field,
        # before the octets it announces, even when the input ends before them; and in
        # a stream that is final at once. The fields are found by §5's grammar.
        tree = Node.compose(bytes(10), [(bytes(10), Node.compose(b"", []))])
        data = encode_flat(tree, IDENTITY_BYTES)
        # id length, root payload length, root count, key length, child's two fields
        spans = varint_spans(tree, IDENTITY_BYTES)
        for dimension, limit, field in (
            ("payload_length", 9, spans[1]),
            ("entries_per_node", 0, spans[2]),
            ("key_length", 9, spans[3]),
        ):
            limits = replace(FLOORS, **{dimension: limit})
            refused = ResourceRefused(dimension)  # type: ignore[arg-type]
            cut = data[: field[1]]  # ends right after the field
            self.assertEqual(decode_flat(cut, REGISTRY, limits), refused)
            self.assertEqual(FlatDecoder(REGISTRY, limits).feed(cut), refused)
            self.assertEqual(decode_flat(data, REGISTRY, limits), refused)
            # One above the limit is the whole artifact, accepted.
            self.assertIsInstance(
                decode_flat(data, REGISTRY, replace(limits, **{dimension: limit + 1})),
                Accepted,
            )

    def test_walk_limits_are_met_before_capability_and_payloads(self) -> None:
        # The walk's own dimensions are met as the walk meets them (§12), so a codec-
        # blind resolver still refuses on them rather than answer unsupported.
        linked = encode_linked(chain(10, lambda _: b""), IDENTITY_BYTES)
        for limits, dimension in (
            (replace(FLOORS, logical_depth=5), "logical_depth"),
            (replace(FLOORS, unique_chunks=3), "unique_chunks"),
        ):
            self.assertEqual(
                materialize(linked.root, linked.chunks.get, {}, limits),
                ResourceRefused(dimension),  # type: ignore[arg-type]
            )

    def test_the_budget_guards_the_build_not_the_judgments(self) -> None:
        # §12: the materialize and flatten budget is judged after the closure's framing,
        # capability and payloads. An over-budget closure that is invalid or
        # unsupported gets that verdict; only one that passes them all is refused on
        # its unfolded measures, and none is ever unfolded to find out.
        good = COARSE.encode(Coarse("a", ""))
        valid = encode_chunk(COARSE.id, good, [])
        overlong = encode_chunk(COARSE.id, bytes([0xC0, 0x80]), [])  # not UTF-8
        trailing = valid + bytes([0x00])
        cases: list[tuple[bytes, Any, object, object]] = [
            (
                valid,
                REGISTRY,
                ResourceRefused("unfolded_node_count"),
                ResourceRefused("unfolded_flat_octets"),
            ),
            (valid, {}, UNSUPPORTED, UNSUPPORTED),
            (overlong, REGISTRY, Invalid("non_canonical_payload"), None),
            (overlong, {}, UNSUPPORTED, None),
            (trailing, REGISTRY, Invalid("trailing_bytes"), None),
            (trailing, {}, Invalid("trailing_bytes"), None),
        ]
        for leaf, registry, materialized, flattened in cases:
            root, store = bomb(70, leaf, COARSE.id, good)
            started = time.perf_counter()
            self.assertEqual(materialize(root, store.get, registry), materialized)
            self.assertEqual(
                flatten(root, store.get, registry), flattened or materialized
            )
            self.assertLess(time.perf_counter() - started, 5.0)
        # Every closure is over a budget of nothing, and each still gets the verdict
        # the judgments reach first.
        nothing = replace(FLOORS, unfolded_node_count=0, unfolded_flat_octets=0)
        for case in generated_cases()[:30]:
            linked = encode_linked(case.tree, case.codec)
            fetch = linked.chunks.get
            self.assertIsInstance(
                materialize(linked.root, fetch, REGISTRY, nothing), ResourceRefused
            )
            self.assertIsInstance(
                flatten(linked.root, fetch, REGISTRY, nothing), ResourceRefused
            )
            self.assertEqual(materialize(linked.root, fetch, {}, nothing), UNSUPPORTED)
            self.assertEqual(flatten(linked.root, fetch, {}, nothing), UNSUPPORTED)


if __name__ == "__main__":
    unittest.main()
