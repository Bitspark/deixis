"""Unit tests and vector replay for pos/py."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from deixis_pos import is_key, key  # noqa: E402

_VECTORS = _HERE.parent.parent / "vectors"


class PosUnitTests(unittest.TestCase):
    def test_the_spec_examples(self) -> None:
        self.assertEqual(key(0), bytes([0x00, 0x00]))
        self.assertEqual(key(1), bytes([0x00, 0x01]))
        self.assertEqual(key(255), bytes([0x00, 0xFF]))
        self.assertEqual(key(256), bytes([0xFF, 0x00, 0x01, 0x00]))
        self.assertEqual(key(65535), bytes([0xFF, 0x00, 0xFF, 0xFF]))

    def test_order_preserving_across_boundaries(self) -> None:
        # Adjacent pairs around magnitude-length boundaries — beyond u64, since
        # positions are unbounded and the profile is total over ℕ.
        boundaries = [
            0,
            1,
            255,
            256,
            65535,
            65536,
            2**32 - 1,
            2**32,
            2**64 - 1,
            2**64,
            10**30,
        ]
        for i in boundaries:
            self.assertLess(key(i), key(i + 1), f"κ({i}) must sort before κ({i + 1})")

    def test_injective_and_prefix_free_over_a_dense_range(self) -> None:
        keys = [key(i) for i in range(600)]
        for i, a in enumerate(keys):
            for j, b in enumerate(keys):
                if i == j:
                    continue
                self.assertNotEqual(a, b, f"κ({i}) = κ({j})")
                self.assertFalse(b.startswith(a), f"κ({i}) is a prefix of κ({j})")

    def test_membership_accepts_exactly_the_image(self) -> None:
        for i in [*range(600), 65535, 65536, 2**64 - 1, 10**30]:
            self.assertTrue(is_key(key(i)), f"is_key(κ({i}))")

    def test_positions_are_naturals(self) -> None:
        with self.assertRaises(ValueError):
            key(-1)


class VectorsReplay(unittest.TestCase):
    def test_replay(self) -> None:
        file = json.loads((_VECTORS / "positional.json").read_text(encoding="utf-8"))

        self.assertGreaterEqual(len(file["keys"]), 15, "vector file shrank?")
        previous: bytes | None = None
        for case in file["keys"]:
            position = int(case["position"])
            expected = bytes.fromhex(case["key"])
            spelled = key(position)
            self.assertEqual(spelled, expected, f"κ({position})")
            self.assertTrue(is_key(spelled), f"is_key(κ({position}))")
            # File order is ascending positions; keys must ascend with it.
            if previous is not None:
                self.assertLess(
                    previous,
                    spelled,
                    f"order preservation visible in file order broke at {position}",
                )
            previous = spelled

        self.assertGreaterEqual(len(file["invalid"]), 9, "vector file shrank?")
        for case in file["invalid"]:
            self.assertFalse(
                is_key(bytes.fromhex(case["bytes"])),
                f"must reject {case['bytes']}: {case['reason']}",
            )


if __name__ == "__main__":
    unittest.main()
