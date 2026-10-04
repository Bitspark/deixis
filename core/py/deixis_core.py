"""
deixis/core — finite keyed trees with one opaque value at every node.

Node[T] = T × FinMap[Bytes, Node[T]].

The payload carries no bounds. Equality is an optional caller-supplied
relation over the entire T. A caller can choose an optional payload type;
the core neither unwraps it nor assigns meaning to its absence tag.
Own values and children are independent. Missing paths are distinct from
existing nodes whose payload happens to be empty, null or an option.
See docs/design/0010-mandatory-node-values.md, TREE.md and PATH.md.
Parts, navigation and supplied equality are the public core; attachment,
replacement, contexts, cuts and mapping are derivable through these parts.
"""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from itertools import pairwise


@dataclass(frozen=True, slots=True)
class Some[T]:
    """``Some(value)``: a present own value, boxed.

    This is an opt-in payload helper. Node leaves its equivalence to the caller.
    """

    value: T


class DuplicateKeyError(Exception):
    """Raised when :meth:`Node.compose` is given the same key twice.

    The stable rejection code for this condition is ``"duplicate_key"``.
    """

    code = "duplicate_key"

    def __init__(self, key: bytes) -> None:
        super().__init__(f"duplicate key: {key.hex()}")
        #: The key that appeared more than once.
        self.key = key


class Node[T]:
    """A node: an opaque own value and a finite map from byte keys to nodes. Nodes are
    immutable once constructed.

    deixis does not define identity, it lifts one from the slot, and the slot is not
    required to have a good equality — or any particular equality. Compare nodes with
    :meth:`Node.equal_by`, passing the relation explicitly.
    """

    # ``_entries`` is sorted by key under unsigned-octet lexicographic order, keys
    # unique — both halves established in ``compose`` and relied on by ``get`` (binary
    # search) and ``equal_by`` (pairwise zip).
    __slots__ = ("_entries", "_own")

    def __init__(
        self,
        own: T,
        entries: tuple[tuple[bytes, Node[T]], ...],
    ) -> None:
        """Internal. Use :meth:`compose`."""
        self._own = own
        self._entries = entries

    # --- parts ------------------------------------------------------------------------

    @classmethod
    def compose(
        cls,
        own: T,
        children: Iterable[tuple[bytes | bytearray | memoryview, Node[T]]],
    ) -> Node[T]:
        """``Node(own, children)`` from children in any order.

        Keys are normalized to ``bytes`` (the defensive copy). Children are sorted, so
        insertion order is not observable — sibling order is not part of a node. Raises
        :class:`DuplicateKeyError` if two children share a key: a finite map has one
        child per key, and deixis has no policy for which would win, so it declines to
        choose.
        """
        owned = sorted(
            ((bytes(key), node) for key, node in children),
            key=lambda entry: entry[0],
        )
        for previous, current in pairwise(owned):
            if previous[0] == current[0]:
                raise DuplicateKeyError(current[0])
        return cls(own, tuple(owned))

    def decompose(self) -> tuple[T, list[tuple[bytes, Node[T]]]]:
        """The node's parts, ``(own, children)``: its own value, and every child under
        its exact key as a whole subtree, in unsigned-octet lexicographic key order. A
        node without children returns an empty map, never a missing one. Composing the
        parts again gives the node back, and nothing about the node is outside them."""
        return self._own, list(self._entries)

    # --- inspection -------------------------------------------------------------------

    @property
    def own(self) -> T:
        """The complete opaque payload, including a caller-chosen None value."""
        return self._own

    def __len__(self) -> int:
        """Number of children. Says nothing about the own value."""
        return len(self._entries)

    def __bool__(self) -> bool:
        """Always true: a node that exists is never falsy, whatever it holds, so that
        ``if node.at(path):`` reads as "the node exists" even for a childless node."""
        return True

    def get(self, key: bytes | bytearray | memoryview) -> Node[T] | None:
        """The child at ``key``, or ``None`` if the key is not in the domain. Key
        equality is octet equality."""
        wanted = bytes(key)
        index = bisect_left(self._entries, wanted, key=lambda entry: entry[0])
        if index < len(self._entries) and self._entries[index][0] == wanted:
            return self._entries[index][1]
        return None

    def entries(self) -> list[tuple[bytes, Node[T]]]:
        """Children in unsigned-octet lexicographic key order."""
        return list(self._entries)

    def keys(self) -> list[bytes]:
        """The domain in order."""
        return [key for key, _ in self._entries]

    def at(self, path: Iterable[bytes | bytearray | memoryview]) -> Node[T] | None:
        """``self / path`` — resolve a path, a *sequence* of byte keys. See
        ``docs/PATH.md``.

        The empty path resolves to ``self``. A miss is ``None``: resolution never
        creates, never defaults, and never searches, and it walks children only — it
        never enters an own value, whatever that value holds. The own value at a path is
        read off the node found there: ``at``, then :attr:`own`.

        A path is not a string. Keys may contain any bytes, including separators and no
        bytes at all, so there is no delimited spelling to accept here — a caller
        wanting one owes a separator and escaping profile of its own.
        """
        node: Node[T] | None = self
        for key in path:
            if node is None:
                return None
            node = node.get(key)
        return node

    # --- identity ---------------------------------------------------------------------

    def equal_by(self, other: Node[T], eq: Callable[[T, T], bool]) -> bool:
        """Identity, lifted from the slot equality ``eq`` supplied by the caller.

            Node(o, m) = Node(o', m')   iff  o ≈ o'  and  dom m = dom m'
                                             and  m(k) = m'(k) for every k


        The result is an equivalence relation exactly when ``eq`` is one. Pass a
        relation that is not reflexive — IEEE ``==`` over floats, say, where
        ``nan != nan`` — and a node stops being equal to itself. deixis lifts what it is
        given and makes no attempt to repair it.
        """
        mine, theirs = self._own, other._own
        if not eq(mine, theirs):
            return False
        # Both sides are sorted and key-unique, so equal domains plus pointwise-equal
        # children is exactly a pairwise walk.
        if len(self._entries) != len(other._entries):
            return False
        return all(
            left_key == right_key and left_child.equal_by(right_child, eq)
            for (left_key, left_child), (right_key, right_child) in zip(
                self._entries, other._entries, strict=True
            )
        )
