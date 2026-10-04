#!/usr/bin/env python3
"""speccheck - mechanical consistency checks over docs/CODEC.md.

What this can decide, it decides. What it cannot, it says so and hands back a
worklist instead of a verdict.

The audits that produced 0008's findings all had one shape: a right ruling stated
more widely than it holds. Only part of that is machine-checkable, and this tool
draws the line explicitly rather than letting a green run imply more than it means:

  DECIDABLE   cross-reference consistency - a code declared in one place and absent
              from another, a section reference resolving to nothing, a table that
              claims completeness and is not. These are facts about the document's
              own internal graph, and a machine owns them. They FAIL the build.

  WORKLIST    two of them, both printed and never gating:
              (1) normative universals - every MUST/SHALL carrying a quantifier.
                  Whether the scope is right is a claim about the world the spec
                  describes, not about the document.
              (2) bare uses of the verdict vocabulary outside the section that
                  defines it. D1 was this class.

  OUT OF REACH  whether a stated scope matches the intended one. That is what the
              freeze bundle's proofs are for: a proof assistant makes every
              quantifier domain explicit and an over-wide claim fails to close.
              This tool is the cheap approximation you run on every commit; it is
              not a substitute for step 2.

Exit 1 if any DECIDABLE check fails, 2 if the spec cannot be read at all. A
worklist never fails the build - a worklist that can fail is a worklist someone
deletes.
"""

import re
import sys
from pathlib import Path

# This repo is developed on Windows, where the console default is cp1252 and any
# section sign in the report raises UnicodeEncodeError - a check that crashes
# before printing its own verdict. Force UTF-8 on both platforms.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "CODEC.md"

def rel(path):
    """Repo-relative, forward slashes - a path a reader can paste on any platform."""
    return path.relative_to(ROOT).as_posix()

UNIVERSALS = r"\b(every|any|all|never|always|nothing|no other|exactly one)\b"

# 0003 Verdicts row 6 asks the worklist to reach past EXPLICIT universals, because the
# quantifier that goes wrong is usually the one nobody wrote. Three further carriers,
# each reading as universal in a normative sentence while stating no domain:
#   INDEFINITE   "A decoder MUST ..."  - an article doing a universal's work. This is
#                the shape of the 5.4 defect: `decoder` narrowed under the sentence when
#                2.1 landed, and no explicit quantifier made the scope visible.
#   BARE PLURAL  "Decoders MUST ..."   - universal by convention only.
#   DEFINITE     "the root chunk"      - presupposes a unique referent; where several
#                exist, the sentence silently picks one.
# WORKLIST-CLASS BY CONSTRUCTION and deliberately not promotable. Whether a scope is
# RIGHT is a claim about the world the spec describes; this finds only sentences that
# ASSERT a scope without STATING one. Expect false alarms - a worklist that can fail the
# build is a worklist someone deletes.
ACTORS = r"decoder|encoder|implementation|validator|store|resolver|profile|parser|caller"
IMPLICIT = [
    ("indefinite", r"\b[Aa]n? (?:conforming )?(?:" + ACTORS + r")\b"),
    ("bare plural", r"\b(?:" + ACTORS + r")s\b"),
    ("definite", r"\bthe (?:" + ACTORS + r")\b"),
]

