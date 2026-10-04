"""Unit tests and vector replay for core/py, through the public API only.

See ``vectors/README.md`` and ``vectors/NODE-PLAN.md`` for the spellings and the fixture
setoid. Python is the language where native ``==`` is most seductive, where dicts are
insertion-ordered by design and where truthiness stands in for presence — exactly the
temptations the vectors exist to catch.

``identity.json`` is spelled in the previous model and is read through the embedding E
of ADR 0009 §10.1, as ``node-embedding.json``'s embedded-identity law says, under the
counts that law pins. ``invalid.json`` is not replayed: no fixture states a law over it
in N, and ``node-invalid.json`` pins the duplicate-key refusals of N directly.
"""

from __future__ import annotations

import json
import sys
import unittest
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from deixis_core import DuplicateKeyError, Node, Some  # noqa: E402

_VECTORS = _HERE.parent.parent / "vectors"


# A slot whose equality is deliberately coarser than its representation. If an
# implementation reached for native equality instead of the supplied relation, every
# test using this type would fail. (``class`` is a Python keyword; the field is
# ``class_`` here and mapped when parsing vector spellings.)
@dataclass(frozen=True)
class Fixture:
    class_: str
    representation: str


def same_own(a: Some[Fixture] | None, b: Some[Fixture] | None) -> bool:
    return a is b if a is None or b is None else same_class(a.value, b.value)


def same_class(a: Fixture, b: Fixture) -> bool:
    return a.class_ == b.class_


def value(class_: str, representation: str) -> Some[Fixture]:
    return Some(Fixture(class_, representation))


def node(
    own: Some[Fixture] | None, *children: tuple[bytes, Node[Some[Fixture] | None]]
) -> Node[Some[Fixture] | None]:
    return Node.compose(own, children)


def valued(class_: str, representation: str) -> Node[Some[Fixture] | None]:
    return node(value(class_, representation))


def unvalued() -> Node[Some[Fixture] | None]:
    return node(None)


