"""Unit tests and vector replay for set/py (slot-member deixis-set-v1).

``set.json`` is spelled in the previous model and is read through the embedding E of
ADR 0009 §10.1, which is what ``node-set.json``'s five embedded laws say: each re-reads
one kind of ``set.json`` case through E and pins the counts it re-reads, and a replayer
must refuse when they differ. ``node-set.json``'s own cases are spelled in N, with own
values spelled by the case's member encoder.
"""

from __future__ import annotations

import json
import sys
import unittest
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_ROOT / "core" / "py"))
sys.path.insert(0, str(_HERE))

from deixis_core import DuplicateKeyError, Node, Some  # noqa: E402
from deixis_set import contains, is_set, recognize, set_of  # noqa: E402

_VECTORS = _ROOT / "vectors"


def identity(member: bytes) -> bytes:
    return member


@dataclass(frozen=True)
class Fixture:
    class_: str
    representation: str


def class_bytes(member: Fixture) -> bytes:
    return member.class_.encode()


def same_class(a: Fixture, b: Fixture) -> bool:
    return a.class_ == b.class_


def octet_eq(a: bytes, b: bytes) -> bool:
    return a == b


def node(
    own: bytes | None, *children: tuple[bytes, Node[Some[bytes] | None]]
) -> Node[Some[bytes] | None]:
    return Node.compose(None if own is None else Some(own), children)


class SetUnitTests(unittest.TestCase):
    def test_enumeration_is_spelling_order(self) -> None:
        built = set_of([b"b", b"a"], identity)
        self.assertEqual(built.keys(), [b"a", b"b"])

    def test_the_second_insert_is_not_a_node_that_exists(self) -> None:
        with self.assertRaises(DuplicateKeyError) as caught:
            set_of([b"k", b"k"], identity)
        self.assertEqual(caught.exception.key, b"k")

    def test_a_set_is_an_unvalued_node_of_valued_childless_members(self) -> None:
        built = set_of([b"a"], identity)
        self.assertIsNone(built.own)
        member = built.get(b"a")
        assert member is not None
        self.assertEqual(member.own, Some(b"a"))
        self.assertEqual(len(member), 0)

    def test_recognition_is_exact_or_refusal(self) -> None:
        self.assertIsNone(recognize(set_of([b"a"], identity), identity))
        # The empty set has nothing to be incoherent.
        self.assertIsNone(recognize(node(None), identity))
        # Mis-keyed: key does not equal the member's bytes. Refused, never re-keyed.
        self.assertEqual(
            recognize(node(None, (b"x", node(b"y"))), identity), "mis_keyed"
        )
        # An unvalued child is the image of a Struct child.
        self.assertEqual(
            recognize(node(None, (b"k", node(None))), identity), "struct_member"
        )
        # A valued node without children is well-formed deixis and simply not a set.
        self.assertEqual(recognize(node(b"k"), identity), "leaf_node")
        # New in N: the set node carries a value beside its members, even an empty
        # one — a presence check written as truthiness (`if own:`) misses the second.
        for value in (b"v", b""):
            valued = node(value, (b"a", node(b"a")))
            self.assertEqual(recognize(valued, identity), "valued_set_node")
        # New in N: a member with a child, even an unvalued one.
        grown = node(None, (b"a", node(b"a", (b"k", node(None)))))
        self.assertEqual(recognize(grown, identity), "member_with_children")
        self.assertFalse(is_set(grown, identity))

    def test_a_set_of_handlers_by_registered_name(self) -> None:
        # The point of the slot-member form: members need not be data. A set of
        # handlers, self-keyed by registered name — membership and idempotence by name.
        @dataclass(frozen=True)
        class Handler:
            name: str
            run: Callable[[], int]

        def by_name(handler: Handler) -> bytes:
            return handler.name.encode()

        built = set_of(
            [Handler("route", lambda: 42), Handler("other", lambda: 7)], by_name
        )
        self.assertTrue(is_set(built, by_name))
        # A different closure — membership is by name.
        self.assertTrue(contains(built, Handler("route", lambda: 0), by_name))

        route = built.get(b"route")
        assert route is not None and route.own is not None
        self.assertEqual(route.own.value.run(), 42)

        # Two handlers with one name are one member; the floor refuses the second.
        with self.assertRaises(DuplicateKeyError) as caught:
            set_of([Handler("route", lambda: 1), Handler("route", lambda: 2)], by_name)
        self.assertEqual(caught.exception.key, b"route")


# --- vector replay --------------------------------------------------------------------


def bytes_member(spelling: Any) -> bytes:
    assert isinstance(spelling, str)
    return bytes.fromhex(spelling)


def class_member(spelling: Any) -> Fixture:
    return Fixture(spelling["class"], spelling["representation"])


def embed[T](spelling: Any, member: Callable[[Any], T]) -> Node[Some[T] | None]:
    """E(n) from a previous-model spelling, leaf payloads parsed by ``member``."""
    if "leaf" in spelling:
        return Node.compose(Some(member(spelling["leaf"])), [])
    if "struct" in spelling:
        return Node.compose(
            None,
            ((bytes.fromhex(k), embed(c, member)) for k, c in spelling["struct"]),
        )
    raise AssertionError('a previous-model node is {"leaf": ...} or {"struct": ...}')


