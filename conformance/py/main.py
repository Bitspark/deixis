"""Thin conformance CLI for the Python implementation — tools/conformance/README.md.

Reads NDJSON requests on stdin, answers each with this implementation's own judgment on
stdout. Owns no vectors and no expectations. The codec.* operations are answered in
codec.py, over core/py/deixis_codec.py.

The node.* operations that are not accessors of the floor — replacement, attachment,
split and plug, cuts, and the embedding of the previous model — are derived here through
the core's accessors (compose, decompose, own, get, at), which is what docs/PATH.md
claims they are: derivable, and no methods of the floor.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "core" / "py"))
sys.path.insert(0, str(_ROOT / "pos" / "py"))
sys.path.insert(0, str(_ROOT / "set" / "py"))

from binding import handle as handle_binding  # noqa: E402
from codec import handle as handle_codec  # noqa: E402
from deixis_core import DuplicateKeyError, Node, Some  # noqa: E402
from deixis_pos import is_key as pos_is_key  # noqa: E402
from deixis_pos import key as pos_key  # noqa: E402
from deixis_set import contains, is_set, recognize, set_of  # noqa: E402
from mandatory import handle as handle_mandatory  # noqa: E402

Fixture = tuple[str, str]  # (class, representation); ≈ compares the first component
Path_ = list[bytes]


def fixture_member(spelling: Any) -> Fixture:
    return (spelling["class"], spelling["representation"])


def fixture_spell(member: Fixture) -> Any:
    return {"class": member[0], "representation": member[1]}


def fixture_e(member: Fixture) -> bytes:
    return member[0].encode()


def option_equal[T](
    eq: Callable[[T, T], bool],
) -> Callable[[Some[T] | None, Some[T] | None], bool]:
    def compare(a: Some[T] | None, b: Some[T] | None) -> bool:
        return a is b if a is None or b is None else eq(a.value, b.value)

    return compare


def fixture_eq(a: Fixture, b: Fixture) -> bool:
    return a[0] == b[0]


def bytes_member(spelling: Any) -> bytes:
    return bytes.fromhex(spelling)


def bytes_e(member: bytes) -> bytes:
    return member


def bytes_eq(a: bytes, b: bytes) -> bool:
    return a == b


SORTS: dict[
    str, tuple[Callable[[Any], Any], Callable[[Any], bytes], Callable[[Any, Any], bool]]
] = {
    "bytes": (bytes_member, bytes_e, bytes_eq),
    "class": (fixture_member, fixture_e, fixture_eq),
}


# --- reading spellings ----------------------------------------------------------------


def path(keys: list[str]) -> Path_:
    return [bytes.fromhex(key) for key in keys]


def parse(
    spelling: Any,
    member: Callable[[Any], Any],
    at: tuple[str, ...] = (),
    holes: list[tuple[str, ...]] | None = None,
) -> Node[Any]:
    """Read an N[T] spelling, {"own": …, "children": […]}. With ``holes`` given, a
    {"hole": {}} is admitted at any position: it is read as Node(None, ∅), which the
    caller replaces, and its path is recorded."""
    if "hole" in spelling:
        if holes is None:
            raise ValueError("a hole where no hole is admitted")
        holes.append(at)
        return Node.compose(None, [])
    own = spelling["own"]
    if (
        not isinstance(own, dict)
        or len(own) != 1
        or not ({"none", "some"} & own.keys())
    ):
        raise ValueError("an own value is exactly one of none and some")
    value = Some(member(own["some"])) if "some" in own else None
    return Node.compose(
        value,
        [
            (bytes.fromhex(key), parse(child, member, (*at, key), holes))
            for key, child in spelling["children"]
        ],
    )


def embed(spelling: Any, member: Callable[[Any], Any]) -> Node[Any]:
    """Read a previous-model spelling through the embedding E of ADR 0009 §10.1:
    E(Leaf(t)) = Node(Some(t), ∅) and E(Struct(m)) = Node(None, k ↦ E(m(k)))."""
    if "leaf" in spelling:
        return Node.compose(Some(member(spelling["leaf"])), [])
    if "struct" in spelling:
        return Node.compose(
            None,
            [
                (bytes.fromhex(key), embed(child, member))
                for key, child in spelling["struct"]
            ],
        )
    raise ValueError('a previous-model node is {"leaf": …} or {"struct": …}')


def read(
    request: dict[str, Any], spelling: Any, member: Callable[[Any], Any]
) -> Node[Any]:
    """A node field of a request: through E when the request says embedded, in N
    otherwise."""
    return (
        embed(spelling, member)
        if request.get("embedded") is True
        else parse(spelling, member)
    )


# --- writing spellings ----------------------------------------------------------------


def spell_own(own: Some[Fixture] | None) -> Any:
    return {"none": {}} if own is None else {"some": fixture_spell(own.value)}


def spell(
    node: Node[Some[Fixture] | None],
    at: tuple[str, ...] = (),
    holes: frozenset[tuple[str, ...]] = frozenset(),
) -> Any:
    """Write a node in N, with a hole at every path of ``holes`` (hex key tuples)."""
    if at in holes:
        return {"hole": {}}
    own, children = node.decompose()
    return {
        "own": spell_own(own),
        "children": [
            [key.hex(), spell(child, (*at, key.hex()), holes)]
            for key, child in children
        ],
    }


UNDEFINED: dict[str, Any] = {"undefined": {}}


def defined(value: Any) -> dict[str, Any]:
    return {"defined": value}


def result(node: Node[Some[Fixture] | None] | None) -> dict[str, Any]:
    return UNDEFINED if node is None else defined(spell(node))


# --- the derived operations -----------------------------------------------------------


def replace(node: Node[Any], keys: Path_, subtree: Node[Any]) -> Node[Any] | None:
    """n[p := s]: defined exactly when p ∈ paths(n). Every untouched own value and
    sibling on the way is retained, because each step recomposes the node's own
    parts."""
    if not keys:
        return subtree
    first, rest = keys[0], keys[1:]
    child = node.get(first)
    if child is None:
        return None
    replaced = replace(child, rest, subtree)
    if replaced is None:
        return None
    own, children = node.decompose()
    return Node.compose(own, [(k, replaced if k == first else c) for k, c in children])


def attach(
    tree: Node[Any], parent: Path_, key: bytes, subtree: Node[Any]
) -> Node[Any] | None:
    """attach(A, p, k, B) of ADR 0009 §8: A[p := compose((o, m ∪ {k ↦ B}))] with
    (o, m) = decompose(at(A, p)), defined exactly when p ∈ paths(A) and
    p ‖ k ∉ paths(A)."""
    at = tree.at(parent)
    if at is None or at.get(key) is not None:
        return None
    own, children = at.decompose()
    return replace(tree, parent, Node.compose(own, [*children, (key, subtree)]))


def unembed(node: Node[Some[Fixture] | None]) -> Any:
    """E's inverse, defined exactly on trees whose valued positions have no children;
    None where it is undefined."""
    own, children = node.decompose()
    if own is not None:
        return {"leaf": fixture_spell(own.value)} if not children else None
    struct = []
    for key, child in children:
        old = unembed(child)
        if old is None:
            return None
        struct.append([key.hex(), old])
    return {"struct": struct}


def is_prefix(p: list[str], q: list[str]) -> bool:
    return len(p) <= len(q) and q[: len(p)] == p


def handle_node(request: dict[str, Any]) -> dict[str, Any]:
    op = request["op"]

    def tree() -> Node[Some[Fixture] | None]:
        return parse(request["tree"], fixture_member)

    if op in ("node.at", "node.valueAt"):
        found = tree().at(path(request["path"]))
        if found is None:
            return UNDEFINED
        return (
            defined(spell_own(found.own))
            if op == "node.valueAt"
            else defined(spell(found))
        )
    if op == "node.atCompose":
        stage = tree().at(path(request["first"]))
        return result(stage.at(path(request["then"])) if stage is not None else None)
    if op == "node.attach":
        return result(
            attach(
                tree(),
                path(request["parent"]),
                bytes.fromhex(request["key"]),
                parse(request["subtree"], fixture_member),
            )
        )
    if op == "node.attachCommute":
        steps = [request["first"], request["second"]]

        def grow(order: tuple[int, int]) -> Node[Some[Fixture] | None] | None:
            grown: Node[Some[Fixture] | None] | None = tree()
            for i in order:
                if grown is None:
                    return None
                grown = attach(
                    grown,
                    path(request["parent"]),
                    bytes.fromhex(steps[i]["key"]),
                    parse(steps[i]["subtree"], fixture_member),
                )
            return grown

        return {"forward": result(grow((0, 1))), "reverse": result(grow((1, 0)))}
    if op == "node.decompose":
        own, children = tree().decompose()
        return defined(
            {
                "parts": {
                    "own": spell_own(own),
                    "children": [[key.hex(), spell(child)] for key, child in children],
                }
            }
        )
    if op == "node.compose":
        return defined(spell(parse(request["parts"], fixture_member)))
    if op == "node.split":
        n = tree()
        found = n.at(path(request["path"]))
        if found is None:
            return UNDEFINED
        return defined(
            {
                "context": spell(n, (), frozenset([tuple(request["path"])])),
                "subtree": spell(found),
            }
        )
    if op == "node.plug":
        holes: list[tuple[str, ...]] = []
        context = parse(request["context"], fixture_member, (), holes)
        if len(holes) != 1:
            raise ValueError(f"a context has exactly one hole, not {len(holes)}")
        return result(
            replace(
                context, path(list(holes[0])), parse(request["subtree"], fixture_member)
            )
        )
    if op == "node.cut":
        n = tree()
        subtrees = []
        for p in request["paths"]:
            found = n.at(path(p))
            if found is None:
                return UNDEFINED
            subtrees.append([p, spell(found)])
        # cut_F is defined for a prefix-free F: no path of F is a prefix of another.
        paths = request["paths"]
        for i, p in enumerate(paths):
            for j, q in enumerate(paths):
                if i != j and is_prefix(p, q):
                    return UNDEFINED
        return defined(
            {
                "skeleton": spell(n, (), frozenset(tuple(p) for p in paths)),
                "subtrees": subtrees,
            }
        )
    if op == "node.rebuild":
        holes = []
        rebuilt: Node[Some[Fixture] | None] | None = parse(
            request["skeleton"], fixture_member, (), holes
        )
        supplied = [tuple(p) for p, _ in request["subtrees"]]
        # The supplied subtrees have exactly the skeleton's holes as their domain.
        if len(supplied) != len(holes) or set(supplied) != set(holes):
            return UNDEFINED
        for p, subtree in request["subtrees"]:
            if rebuilt is None:
                break
            rebuilt = replace(rebuilt, path(p), parse(subtree, fixture_member))
        return result(rebuilt)
    if op == "node.embed":
        return defined(spell(embed(request["old"], fixture_member)))
    if op == "node.unembed":
        old = unembed(tree())
        return UNDEFINED if old is None else defined(old)
    return {"error": "unsupported"}


def parse_required(spelling: Any) -> Node[Fixture]:
    return Node.compose(
        fixture_member(spelling["own"]),
        [
            (bytes.fromhex(key), parse_required(child))
            for key, child in spelling["children"]
        ],
    )


def spell_required(node: Node[Fixture]) -> Any:
    return {
        "own": fixture_spell(node.own),
        "children": [
            [key.hex(), spell_required(child)] for key, child in node.entries()
        ],
    }


def handle_required(request: dict[str, Any]) -> dict[str, Any]:
    op = request["op"]
    if op == "required.equal":
        return {
            "equal": parse_required(request["left"]).equal_by(
                parse_required(request["right"]), fixture_eq
            )
        }
    tree = parse_required(request["tree"])
    if op == "required.roundtrip":
        return defined(spell_required(Node.compose(*tree.decompose())))
    if op in ("required.at", "required.valueAt"):
        found = tree.at(path(request["path"]))
        if found is None:
            return UNDEFINED
        return defined(
            fixture_spell(found.own)
            if op == "required.valueAt"
            else spell_required(found)
        )
    if op == "required.attach":
        grown = attach(
            tree,
            path(request["parent"]),
            bytes.fromhex(request["key"]),
            parse_required(request["subtree"]),
        )
        return UNDEFINED if grown is None else defined(spell_required(grown))
    return {"error": "unsupported"}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    if str(request.get("op", "")).startswith("codec."):
        return handle_codec(request)
    if str(request.get("op", "")).startswith("mnode."):
        return handle_mandatory(request, replace, attach)
    if str(request.get("op", "")).startswith("binding."):
        return handle_binding(request)
    if str(request.get("op", "")).startswith("required."):
        return handle_required(request)
    op = request.get("op")

    if op == "core.equal":
        left = read(request, request["left"], fixture_member)
        right = read(request, request["right"], fixture_member)
        return {"equal": left.equal_by(right, option_equal(fixture_eq))}

    if op == "core.build":
        try:
            read(request, request["node"], fixture_member)
        except DuplicateKeyError as refusal:
            return {"error": refusal.code, "key": refusal.key.hex()}
        return {"ok": True}

    if op == "pos.key":
        return {"key": pos_key(int(request["position"])).hex()}

    if op == "pos.isKey":
        return {"isKey": pos_is_key(bytes.fromhex(request["bytes"]))}

    if op in ("set.form", "set.recognize", "set.membership", "set.identity"):
        member, e, eq = SORTS[request["member"]]
        try:
            if op == "set.form":
                built = set_of([member(m) for m in request["members"]], e)
                expected = read(request, request["node"], member)
                return {
                    "equal": built.equal_by(expected, option_equal(eq))
                    and expected.equal_by(built, option_equal(eq)),
                    "recognized": is_set(built, e),
                }
            if op == "set.recognize":
                reason = recognize(read(request, request["node"], member), e)
                return (
                    {"isSet": True}
                    if reason is None
                    else {"isSet": False, "reason": reason}
                )
            if op == "set.membership":
                built = set_of([member(m) for m in request["members"]], e)
                return {
                    "in": [contains(built, member(q), e) for q in request["queries"]]
                }
            left = read(request, request["left"], member)
            right = read(request, request["right"], member)
            return {"equal": left.equal_by(right, option_equal(eq))}
        except DuplicateKeyError as refusal:
            return {"error": refusal.code, "key": refusal.key.hex()}

    if isinstance(op, str) and op.startswith("node."):
        try:
            return handle_node(request)
        except DuplicateKeyError as refusal:
            return {"error": refusal.code, "key": refusal.key.hex()}

    return {"error": "unsupported"}


def main() -> None:
    # NDJSON is UTF-8 whatever the locale: text-mode stdin would decode it with the
    # locale's encoding (cp1252 on a Windows console) and hand the core mis-decoded
    # strings. Answers stay ASCII — json.dumps escapes the rest — so stdout's encoding
    # never matters.
    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8").strip()
        if not line:
            continue
        request = json.loads(line)
        response = handle(request)
        response["id"] = request.get("id")
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
