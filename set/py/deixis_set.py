"""deixis-set-v1, slot-member form — the finite-set container by self-keying.

    set(S) = Node(None, { e(x) ↦ Node(Some(x), ∅) | x ∈ S })

See ``docs/design/0005-set-keys.md``. ``e`` is a lawful member encoder for the slot —
``x ≈ y ⟺ e(x) = e(y)``, canonical — and the codec law then does every job a set
semantics needs, with nothing invented: membership is key membership, idempotence is
inherited from the floor's duplicate-key refusal, set identity reduces to node
identity, and enumeration order is spelling order (a set carries no order of its own).

Under ADR 0010 this profile explicitly uses Node[Some[T] | None]: the set node is
unvalued, and every member is a valued node without children. There is deliberately no
repair anywhere: a mis-keyed entry is refused, never re-keyed, and recognition never
prefers a representative among ``≈``-equal members — either may sit under their shared
key.

The node-member form (``member(n) = n``, ``e`` the deixis codec combinator) is gated on
the codec axis and is not implemented here.

This module imports ``deixis_core``; run with ``core/py`` on the path (the tests and CI
arrange this).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Literal

from deixis_core import Node, Some

PROFILE = "deixis-set-v1"
"""The name of the profile this module implements (slot-member form)."""

type Refusal = Literal[
    "mis_keyed",
    "struct_member",
    "leaf_node",
    "valued_set_node",
    "member_with_children",
]
"""Why a node is not a set node, by its stable code:

- ``mis_keyed``: a member ``Node(Some(x), ∅)`` under a key ``k ≠ e(x)``;
- ``struct_member``: a child whose own value is ``None`` — the image of a ``Struct``
  child;
- ``leaf_node``: the set node itself is ``Node(Some(x), ∅)`` — the image of a bare
  ``Leaf``;
- ``valued_set_node``: a set node with at least one member that carries its own value,
  ``Node(Some(t), m)`` with ``m ≠ ∅`` — new in N; the childless case is ``leaf_node``'s;
- ``member_with_children``: a member ``Node(Some(x), m)`` with ``m ≠ ∅`` — new in N.
"""


def set_of[T](members: Iterable[T], e: Callable[[T], bytes]) -> Node[Some[T] | None]:
    """The set node of ``members`` under the member encoder ``e``:
    ``Node(None, {e(x) ↦ Node(Some(x), ∅)})``, entries fed in iteration order.

    Two ``≈``-equal members spell the same key, and the floor refuses the duplicate —
    idempotence is inherited, not implemented. The raised
    :class:`deixis_core.DuplicateKeyError` carries the shared key.
    """
    return Node.compose(
        None, ((e(member), Node.compose(Some(member), [])) for member in members)
    )


def recognize[T](node: Node[Some[T] | None], e: Callable[[T], bytes]) -> Refusal | None:
    """Exact-or-refusal recognition of the slot-member image: an unvalued node whose
    every child is a valued node without children, coherent with its key
    (``k = e(x)``). Returns ``None`` for a set node and the refusal's reason otherwise.

    A node with several defects has several reasons that apply, and any of them may be
    returned: 0005 fixes the verdict, not an order among reasons. A key outside
    ``im(e)`` cannot cohere with any member, so it needs no check of its own — it
    reduces to mis-keying.
    """
    if node.own is not None:
        return "leaf_node" if len(node) == 0 else "valued_set_node"
    for key, child in node.entries():
        member = child.own
        if member is None:
            return "struct_member"
        if len(child) != 0:
            return "member_with_children"
        if e(member.value) != key:
            return "mis_keyed"
    return None


def is_set[T](node: Node[Some[T] | None], e: Callable[[T], bytes]) -> bool:
    """Whether ``node`` is a set node: :func:`recognize` without the reason."""
    return recognize(node, e) is None


def contains[T](node: Node[Some[T] | None], member: T, e: Callable[[T], bytes]) -> bool:
    """Membership: ``x ∈ S`` iff ``e(x) ∈ dom`` — one lookup, no enumeration.

    Defined over set nodes (recognize first where provenance is unknown); on an
    arbitrary node it answers key membership, which coincides on the image. It never
    reads a member's own value.
    """
    return node.get(e(member)) is not None