# Row 6 names a FOURTH carrier and it is the one that matters most: GRAMMAR
# PRODUCTIONS. The vectors lane measured this independently on 2026-09-03 - of twenty
# identity-affecting mutations, the ten that survived every pin were all in grammar,
# and none in prose. Their words: "prose reads like a requirement, grammar reads like
# description." A production carries no MUST, so WORKLIST 1 and 1b are structurally
# blind to it while it decides every octet on the wire.
#
# So 1c enumerates the obligation-bearing tokens INSIDE fenced blocks: literal octets,
# quoted magics, fixed widths, and cuvarint positions. Each is a requirement stated by
# being written down, and each needs a rule or a vector holding it somewhere else.
GRAMMAR_TOKENS = [
    ("literal octet", r"0x[0-9a-fA-F]{2}"),
    ("magic", r'"[a-z]{2}[fl][0-9]"'),
    ("fixed width", r"\w+\{[0-9]+\}"),
    ("canonical int", r"cuvarint\("),
    # A production stating pure ORDER carries no literal at all: `flat := header || node`
    # has no octet, no magic, no width and no integer, and the first cut of 1c could not
    # see it - while the order it fixes is as identity-affecting as anything above it.
    ("production", r":="),
]
NORMATIVE = r"\b(MUST|SHALL)\b"
# The verdict vocabulary of section 9. Used technically these are normally marked
# with backticks or bold; a BARE use is the candidate for a D1-style collision.
VOCAB = r"\b(accept|accepts|accepted|accepting|invalid|invalidity|unsupported|incomplete)\b"

STORE_LAYER = {"missing_chunk", "hash_mismatch", "address_conflict"}
# Codes ordered outside section 10 - excused only if section 10 NAMES them.
ORDERED_ELSEWHERE = ("unsupported_slot_codec", "non_canonical_payload", "limit_exceeded")


def load():
    if not SPEC.exists():
        print("REFUSING: " + str(SPEC) + " does not exist - a dead read, not a pass.")
        sys.exit(2)
    return SPEC.read_text(encoding="utf-8").splitlines()


def headings(lines):
    """Ordered [(section number, line index)] for '## N. Title' headings."""
    out = []
    for i, l in enumerate(lines):
        m = re.match(r"^## (\d+)\.\s", l)
        if m:
            out.append((m.group(1), i))
    return out


def section_at(order, i):
    """Which section line index i falls in. '0' for front matter."""
    cur = "0"
    for num, idx in order:
        if idx <= i:
            cur = num
        else:
            break
    return cur


def walk_markdown():
    """Every .md in the repository, skipping VCS and dependency directories."""
    SKIP = {".git", "node_modules", ".venv", "__pycache__", "dist", "build"}
    for f in sorted(ROOT.rglob("*.md")):
        if SKIP.isdisjoint(p.name for p in f.relative_to(ROOT).parents if p.name):
            yield f


def check_tables(lines):
    """DECIDABLE: every row of one Markdown table has the same column count.

    A raw pipe inside a code span in a table cell is STILL a cell separator in GFM, so
    one stray pipe silently adds a column - and an insertion landing mid-table splits
    one table into two.

    Both have happened here. The section 10 precedence table was split by an insertion
    on 2026-09-02, and IDENTITY-SURFACE.md's id-production row carried a bare pipe on
    2026-09-03. Neither was caught by anything, because NOTHING IN THIS REPOSITORY
    RENDERS MARKDOWN: every other check reads the file as text, and text is exactly the
    surface on which a broken table looks fine.

    ~ A backslash-escaped pipe is a LITERAL pipe in GFM, not a separator. The first
    version of this counted them as separators and reported 0003's Verdicts table
    broken, where a grep alternation legitimately carries one. The instrument needed
    the fix, not the file - so it is masked here before splitting.
    """
    ESCAPED = chr(92) + "|"
    MASK = chr(1)
    out, fence, run = [], False, []

    def flush():
        if len(run) < 2:
            return
        # A SPLIT table is not ragged - each half is internally consistent, which is
        # exactly why raggedness alone missed the section 10 case. The tell is that a
        # table's second line must be the | --- | separator; an orphaned lower half
        # begins with a data row and renders as literal pipe-text, not as a table.
        second = run[1][1].strip()
        if set(second) - set("|-: "):
            out.append(
                "table fragment at line {}: its second line is not a `| --- |` "
                "separator, so this block renders as literal text rather than as a "
                "table. Usually means an insertion split one table in two.".format(
                    run[0][0]))
            return
        widths = {}
        for n, l in run:
            s = l.strip().replace(ESCAPED, MASK)
            widths.setdefault(len(s.strip("|").split("|")), []).append(n)
        if len(widths) > 1:
            common = max(widths, key=lambda k: len(widths[k]))
            for w, ns in sorted(widths.items()):
                if w == common:
                    continue
                out.append(
                    "ragged table: line(s) {} have {} columns where the rest of the "
                    "table (from line {}) have {}. A bare pipe in a cell adds a "
                    "column; escape it.".format(
                        ", ".join(str(x) for x in ns), w, run[0][0], common))

    for n, l in enumerate(lines, 1):
        if l.strip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        if l.strip().startswith("|"):
            run.append((n, l))
        else:
            flush()
            del run[:]
    flush()
    return out


