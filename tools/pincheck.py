r"""Every `pins` fragment a vector cites must still appear verbatim in CODEC.md.

WHY THIS EXISTS. The corpus and the specification agreed with each other only by hand.
Measured 2026-09-03 against a 20-mutation copy of `CODEC.md` — twelve of the mutations
changing which octets are canonical, and therefore changing addresses — every gate the
repository had stayed green:

    speccheck 0 · linkcheck 0 · derive-vector-profiles 0 · conformance 103/103
                                            mechanical kill rate: 0 / 20

Nothing derived the corpus's bytes from the prose. `speccheck` recomputes each published
digest from the preimage printed beside it, which holds whatever the document says about
ordering; the conformance harness replays vectors against implementations of the *floor*,
and the codec has none yet. So a rule could be reversed — ascending keys to descending,
first-use order to hash order — and the corpus asserting those very bytes would not
notice.

WHAT A `pins` ENTRY IS. An exact fragment of `CODEC.md` that the case's octets DEPEND ON.
Not a citation for the reader: a claim that *if this text changes, these bytes are no
longer the right answer*. `flat/prefix-order-a-before-ab` pins **strictly ascending
lexicographic order** because reversing that word makes its bytes wrong.

WHAT IT CATCHES, AND THE LIMIT THAT MATTERS MORE.
    catches   the pinned TEXT changing, being reworded, or being deleted
    misses    a semantic change made ANYWHERE THE CASES DO NOT QUOTE

⚠ So this is not a proof that the corpus follows from the specification, and it must not
be read as one. **A codec implementation is still the first artifact that must read the
rule and produce the octet** (0006's ordering) — this only ensures the corpus notices
when the sentence it was written against stops saying what it said. ⚠ It is also exact-
match by design: a purely editorial rewording will fail it. That is the intended cost. A
fragment that cannot survive copy-editing is a fragment whose case should be re-read.

Discovery is BY SHAPE — case arrays are recognised by their contents, not by an
enumerated list of field names, which is the defect two tools here have already shipped.

stdlib only, read-only, and safe to import: it writes nothing and does nothing on import.
"""

from __future__ import annotations

import io
import json
import os
import sys

# This repo is developed on Windows, where the console default is cp1252 and a
# character outside it raises UnicodeEncodeError - a check that crashes before printing
# its own verdict. Copied from speccheck.py, which has carried it since 533849d; added
# here after claimcheck exited 1 with every claim holding, dying on a U+26A0 in its own
# caveat line. pincheck and linkcheck survived only because their non-ASCII happens to
# exist in cp1252 - luck, not design, and one edit away from the same failure.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SPEC = os.path.join("docs", "CODEC.md")
VECTORS = "vectors"


def case_arrays(obj):
    """Yield every list of case-like dicts, wherever it sits. By shape, not by name."""
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
    # A vector file names the specification its octets were derived from in its own
    # "spec" field, and its pins are checked against THAT text. Since ADR 0011 the v1
    # corpus cites docs/CODEC-v1.md while docs/CODEC.md is v2; a file without the field
    # is checked against docs/CODEC.md, as before.
    texts = {}

    def spec_text(path):
        key = os.path.normpath(path)
        if key not in texts:
            texts[key] = (io.open(key, encoding="utf-8").read()
                          if os.path.exists(key) else None)
        return texts[key]

    if spec_text(SPEC) is None:
        print("pincheck: {} not found".format(SPEC))
        return 1

    missing = []
    pinned_cases = 0
    fragments = 0
    files = sorted(f for f in os.listdir(VECTORS) if f.endswith(".json"))

    for name in files:
        path = os.path.join(VECTORS, name)
        try:
            doc = json.load(io.open(path, encoding="utf-8"))
        except ValueError as exc:
            print("{}: not valid JSON ({})".format(path, exc))
            return 1
        # The field may carry a section after the path ("docs/CODEC.md §10"); the
        # path is its first token.
        cited = (doc.get("spec") or SPEC).split()[0] if isinstance(doc, dict) else SPEC
        spec = spec_text(cited)
        if spec is None:
            print("{}: cites spec {} which does not exist".format(path, cited))
            return 1
        for array in case_arrays(doc):
            for case in array:
                pins = case.get("pins")
                if not pins:
                    continue
                pinned_cases += 1
                for fragment in pins:
                    fragments += 1
                    if fragment not in spec:
                        missing.append((path, case["name"], fragment, cited))

    for path, case_name, fragment, cited in missing:
        head = fragment if len(fragment) <= 90 else fragment[:87] + "..."
        print("{}: {}".format(path, case_name))
        print("    pins text no longer in {}: {!r}".format(cited, head))

    if missing:
        print("\n{} pinned fragment(s) no longer appear in the spec their file cites.".format(len(missing)))
        print("Either the specification changed under these cases — in which case their "
              "octets need re-deriving, not their pins re-typing — or the text was "
              "reworded, in which case update the pin AND confirm the bytes still hold.")
        return 1

    print("pins: {} fragments across {} cases all still present in the spec each file cites ({})".format(
        fragments, pinned_cases, ", ".join(sorted(k for k, v in texts.items() if v is not None))))
    return 0


if __name__ == "__main__":
    sys.exit(run())