class CoreUnitTests(unittest.TestCase):
    def test_none_is_not_some_of_an_empty_value(self) -> None:
        empty = valued("", "")
        self.assertFalse(empty.equal_by(unvalued(), same_own))
        self.assertFalse(unvalued().equal_by(empty, same_own))

    def test_none_is_a_legal_own_value(self) -> None:
        # The slot carries no bounds — None included. Some(None) is present.
        holds_none: Node[Some[None] | None] = Node.compose(Some(None), [])
        unvalued_none: Node[Some[None] | None] = Node.compose(None, [])
        self.assertIsNotNone(holds_none.own)
        self.assertFalse(holds_none.equal_by(unvalued_none, lambda a, b: a == b))
        self.assertTrue(
            holds_none.equal_by(Node.compose(Some(None), []), lambda a, b: a == b)
        )

    def test_a_bare_value_is_an_own_value(self) -> None:
        payload = Fixture("7", "seven")
        self.assertIs(Node.compose(payload, []).own, payload)

    def test_a_node_carries_a_value_and_children_at_once(self) -> None:
        n = node(value("7", "seven"), (b"k", unvalued()))
        self.assertEqual(n.own, value("7", "seven"))
        self.assertIsNotNone(n.get(b"k"))
        self.assertEqual(len(n), 1)

    def test_a_node_is_never_falsy(self) -> None:
        # A childless node exists; only a missing one reads as absent.
        self.assertTrue(unvalued())
        self.assertTrue(valued("1", "x"))

    def test_identical_children_with_different_own_values_are_different_nodes(
        self,
    ) -> None:
        valued_parent = node(value("7", "seven"), (b"k", unvalued()))
        unvalued_parent = node(None, (b"k", unvalued()))
        other_value = node(value("8", "seven"), (b"k", unvalued()))
        self.assertFalse(valued_parent.equal_by(unvalued_parent, same_own))
        self.assertFalse(valued_parent.equal_by(other_value, same_own))

    def test_a_value_relocated_to_a_child_is_a_different_node(self) -> None:
        at_root = node(value("7", "seven"), (b"k", unvalued()))
        at_child = node(None, (b"k", valued("7", "seven")))
        self.assertFalse(at_root.equal_by(at_child, same_own))

    def test_equality_is_the_supplied_relation(self) -> None:
        a = node(value("7", "seven"), (b"k", valued("1", "one")))
        b = node(value("7", "SEVEN"), (b"k", valued("1", "ONE")))
        self.assertTrue(a.equal_by(b, same_own))
        self.assertFalse(a.equal_by(node(value("9", "nine")), same_own))

    def test_keys_are_normalized_and_copied(self) -> None:
        live = bytearray(b"live")
        n = Node.compose(None, [(live, valued("1", "x"))])
        live[:] = b"!!!!"
        self.assertIsNotNone(n.get(b"live"))
        self.assertIsNone(n.get(b"!!!!"))

    def test_keys_are_exact_byte_strings(self) -> None:
        n = node(
            None,
            (b"", valued("1", "empty key")),
            (bytes([1]), valued("2", "one")),
            (bytes([1, 0]), valued("3", "one zero")),
        )
        for key in (b"", bytes([1]), bytes([1, 0])):
            self.assertIsNotNone(n.get(key), key.hex())
        self.assertIsNone(n.get(bytes([0, 1])))
        self.assertEqual(len(n), 3)

    def test_children_are_sorted_regardless_of_insertion_order(self) -> None:
        n = node(None, (b"b", valued("2", "")), (b"a", valued("1", "")))
        self.assertEqual(n.keys(), [b"a", b"b"])

    def test_duplicate_keys_are_refused_under_any_parent(self) -> None:
        for own in (None, value("3", "valued")):
            with self.assertRaises(DuplicateKeyError) as caught:
                node(own, (b"k", valued("1", "first")), (b"k", valued("2", "second")))
            self.assertEqual(caught.exception.key, b"k")
            self.assertEqual(caught.exception.code, "duplicate_key")

    def test_decompose_returns_complete_parts(self) -> None:
        original = node(
            value("7", "seven"),
            (b"b", unvalued()),
            (b"a", node(value("4", "a"), (b"g", valued("5", "c")))),
        )
        own, children = original.decompose()
        self.assertEqual(own, value("7", "seven"))
        self.assertEqual([key for key, _ in children], [b"a", b"b"])
        # Children are whole subtrees, not their own values.
        self.assertIsNotNone(children[0][1].get(b"g"))
        self.assertTrue(Node.compose(own, children).equal_by(original, same_own))
        # A node without children returns an empty map, never a missing one.
        self.assertEqual(valued("1", "x").decompose()[1], [])

    def _nested(self) -> Node[Some[Fixture] | None]:
        return node(None, (b"a", node(value("4", "a"), (b"b", valued("1", "deep")))))

    def test_the_empty_path_resolves_to_the_node_itself(self) -> None:
        n = self._nested()
        resolved = n.at([])
        assert resolved is not None
        self.assertTrue(resolved.equal_by(n, same_own))

    def test_resolution_walks_keys_in_order(self) -> None:
        n = self._nested()
        deep = n.at([b"a", b"b"])
        assert deep is not None and deep.own is not None
        self.assertEqual(deep.own.value.class_, "1")
        # Order matters, and a miss is a miss — never a default, never a search.
        self.assertIsNone(n.at([b"b", b"a"]))
        self.assertIsNone(n.at([b"a", b"nope"]))
        # A childless node resolves no nonempty path, whatever its own value.
        self.assertIsNone(n.at([b"a", b"b", b"c"]))

    def test_resolution_passes_through_a_valued_node(self) -> None:
        n = self._nested()
        through = n.at([b"a"])
        assert through is not None and through.own is not None
        self.assertEqual(through.own.value.class_, "4")
        self.assertIsNotNone(n.at([b"a", b"b"]))

    def test_resolution_is_a_partial_monoid_action(self) -> None:
        n = self._nested()
        whole = n.at([b"a", b"b"])
        stage = n.at([b"a"])
        staged = stage.at([b"b"]) if stage is not None else None
        assert whole is not None and staged is not None
        self.assertTrue(whole.equal_by(staged, same_own))
        # Defined in exactly the same cases, including when neither is.
        self.assertIsNone(n.at([b"x", b"y"]))

    def test_path_elements_are_byte_strings_not_a_delimited_string(self) -> None:
        # The empty key is a key, and a key may contain what a separator would be.
        n = node(None, (b"", node(None, (b"a/b", valued("1", "slash")))))
        self.assertIsNotNone(n.at([b"", b"a/b"]))
        # The two path elements do not concatenate into one.
        self.assertIsNone(n.at([b"a/b"]))
        # The empty key and the empty path are different.
        root, child = n.at([]), n.at([b""])
        assert root is not None and child is not None
        self.assertFalse(root.equal_by(child, same_own))

    def test_the_slot_carries_no_bounds(self) -> None:
        # A closure implements no meaningful equality and is still a legal own value,
        # beside children or without them.
        route: Node[Some[Callable[[], int]] | None] = Node.compose(Some(lambda: 42), [])
        handlers = Node.compose(Some(lambda: 7), [(b"route", route)])
        found = handlers.get(b"route")
        assert found is not None and found.own is not None
        self.assertEqual(found.own.value(), 42)
        assert handlers.own is not None
        self.assertEqual(handlers.own.value(), 7)


