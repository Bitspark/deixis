r"""Re-run the measurement a ledger quotes, and refuse the build when it has moved.

WHY. On 2026-09-03 six stale claims were found across two ledgers in one morning, and
**none of them was in `CODEC.md`** — every one was in a governance document. That is not a
difference in care, it is a difference in gating: `CODEC.md`'s claims are checked six ways
(§refs, code declaration and ordering, profile agreement, digest recomputation, corpus pin
binding, table shape) and a ledger's claims were checked none. The freeze manifest is
signed against the ledgers.

A citation resolver was built first and measured **0 of 6** — the failing direction carries
no syntax; a dangling `§99` is trivially checkable and has never happened here. Sorting the
six by the FORM of the claim rather than its subject splits them 4/2: four quote a command
and its output and are re-executable, two assert a judgement and need a reader. This gate
is for the four.

TWO KINDS, AND THE SECOND EXISTS BECAUSE A NAIVE GATE FAILS ON CORRECT ROWS.
A repaired ledger row carries both a historical measurement and a live one:

    measured when the row was written:  grep ... -> 0     <- must NOT be re-asserted
    the same grep returns 2 today                         <- must still hold

Re-running everything reports a mismatch on the first half, and the row is right. So a
claim declares which it is:

    <!-- claim holds: `grep -c "cuvarint" docs/CODEC.md` == 15 -->
    <!-- claim measured-at 2026-08-24: `grep -c "profile" docs/CODEC.md` == 0 -->

`holds` is re-executed every run. `measured-at` is never executed — it is a dated
historical fact, and a gate that "corrects" it is the defect, not the fix. Both forms are
single-line so they survive inside a table cell, and both are HTML comments so they render
as nothing.

    == <value>        stdout, stripped, must equal <value> exactly
    contains <value>  <value> must appear somewhere in stdout

⛔ THE DENOMINATOR IS THE POINT, AND IT IS DELIBERATELY UNFLATTERING. This reports over
*claims that carry a command*, never over *claims*. **A page with no markup looks
perfectly clean here and is entirely unchecked** — that is the difference between "verified"
and "not looked at", and collapsing it would make this the next instrument whose green
means less than it reads. The two judgement-class defects of the six carry no command and
are invisible to this gate by construction.

⚠ AND IT CANNOT SAY THE MEASUREMENT WAS THE RIGHT ONE. 0003's row 2 correctly measured an
absence that its own recommendation then abolished. Re-running reports that the number
moved; it does not say which side is wrong, and a reader still has to decide.

SAFETY. This executes commands found in documents, so it does not use a shell: the command
is split with `shlex`, `argv[0]` must be in ALLOWED, and anything else is refused loudly
rather than run. A shell would make an edit to a Markdown file into arbitrary code
execution in CI.

stdlib only, and safe to import: it does nothing on import.
"""

from __future__ import annotations

import io
import os
import re
import shlex
import subprocess
import sys

# This repo is developed on Windows, where the console default is cp1252 and a
# character outside it raises UnicodeEncodeError - a check that crashes before printing
# its own verdict. Copied from speccheck.py, which has carried it since 533849d; added
# here after claimcheck exited 1 with every claim holding, dying on a U+26A0 in its own
# caveat line. pincheck and linkcheck survived only because their non-ASCII happens to
# exist in cp1252 - luck, not design, and one edit away from the same failure.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# "worktrees": .claude/worktrees/* are isolated agent checkouts, untracked copies of older
# revisions. CI never has them, and scanning them reports their stale claims and links as
# this tree's (16 false failures on 2026-09-23). No tracked path has that component.
SKIP = {".git", "node_modules", "target", "dist", "build", ".venv", "venv",
        "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "worktrees"}

# argv[0] must be one of these. Extend deliberately; every addition widens what a
# Markdown edit can execute in CI.
ALLOWED = {"grep", "python", "python3", "node", "wc", "git"}

# `holds` and `measured-at` both take a command. `recorded` does NOT: it declares a
# number to be a historical reading of a one-off exercise with nothing to re-run — a
# human adjudication, a scored challenge. Added after fractioncheck listed fourteen such
# numbers that the command-bearing forms could not express: a worklist whose items cannot
# be satisfied is noise, and noise is what gets a worklist switched off.
CLAIM = re.compile(
    r"<!--\s*claim\s+(?P<kind>holds|measured-at(?:\s+(?P<date>[0-9]{4}-[0-9]{2}-[0-9]{2}))?)"
    r"\s*:\s*`(?P<cmd>[^`]+)`\s*(?P<op>==|contains)\s*(?P<want>.*?)\s*-->")

RECORDED = re.compile(
    r"<!--\s*claim\s+recorded(?:\s+(?P<date>[0-9]{4}-[0-9]{2}-[0-9]{2}))?\s*:"
    r"\s*(?P<why>[^>]*?)\s*-->")


def markdown_files(root: str) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP]
        out.extend(os.path.join(dirpath, f) for f in filenames if f.endswith(".md"))
    return sorted(out)


