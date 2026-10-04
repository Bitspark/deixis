r"""Worklist: claims whose truth depends on WHEN the page is read.

WHY THIS ONE AND NOT ANOTHER. Nine stale claims were found across two ledgers on
2026-09-03, and every one of them needed a peer: one lane said something the other could
turn into a search instruction. **One exchange did not.** The codec lane could not
reconstruct the denominator in `23 of 45` from the tree and said so — without knowing the
corpus, inspecting a case, or making any judgement about the subject. That was enough to
surface a wrong number: the true figure was `23 of 41`, because four entries carried no
octets and could not exercise the thing being counted either way.

    transferable     "can this fraction be rebuilt from the repository?"
    everything else  "notice the thing the other lane happens to mention"

⇒ The second needs a peer, arguing, today. **The first needs nothing**, which makes it the
only technique of that morning that survives the two lanes not being in the room. This
file is that technique, so it stops depending on someone remembering to apply it.

WORKLIST-CLASS BY CONSTRUCTION — it prints and returns 0, and it must never do otherwise.
It cannot tell a coverage fraction from a date range, a version, or an ordinary sentence
containing two numbers, and **a gate that fails a build on a judgement it cannot make gets
switched off**, taking its real findings with it. `speccheck` draws the same line between
its decidable checks and its worklist.

WHAT SATISFIES IT. A fraction is reconstructible when its line carries a `claim` comment
(see `claimcheck.py`) — either `holds`, which re-runs the command that produces it, or
`measured-at`, which declares it a dated historical reading that must NOT be re-run.
Anything else is listed here: not as a defect, but as a number whose boundary a reader
cannot check.

KNOWN FALSE POSITIVES, measured on this tree rather than imagined — they are the reason
this is a worklist and not a gate:

    0006  `127/128`, `16383/16384`   uvarint BOUNDARY VALUES, not a coverage fraction
    0002  `2/3`                      a vote tally

⇒ Three of nine on the first run. A stricter pattern would drop them and would also drop
`3 of 4`, which IS a coverage claim; there is no lexical rule separating the two, which is
precisely the judgement a build must not fail on.

⚠ IT CANNOT SAY THE FRACTION IS WRONG. `23 of 45` was arithmetically fine and counted the
wrong population. This asks only whether a reader could rebuild it — the question that
happened to be sufficient, not a claim that it is sufficient in general.

TWO KINDS, and the second was named by the codec lane after the first shipped:

    a FRACTION whose denominator cannot be rebuilt      has a number to be wrong
    a RELATIVE DATE                                     has NO number to be wrong

⇒ *"already normative — added THIS MORNING as finding 5.1"* rots exactly as a stale count
does, and **nothing in the fraction half could ever find it**: there is no figure to
recompute. ⚠ **A relative date in a ledger is a claim about when the READER is, and the
reader is always later than the writer.** Five were live in `EVIDENCE.md` when this half
was added, one of them compound — a stale count (*"10 normative universals today"*, by
then 12) wearing a relative date, so it was wrong in two ways at once.

ANCHORED RELATIVE DATES, added 2026-09-22 — the rule `0003` recorded and nothing ran.
`0003` measured that "a document-level status header does the work a per-claim marker
would", and this file went on listing every "today" in such documents. Measured on this
tree the day the rule was added, 33 relative dates:

    16  in a document that declares its own date, written ON OR BEFORE it   anchored
     1  in a dated document, but written AFTER its declared date            LISTED
    16  in a document with no dated header                                 LISTED

⇒ The ANCHOR is the date a document declares for its own present tense: an explicit
`As of YYYY-MM-DD`, else a date on its first `Status:` line, else a dated filename — in
the first 20 lines only, because a date deep in the body is content. A header covers
only the lines written by then, so authorship comes from `git blame`: `0006` declares
2026-08-08 and its "today's bytes" line was written 2026-08-20, so it stays listed.
That row is the rule's control — without the second test, a living document's old
header would hide exactly the rot it accumulates later.

⚠ IT FAILS TOWARD LISTING. No git, a failed blame, a shallow clone (every line blames
to the boundary commit, which postdates every header) and an uncommitted line all leave
the hit LISTED. An unverifiable anchor costs worklist noise; it must never cost silence.
Nor may the noise be silent: a run says how many rows it listed only because git could
not date them, and names a shallow clone when that is why.

⚠ RENAMED from `fractioncheck.py` one commit after landing, because the second kind made
the first name wrong. A tool named for one of the two things it does is a naming defect,
and it was cheaper to fix while CI was the only consumer.

stdlib only (plus a read-only `git blame` it can live without), read-only, and safe
to import: it does nothing on import.
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Ledgers make claims about other artifacts. Source trees and vendored docs do not.
ROOTS = ("docs", "research-docs")
LEDGERS = (".advice.md", ".integration.md")
SKIP = {".git", "node_modules", "target", "dist", "build", "__pycache__",
        ".mypy_cache", ".ruff_cache", "paper"}

# "23 of 41" and "17 / 25". Deliberately narrow: these are how a coverage claim is
# written here, and widening it to bare counts drowns the signal in prose numbers.
FRACTION = re.compile(r"\b(\d{1,6})\s*(?:of|/)\s*(\d{1,6})\b")

# A line already carrying a claim is reconstructible; that is claimcheck's job, not this
# one's. Fenced blocks are transcripts of output, not assertions in the page's own voice.
HAS_CLAIM = re.compile(r"<!--\s*claim\s")

# A `recorded` claim declares a number a historical reading of a one-off exercise
# with nothing to re-run, and scopes every fraction to the end of its section.
RECORDED = re.compile(r"<!--\s*claim\s+recorded")

# Deliberately not "now", "then" or "recent" — those appear constantly in ordinary prose
# and would bury the signal. These are the forms that assert a POSITION IN TIME relative
# to the reader.
RELATIVE_DATE = re.compile(
    r"\b(this morning|today|yesterday|tomorrow|earlier today|just now|"
    r"an hour ago|hours ago|last week|next week|this week)\b", re.I)

# The date a document declares for its own present tense. See ANCHORED RELATIVE DATES.
ANCHOR_ASOF = re.compile(r"\bas of (\d{4}-\d{2}-\d{2})\b", re.I)
STATUS_LINE = re.compile(r"\bstatus:", re.I)
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
BLAME_HEADER = re.compile(r"^[0-9a-f]{40} \d+ (\d+)")

# A pattern holding a CONTROL CHARACTER matches nothing and reports clean. This
# file shipped exactly that: a word-boundary escape eaten in transit became a literal
# BACKSPACE (0x08) and the date scanner returned 0 against a tree with a dozen hits.
# EVIDENCE.md already records the same defect in another tool, whose guard tested for
# ONE named control byte instead of the class - so this tests the CLASS.
for _name, _pat in (("FRACTION", FRACTION), ("RELATIVE_DATE", RELATIVE_DATE),
                    ("HAS_CLAIM", HAS_CLAIM), ("RECORDED", RECORDED),
                    ("ANCHOR_ASOF", ANCHOR_ASOF), ("STATUS_LINE", STATUS_LINE),
                    ("ISO_DATE", ISO_DATE), ("BLAME_HEADER", BLAME_HEADER)):
    _bad = [hex(ord(c)) for c in _pat.pattern if ord(c) < 32]
    if _bad:
        raise SystemExit(
            "rotcheck: {} holds control character(s) {} - it would match nothing and"
            " report clean".format(_name, _bad))


def markdown_files() -> list[str]:
    out: list[str] = []
    for root in ROOTS:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP]
            out.extend(os.path.join(dirpath, f) for f in filenames if f.endswith(".md"))
    return sorted(out)


def scan(path: str) -> list[tuple[int, str, str]]:
    text = io.open(path, encoding="utf-8", errors="replace").read()
    hits: list[tuple[int, str, str]] = []
    fenced = False
    section_recorded = False
    recorded_depth = 99
    last_heading_depth = 99
    lines = text.split(chr(10))
    for i, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if line.startswith("#"):
            # A `recorded` claim scopes the SECTION it opens, not three lines: a page
            # reporting one exercise carries a dozen fractions from that single run, and
            # tagging each is noise that gets the worklist ignored.
            #
            # The scope ends at a heading of the SAME OR SHALLOWER depth, never at a
            # deeper one. A first cut reset on any `#` at all, so the `###` subsections
            # INSIDE a declared `##` section escaped it and the declaration covered only
            # its own opening paragraph — a scoping rule that silently under-applied,
            # which is this repository's defect of the day in its own instrument.
            depth = len(line) - len(line.lstrip("#"))
            last_heading_depth = depth
            if section_recorded and depth <= recorded_depth:
                section_recorded = False
        if RECORDED.search(line):
            section_recorded = True
            recorded_depth = last_heading_depth
        if fenced or HAS_CLAIM.search(line) or section_recorded:
            continue
        for m in FRACTION.finditer(line):
            num, den = int(m.group(1)), int(m.group(2))
            # A fraction over a larger whole. Equal parts are usually a date or a ratio
            # written for emphasis; num > den is not a coverage claim at all.
            if den == 0 or num > den or num == den:
                continue
            # Neighbouring lines may carry the claim for a wrapped sentence.
            near = lines[max(0, i - 3):i + 2]
            if any(HAS_CLAIM.search(n) for n in near):
                continue
            hits.append((i, m.group(0), line.strip()[:96]))
    return hits


def scan_dates(path: str) -> list[tuple[int, str, str]]:
    text = io.open(path, encoding="utf-8", errors="replace").read()
    hits: list[tuple[int, str, str]] = []
    for i, line in enumerate(text.split(chr(10)), 1):
        if HAS_CLAIM.search(line):
            continue
        for m in RELATIVE_DATE.finditer(line):
            hits.append((i, m.group(0), line.strip()[:96]))
    return hits


def anchor_date(path: str) -> "str | None":
    """The date a document declares for its present tense, or None: an explicit `As of`,
    else a date on the FIRST `Status:` line, else a dated filename. First 20 lines only."""
    try:
        head = io.open(path, encoding="utf-8", errors="replace").read().split(chr(10))[:20]
    except OSError:
        return None
    for line in head:
        m = ANCHOR_ASOF.search(line)
        if m:
            return m.group(1)
    for line in head:
        if STATUS_LINE.search(line):
            m = ISO_DATE.search(line)
            if m:
                return m.group(0)
            break
    m = ISO_DATE.match(os.path.basename(path))
    return m.group(0) if m else None


def blame_dates(path: str) -> "dict[int, str] | None":
    """Line number -> the UTC date that line was authored. None on ANY failure, and None
    means every hit in the file is LISTED: this must fail toward more worklist."""
    try:
        out = subprocess.run(["git", "blame", "--line-porcelain", "--", path],
                             capture_output=True, check=True, timeout=120).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    dates: "dict[int, str]" = {}
    cur = None
    for raw in out.decode("utf-8", "replace").split(chr(10)):
        m = BLAME_HEADER.match(raw)
        if m:
            cur = int(m.group(1))
        elif raw.startswith("author-time ") and cur is not None:
            dates[cur] = time.strftime("%Y-%m-%d", time.gmtime(int(raw.split()[1])))
    return dates


def shallow() -> bool:
    """True in a shallow clone, where `git blame` SUCCEEDS and is wrong: every line older
    than the boundary commit is dated to it, and it postdates every header. CI's depth-1
    checkout listed all 33 relative dates on 78feee1 against 17 locally, and said nothing."""
    try:
        out = subprocess.run(["git", "rev-parse", "--is-shallow-repository"],
                             capture_output=True, check=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return out.strip() == b"true"


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
    total = 0
    print("A. FRACTIONS a reader cannot rebuild from the tree" + chr(10))
    for path in markdown_files():
        hits = scan(path)
        if not hits:
            continue
        print(path)
        for lineno, frac, context in hits:
            total += 1
            print("  {:>5}  {:<12} {}".format(lineno, frac, context))
    dated = 0
    anchored = 0
    undated = 0
    in_ledgers = 0
    # A shallow clone's blame SUCCEEDS and is wrong, so it is not asked. See shallow().
    cut_off = shallow()
    print(chr(10) + "B. RELATIVE DATES — no number to be wrong, so (A) can never find them"
          + chr(10))
    for path in markdown_files():
        hits = scan_dates(path)
        if not hits:
            continue
        anchor = anchor_date(path)
        born = blame_dates(path) if anchor and not cut_off else None
        listed = []
        for hit in hits:
            # "9999" for a line blame did not report: it compares LATER, so it is listed.
            if anchor and born is not None and born.get(hit[0], "9999") <= anchor:
                anchored += 1
            else:
                listed.append(hit)
        if not listed:
            continue
        if anchor and born is None:
            undated += len(listed)
        if path.endswith(LEDGERS):
            in_ledgers += len(listed)
        print(path + ("   (declares {})".format(anchor) if anchor else ""))
        for lineno, word, context in listed:
            dated += 1
            print("  {:>5}  {:<12} {}".format(lineno, word, context))
    if anchored:
        print(chr(10) + "  ({} more not listed: each sits in a document that declares its own"
              " date, and was written on or before it.)".format(anchored))
    if undated:
        print(chr(10) + "  ⚠ {} of those listed sit in a document that declares its own date,"
              " but git could not date their lines{}. A full-history clone may list"
              " fewer.".format(undated, " (shallow clone)" if cut_off else ""))
    print(chr(10) + "WORKLIST: {} fraction(s) with no reconstructing command, "
          "{} relative date(s).".format(total, dated))
    print("Not defects. Each is a number whose boundary a reader cannot rebuild from the")
    print("tree — the one question that found a wrong denominator on 2026-09-03 without")
    print("any knowledge of the subject. Add a `claim holds` with the command that")
    print("recomputes it, or a `claim measured-at <date>` if it is a historical reading.")
    print("  Read B by file, not by total. In a ledger (*.advice.md, *.integration.md) a")
    print("  relative date is a claim about when the READER is; elsewhere it can be ordinary")
    print("  prose (\"today's commons\") — but not reliably: on 2026-09-22 eight of 0003's nine")
    print("  rows were real. This run: {} in ledgers, {} elsewhere.".format(
        in_ledgers, dated - in_ledgers))
    print(chr(10) + "  ⚠ This never fails the build. It cannot tell a coverage fraction from")
    print("    a date, a version, or a sentence with two numbers, and a gate that fails on")
    print("    a judgement it cannot make gets switched off — with its real findings.")
    print(_scope(ROOTS, SKIP))
    return 0


if __name__ == "__main__":
    sys.exit(run())
