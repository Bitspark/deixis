"""ADR 0013's scripted binding laws over the core's native Node; no vectors or results.

Binding is not a deixis API. This is the scripted harness of ADR 0013 §10 item 1: a
name is bytes, preparation turns it into a request that captures the context and the
path from the original root, and a binder is a script table that records every name it
is asked for. Every tree is built and read through the core's compose, decompose and at.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from deixis_core import Node

Outcome = dict[str, Any]
UNRECOGNIZED: Outcome = {"refused": "unrecognized"}


@dataclass(frozen=True)
class Request:
    """A binding request: the exact name bytes and its captured scope, the context's
    origin and the cursor, a path from the original root."""

    name: bytes
    origin: str
    at: tuple[bytes, ...]


class Binder:
    """A script table that records every name it is asked to resolve, so selection's
    noninterference is observed rather than inferred (ADR 0013 §5)."""

    def __init__(self, script: list[list[Any]]) -> None:
        self.table: dict[bytes, Outcome] = {
            bytes.fromhex(name): outcome for name, outcome in script
        }
        self.consulted: list[bytes] = []

    def resolve(self, request: Request) -> Outcome:
        self.consulted.append(request.name)
        return self.table.get(request.name, UNRECOGNIZED)


class Failed(Exception):
    """The eager batch met an outcome that is not bound."""

    def __init__(self, outcome: Outcome) -> None:
        super().__init__(outcome)
        self.outcome = outcome


def read(spelling: Any) -> Node[bytes]:
    return Node.compose(
        bytes.fromhex(spelling["own"]),
        [(bytes.fromhex(k), read(n)) for k, n in spelling["children"]],
    )


def prepare(
    node: Node[bytes], origin: str, at: tuple[bytes, ...] = ()
) -> Node[Request]:
    """P_{γ·at}: each name becomes a request whose cursor is its path from the original
    root. Pure: it consults nothing."""
    name, children = node.decompose()
    return Node.compose(
        Request(name, origin, at),
        [(k, prepare(child, origin, (*at, k))) for k, child in children],
    )


def bind_all(node: Node[Request], binder: Binder) -> Node[str]:
    """resolveAllOrFail: depth-first, a node before its children, and children in the
    core's unsigned-octet key order; the first outcome that is not bound stops it."""
    request, children = node.decompose()
    outcome = binder.resolve(request)
    if set(outcome) != {"bound"}:
        raise Failed(outcome)
    return Node.compose(
        outcome["bound"], [(k, bind_all(child, binder)) for k, child in children]
    )


def spell[T](node: Node[T], own: Callable[[T], Any]) -> Any:
    value, children = node.decompose()
    return {
        "own": own(value),
        "children": [[k.hex(), spell(child, own)] for k, child in children],
    }


def spell_request(request: Request) -> Any:
    return {
        "name": request.name.hex(),
        "origin": request.origin,
        "at": [k.hex() for k in request.at],
    }


def side(node: Node[Request] | None) -> Any:
    return (
        {"undefined": {}} if node is None else {"defined": spell(node, spell_request)}
    )


def handle(request: dict[str, Any]) -> dict[str, Any]:
    op = request["op"].removeprefix("binding.")
    node = read(request["node"])
    origin: str = request["context"]
    if op == "prepare":
        return {"result": spell(prepare(node, origin), spell_request)}
    path = tuple(bytes.fromhex(k) for k in request.get("path", []))
    if op == "at-after-prepare":
        selected = node.at(path)
        return {
            "result": {
                "prepare-then-select": side(prepare(node, origin).at(path)),
                "select-then-prepare": side(
                    None if selected is None else prepare(selected, origin, path)
                ),
            }
        }
    binder = Binder(request["binder"])
    outcome: Any
    if op == "resolve-at":
        found = prepare(node, origin).at(path)
        # Structural absence is selection's answer; the binder is never asked.
        outcome = {"absent": {}} if found is None else binder.resolve(found.own)
    elif op == "resolve-all-or-fail":
        try:
            outcome = {
                "bound-tree": spell(bind_all(prepare(node, origin), binder), str)
            }
        except Failed as failure:
            outcome = {"failed": failure.outcome}
    else:
        raise ValueError(f"unknown binding operation {op}")
    return {
        "result": {
            "outcome": outcome,
            "consulted": [name.hex() for name in binder.consulted],
        }
    }
