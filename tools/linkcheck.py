r"""Every relative Markdown link in the repository resolves to a file that exists.

WHY THIS EXISTS AT ALL. `ci.yml`'s `paper` job already refuses a build whose LaTeX
carries an undefined `\ref` or `\cite`. The prose documents had no equivalent, so a
citation could name a file that has never existed and nothing would say so. It was
introduced exactly that way: the commit recording the mutation challenge cited
`design/0003-freeze-readiness.md`, an invented filename, in the sentence claiming the
review process had been measured. A hand-audit found it. Nothing would have found the
next one.

WHAT IT DECIDES, AND WHAT IT DELIBERATELY DOES NOT.
  decides   the link TARGET exists, for every relative link in every tracked `.md`
  does NOT  whether the target is the RIGHT document, or whether an `#anchor` resolves

The second exclusion is deliberate rather than unfinished. Heading-to-anchor
slugification is renderer-specific, so an anchor check here would fail on documents that
render correctly — a red arm that fires on green input teaches readers to ignore it.
⚠ And note the first exclusion is the sharper one: the original defect had a *plausible*
target, and a checker that only tests existence would still have caught it only because
the file was absent. A citation pointing at a real but wrong document remains a
reader's job.

DISCOVERY IS BY SHAPE, NOT BY LIST. Files are found by walking, so a document added
tomorrow is covered without editing this file. Two tools in this repository have already
shipped the other defect — an enumerated list of inputs that silently skips whatever is
added next — and this is the same class.

stdlib only, read-only, and safe to import: it writes nothing and does nothing on import.
"""

from __future__ import annotations

import os
import re
import sys

# Directories that are never ours to audit: version control, dependency trees, build
# output, and caches. Walking into them is slow and reports links in vendored READMEs.
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
# "public-files": cutover/public-files/ is written for the PUBLIC repository's layout, where
# its relative links resolve and this tree's do not (docs/cutover.md §3.4). Its links are
# checked there, by cutover/verify-public-tree.sh on the built tree. No other tracked path
# has that component.
SKIP = {".git", "node_modules", "target", "dist", "build", ".venv", "venv",
        "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "worktrees",
        "public-files"}

# [text](target) with an optional #fragment. Angle-bracket and title forms are rare here
# and are matched loosely rather than parsed; a miss under-reports, it never false-fires.
LINK = re.compile(r"\[([^\]\n]*)\]\(\s*<?([^)<>\s]+?)>?(?:\s+\"[^\"]*\")?\s*\)")

EXTERNAL = ("http://", "https://", "mailto:", "ftp://", "//", "#")


def markdown_files(root: str) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP]
        out.extend(os.path.join(dirpath, f) for f in filenames if f.endswith(".md"))
    return sorted(out)


def check(root: str = ".") -> tuple[int, int, list[tuple[str, int, str, str]]]:
    """Return (files, links_checked, broken). Pure: reads, returns, writes nothing."""
    broken: list[tuple[str, int, str, str]] = []
    files = markdown_files(root)
    checked = 0
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
        for lineno, line in enumerate(lines, 1):
            for text, target in LINK.findall(line):
                if target.startswith(EXTERNAL):
                    continue
                bare = target.split("#", 1)[0]
                if not bare:  # a pure #fragment, handled by the EXTERNAL guard above
                    continue
                checked += 1
                resolved = os.path.normpath(os.path.join(os.path.dirname(path), bare))
                if not os.path.exists(resolved):
                    broken.append((path, lineno, text, target))
    return len(files), checked, broken


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
    files, checked, broken = check(".")
    for path, lineno, text, target in broken:
        print(f"{path}:{lineno}: [{text}]({target}) -> no such file")
    if broken:
        print(f"\n{len(broken)} dangling link(s) in {files} markdown files "
              f"({checked} relative links checked)")
        return 1
    print(f"links: {checked} relative links across {files} markdown files, all resolve")
    print(_scope((".",), SKIP))
    return 0


if __name__ == "__main__":
    sys.exit(run())
