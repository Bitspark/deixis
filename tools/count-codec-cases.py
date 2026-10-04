"""Recompute `N of M` for the leaf-codec registry entry in docs/EVIDENCE.md.

M is codec-file entries CARRYING `bytes` — an entry with no octets cannot exercise a
registry id, so counting it would understate the ratio. The peer could not reconstruct an
earlier denominator of 45 from the tree, which is a coverage fraction whose boundary is
unstated: exactly what this repository spent 2026-09-03 repairing elsewhere.

Discovery is by shape, not by an enumerated list of array names.

Scope: the v1 corpus only, meaning files whose top-level "spec" is docs/CODEC-v1.md. The
patterns below are v1 octets (the dxf1 header), so a v2 file can only distort the ratio.
Before this scope existed, the first v2 corpus file moved the result from 23 of 41 to 27 of
62 without any change to v1. A v2 count, if one is wanted, is a new measurement with v2
patterns, not this one.
"""

import io
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def case_arrays(obj):
    if isinstance(obj, dict):
        for value in obj.values():
            if (isinstance(value, list) and value
                    and isinstance(value[0], dict) and "name" in value[0]):
                yield value
            else:
                yield from case_arrays(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from case_arrays(item)


def run() -> int:
    total = exercising = 0
    for name in sorted(os.listdir("vectors")):
        if not (name.startswith("codec") and name.endswith(".json")):
            continue
        doc = json.load(io.open(os.path.join("vectors", name), encoding="utf-8"))
        if not str(doc.get("spec", "")).split()[:1] == ["docs/CODEC-v1.md"]:
            continue          # v1 measurement: only files specified by the v1 text
        for array in case_arrays(doc):
            for case in array:
                octets = (case.get("bytes") or "").lower()
                if not octets:
                    continue          # no octets: cannot carry an id either way
                total += 1
                after = octets.split("6478663102", 1)
                identity = len(after) > 1 and after[1][:4] == "0001"
                private = "6478663112" in octets or "01fb44" in octets
                reserved = "6478663102ff" in octets
                if identity or private or reserved:
                    exercising += 1
    print("{} of {}".format(exercising, total))
    return 0


if __name__ == "__main__":
    sys.exit(run())
