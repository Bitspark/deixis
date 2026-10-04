"""Tests of the conformance CLI's own plumbing, through a real process.

Nothing here judges the codec: the harness does that against the corpus. What is checked
is what no corpus case can see: that a request reaches the core as the JSON it was,
whatever the locale's encoding (every fixture class in the corpus is ASCII), and that
the CLI serves a request only as the protocol states it — ``holding`` names base ids,
and ``cuts`` are strictly ascending interior offsets. Expected payloads are computed
as ``class.encode("utf-8")`` and artifacts by the core's encoder; no node octets are
authored.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parent.parent / "core" / "py"))

from codec import FIXTURE_ID  # noqa: E402
from deixis_codec import (  # noqa: E402
    FLAT_MAGIC,
    IDENTITY_BYTES,
    encode_flat,
    encode_uvarint,
    option_of,
    read_uvarint,
)
from deixis_core import Node, Some  # noqa: E402


def run_cli(
    request: dict[str, Any], encoding: str = "utf-8"
) -> subprocess.CompletedProcess[bytes]:
    """One request to main.py as a line of UTF-8 JSON with its non-ASCII characters
    raw, as the harness sends them, while the child's locale encoding is
    ``encoding``."""
    env = dict(os.environ, PYTHONIOENCODING=encoding, PYTHONUTF8="0")
    line = json.dumps(request, ensure_ascii=False) + "\n"
    return subprocess.run(
        [sys.executable, str(_HERE / "main.py")],
        input=line.encode("utf-8"),
        capture_output=True,
        env=env,
        timeout=60,
        check=False,
    )


def ask(request: dict[str, Any], encoding: str = "utf-8") -> dict[str, Any]:
    """The CLI's answer to one request, which it must serve without failing."""
    run = run_cli(request, encoding)
    if run.returncode != 0:
        raise AssertionError(run.stderr.decode("utf-8", "replace"))
    [answer] = run.stdout.decode("utf-8").splitlines()
    response: dict[str, Any] = json.loads(answer)
    return response


def payload_of(octets: bytes, slot_codec_id: bytes) -> bytes:
    """The root payload of a flat artifact, found by §5's grammar: after the header,
    ``cuvarint(len(payload)) ‖ payload``."""
    at = len(FLAT_MAGIC) + len(encode_uvarint(len(slot_codec_id))) + len(slot_codec_id)
    read = read_uvarint(octets, at)
    assert isinstance(read, tuple), read
    length, start = read
    return octets[start : start + length]


CLASSES = (
    chr(0xE9),  # e acute: two octets in UTF-8, and the class interop caught
    " ".join(map(chr, (0x2115, 0x2248, 0xBD))),  # double-struck N, almost-equal, half
    chr(0x1F600),  # outside the BMP: four octets
)
"""Fixture classes whose UTF-8 no single-octet locale decodes faithfully."""


class EncodingTests(unittest.TestCase):
    def test_a_non_ascii_class_reaches_the_core_as_utf8(self) -> None:
        for encoding in ("cp1252", "latin-1", "utf-8"):
            for class_ in CLASSES:
                with self.subTest(encoding=encoding, class_=class_):
                    response = ask(
                        {
                            "id": "1",
                            "op": "codec.encodeFlat",
                            "slot_codec": FIXTURE_ID.hex(),
                            "node": {
                                "own": {"class": class_, "representation": ""},
                                "children": [],
                            },
                        },
                        encoding,
                    )
                    self.assertEqual(response["id"], "1")
                    octets = bytes.fromhex(response["bytes"])
                    self.assertEqual(
                        payload_of(octets, FIXTURE_ID), class_.encode("utf-8")
                    )


class RequestTests(unittest.TestCase):
    def test_holding_names_base_ids_only(self) -> None:
        # §13 grants one direction: option-of over a held id is held, and the core
        # derives it. Holding option-of(c) does not imply holding c, so a list that
        # names anything but a base id this CLI implements is a request it cannot
        # serve — unlike an empty list, which asks for a codec-blind decoder.
        option = option_of(IDENTITY_BYTES)
        none: Node[Some[bytes] | None] = Node.compose(None, [])
        data = encode_flat(none, option).hex()

        def decode(holding: list[str]) -> dict[str, Any]:
            return ask(
                {"id": "1", "op": "codec.decodeFlat", "bytes": data, "holding": holding}
            )

        self.assertEqual(
            decode([IDENTITY_BYTES.id.hex()])["value"],
            {"own": {"none": {}}, "children": []},
        )
        self.assertEqual(
            decode([])["verdict"],
            {"class": "unsupported", "code": "unsupported_slot_codec"},
        )
        for listed in (
            [option.id.hex()],
            [IDENTITY_BYTES.id.hex(), option.id.hex()],
            [IDENTITY_BYTES.id.hex()[:2]],  # an id's first octet alone
            ["0002"],  # assigned, and not implemented here
        ):
            self.assertEqual(
                decode(listed), {"error": "unsupported", "id": "1"}, listed
            )

    def test_cuts_are_strictly_ascending_interior_offsets(self) -> None:
        # Anything else is a malformed request, which the CLI refuses as it refuses
        # every malformed request: on stderr, with a nonzero exit.
        data = encode_flat(Node.compose(b"xy", []), IDENTITY_BYTES)
        request: dict[str, Any] = {
            "id": "1",
            "op": "codec.decodeFlat",
            "bytes": data.hex(),
            "holding": [IDENTITY_BYTES.id.hex()],
            "end": True,
        }
        end = len(data)
        served: tuple[list[Any], ...] = ([], [1], [1, end - 1])
        for cuts in served:
            self.assertIn("value", ask({**request, "cuts": cuts}), cuts)
        malformed: tuple[list[Any], ...] = (
            [0],
            [end],
            [end + 1],
            [-1],
            [2, 2],
            [3, 1],
            [1.5],
            [True],
        )
        for cuts in malformed:
            run = run_cli({**request, "cuts": cuts})
            self.assertNotEqual(run.returncode, 0, cuts)
            self.assertIn(b"cuts", run.stderr, cuts)


if __name__ == "__main__":
    unittest.main()