def prose_sentences(lines):
    """Yield (line_no, sentence) over PROSE, across the hard wrap.

    CODEC.md is hard-wrapped, so a sentence's SUBJECT and its MUST routinely sit on
    different physical lines. A line-scoped scan therefore reads `larger value MUST be
    refused as `uvarint_overflow`.` (line 156) as a whole claim when its quantifier is
    one line up - which is the exact failure the 1b worklist exists to surface, so a
    line-scoped 1b would have been blind to its own defect class.

    Fenced blocks and tables are skipped: a grammar production is not a sentence, and a
    table row states its scope in the column header rather than in the row.
    """
    out, buf, start, fence = [], [], None, False

    def flush():
        if not buf:
            return
        text = " ".join(buf)
        for s in re.split(r"(?<=[.:;]) +(?=[A-Z`*(])", text):
            s = s.strip()
            if s:
                out.append((start, s))

    for n, l in enumerate(lines, 1):
        if l.strip().startswith("```"):
            fence = not fence
            flush(); buf, start = [], None
            continue
        if fence or not l.strip() or l.strip().startswith("|"):
            flush(); buf, start = [], None
            continue
        if start is None:
            start = n
        buf.append(l.strip())
    flush()
    return out


def span(lines, order, num):
    """The lines of section `num`, up to the next heading."""
    starts = [idx for n, idx in order if n == num]
    if not starts:
        return []
    start = starts[0]
    later = [idx for _, idx in order if idx > start]
    return lines[start:(min(later) if later else len(lines))]


