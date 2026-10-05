"""IDENTITY.md's projection (ID9) and its composition inside one tree (ID10).

A scripted harness over the core's native Node; no vectors or expected results.
Projection is not a deixis API (ID8): invocation adds zero interface to deixis. A
tree's own values are live capability objects, one per distinct id in each fixture,
and every tree is built and read through the core's compose, decompose and at.
"""

from collections.abc import Callable
from typing import Any

from deixis_core import Node

Outcome = dict[str, Any]
MISSING_PATH: Outcome = {"missing-path": {}}
UNSCRIPTED: Outcome = {"fault": "unscripted"}


class Capability:
    """A live capability: its behaviour comes from the world script, and every
    invocation is recorded in its fixture's log. A count capability counts its own
    invocations."""

    def __init__(self, fixture: "Fixture", cap_id: bytes, behaviour: Any) -> None:
        self.fixture = fixture
        self.cap_id = cap_id
        self.behaviour = behaviour
        self.calls = 0

    def invoke(self, args: bytes) -> Outcome:
        self.calls += 1
        self.fixture.log.append([self.cap_id.hex(), args.hex()])
        if self.behaviour is None:
            return UNSCRIPTED
        if "count" in self.behaviour:
            return {"ok": str(self.calls)}
        return dict(self.behaviour)


class Fixture:
    """One separately initialised fixture: fresh capability objects, one per distinct
    id, and a fresh log."""

    def __init__(self, world: list[list[Any]]) -> None:
        self.world = {bytes.fromhex(cap_id): behaviour for cap_id, behaviour in world}
        self.capabilities: dict[bytes, Capability] = {}
        self.log: list[list[str]] = []

    def capability(self, spelling: str) -> Capability:
        cap_id = bytes.fromhex(spelling)
        if cap_id not in self.capabilities:
            self.capabilities[cap_id] = Capability(self, cap_id, self.world.get(cap_id))
        return self.capabilities[cap_id]

    def read(self, spelling: Any) -> Node[Capability]:
        return Node.compose(
            self.capability(spelling["own"]),
            [(bytes.fromhex(k), self.read(n)) for k, n in spelling["children"]],
        )


def lift(node: Node[Capability], path: list[bytes], args: bytes) -> Outcome:
    """MissingPath with no invocation when at(N, p) is absent, otherwise exactly one
    invocation of the selected node's own capability."""
    selected = node.at(path)
    return MISSING_PATH if selected is None else selected.own.invoke(args)


def reconstruct(node: Node[Capability]) -> Node[Capability]:
    """Rebuild every node through decompose and then compose."""
    own, children = node.decompose()
    return Node.compose(own, [(k, reconstruct(child)) for k, child in children])


def side(
    request: dict[str, Any], run: Callable[[Node[Capability]], Outcome]
) -> dict[str, Any]:
    """One side of a lift on its own fixture: the outcome and that fixture's log."""
    fixture = Fixture(request["world"])
    outcome = run(fixture.read(request["node"]))
    return {"outcome": outcome, "invocations": fixture.log}


def read_mutable(spelling: Any, buffers: list[bytearray]) -> Node[bytes]:
    """A tree built from key buffers the harness owns and mutates afterwards."""
    children: list[tuple[bytes | bytearray | memoryview, Node[bytes]]] = []
    for k, n in spelling["children"]:
        key = bytearray.fromhex(k)
        buffers.append(key)
        children.append((key, read_mutable(n, buffers)))
    return Node.compose(bytes.fromhex(spelling["own"]), children)


def path(spelling: list[str]) -> list[bytes]:
    return [bytes.fromhex(k) for k in spelling]


def handle(request: dict[str, Any]) -> dict[str, Any]:
    op = request["op"].removeprefix("projection.")
    if op == "lift":
        p, args = path(request["path"]), bytes.fromhex(request["args"])
        return {"result": side(request, lambda n: lift(n, p, args))}
    if op == "lift-cut":
        prefix, suffix = path(request["prefix"]), path(request["suffix"])
        args = bytes.fromhex(request["args"])

        def select_then_lift(n: Node[Capability]) -> Outcome:
            selected = n.at(prefix)
            return MISSING_PATH if selected is None else lift(selected, suffix, args)

        return {
            "result": {
                "select-then-lift": side(request, select_then_lift),
                "lift-concat": side(request, lambda n: lift(n, prefix + suffix, args)),
            }
        }
    if op == "lift-sequence":
        fixture = Fixture(request["world"])
        node = fixture.read(request["node"])
        if request["reconstruct"]:
            node = reconstruct(node)
        outcomes = [
            lift(node, path(p), bytes.fromhex(args)) for p, args in request["steps"]
        ]
        return {"result": {"outcomes": outcomes, "invocations": fixture.log}}
    if op == "keys-after-mutation":
        buffers: list[bytearray] = []
        tree = read_mutable(request["node"], buffers)
        for buffer in buffers:
            for i in range(len(buffer)):
                buffer[i] ^= 0xFF
        found = [tree.at(path(p)) is not None for p in request["probes"]]
        return {"result": {"found": found}}
    raise ValueError(f"unknown projection operation {op}")