# --- vector replay --------------------------------------------------------------------


def payload(spelling: Any) -> Fixture:
    return Fixture(spelling["class"], spelling["representation"])


def own_of(spelling: Any) -> Some[Fixture] | None:
    if not isinstance(spelling, dict) or len(spelling) != 1:
        raise AssertionError(
            f"an own value is exactly one of none and some: {spelling!r}"
        )
    if "none" in spelling:
        return None
    return Some(payload(spelling["some"]))


def build(spelling: Any) -> Node[Some[Fixture] | None]:
    """Build a node from its N[T] spelling, feeding the children to the constructor in
    file (insertion) order — the construction owns sorting and duplicate refusal."""
    if not isinstance(spelling, dict):
        raise AssertionError(f"node spelling must be an object, got {spelling!r}")
    return Node.compose(
        own_of(spelling["own"]),
        ((bytes.fromhex(key), build(child)) for key, child in spelling["children"]),
    )


def embed(spelling: Any) -> Node[Some[Fixture] | None]:
    """E(n) from a previous-model spelling: E(Leaf(t)) = Node(Some(t), ∅) and
    E(Struct(m)) = Node(None, k ↦ E(m(k)))."""
    if "leaf" in spelling:
        return Node.compose(Some(payload(spelling["leaf"])), [])
    if "struct" in spelling:
        return Node.compose(
            None,
            ((bytes.fromhex(key), embed(child)) for key, child in spelling["struct"]),
        )
    raise AssertionError('a previous-model node is {"leaf": ...} or {"struct": ...}')


def read(name: str) -> Any:
    return json.loads((_VECTORS / name).read_text(encoding="utf-8"))


class IdentityReplay(unittest.TestCase):
    def _judge(
        self, case: Any, construct: Callable[[Any], Node[Some[Fixture] | None]]
    ) -> bool:
        """Judge one identity case both ways round, and reflexivity; report whether it
        is an equal judgment between nodes whose root representations differ."""
        name = case["name"]
        left = construct(case["left"])
        right = construct(case["right"])
        expected = case["equal"]

        self.assertEqual(left.equal_by(right, same_own), expected, name)
        # Equality is symmetric; the judgment must not depend on argument order.
        self.assertEqual(right.equal_by(left, same_own), expected, f"{name} (flipped)")
        # And every node equals itself under the fixture relation.
        self.assertTrue(left.equal_by(left, same_own), f"{name} (left reflexive)")
        self.assertTrue(right.equal_by(right, same_own), f"{name} (right reflexive)")

        return bool(
            expected
            and left.own is not None
            and right.own is not None
            and left.own.value.representation != right.own.value.representation
        )

    def test_identity_json_through_the_embedding(self) -> None:
        # The embedded-identity law of node-embedding.json: for every case of
        # identity.json, E(left) ≡ E(right) in N iff the case's `equal` is true. The law
        # pins the source's counts, and a replayer must refuse when they differ.
        laws = read("node-embedding.json")
        self.assertEqual(laws["profile"], "deixis-node-embedding")
        [law] = [c for c in laws["cases"] if c["op"] == "embedded-identity"]
        self.assertEqual(law["source"], "identity.json")

        file = read("identity.json")
        self.assertEqual(file["profile"], "deixis-core-identity")
        cases = file["cases"]
        equal = sum(1 for c in cases if c["equal"])
        self.assertEqual(
            (len(cases), equal, len(cases) - equal),
            (law["source_cases"], law["source_equal"], law["source_not_equal"]),
            f"{law['name']}: identity.json no longer matches the counts the law pins — "
            "an erratum to identity.json, and the law must be re-checked by a person",
        )

        # The vectors must themselves exercise the coarseness of ≈: at least one equal
        # judgment between values whose representations differ, or they could not tell
        # a lifted relation from native equality.
        results = [self._judge(case, embed) for case in cases]
        self.assertTrue(any(results), "no equal judgment between differing values")

    def test_node_identity_json(self) -> None:
        file = read("node-identity.json")
        self.assertEqual(file["profile"], "deixis-node-identity")
        cases = file["cases"]
        self.assertGreaterEqual(len(cases), 20, "vector file shrank?")
        results = [self._judge(case, build) for case in cases]
        self.assertTrue(any(results), "no equal judgment between differing values")