def codes_in(text):
    """Result codes are lowercase_snake in backticks."""
    found = set(re.findall(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`", text))
    # grammar nonterminals and field names are not result codes
    noise = {"link_index", "leaf_codec", "slot_codec", "board_root", "need_more_input"}
    return {c for c in found if c not in noise}


def marked(line, a, b):
    """Is the token at [a,b) wrapped in backticks, bold, or italics?"""
    return (
        (a > 0 and line[a - 1] == "`")
        or (b < len(line) and line[b] == "`")
        or (a > 1 and line[a - 2:a] == "**")
        or (b + 1 < len(line) and line[b:b + 2] == "**")
        or (a > 0 and line[a - 1] == "*")
        or (b < len(line) and line[b] == "*")
    )


def load_derivation():
    """Import tools/derive-vector-profiles.py by path (its name is not an identifier).

    Imported rather than transcribed: two records of the same table is how they drift,
    and this check exists because a drift of exactly that kind went unnoticed.
    """
    import importlib.util
    f = Path(__file__).resolve().parent / "derive-vector-profiles.py"
    if not f.exists():
        return None, None
    spec_mod = importlib.util.spec_from_file_location("dvp", f)
    dvp = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(dvp)
    # The table for THIS spec. A vector file cites its own spec, and only files citing
    # docs/CODEC.md make claims about this document's section 2.1.
    return dvp.MAY_REPORT_BY_SPEC["docs/CODEC.md"], dvp.LOCUS_MIN


def check_profiles(lines, order):
    """Section 2.1's profile table against the vector corpus's reading of it.

    THE ASYMMETRY THAT DECIDES WHAT IS CHECKABLE: section 2.1 states four of its six
    may-report cells INTENSIONALLY ("every section 9 decoder verdict", "only the
    store-layer codes") while the derivation tool states all six EXTENSIONALLY. The
    tool therefore holds a READING of the spec, and only rows the spec spells out as a
    code list can be compared against it. That is one row today - flat-header-validator
    - and it is the row that drifted, because it is the one narrow enough to enumerate.
    """
    notes, fails = [], []
    sec = "\n".join(span(lines, order, "2"))
    if "2.1 Conformance profiles" not in sec:
        return notes, ["section 2.1 not found - refusing rather than reporting clean"]

    # ⚠ WHITESPACE-TOLERANT ON PURPOSE. This pattern required exactly one space around
    # the cell delimiters, so ONE EXTRA SPACE before a `|` dropped a profile and failed
    # the build on a document that renders identically. Found by an R7 mutation seeded
    # as a decoy: it is a decoy for the SPEC and a real defect in this CHECKER.
    # ⇒ A gate that reds on valid Markdown teaches its readers to ignore it, which is
    #   worse than the drift it was added to catch. Cell padding is insignificant in
    #   the format, so the parser must treat it that way.
    spec_rows = {}
    for line in sec.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        m = re.fullmatch(r"\*\*([a-z-]+)\*\*", cells[0])
        if m:
            spec_rows[m.group(1)] = cells[2]
    if not spec_rows:
        return notes, ["section 2.1's profile table did not parse - a dead read, not a pass"]

    may, locus_min = load_derivation()
    if may is None:
        return notes, ["tools/derive-vector-profiles.py absent - cannot check the corpus's reading"]

    # (a) The NAME SET is total and mechanical. A profile added, renamed or removed in
    #     section 2.1 without the tool following is caught here and nowhere else.
    spec_names, tool_names = set(spec_rows), set(may)
    if spec_names != tool_names:
        fails.append(
            "section 2.1 and derive-vector-profiles.MAY_REPORT name different profiles: "
            "only in the spec {} | only in the tool {}".format(
                sorted(spec_names - tool_names) or "-", sorted(tool_names - spec_names) or "-"))
    notes.append("section 2.1 profiles: {}, tool agrees on names: {}".format(
        len(spec_names), spec_names == tool_names))

    # (b) Rows the spec spells out as an explicit code list are comparable; rows stated
    #     by reference to a section 9 class are NOT, and are named as out of reach.
    explicit, intensional = [], []
    for name, cell in spec_rows.items():
        # POLARITY IS LOAD-BEARING and this check got it wrong on its first run: the
        # closure-checker cell reads "framing and link faults; never
        # `non_canonical_payload`" - a backticked code stated as an EXCLUSION. Reading
        # every code in a cell as permitted made the check demand the tool include the
        # one code the spec forbids. A cell carrying a negation is not an enumeration,
        # so it is intensional and out of reach, exactly like "every section 9 verdict".
        negated = any(w in cell.lower().split() for w in ("never", "not", "no"))
        codes = set() if negated else set(
            re.findall(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`", cell))
        if codes:
            explicit.append(name)
            if name in may and not codes <= may[name]:
                fails.append(
                    "section 2.1's row for {} names codes the corpus's table omits: {}".format(
                        name, ", ".join(sorted(codes - may[name]))))
        else:
            intensional.append(name)
    notes.append(
        "section 2.1 rows comparable to the tool: {} explicit ({}); {} stated by "
        "reference to a section 9 class and NOT machine-comparable".format(
            len(explicit), ", ".join(sorted(explicit)), len(intensional)))

    # (c) Every case's code must be reportable by the profile the case names.
    import json as _json
    # WHICH FILES make claims about THIS document is decided by each file's own "spec"
    # field, not by its name: since ADR 0011 the v1 corpus cites docs/CODEC-v1.md, and a
    # v2 corpus may use any file name. Digest integrity (e) is spec-independent and
    # still covers every codec corpus file.
    vec_dir = Path(__file__).resolve().parent.parent / "vectors"
    codec_specs = {"docs/CODEC.md", "docs/CODEC-v1.md"}
    codec_files, corpus = [], []
    for f in sorted(vec_dir.glob("*.json")):
        try:
            spec_of = _json.loads(f.read_text(encoding="utf-8")).get("spec")
            # The field may carry a section after the path ("docs/CODEC.md §10").
            spec_of = spec_of.split()[0] if isinstance(spec_of, str) and spec_of.strip() else None
        except Exception:
            spec_of = None
        if spec_of in codec_specs:
            codec_files.append(f)
            if spec_of == "docs/CODEC.md":
                corpus.append(f)
    notes.append("codec corpus files: {} citing docs/CODEC.md (checked against section 2.1), "
                 "{} citing another spec (digests only)".format(len(corpus), len(codec_files) - len(corpus)))
    total = bad = 0
    seen_arrays = {}
    for f in corpus:
        try:
            d = _json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            fails.append("{} did not parse: {}".format(f.name, e))
            continue
        # DO NOT NAME THE ARRAY. This read was `d["cases"]` and silently skipped five
        # cases that landed under a NEW top-level key, `invalid_cases` - reporting
        # "15 cases, all consistent" while five profile claims went unchecked. A true
        # count of the wrong population, in the check whose whole job is catching that.
        # An enumeration of key names is always one short, so match the SHAPE: every
        # top-level list whose items carry a `name` is a case array.
        arrays = [k for k, v in d.items()
                  if isinstance(v, list) and v and isinstance(v[0], dict) and "name" in v[0]]
        seen_arrays.setdefault(f.name, []).extend(arrays)
        for c in [x for k in arrays for x in d[k]]:
            mp, code = c.get("min_profile"), c.get("code")
            # A case asserting a FAULT must name the profile that can report it. Skipping
            # when either field is absent treated "acceptance case, correctly no claim"
            # and "fault case, claim MISSING" as one thing, and passed both. The
            # derivation tool repairs the second and says so - which is right for an
            # AUTHORING tool and wrong for a GATE, and CI runs the gate, not the tool.
            if code and not mp:
                fails.append(
                    "{}: asserts {} and names NO min_profile - refusing rather than "
                    "skipping; run tools/derive-vector-profiles.py".format(c["name"], code))
                bad += 1
                continue
            if not mp or not code:
                continue          # acceptance cases correctly carry neither
            total += 1
            if mp not in may:
                fails.append("{}: names profile {}, absent from section 2.1".format(c["name"], mp))
                bad += 1
            elif code not in may[mp]:
                fails.append(
                    "{}: code {} is NOT reportable by {} - the corpus asks an actor for a "
                    "verdict section 2.1 does not permit it".format(c["name"], code, mp))
                bad += 1
            # (d) min_profile must be the MINIMUM its stated locus implies. WEAK on a
            #     generated file, since one run writes both fields - so it catches a HAND
            #     EDIT, never a stale derivation. Said plainly so nobody reads it as more.
            loc = c.get("fault_locus")
            if loc and loc in locus_min and mp != locus_min[loc]:
                fails.append(
                    "{}: fault_locus {} implies min_profile {}, but the case names {}".format(
                        c["name"], loc, locus_min[loc], mp))
                bad += 1
    # (e) Every published digest must be the digest of the preimage beside it.
    # NON-CONTAMINATING BY CONSTRUCTION, which is why a spec-side gate may do it:
    # sha256 is not the codec. This needs no grammar, no leaf codec and no decoder, so
    # it is not a step toward the reference implementation 0007 withholds.
    # ⚠ AND IT DOES NOT WITNESS THE OCTETS. A case whose bytes are the WRONG bytes still
    # passes: what can no longer pass is a digest that disagrees with the bytes printed
    # beside it. The corpus publishes each digest WITH its preimage precisely so a reader
    # can recompute rather than trust - and until now nothing recomputed them.
    import hashlib as _h
    pairs = ok_pairs = 0

    def _digests(o):
        if isinstance(o, dict):
            if isinstance(o.get("sha256"), str) and isinstance(o.get("bytes"), str):
                yield o
            for v in o.values():
                yield from _digests(v)
        elif isinstance(o, list):
            for v in o:
                yield from _digests(v)

    for f in codec_files:
        try:
            d = _json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue          # already reported by the case walk above
        for o in _digests(d):
            pairs += 1
            try:
                got = _h.sha256(bytes.fromhex(o["bytes"])).hexdigest()
            except ValueError:
                fails.append("{}: `bytes` is not hex, so its digest cannot be checked".format(
                    o.get("name", "<unnamed>")))
                continue
            if got == o["sha256"]:
                ok_pairs += 1
            else:
                fails.append(
                    "{}: published sha256 {} but its preimage hashes to {}".format(
                        o.get("name", "<unnamed>"), o["sha256"][:16], got[:16]))
    notes.append("published digests recomputed from their preimages: {}/{}".format(
        ok_pairs, pairs))

    notes.append("vector cases carrying a profile claim: {}, all consistent: {}".format(
        total, not bad))
    # Name the arrays read, every run. A new case array is then visible in the output
    # rather than silently outside the check - which is how the last five hid.
    notes.append("case arrays read: " + "; ".join(
        "{} [{}]".format(k, ", ".join(sorted(set(v)))) for k, v in sorted(seen_arrays.items())))
    return notes, fails


def main():
    lines = load()
    order = headings(lines)
    secs = {n for n, _ in order}
    text = "\n".join(lines)
    failures = []
    notes = []

    # ---- DECIDABLE 1: every section reference resolves ---------------------
    refs = set(re.findall(r"§(\d+)", text))
    missing = sorted(refs - secs, key=int)
    if missing:
        failures.append(
            "dangling section references: " + ", ".join("§" + m for m in missing)
        )
    notes.append("section refs resolved: {}/{}".format(len(refs) - len(missing), len(refs)))

    # ---- DECIDABLE 2: declared codes vs the precedence table ---------------
    s9 = "\n".join(span(lines, order, "9"))
    s10 = "\n".join(span(lines, order, "10"))
    declared = set()
    if not s9 or not s10:
        failures.append(
            "could not locate section 9 or 10 - refusing rather than reporting clean"
        )
    else:
        declared = codes_in(s9)
        ordered = codes_in(s10)
        # An unnamed exemption is the defect itself, so require section 10 to name it.
        excused = {c for c in ORDERED_ELSEWHERE if "`" + c + "`" in s10}
        gap = sorted(declared - ordered - STORE_LAYER - excused)
        if gap:
            failures.append(
                "codes declared in section 9 but absent from section 10's precedence "
                "table, and section 10 does not say where they are ordered: "
                + ", ".join(gap)
            )
        notes.append(
            "section 9 declares {} codes; section 10 orders {}; {} store-layer, "
            "{} ordered elsewhere and named".format(
                len(declared),
                len(ordered & declared),
                len(STORE_LAYER & declared),
                len(excused & declared),
            )
        )

    # ---- DECIDABLE 3: no code used without being declared ------------------
    if s9:
        used = codes_in(text)
        # Section 12's token column names resource DIMENSIONS, not result codes. They
        # share the backticked snake_case spelling, so they are read from that table and
        # set apart here rather than reported as undeclared codes.
        s12 = "\n".join(span(lines, order, "12"))
        dimensions = {c for c in codes_in(s12) if c not in declared}
        orphans = sorted(used - (declared | STORE_LAYER | dimensions))
        if orphans:
            failures.append(
                "codes used but never declared in section 9: " + ", ".join(orphans)
            )
        notes.append(
            "codes used document-wide: {}, all declared: {}".format(len(used), not orphans)
        )

    # ---- DECIDABLE 4: section 2.1's profile table vs the corpus's reading ----
    # Crosses out of the document into vectors/ deliberately: the invariant is about
    # the TABLE and the corpus's CLAIMS about it, not about octets. It exists because
    # this drift happened - widening flat-header-validator's may-report set lowered a
    # case's min_profile an hour after it was authored, and nothing announced it.
    pn, pf = check_profiles(lines, order)
    notes.extend(pn); failures.extend(pf)

    # EVERY markdown file, not just CODEC.md. The two table defects that actually
    # occurred were in CODEC.md and in IDENTITY-SURFACE.md, and 0008 - a governing
    # artifact at freeze - was unguarded entirely. Scoping a repo-wide defect class to
    # one file is how the second instance gets found by a person instead.
    n_md, n_tables = 0, 0
    for md in walk_markdown():
        try:
            ml = md.read_text(encoding="utf-8").splitlines()
        except (IOError, OSError, UnicodeDecodeError) as e:
            failures.append("{}: unreadable ({})".format(rel(md), e))
            continue
        n_md += 1
        n_tables += sum(1 for l in ml if l.strip().startswith("| ---"))
        for msg in check_tables(ml):
            failures.append("{}: {}".format(rel(md), msg))
    # Printed so the LEDGERS' coverage is visible. Until this line the report listed
    # seven checks, all of them about CODEC.md and the vectors, and a reader could not
    # see that any ledger was gated at all - which is how "the ledgers' claims are
    # checked none" stayed true without anyone noticing.
    notes.append(
        "markdown tables well-formed: {} tables across {} files "
        "(the only gate that reaches the ledgers)".format(n_tables, n_md))

    # ---- WORKLIST 1: normative universals ----------------------------------
    universals = [
        (i, l.strip())
        for i, l in enumerate(lines, 1)
        if re.search(NORMATIVE, l) and re.search(UNIVERSALS, l, re.I)
    ]

    # ---- WORKLIST 1b: IMPLICIT quantifiers (0003 Verdicts row 6) ----------
    implicit = []
    for n, s in prose_sentences(lines):
        if not re.search(NORMATIVE, s):
            continue
        if re.search(UNIVERSALS, s, re.I):
            continue          # already on worklist 1; do not double-report
        for kind, pat in IMPLICIT:
            if re.search(pat, s):
                implicit.append((section_at(order, n - 1), n, kind, s))
                break

    # ---- WORKLIST 1c: GRAMMAR productions (0003 Verdicts row 6, 4th carrier) ---
    grammar, fence = [], False
    for n, l in enumerate(lines, 1):
        if l.strip().startswith("```"):
            fence = not fence
            continue
        if not fence or not l.strip() or l.strip().startswith("#"):
            continue
        hits = []
        for kind, pat in GRAMMAR_TOKENS:
            for m in re.findall(pat, l):
                hits.append(kind)
        if hits:
            grammar.append((section_at(order, n - 1), n, sorted(set(hits)), l.strip()))

    # ---- WORKLIST 2: bare verdict vocabulary outside section 9 -------------
    vocab = []
    for i, l in enumerate(lines, 1):
        if section_at(order, i - 1) == "9":
            continue
        for m in re.finditer(VOCAB, l, re.I):
            if not marked(l, m.start(), m.end()):
                vocab.append((section_at(order, i - 1), i, m.group(0), l.strip()))

    # ---- report ------------------------------------------------------------
    def trunc(s, n=86):
        return s if len(s) <= n else s[: n - 3] + "..."

    print("=" * 74)
    print("speccheck - docs/CODEC.md")
    print("=" * 74)

    print("\nDECIDABLE (these fail the build):")
    for n in notes:
        print("  - " + n)
    if failures:
        for f in failures:
            print("  FAIL: " + f)
    else:
        print("  ok: all decidable checks pass")

    print(
        "\nWORKLIST 1 - {} normative universals (never fails the build)".format(
            len(universals)
        )
    )
    print("  Ask of each: not 'is it true' but 'over what is it quantified, and does")
    print("  the text say so'. Several of 0008's findings were exactly this, and none")
    print("  was a wrong ruling - each was a right ruling stated too widely.")
    for i, l in universals:
        print("  line {:>4}  {}".format(i, trunc(l)))

    print(
        "\nWORKLIST 1b - {} normative sentences quantifying IMPLICITLY "
        "(never fails the build)".format(len(implicit)))
    print("  An article, a bare plural or a definite description doing a universal's")
    print("  work, with no domain stated. The 5.4 defect had this shape: `A decoder`")
    print("  narrowed when 2.1 landed and nothing in the sentence showed it. The")
    print("  question is whether the domain is STATED, not whether the sentence is")
    print("  wrong - so expect false alarms, and read these rather than count them.")
    print("  The line number is the PARAGRAPH start, not the sentence: several rows may")
    print("  share one number. Read the paragraph, which is the unit a scope lives in.")
    for sec, n, kind, s in implicit:
        # Belt-and-braces only, and the honest version of why. A worklist may not fail
        # the build, and printing is a way one could: CODEC.md carries U+2208 and a
        # cp1252 stdout raises on it.
        #
        # ~ BUT THIS FILE WAS NEVER EXPOSED, and I claimed otherwise. Line 40 has forced
        # UTF-8 on stdout since 533849d, with a comment saying exactly why. I then
        # "proved" the fold necessary with PYTHONIOENCODING=ascii:strict -> rc=0, and
        # reconfigure() OVERRIDES PYTHONIOENCODING: THE ARM COULD NOT HAVE GONE RED.
        # A green result from an arm with no failing mode is not evidence, and it reads
        # identically to one that is. Same defect as the ragged-table rule that could
        # not see a split table - found by running it, not by reading it back.
        #
        # Kept because it is locally true where reconfigure is global, and a later
        # removal of line 40 should not silently re-arm this. Not kept as a defence
        # that was ever needed.
        row = "  s{:<4} line {:>4}  [{:<11}] {}".format(sec, n, kind, trunc(s, 58))
        print(row.encode("ascii", "replace").decode("ascii"))

    print(
        "\nWORKLIST 1c - {} grammar lines stating an obligation with no MUST "
        "(never fails the build)".format(len(grammar)))
    print("  A production carries no normative keyword, so worklists 1 and 1b cannot")
    print("  see it - and it decides every octet on the wire. The vectors lane measured")
    print("  this on 2026-09-03: of 20 identity-affecting mutations, the 10 that")
    print("  survived every pin were ALL in grammar and NONE in prose. Ask of each row:")
    print("  which rule or vector holds this, and would anything fail if it changed?")
    for sec, n, kinds, s in grammar:
        row = "  s{:<4} line {:>4}  {:<34} {}".format(
            sec, n, ",".join(kinds)[:34], trunc(s, 46))
        print(row.encode("ascii", "replace").decode("ascii"))

    print(
        "\nWORKLIST 2 - {} bare uses of the verdict vocabulary outside section 9".format(
            len(vocab)
        )
    )
    print("  Section 9 defines accepted / invalid / unsupported / incomplete as verdict")
    print("  classes. In the technical sense they are normally marked (backticks or")
    print("  bold); a BARE use is either colloquial - fine - or a D1-style collision,")
    print("  where section 12's 'MUST accept inputs up to each floor', read with")
    print("  section 9's own definition, required returning accepted for INVALID octets.")
    for sec, i, w, l in vocab:
        print("  s{:<3} line {:>4}  [{}]  {}".format(sec, i, w, trunc(l, 66)))

    print("\nOUT OF REACH of this tool: whether a stated scope is the intended one.")
    print("  That is the freeze bundle's proofs (0008 step 2) - a proof assistant makes")
    print("  every quantifier's domain explicit and an over-wide claim fails to close.")
    print("  This is what you run meanwhile, on every commit.")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
