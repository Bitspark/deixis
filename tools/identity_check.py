r"""deixis's identity invariants change only by IDENTITY.md's change rule.

WHY THIS EXISTS AT ALL. On 2026-10-05 a deixis design record (ADR 0013, first version)
declared that it "supersedes the interaction terminology of ADR 0012", an owner-decided
floor record, because a consumer's release had dropped that terminology the day before.
Nothing in the repository could tell an ordinary revision from a reversal of the floor, so
the reversal merged as one more paragraph. ADR 0015 wrote deixis's identity down as
numbered invariants (IDENTITY.md) with a change rule; this check is the mechanical half of
that rule.

WHAT IT DECIDES.
  1. IDENTITY.md numbers its invariants ID1..IDn contiguously, and each has a non-empty
     quoted statement.
  2. Each statement matches its pin in tools/identity.lock. A pin names the ADR that last
     set the statement.
  3. That ADR exists and carries an `Identity:` line that adopts or breaks the invariant,
     and IDENTITY.md's change log names that ADR.
  4. No markdown file declares, in the present tense, that it supersedes a record an
     invariant's status rests on, or supersedes part of such a record from inside it,
     unless the file carries an `Identity: breaks ID<n>` line. Lines that predate this
     check are listed in the lock as `allow` entries.
  5. No markdown file outside IDENTITY.md calls an invariant superseded, withdrawn or
     replaced, unless it carries an `Identity: breaks` line.
  6. Every quotation in an invariant's status occurs verbatim in a record that the same
     status clause links, ignoring line breaks and `**` emphasis. A clause that links no
     file in this repository (an issue, an internal note) is a reviewer's to check. This
     is the guard the incident broke four times: an owner's words paraphrased, then
     cited as if quoted. Its first draft was itself nearly "corrected" by a grep that
     could not see a quotation wrapped across two lines, hence the normalization.

WHAT IT DOES NOT DECIDE. Whether a change is RIGHT. It cannot see the two sealed
derivations, the peer read or the owner's words the rule also requires; those are a
reviewer's job. What it guarantees is that a change to an invariant cannot merge looking
like an ordinary edit: it has to touch the pin and name an ADR that says `breaks`.
Rule 4 reads the English "supersede(s)". A reversal written as "replaces" or "is no
longer" escapes it, which is why the change rule, not this check, is the guard.

`--self-test` plants each defect this check exists for in a scratch copy, the historical
one included, and fails unless every plant turns it red and the clean copy stays green.

stdlib only, read-only, and safe to import: it writes nothing and does nothing on import.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

SKIP = {".git", "node_modules", "target", "build", "dist", "__pycache__", ".venv", "venv",
        "worktrees", ".mypy_cache", ".pytest_cache", ".ruff_cache"}

HEADING = re.compile(r"^### (ID(\d+))\. ")
IDENTITY_LINE = re.compile(r"^\s*(?:\*\*)?Identity:(?:\*\*)?\s*(adopts|breaks)\s+(.+)$", re.M)
ID_RANGE = re.compile(r"ID(\d+)\s*(?:to|–|-)\s*ID(\d+)")
ID_ONE = re.compile(r"\bID(\d+)\b")
SUPERSEDE = re.compile(r"\bsupersed(?:e|es|ing)\b", re.I)
RETIRES_ID = re.compile(r"\bID\d+\b.*\b(?:superseded|withdrawn|replaced|retired)\b"
                        r"|\b(?:supersede[sd]?|withdraws?|replaces?|retires?)\b.*\bID\d+\b", re.I)
DESIGN_REF = re.compile(r"\bADR (\d{4})\b|design/(\d{4})-|\]\((\d{4})-")
QUOTE = re.compile(r'"([^"]+)"')
CLAUSE = re.compile(r"\b(?:owner sessions|owner|agents|recorded|proved|checked|stated):")
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
DOC_REF = re.compile(r"\]\((?:\.\./|docs/)?([A-Z][A-Z0-9-]*\.md)\)")


def norm(text: str) -> str:
    return " ".join(text.split())


def sha(text: str) -> str:
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def parse_identity(text: str):
    """Return ({id: statement}, ordered ids, protected records, change-log text)."""
    lines = text.splitlines()
    statements: dict[str, str] = {}
    order: list[int] = []
    protected: set[str] = set()
    i = 0
    while i < len(lines):
        m = HEADING.match(lines[i])
        if not m:
            i += 1
            continue
        ident, num = m.group(1), int(m.group(2))
        order.append(num)
        j = i + 1
        while j < len(lines) and not lines[j].startswith(">") and not lines[j].startswith("#"):
            j += 1
        quoted = []
        while j < len(lines) and lines[j].startswith(">"):
            quoted.append(lines[j][1:].strip())
            j += 1
        statements[ident] = "\n".join(quoted)
        # The invariant's status paragraph names the records it rests on.
        k = j
        while k < len(lines) and not HEADING.match(lines[k]) and not lines[k].startswith("## "):
            if lines[k].startswith("**Status.**"):
                para = []
                while k < len(lines) and lines[k].strip():
                    para.append(lines[k])
                    k += 1
                body = " ".join(para)
                for g in DESIGN_REF.findall(body):
                    protected.add("design/" + next(x for x in g if x))
                for doc in DOC_REF.findall(body):
                    protected.add(doc)
                continue
            k += 1
        i = j
    log = text.split("## Change log", 1)[1] if "## Change log" in text else ""
    return statements, order, protected, log


def status_blocks(text: str):
    """Yield (ident, status text): from **Status.** to the next heading or bold paragraph."""
    lines = text.splitlines()
    ident = None
    i = 0
    while i < len(lines):
        m = HEADING.match(lines[i])
        if m:
            ident = m.group(1)
        elif lines[i].startswith("## "):
            ident = None
        elif ident and lines[i].startswith("**Status.**"):
            block = [lines[i]]
            i += 1
            while i < len(lines) and not lines[i].startswith("#") and not (
                    lines[i].startswith("**") and not lines[i].startswith("**Status")):
                block.append(lines[i])
                i += 1
            yield ident, "\n".join(block)
            continue
        i += 1


def plain(text: str) -> str:
    return norm(text.replace("**", ""))


def unquoted(root: str, identity_text: str) -> list[str]:
    errors = []
    for ident, block in status_blocks(identity_text):
        # A blockquote inside a status quotes an outside source at length; it is not a clause.
        body = "\n".join(l for l in block.splitlines() if not l.startswith(">"))
        starts = [m.start() for m in CLAUSE.finditer(body)] + [len(body)]
        for a, b in zip(starts, starts[1:]):
            clause = body[a:b]
            files = []
            for target in LINK.findall(clause):
                path = os.path.normpath(os.path.join(root, target))
                if os.path.isfile(path):
                    files.append(path)
            if not files:
                continue
            sources = [plain(read(f)) for f in files]
            for quoted in QUOTE.findall(clause):
                if not any(plain(quoted) in src for src in sources):
                    errors.append(
                        f"IDENTITY.md {ident}: the quotation \"{plain(quoted)}\" does not occur in "
                        + ", ".join(rel(root, f) for f in files)
                        + ". Quote the record verbatim, or say paraphrase and drop the quotation marks")
    return errors


def parse_lock(text: str):
    pins: dict[str, tuple[str, str]] = {}
    allow: set[tuple[str, str]] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if parts[0] == "allow" and len(parts) == 3:
            allow.add((parts[1], parts[2]))
        elif len(parts) == 3 and parts[0].startswith("ID"):
            pins[parts[0]] = (parts[1], parts[2])
        else:
            raise SystemExit(f"identity.lock: cannot read line: {raw!r}")
    return pins, allow


def ids_in(spec: str) -> set[int]:
    out: set[int] = set()
    for a, b in ID_RANGE.findall(spec):
        out.update(range(int(a), int(b) + 1))
    out.update(int(x) for x in ID_ONE.findall(ID_RANGE.sub("", spec)))
    return out


def adr_file(root: str, number: str) -> str | None:
    d = os.path.join(root, "docs", "design")
    for name in sorted(os.listdir(d)):
        if name.startswith(number + "-") and name.endswith(".md"):
            return os.path.join(d, name)
    return None


def markdown_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(n for n in dirnames if n not in SKIP)
        for name in sorted(filenames):
            if name.endswith(".md"):
                yield os.path.join(dirpath, name)


def rel(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace(os.sep, "/")


def refers_to(rel_path: str, line: str, protected: set[str]) -> bool:
    """Is this file one of the protected records, or does the line cite one?"""
    for rec in protected:
        if rec.startswith("design/"):
            num = rec.split("/")[1]
            if rel_path.startswith(f"docs/design/{num}-"):
                return True
            if f"ADR {num}" in line or f"design/{num}-" in line or f"]({num}-" in line:
                return True
        else:
            if rel_path == f"docs/{rec}":
                return True
            if re.search(r"[(/]" + re.escape(rec) + r"\)", line):
                return True
    return False


def check(root: str) -> list[str]:
    errors: list[str] = []
    identity_path = os.path.join(root, "IDENTITY.md")
    lock_path = os.path.join(root, "tools", "identity.lock")
    identity_text = read(identity_path)
    statements, order, protected, log = parse_identity(identity_text)
    pins, allow = parse_lock(read(lock_path))
    errors.extend(unquoted(root, identity_text))

    if order != list(range(1, len(order) + 1)):
        errors.append(f"IDENTITY.md: invariants must be numbered ID1..IDn in order, found {order}")
    for ident, text in statements.items():
        if not text.strip():
            errors.append(f"IDENTITY.md: {ident} has no quoted statement")
    if set(pins) != set(statements):
        errors.append("identity.lock pins " + ", ".join(sorted(pins)) +
                      " but IDENTITY.md states " + ", ".join(sorted(statements)))

    for ident, text in statements.items():
        if ident not in pins:
            continue
        digest, adr = pins[ident]
        if sha(text) != digest:
            errors.append(
                f"{ident}'s statement changed. An invariant changes only by IDENTITY.md's change "
                f"rule: an ADR with the line `Identity: breaks {ident}`, a change-log entry, and "
                f"the new pin in tools/identity.lock ({sha(text)})")
        path = adr_file(root, adr)
        if path is None:
            errors.append(f"{ident} is pinned to ADR {adr}, which does not exist")
            continue
        covered = set()
        for _, spec in IDENTITY_LINE.findall(read(path)):
            covered |= ids_in(spec)
        if int(ident[2:]) not in covered:
            errors.append(f"{ident} is pinned to ADR {adr}, whose `Identity:` line does not "
                          f"adopt or break it")
        if f"ADR {adr}" not in log and f"design/{adr}-" not in log:
            errors.append(f"{ident} is pinned to ADR {adr}, which IDENTITY.md's change log does "
                          f"not name")

    # The records the lock names are the identity records themselves: they state the
    # invariants and discuss supersession on purpose, under the change rule.
    identity_records = {adr for _, adr in pins.values()}
    for path in markdown_files(root):
        r = rel(root, path)
        if r == "IDENTITY.md":
            continue
        if r.startswith("docs/design/") and r[12:16] in identity_records:
            continue
        text = read(path)
        breaks = any(kind == "breaks" for kind, _ in IDENTITY_LINE.findall(text))
        if breaks:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if SUPERSEDE.search(line) and refers_to(r, line, protected):
                if (r, sha(line)) not in allow:
                    errors.append(
                        f"{r}:{n}: declares a supersession touching a record deixis's identity "
                        f"rests on. A reversal of the floor needs an ADR with an "
                        f"`Identity: breaks ID<n>` line (IDENTITY.md, change rule): {line.strip()}")
            if RETIRES_ID.search(line):
                errors.append(f"{r}:{n}: retires an identity invariant without an "
                              f"`Identity: breaks` line: {line.strip()}")
    return errors


def self_test(root: str) -> list[str]:
    """Plant each defect in a scratch copy; every plant must turn the check red."""
    failures: list[str] = []

    def copy() -> str:
        tmp = tempfile.mkdtemp(prefix="identity-check-")
        for path in markdown_files(root):
            dst = os.path.join(tmp, rel(root, path))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(path, dst)
        os.makedirs(os.path.join(tmp, "tools"), exist_ok=True)
        shutil.copyfile(os.path.join(root, "tools", "identity.lock"),
                        os.path.join(tmp, "tools", "identity.lock"))
        return tmp

    def edit(path: str, fn) -> None:
        s = read(path)
        t = fn(s)
        assert t != s, f"self-test plant did not apply to {path}"
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(t)

    def arm(name: str, plant, want_red: bool) -> None:
        tmp = copy()
        try:
            plant(tmp)
            red = bool(check(tmp))
            if red != want_red:
                failures.append(f"self-test arm '{name}': expected {'red' if want_red else 'green'}, "
                                f"got {'red' if red else 'green'}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    first = sorted(parse_identity(read(os.path.join(root, "IDENTITY.md")))[0])[0]

    arm("clean copy", lambda t: None, False)

    def reword(t):
        edit(os.path.join(t, "IDENTITY.md"),
             lambda s: re.sub(r"(### " + first + r"\. [^\n]*\n\n> )", r"\1Usually, ", s, count=1))
    arm("an invariant's statement edited in place", reword, True)

    def historical(t):
        with open(os.path.join(t, "docs", "design", "0999-planted.md"), "w", encoding="utf-8") as f:
            f.write("# Planted\n\nIt **supersedes the interaction terminology of "
                    "[ADR 0012](0012-data-wire-tree-symmetry.md)**:\n")
    arm("ADR 0013's original sentence, superseding ADR 0012", historical, True)

    def amend_0012(t):
        edit(adr_file(t, "0012"), lambda s: s.replace(
            "## Decision", "*(Amended: ADR 0999 supersedes this record's interaction "
            "terminology.)*\n\n## Decision", 1))
    arm("an amendment inside ADR 0012 saying it is superseded", amend_0012, True)

    def paraphrase(t):
        edit(os.path.join(t, "IDENTITY.md"), lambda s: s.replace("\"Let's use mandatory", "\"We use mandatory", 1))
    arm("an owner's words paraphrased inside quotation marks", paraphrase, True)

    def retire(t):
        edit(os.path.join(t, "README.md"), lambda s: s + "\nID12 is superseded by bitwire 0.4.0.\n")
    arm("a document retiring an invariant", retire, True)

    def lawful(t):
        target = os.path.join(t, "IDENTITY.md")
        edit(target, lambda s: re.sub(r"(### " + first + r"\. [^\n]*\n\n> )", r"\1Usually, ", s, count=1))
        new = parse_identity(read(target))[0][first]
        with open(os.path.join(t, "docs", "design", "0999-planted.md"), "w", encoding="utf-8") as f:
            f.write(f"# Planted\n\nIdentity: breaks {first}\n\nThis supersedes "
                    f"[ADR 0012](0012-data-wire-tree-symmetry.md) on purpose.\n")
        edit(target, lambda s: s + "- planted break, [ADR 0999](docs/design/0999-planted.md).\n")
        lock = os.path.join(t, "tools", "identity.lock")
        edit(lock, lambda s: re.sub(r"^" + first + r" \S+ \S+$",
                                    f"{first} {sha(new)} 0999", s, count=1, flags=re.M))
    arm("a change made by the change rule", lawful, False)

    return failures


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--self-test" in sys.argv[1:]:
        failures = self_test(root)
        for f in failures:
            print(f)
        print("identity self-test: " + ("FAILED" if failures else "every plant turns the check red; the clean copy and a lawful change stay green"))
        return 1 if failures else 0
    errors = check(root)
    for e in errors:
        print(e)
    statements = parse_identity(read(os.path.join(root, "IDENTITY.md")))[0]
    print(f"identity: {len(statements)} invariants, " +
          ("FAILED" if errors else "every statement matches its pin, and no record supersedes their sources"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