def run_claim(cmd: str) -> tuple[bool, str]:
    """Execute one claim command without a shell. Returns (ok, stdout-or-reason)."""
    try:
        argv = shlex.split(cmd)
    except ValueError as exc:
        return False, "unparseable command ({})".format(exc)
    if not argv:
        return False, "empty command"
    exe = os.path.basename(argv[0])
    if exe not in ALLOWED:
        return False, ("refusing to run {!r}: not in the allowlist {}"
                       .format(exe, sorted(ALLOWED)))
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, "could not run: {}".format(exc)
    # grep exits 1 on "no matches", which is a legitimate result for a count claim.
    return True, proc.stdout


def _scope(roots, skip):
    """The file-set, printed. A hand-run `grep -r` reproduces the COMMAND and not
    the CORPUS: these tools skip vendored trees and a person does not. A peer's
    count differed from ours by exactly three vendored node_modules READMEs, and
    neither of us could name the delta until it was located by hand."""
    # Column 0, deliberately: a line meant to be machine-checked must satisfy the
    # obvious test. Indented for visual grouping, it failed `^scope:` in all three
    # tools while satisfying an unanchored `scope` - so a peer checking loosely
    # passed two and, distrusting a content match in the third, tightened to an
    # anchor that was wrong for all three and reported the one as missing.
    return "scope: {} minus {}".format(
        "/".join(roots), ", ".join(sorted(skip)))


def run() -> int:
    live = historical = recorded = 0
    failures: list[str] = []
    files_with_claims = set()

    for path in markdown_files("."):
        text = io.open(path, encoding="utf-8", errors="replace").read()
        for lineno, line in enumerate(text.split(chr(10)), 1):
            # finditer, NOT search: a table row is ONE line, and the two-kind design puts
            # a `measured-at` and a `holds` in the SAME row. `search` read the first and
            # dropped the rest silently — a clean green over a plausible count, in exactly
            # the place the pairing is needed. Found by the codec lane using it as designed.
            found = list(CLAIM.finditer(line))
            recorded_here = list(RECORDED.finditer(line))
            if recorded_here:
                files_with_claims.add(path)
                recorded += len(recorded_here)
            # A comment that opens `<!-- claim` and does not parse is NOT unmarked: it
            # LOOKS marked and is read by nothing, which is worse than no markup at all.
            for stray in range(line.count("<!-- claim")
                               - len(found) - len(recorded_here)):
                failures.append("{}:{}: a `<!-- claim ...` comment on this line does not "
                                "parse and was read by NOTHING".format(path, lineno))
            for m in found:
                files_with_claims.add(path)
                kind, cmd, op, want = (m.group("kind"), m.group("cmd").strip(),
                                       m.group("op"), m.group("want").strip())
                if kind.startswith("measured-at"):
                    historical += 1
                    continue
                live += 1
                ok, out = run_claim(cmd)
                if not ok:
                    failures.append("{}:{}: {}".format(path, lineno, out))
                    continue
                got = out.strip()
                passed = (got == want) if op == "==" else (want in out)
                if not passed:
                    shown = got if len(got) <= 120 else got[:117] + "..."
                    failures.append(
                        "{}:{}: `{}`{}  expected {} {!r}{}  got {!r}"
                        .format(path, lineno, cmd, chr(10) + "      ", op, want,
                                chr(10) + "      ", shown))

    for f in failures:
        print(f)

    if failures:
        print(chr(10) + "{} live claim(s) no longer hold.".format(len(failures)))
        print("Either the artifact moved under the claim — in which case the claim needs")
        print("re-measuring, not re-typing — or the claim was historical, in which case it")
        print("should be `measured-at <date>` and this gate should never have run it.")
        return 1

    print("claims: {} live re-executed and holding, {} measured-at (not run), {} recorded "
          "as unrecomputable, across {} files".format(
              live, historical, recorded, len(files_with_claims)))
    print("  ⚠ the denominator is CLAIMS CARRYING A COMMAND, not claims. Unmarked prose is")
    print("    unchecked here, not clean — judgement-class claims are invisible to this gate.")
    print(_scope((".",), SKIP))
    return 0


if __name__ == "__main__":
    sys.exit(run())