class NodeInvalidReplay(unittest.TestCase):
    def test_replay(self) -> None:
        file = read("node-invalid.json")
        self.assertEqual(file["profile"], "deixis-node-invalid")
        cases = file["cases"]
        self.assertGreaterEqual(len(cases), 6, "vector file shrank?")

        for case in cases:
            name = case["name"]
            self.assertEqual(case["error"], "duplicate_key", name)
            with self.assertRaises(DuplicateKeyError, msg=name) as caught:
                build(case["node"])
            self.assertEqual(
                caught.exception.key, bytes.fromhex(case["key"]), f"{name}: key"
            )


class NodeNavigationReplay(unittest.TestCase):
    def test_replay(self) -> None:
        # The navigation laws of node-navigation.json: at, the own value read off the
        # node at a path (valueAt), and at composed with itself (S1).
        file = read("node-navigation.json")
        self.assertEqual(file["profile"], "deixis-node-navigation")

        def path(keys: list[str]) -> list[bytes]:
            return [bytes.fromhex(key) for key in keys]

        for case in file["cases"]:
            name, op = case["name"], case["op"]
            tree = build(case["tree"])
            found: Node[Some[Fixture] | None] | None
            if op in ("at", "valueAt"):
                found = tree.at(path(case["path"]))
            elif op == "at-compose":
                stage = tree.at(path(case["first"]))
                found = stage.at(path(case["then"])) if stage is not None else None
            else:
                raise AssertionError(f"{name}: unknown op {op!r}")

            expected = case["expected"]
            self.assertNotEqual("defined" in expected, "undefined" in expected, name)
            if "undefined" in expected:
                self.assertIsNone(found, f"{name}: defined, want undefined")
                continue
            assert found is not None, f"{name}: undefined, want defined"
            if op == "valueAt":
                want = own_of(expected["defined"])
                if want is None:
                    self.assertIsNone(found.own, f"{name}: want None")
                else:
                    assert found.own is not None, f"{name}: want Some"
                    self.assertTrue(same_class(found.own.value, want.value), name)
            else:
                self.assertTrue(
                    found.equal_by(build(expected["defined"]), same_own), name
                )


class RequiredPayloadTests(unittest.TestCase):
    def test_direct_payloads_and_complete_parts(self) -> None:
        child = Node.compose(lambda: 7, [])

        def handler() -> int:
            return 42

        root = Node.compose(handler, [(b"child", child)])
        self.assertIs(root.own, handler)
        found = root.at([b"child"])
        assert found is not None
        self.assertEqual(found.own(), 7)
        self.assertIsNone(root.at([b"missing"]))
        rebuilt = Node.compose(*root.decompose())
        self.assertIs(rebuilt.own, handler)
        self.assertEqual(rebuilt.own(), 42)

    def test_whole_payload_equality_includes_none(self) -> None:
        raw = Node.compose(None, [])
        self.assertIs(raw.at([]), raw)
        self.assertIsNone(raw.own)
        self.assertIsNone(raw.at([b"missing"]))
        self.assertFalse(raw.equal_by(raw, lambda a, b: False))
        absent: Node[Some[int] | None] = Node.compose(None, [])
        present: Node[Some[int] | None] = Node.compose(Some(7), [])
        self.assertTrue(absent.equal_by(present, lambda a, b: True))
        self.assertFalse(absent.equal_by(present, lambda a, b: a == b))


if __name__ == "__main__":
    unittest.main()
