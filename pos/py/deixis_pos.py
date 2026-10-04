"""deixis-pos-v1 — the spelling of positions into deixis keys.

    κ(i) = ff^(len(mag(i)) − 1) ‖ 00 ‖ mag(i)

where ``mag(i)`` is the shortest unsigned big-endian encoding of ``i``, with
``mag(0) = 00``. See ``docs/design/0002-positional-keys.md``. The spelling is
injective, prefix-free, and order-preserving: ``i < j`` iff ``key(i)`` sorts before
``key(j)`` in unsigned lexicographic byte order — so a positionally-keyed struct's
canonical entry order *is* sequence order, and a consumer walking a sequence never
parses a key.

The profile is total over ℕ, and so is this implementation: Python integers are
unbounded.

There is deliberately no decoder: consumers recognize positional structure by
generating ``key(0) ‖ key(1) ‖ …`` and comparing octets, or test membership with
:func:`is_key`. Normalizing a non-canonical spelling to its index would be a repair
pass, and a repair pass coarsens identity.
"""

from __future__ import annotations

PROFILE = "deixis-pos-v1"
"""The name of the profile this module implements."""


def key(i: int) -> bytes:
    """``κ(i)`` — the key bytes spelling position ``i``."""
    if i < 0:
        raise ValueError("positions are naturals")
    # mag(i): shortest big-endian, one 00 byte for zero.
    magnitude = i.to_bytes(max(1, (i.bit_length() + 7) // 8), "big")
    return b"\xff" * (len(magnitude) - 1) + b"\x00" + magnitude


def is_key(candidate: bytes) -> bool:
    """Whether ``candidate`` is ``κ(i)`` for some ``i`` — exact membership, no
    normalization.

    Rejects truncation, a malformed run/terminator, a non-shortest magnitude, and
    trailing bytes. ``is_key(key(i))`` holds for every ``i``.
    """
    # The ff-run promises the magnitude length; 00 terminates it.
    run = 0
    while run < len(candidate) and candidate[run] == 0xFF:
        run += 1
    if run >= len(candidate):
        return False  # all ff (or empty): no terminator
    if candidate[run] != 0x00:
        return False  # run must end in 00
    magnitude = len(candidate) - (run + 1)
    if magnitude != run + 1:
        return False  # truncated magnitude, or trailing bytes
    # Shortest form: no leading zero, except the single-byte magnitude 00 (position 0).
    return magnitude == 1 or candidate[run + 1] != 0x00
