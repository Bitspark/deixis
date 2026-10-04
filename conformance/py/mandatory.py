"""ADR 0010 protocol over direct JSON payloads; no vectors or expected results."""

from collections.abc import Callable
from functools import partial
from typing import Any

from deixis_core import DuplicateKeyError, Node


class MissingOwn(ValueError):
    """A node spelling supplied no payload; distinct from a protocol failure."""


def payload_equal(slot: str, a: Any, b: Any) -> bool:
    if slot == "fixture":
        return bool(a["class"] == b["class"])
    if slot in ("option", "option-sum"):
        if "none" in a or "none" in b:
            return "none" in a and "none" in b
        return payload_equal(
            "fixture" if slot == "option" else "sum", a["some"], b["some"]
        )
    if slot == "sum":
        tag = "left" if "left" in a else "right"
        return tag in b and payload_equal(
            "fixture" if tag == "left" else "json", a[tag], b[tag]
        )
    if slot == "unit":
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(
            payload_equal("json", a[k], b[k]) for k in a
        )
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(
            payload_equal("json", x, y) for x, y in zip(a, b, strict=True)
        )
    return bool(a == b)


def parse(
    spelling: Any, at: tuple[str, ...] = (), holes: list[tuple[str, ...]] | None = None
) -> Node[Any]:
    if holes is not None and "hole" in spelling:
        holes.append(at)
        return Node.compose(
            None, []
        )  # Private placeholder, replaced before returning a tree.
    if "own" not in spelling:
        raise MissingOwn("missing own")
    return Node.compose(
        spelling["own"],
        [
            (bytes.fromhex(k), parse(n, (*at, k), holes))
            for k, n in spelling["children"]
        ],
    )


def spell(
    node: Node[Any], at: tuple[str, ...] = (), holes: tuple[tuple[str, ...], ...] = ()
) -> Any:
    if at in holes:
        return {"hole": {}}
    own, children = node.decompose()
    return {
        "own": own,
        "children": [[k.hex(), spell(n, (*at, k.hex()), holes)] for k, n in children],
    }


def map_node(node: Node[Any], f: Callable[[Any], Any]) -> Node[Any]:
    own, children = node.decompose()
    return Node.compose(f(own), [(k, map_node(n, f)) for k, n in children])


def apply(name: str, value: Any) -> Any:
    if name == "id":
        return value
    if name == "class-suffix-x":
        return {**value, "class": value["class"] + "x"}
    if name == "representation-upper":
        return {**value, "representation": value["representation"].upper()}
    if name == "none-to-z":
        return (
            {"some": {"class": "z", "representation": "z"}}
            if "none" in value
            else value
        )
    if name == "option-map-class-suffix-x":
        return (
            value
            if "none" in value
            else {"some": apply("class-suffix-x", value["some"])}
        )
    if name == "wrap-in-array":
        return [value]
    raise ValueError(f"unknown map {name}")


def handle(
    request: dict[str, Any], replace: Callable[..., Any], attach: Callable[..., Any]
) -> dict[str, Any]:
    op = request["op"].removeprefix("mnode.")
    slot = request["slot"]
    missing: dict[str, Any] = {"undefined": {}}

    def path(p: list[str]) -> list[bytes]:
        return [bytes.fromhex(k) for k in p]

    def selected(n: Node[Any] | None, value: bool = False) -> Any:
        return missing if n is None else {"defined": n.own if value else spell(n)}

    if op == "equal":
        return {
            "equal": parse(request["left"]).equal_by(
                parse(request["right"]), lambda a, b: payload_equal(slot, a, b)
            )
        }
    result: Any
    if op == "construct":
        try:
            result = selected(parse(request["node"]))
        except DuplicateKeyError as error:
            return {"error": "duplicate_key", "key": error.key.hex()}
        except MissingOwn:
            result = missing
    elif op == "compose":
        result = spell(parse(request))
    elif op == "assemble":
        children = []
        for key, tag, raw in request["children"]:

            def inject(v: Any, tag: str = tag) -> Any:
                value = {tag: v}
                return {"some": value} if slot == "option-sum" else value

            children.append((bytes.fromhex(key), map_node(parse(raw), inject)))
        try:
            result = selected(Node.compose(request["parent"], children))
        except DuplicateKeyError as error:
            return {"error": "duplicate_key", "key": error.key.hex()}
    elif op in ("plug", "rebuild"):
        holes: list[tuple[str, ...]] = []
        n = parse(request["context" if op == "plug" else "skeleton"], (), holes)
        if op == "plug":
            if len(holes) != 1:
                raise ValueError("one hole required")
            supplied = [(holes[0], request["subtree"])]
        else:
            supplied = [(tuple(p), raw) for p, raw in request["subtrees"]]
        if len(supplied) != len(holes) or {p for p, _ in supplied} != set(holes):
            raise ValueError("subtrees must exactly fill holes")
        for p, raw in supplied:
            n = replace(n, path(list(p)), parse(raw))
        result = spell(n)
    elif op.startswith("attach"):
        current: Node[Any] | None = parse(request["A"])
        steps = request["steps"] if op == "attach-seq" else [request]
        for step in steps:
            if current is not None:
                current = attach(
                    current,
                    path(step["parent"]),
                    bytes.fromhex(step["key"]),
                    parse(step["B"]),
                )
        if current is not None and op in ("attach-then-at", "attach-then-valueAt"):
            current = current.at(path(request["at"]))
        result = selected(current, op == "attach-then-valueAt")
    else:
        n = parse(request["node"])
        if op == "own":
            result = n.own
        elif op in ("at", "valueAt"):
            result = selected(n.at(path(request["path"])), op == "valueAt")
        elif op == "decompose":
            result = {"parts": spell(n)}
        elif op in ("map", "at-after-map", "embed-some"):
            if op == "embed-some":
                n = map_node(n, lambda v: {"some": v})
            else:
                fs = request["f"] if isinstance(request["f"], list) else [request["f"]]
                for f in fs:
                    n = map_node(n, partial(apply, f))
            result = (
                selected(n.at(path(request["path"])))
                if op == "at-after-map"
                else spell(n)
            )
        elif op == "replace":
            replaced = replace(n, path(request["path"]), parse(request["subtree"]))
            if replaced is not None and "then" in request:
                replaced = replace(
                    replaced, path(request["path"]), parse(request["then"])
                )
            result = selected(replaced)
        elif op == "split":
            found = n.at(path(request["path"]))
            result = (
                missing
                if found is None
                else {
                    "defined": {
                        "context": spell(n, (), (tuple(request["path"]),)),
                        "subtree": spell(found),
                    }
                }
            )
        elif op == "cut":
            paths = [tuple(p) for p in request["paths"]]
            found_nodes = [n.at(path(list(p))) for p in paths]
            prefix = any(
                i != j and q[: len(p)] == p
                for i, p in enumerate(paths)
                for j, q in enumerate(paths)
            )
            if prefix or any(s is None for s in found_nodes):
                result = missing
            else:
                result = {
                    "defined": {
                        "skeleton": spell(n, (), tuple(paths)),
                        "subtrees": [
                            [list(p), spell(s)]
                            for p, s in zip(paths, found_nodes, strict=True)
                            if s is not None
                        ],
                    }
                }
        else:
            raise ValueError(f"unknown operation {op}")
    return {"result": result}