def build[T](spelling: Any, member: Callable[[Any], T]) -> Node[Some[T] | None]:
    """A node from its N[T] spelling, own values parsed by ``member``."""
    own = spelling["own"]
    if not isinstance(own, dict) or len(own) != 1:
        raise AssertionError(f"an own value is exactly one of none and some: {own!r}")
    value = None if "none" in own else Some(member(own["some"]))
    return Node.compose(
        value, ((bytes.fromhex(k), build(c, member)) for k, c in spelling["children"])
    )


def read(name: str) -> Any:
    return json.loads((_VECTORS / name).read_text(encoding="utf-8"))


class SetVectorsReplay(unittest.TestCase):
    def _run_case[T](
        self,
        case: Any,
        construct: Callable[[Any, Callable[[Any], T]], Node[Some[T] | None]],
        member: Callable[[Any], T],
        e: Callable[[T], bytes],
        eq: Callable[[T, T], bool],
    ) -> None:
        name = case["name"]
        kind = case["kind"]

        if kind == "form":
            built = set_of([member(m) for m in case["members"]], e)
            expected = construct(case["node"], member)
            self.assertTrue(built.equal_by(expected, option_equal(eq)), f"{name}: form")
            self.assertTrue(
                expected.equal_by(built, option_equal(eq)), f"{name}: form (flipped)"
            )
            self.assertTrue(is_set(built, e), f"{name}: a built set must recognize")
        elif kind == "duplicate":
            self.assertEqual(case["error"], "duplicate_key", name)
            with self.assertRaises(DuplicateKeyError, msg=name) as caught:
                set_of([member(m) for m in case["members"]], e)
            self.assertEqual(
                caught.exception.key, bytes.fromhex(case["key"]), f"{name}: key"
            )
        elif kind == "recognize":
            reason = recognize(construct(case["node"], member), e)
            self.assertEqual(reason is None, case["valid"], name)
            # A refusal pins its reason only on a node with exactly one defect; a case
            # without one is judged on the verdict alone.
            if not case["valid"] and "reason" in case:
                self.assertEqual(reason, case["reason"], f"{name}: reason")
        elif kind == "membership":
            built = set_of([member(m) for m in case["members"]], e)
            for query in case["queries"]:
                self.assertEqual(
                    contains(built, member(query["value"]), e),
                    query["in"],
                    f"{name}: query",
                )
        elif kind == "identity":
            left = construct(case["left"], member)
            right = construct(case["right"], member)
            expected = case["equal"]
            self.assertEqual(left.equal_by(right, option_equal(eq)), expected, name)
            self.assertEqual(
                right.equal_by(left, option_equal(eq)), expected, f"{name} (flipped)"
            )
        else:
            raise AssertionError(f"{name}: unknown kind {kind!r}")

    def _run_sorted(self, case: Any, embedded: bool) -> None:
        sort = case["member"]
        if sort == "bytes":
            self._run_case(
                case, embed if embedded else build, bytes_member, identity, octet_eq
            )
        elif sort == "class":
            self._run_case(
                case,
                embed if embedded else build,
                class_member,
                class_bytes,
                same_class,
            )
        else:
            raise AssertionError(f"unknown member sort {sort!r}")

    def _check_pin(self, law: Any, source: list[Any]) -> None:
        """The counts one embedded law pins, checked against the set.json cases it
        re-reads."""
        queries = [q for c in source for q in c.get("queries", [])]
        got = {
            "source_cases": len(source),
            "source_valid": sum(1 for c in source if c.get("valid") is True),
            "source_refused": sum(1 for c in source if c.get("valid") is False),
            "source_queries": len(queries),
            "source_in": sum(1 for q in queries if q["in"]),
            "source_out": sum(1 for q in queries if not q["in"]),
            "source_equal": sum(1 for c in source if c.get("equal") is True),
            "source_not_equal": sum(1 for c in source if c.get("equal") is False),
        }
        message = (
            f"{law['name']}: set.json no longer matches the counts the law pins — an "
            "erratum to set.json, and the law must be re-checked by a person"
        )
        for field, count in got.items():
            if field in law:
                self.assertEqual(law[field], count, f"{message} ({field})")
        if "source_reasons" in law:
            reasons = Counter(c["reason"] for c in source if c.get("valid") is False)
            self.assertEqual(dict(reasons), law["source_reasons"], message)

    def test_replay_through_the_embedding(self) -> None:
        laws = read("node-set.json")
        source = read("set.json")
        for file in (laws, source):
            self.assertEqual(file["profile"], "deixis-set-v1")
            self.assertEqual(file["form"], "slot-member")

        covered = set()
        for law in (c for c in laws["cases"] if c["kind"] == "embedded"):
            self.assertEqual(law["source"], "set.json")
            kind = law["source_kind"]
            self._check_pin(law, [c for c in source["cases"] if c["kind"] == kind])
            covered.add(kind)
        self.assertEqual(len(covered), 5, "node-set.json states five embedded laws")

        for case in source["cases"]:
            self.assertIn(case["kind"], covered, f"{case['name']}: no law re-reads it")
            self._run_sorted(case, embedded=True)

        own_cases = [c for c in laws["cases"] if c["kind"] != "embedded"]
        self.assertGreaterEqual(len(own_cases), 4, "node-set.json shrank?")
        for case in own_cases:
            self._run_sorted(case, embedded=False)


def option_equal[T](
    eq: Callable[[T, T], bool],
) -> Callable[[Some[T] | None, Some[T] | None], bool]:
    def compare(a: Some[T] | None, b: Some[T] | None) -> bool:
        return a is b if a is None or b is None else eq(a.value, b.value)

    return compare


if __name__ == "__main__":
    unittest.main()
