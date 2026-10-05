r"""deixis's identity contracts change only by IDENTITY.md's change rule.

WHY THIS EXISTS AT ALL. On 2026-10-05 a deixis design record (ADR 0013, first version)
declared that it "supersedes the interaction terminology of ADR 0012", an owner-decided record,
because a consumer's release had dropped that terminology the day before. Nothing could tell an
ordinary revision from a reversal, so the reversal merged as one more paragraph. ADR 0015 wrote
deixis's identity down (IDENTITY.md); research 0006's advice (R5-R7, R27) shaped how it is
governed. This check is the mechanical half of the change rule: change detection and
provenance, never a decision procedure.

WHAT IT DECIDES.
  1. IDENTITY.md's entries (`### ID<n>. Title`) have unique, stable identifiers, a non-empty
     quoted statement, a `**Why.**` paragraph, and the four attributes: Contract status,
     Authority, Evidence, Coverage. The Authority attribute names the entry's part: structural
     contract, derived construction, or family policy.
  2. Each entry's statement, reason and authority match their pin in tools/identity.lock, and so
     does every pinned section (`<!-- identity:pin NAME -->` ... `<!-- identity:end -->`). A pin
     names the record that last set it.
  3. That record exists, carries an `Identity:` line that adopts, proposes, updates or breaks the
     entry, and
     IDENTITY.md's change log names it.
  4. A supersession record (a structured `Supersedes:` line, or `Identity: breaks|retires`)
     carries the seven fields of IDENTITY.md's change rule, a `Derivations:` field citing at
     least two derivations, and a `Peer read:` field citing one. An update (`Updates:` or
     `Identity: updates`) carries a `Peer read:` field. A record that sets a family-policy entry
     carries an `Accepted-by:` field naming every component the entry's authority names.
  5. A structured `Supersedes:` or `Updates:` line that names a record an entry rests on comes
     with an `Identity:` line for an entry that rests on it.
  6. Prose that declares, in the present tense, a supersession of a record an entry rests on is
     an error unless its file also declares it structurally (rule 5), or the line predates this
     check (an `allow` entry in the lock). Prose supersession of anything else is a warning.
     ADAPTATION, named: research 0006's R7 makes keyword detection a warning. Here it stays an
     error for the records the contracts rest on, because the incident was exactly an
     undeclared prose supersession, and a warning in a CI log would not have stopped it. The
     structured line is the way to satisfy it, so structured links remain the primary check.
  7. No markdown file outside IDENTITY.md calls an entry superseded, withdrawn, replaced or
     retired without an `Identity:` line that breaks or retires it.
  8. Every quotation in an entry's attributes occurs verbatim in a record that the same clause
     links, ignoring line breaks and `**` emphasis. A clause that links no file in this
     repository (an issue, another repository, an internal note) is a reviewer's to check.

WHAT IT DOES NOT DECIDE. Whether a change is right, whether a derivation was really sealed,
whether a peer read was independent, or whether a component's agents really accepted. It
guarantees only that a change to a contract cannot merge looking like an ordinary edit.

`--self-test` plants each defect in a scratch copy and fails unless every plant turns the check
red for that defect, and the clean copy and a lawful change stay green.

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
ATTR = re.compile(r"^- \*\*(Contract status|Authority|Evidence|Coverage):\*\*")
ATTRS = ("Contract status", "Authority", "Evidence", "Coverage")
PARTS = ("structural contract", "derived construction", "family policy")
IDENTITY_LINE = re.compile(r"^\s*(?:\*\*)?Identity:(?:\*\*)?\s*(adopts|proposes|updates|breaks|retires)\s+(.+)$", re.M)
STRUCT = re.compile(r"^\s*(?:\*\*)?(Supersedes|Updates):(?:\*\*)?\s*(.+)$", re.M)
FIELD = lambda name: re.compile(r"^\s*(?:-\s*)?\*\*" + re.escape(name) + r":\*\*\s*\S", re.M | re.I)
R6_FIELDS = ("Affected contract", "Old rationale and present tradeoff", "Authority and delegation",
             "Alternatives and consequences", "Evidence and obligations", "Approved revision")
ID_RANGE = re.compile(r"ID(\d+)\s*(?:to|–|-)\s*ID(\d+)")
ID_ONE = re.compile(r"\bID(\d+)\b")
SUPERSEDE = re.compile(r"\bsupersed(?:e|es|ing)\b", re.I)
RETIRES_ID = re.compile(r"\bID\d+\b.*\b(?:superseded|withdrawn|replaced|retired)\b"
                        r"|\b(?:supersede[sd]?|withdraws?|replaces?|retires?)\b.*\bID\d+\b", re.I)
DESIGN_REF = re.compile(r"\bADR (\d{4})\b|design/(\d{4})-|\]\((\d{4})-")
DOC_REF = re.compile(r"\]\((?:\.\./|docs/)?([A-Z][A-Z0-9-]*\.md)\)")
QUOTE = re.compile(r'"([^"]+)"')
CLAUSE = re.compile(r"\b(?:owner sessions|owner|agents|recorded|proved|checked|stated|derived):")
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
REF = re.compile(r"\]\([^)]+\)|(?<![\w/])#\d+\b|\b[\w.-]+#\d+\b")
SECTION = re.compile(r"<!-- identity:pin ([\w-]+) -->(.*?)<!-- identity:end -->", re.S)


def norm(text: str) -> str:
    return " ".join(text.split())


def sha(text: str) -> str:
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()


def plain(text: str) -> str:
    return norm(text.replace("**", ""))


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def rel(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace(os.sep, "/")


# ------------------------------------------------------------------------------ IDENTITY.md

def parse_entries(text: str) -> list[dict]:
    """One dict per `### ID<n>.` entry: id, statement, why, attrs {name: text}, part, components."""
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if HEADING.match(l)]
    bounds = starts[1:] + [len(lines)]
    entries = []
    for a, b in zip(starts, bounds):
        block = lines[a:b]
        # an entry ends at the next "## " part heading
        for k, l in enumerate(block[1:], 1):
            if l.startswith("## "):
                block = block[:k]
                break
        ident = HEADING.match(block[0]).group(1)
        statement, why, attrs, current = [], [], {}, None
        i = 1
        while i < len(block) and not block[i].startswith(">"):
            i += 1
        while i < len(block) and block[i].startswith(">"):
            statement.append(block[i][1:].strip())
            i += 1
        for j in range(i, len(block)):
            if block[j].startswith("**Why.**"):
                k = j
                while k < len(block) and block[k].strip():
                    why.append(block[k])
                    k += 1
                break
        for l in block:
            m = ATTR.match(l)
            if m:
                current = m.group(1)
                attrs[current] = [l]
            elif current and (l.startswith("  ") or not l.strip()):
                attrs[current].append(l)
            elif current and l.startswith("**"):
                current = None
            else:
                current = None
        attrs = {k: "\n".join(v).strip() for k, v in attrs.items()}
        authority = attrs.get("Authority", "")
        part = next((p for p in PARTS if p in authority.lower()), None)
        components = []
        m = re.search(r"family policy:\s*([^.]*?)\s+together", authority, re.I)
        if m:
            components = [c.strip() for c in re.split(r",|\band\b", m.group(1)) if c.strip()]
        entries.append({"id": ident, "num": int(ident[2:]), "statement": "\n".join(statement),
                        "why": "\n".join(why), "attrs": attrs, "part": part,
                        "components": components})
    return entries


def entry_pin(e: dict) -> str:
    return sha(e["statement"] + "\n" + e["why"] + "\n" + e["attrs"].get("Authority", ""))


def entry_sources(e: dict) -> set[str]:
    """Records an entry rests on: local design records and docs linked from its attributes."""
    out = set()
    body = "\n".join(e["attrs"].values())
    for g in DESIGN_REF.findall(body):
        out.add("design/" + next(x for x in g if x))
    for doc in DOC_REF.findall(body):
        out.add(doc)
    return out


def change_log(text: str) -> str:
    return text.split("## Change log", 1)[1] if "## Change log" in text else ""


def parse_lock(text: str):
    pins, sections, allow, retired = {}, {}, set(), {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if parts[0] == "allow" and len(parts) == 3:
            allow.add((parts[1], parts[2]))
        elif parts[0] == "SECTION" and len(parts) == 4:
            sections[parts[1]] = (parts[2], parts[3])
        elif len(parts) == 3 and parts[0].startswith("ID") and parts[1] == "retired":
            retired[parts[0]] = parts[2]
        elif len(parts) == 3 and parts[0].startswith("ID"):
            pins[parts[0]] = (parts[1], parts[2])
        else:
            raise SystemExit(f"identity.lock: cannot read line: {raw!r}")
    return pins, sections, allow, retired


# ------------------------------------------------------------------------------ records

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


def identity_lines(text: str) -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    for kind, spec in IDENTITY_LINE.findall(text):
        out.setdefault(kind, set()).update(ids_in(spec))
    return out


def field_text(text: str, name: str) -> str:
    m = re.search(r"^\s*(?:-\s*)?\*\*" + re.escape(name) + r":\*\*(.*(?:\n(?!\s*(?:-\s*)?\*\*[\w -]+:\*\*|\s*$|#).*)*)",
                  text, re.M | re.I)
    return m.group(1) if m else ""


def record_errors(r: str, text: str, entries_by_num: dict[int, dict]) -> list[str]:
    """Rule 4 for one markdown record."""
    errors = []
    idl = identity_lines(text)
    structs = STRUCT.findall(text)
    supersedes = any(k == "Supersedes" for k, _ in structs) or bool(idl.get("breaks") or idl.get("retires"))
    updates = any(k == "Updates" for k, _ in structs) or bool(idl.get("updates"))
    if supersedes:
        missing = [f for f in R6_FIELDS if not FIELD(f).search(text)]
        if not structs and not (FIELD("Supersedes").search(text) or FIELD("Updates").search(text)):
            missing.insert(1, "Supersedes")
        if missing:
            errors.append(f"{r}: a supersession record lacks the change rule's fields: "
                          + ", ".join(missing))
        if len(REF.findall(field_text(text, "Derivations"))) < 2:
            errors.append(f"{r}: a supersession needs a `Derivations:` field citing two sealed "
                          f"derivations, one of which tries to defeat the favoured design")
    if (supersedes or updates) and len(REF.findall(field_text(text, "Peer read"))) < 1:
        errors.append(f"{r}: a {'supersession' if supersedes else 'update'} needs a "
                      f"`Peer read:` field citing the read")
    # Proposing a family-policy entry needs no acceptance; adopting or changing one does.
    touched = set().union(*(v for k, v in idl.items() if k != "proposes")) if idl else set()
    accepted = field_text(text, "Accepted-by").lower()
    for num in sorted(touched):
        e = entries_by_num.get(num)
        if e and e["part"] == "family policy":
            lacking = [c for c in e["components"] if c.lower() not in accepted]
            if lacking:
                errors.append(f"{r}: it sets family policy {e['id']}, which only the agents of "
                              f"every affected component change together; its `Accepted-by:` "
                              f"lacks " + ", ".join(lacking))
    return errors


def markdown_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(n for n in dirnames if n not in SKIP)
        for name in sorted(filenames):
            if name.endswith(".md"):
                yield os.path.join(dirpath, name)


def refers_to(rel_path: str, line: str, record: str) -> bool:
    if record.startswith("design/"):
        num = record.split("/")[1]
        return (rel_path.startswith(f"docs/design/{num}-") or f"ADR {num}" in line
                or f"design/{num}-" in line or f"]({num}-" in line)
    return rel_path == f"docs/{record}" or bool(re.search(r"[(/]" + re.escape(record) + r"\)", line))


def unquoted(root: str, entries: list[dict]) -> list[str]:
    errors = []
    for e in entries:
        body = "\n".join(l for l in "\n".join(e["attrs"].values()).splitlines()
                         if not l.lstrip().startswith(">"))
        starts = [m.start() for m in CLAUSE.finditer(body)] + [len(body)]
        for a, b in zip(starts, starts[1:]):
            clause = body[a:b]
            files = [os.path.normpath(os.path.join(root, t)) for t in LINK.findall(clause)]
            files = [f for f in files if os.path.isfile(f)]
            if not files:
                continue
            sources = [plain(read(f)) for f in files]
            for quoted in QUOTE.findall(clause):
                if not any(plain(quoted) in src for src in sources):
                    errors.append(f"IDENTITY.md {e['id']}: the quotation \"{plain(quoted)}\" does not "
                                  f"occur in " + ", ".join(rel(root, f) for f in files)
                                  + ". Quote the record verbatim, or say paraphrase and drop the "
                                    "quotation marks")
    return errors


# ------------------------------------------------------------------------------ the check

def check(root: str, warnings: list[str] | None = None) -> list[str]:
    errors: list[str] = []
    warnings = warnings if warnings is not None else []
    identity_text = read(os.path.join(root, "IDENTITY.md"))
    entries = parse_entries(identity_text)
    by_num = {e["num"]: e for e in entries}
    log = change_log(identity_text)
    pins, sections, allow, retired = parse_lock(read(os.path.join(root, "tools", "identity.lock")))

    # rule 1
    ids = [e["id"] for e in entries]
    if len(ids) != len(set(ids)):
        errors.append("IDENTITY.md: entry identifiers must be unique")
    for e in entries:
        if not e["statement"].strip():
            errors.append(f"IDENTITY.md {e['id']}: no quoted statement")
        if not e["why"].strip():
            errors.append(f"IDENTITY.md {e['id']}: no **Why.** paragraph")
        for a in ATTRS:
            if a not in e["attrs"]:
                errors.append(f"IDENTITY.md {e['id']}: lacks the {a} attribute "
                              f"(every entry carries Contract status, Authority, Evidence, Coverage)")
        if "Authority" in e["attrs"] and e["part"] is None:
            errors.append(f"IDENTITY.md {e['id']}: its Authority does not name its part "
                          f"(structural contract, derived construction or family policy)")
        if e["part"] == "family policy" and not e["components"]:
            errors.append(f"IDENTITY.md {e['id']}: a family-policy entry names its components "
                          f"(\"family policy: A, B and C together\")")
    for gone in retired:
        if gone in ids:
            errors.append(f"IDENTITY.md: {gone} is retired in the lock and cannot be reused")

    # rules 2 and 3
    if set(pins) != set(ids):
        errors.append("identity.lock pins " + ", ".join(sorted(pins)) + " but IDENTITY.md states "
                      + ", ".join(sorted(ids)))
    for e in entries:
        if e["id"] not in pins:
            continue
        digest, adr = pins[e["id"]]
        if entry_pin(e) != digest:
            errors.append(f"{e['id']}'s statement, reason or authority changed. A contract changes "
                          f"only by IDENTITY.md's change rule: a record with an `Identity:` line for "
                          f"{e['id']}, a change-log entry, and the new pin ({entry_pin(e)})")
        path = adr_file(root, adr)
        if path is None:
            errors.append(f"{e['id']} is pinned to ADR {adr}, which does not exist")
            continue
        covered = set().union(*identity_lines(read(path)).values()) if identity_lines(read(path)) else set()
        if e["num"] not in covered:
            errors.append(f"{e['id']} is pinned to ADR {adr}, whose `Identity:` line does not cover it")
        if f"ADR {adr}" not in log and f"design/{adr}-" not in log:
            errors.append(f"{e['id']} is pinned to ADR {adr}, which the change log does not name")
    for key, (digest, adr) in sections.items():
        fname, name = key.split("#", 1)
        path = os.path.join(root, fname)
        found = {m.group(1): m.group(2) for m in SECTION.finditer(read(path))} if os.path.isfile(path) else {}
        if name not in found:
            errors.append(f"pinned section {key} is missing its identity:pin markers")
        elif sha(found[name]) != digest:
            errors.append(f"pinned section {key} changed; it changes only with a record and a new "
                          f"pin ({sha(found[name])})")
        if adr_file(root, adr) is None or (f"ADR {adr}" not in log and f"design/{adr}-" not in log):
            errors.append(f"pinned section {key} names ADR {adr}, which is missing or not in the change log")

    # rules 4 to 7
    identity_records = {adr for _, adr in pins.values()} | {adr for _, adr in sections.values()}
    for path in markdown_files(root):
        r = rel(root, path)
        if r == "IDENTITY.md":
            continue
        text = read(path)
        errors.extend(record_errors(r, text, by_num))
        idl = identity_lines(text)
        structs = STRUCT.findall(text)
        named_ids = set().union(*idl.values()) if idl else set()
        for kind, target in structs:
            for e in entries:
                if any(refers_to("", target, src) for src in entry_sources(e)) and \
                        not (named_ids & {x["num"] for x in entries
                                          if any(refers_to("", target, s) for s in entry_sources(x))}):
                    errors.append(f"{r}: `{kind}: {target.strip()}` names a record "
                                  f"{e['id']} rests on, but no `Identity:` line covers an entry resting on it")
                    break
        is_identity_record = r.startswith("docs/design/") and r[12:16] in identity_records
        breaks = bool(idl.get("breaks") or idl.get("retires"))
        for n, line in enumerate(text.splitlines(), 1):
            if SUPERSEDE.search(line) and not is_identity_record and not STRUCT.match(line):
                protected = [s for e in entries for s in entry_sources(e) if refers_to(r, line, s)]
                if protected and not structs and (r, sha(line)) not in allow:
                    errors.append(f"{r}:{n}: declares a supersession of a record deixis's contracts "
                                  f"rest on ({protected[0]}) without declaring it: add `Supersedes:` "
                                  f"and `Identity:` lines (IDENTITY.md, change rule): {line.strip()}")
                elif not protected and (r, sha(line)) not in allow:
                    warnings.append(f"{r}:{n}: prose supersession (warning only): {line.strip()}")
            if RETIRES_ID.search(line) and not breaks and not is_identity_record:
                errors.append(f"{r}:{n}: retires an identity entry without an `Identity: breaks` "
                              f"or `retires` line: {line.strip()}")

    # rule 8
    errors.extend(unquoted(root, entries))
    return errors


# ------------------------------------------------------------------------------ self-test

def self_test(root: str) -> list[str]:
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

    def write(path: str, s: str) -> None:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(s)

    def arm(name: str, plant, want: str | None) -> None:
        """want: None for green, else a fragment the errors must contain."""
        tmp = copy()
        try:
            plant(tmp)
            errors = check(tmp)
            if want is None and errors:
                failures.append(f"self-test arm '{name}': expected green, got: {errors[0][:160]}")
            elif want is not None and not any(want in e for e in errors):
                failures.append(f"self-test arm '{name}': expected red for '{want}', got: "
                                + (errors[0][:160] if errors else "green"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def entry(t, ident):
        return next(e for e in parse_entries(read(os.path.join(t, "IDENTITY.md"))) if e["id"] == ident)

    def repin(t, ident, adr):
        new = entry_pin(entry(t, ident))
        edit(os.path.join(t, "tools", "identity.lock"),
             lambda s: re.sub(r"(?m)^" + ident + r" \S+ \S+$", f"{ident} {new} {adr}", s, count=1))

    def reword(t, ident, old, new):
        edit(os.path.join(t, "IDENTITY.md"), lambda s: s.replace(old, new, 1))

    fam = next(e for e in parse_entries(read(os.path.join(root, "IDENTITY.md"))) if e["part"] == "family policy")
    first = parse_entries(read(os.path.join(root, "IDENTITY.md")))[0]

    def record(t, ident, *, fields=True, derivations=True, peer=True, accepted=None):
        lines = [f"# Planted\n\nIdentity: breaks {ident}\n",
                 "Supersedes: [ADR 0012](0012-data-wire-tree-symmetry.md)\n"]
        if fields:
            for f in R6_FIELDS:
                lines.append(f"**{f}:** planted.\n")
        if derivations:
            lines.append("**Derivations:** [one](0001-keys-are-bytes.md), [two](0002-positional-keys.md).\n")
        if peer:
            lines.append("**Peer read:** [read](0003-instantiations-beyond-ontos.md).\n")
        if accepted is not None:
            lines.append(f"**Accepted-by:** {accepted}.\n")
        write(os.path.join(t, "docs", "design", "0999-planted.md"), "\n".join(lines))
        edit(os.path.join(t, "IDENTITY.md"), lambda s: s + "- planted, [ADR 0999](docs/design/0999-planted.md).\n")

    arm("clean copy", lambda t: None, None)

    arm("an entry's statement edited in place",
        lambda t: reword(t, first["id"], first["statement"].splitlines()[0], "Usually, " + first["statement"].splitlines()[0]),
        "statement, reason or authority changed")

    def historical(t):
        write(os.path.join(t, "docs", "design", "0999-planted.md"),
              "# Planted\n\nIt **supersedes the interaction terminology of "
              "[ADR 0012](0012-data-wire-tree-symmetry.md)**:\n")
    arm("ADR 0013's original sentence, an undeclared supersession of ADR 0012", historical,
        "without declaring it")

    arm("an amendment inside ADR 0012 saying it is superseded",
        lambda t: edit(adr_file(t, "0012"), lambda s: s.replace(
            "## Decision", "*(Amended: ADR 0999 supersedes this record's interaction terminology.)*\n\n## Decision", 1)),
        "without declaring it")

    arm("a document retiring an entry",
        lambda t: edit(os.path.join(t, "README.md"), lambda s: s + f"\n{fam['id']} is superseded by bitwire 0.4.0.\n"),
        "retires an identity entry")

    arm("an owner's words paraphrased inside quotation marks",
        lambda t: edit(os.path.join(t, "IDENTITY.md"), lambda s: s.replace("\"Let's use mandatory", "\"We use mandatory", 1)),
        "does not occur in")

    arm("R4: the withdrawn criterion sentence re-added to ID12",
        lambda t: reword(t, "ID12", "Raw conveyance does not interpret application paths.",
                         "Raw conveyance does not interpret application paths. A path parameter on the "
                         "primitive is addressing duplicated."),
        "statement, reason or authority changed")

    arm("R13: ID11 collapsed back into one overloaded `/` law",
        lambda t: reword(t, "ID11", "opaque addressed handle, `under(under",
                         "opaque addressed handle, or across any connection, `connect(a) / p ≈ connect(a ++ p)` and `under(under"),
        "statement, reason or authority changed")

    arm("R27: an entry missing its Coverage attribute",
        lambda t: edit(os.path.join(t, "IDENTITY.md"),
                       lambda s: s.replace(first["attrs"]["Coverage"].splitlines()[0], "", 1)),
        "lacks the Coverage attribute")

    def missing_field(t):
        reword(t, "ID12", "Raw conveyance", "Raw conveyance, in this plant,")
        record(t, "ID12", fields=False, accepted=", ".join(fam["components"]))
        repin(t, "ID12", "0999")
    arm("R6: a supersession record without the change rule's fields", missing_field, "lacks the change rule's fields")

    def no_derivations(t):
        reword(t, "ID12", "Raw conveyance", "Raw conveyance, in this plant,")
        record(t, "ID12", derivations=False, peer=False, accepted=", ".join(fam["components"]))
        repin(t, "ID12", "0999")
    arm("condition 2: a supersession without two derivations and a peer read", no_derivations, "Derivations")

    def one_component(t):
        reword(t, "ID12", "Raw conveyance", "Raw conveyance, in this plant,")
        record(t, "ID12", accepted=fam["components"][0])
        repin(t, "ID12", "0999")
    arm("condition 1: family policy changed with one component's acceptance", one_component, "Accepted-by")

    def lawful(t):
        reword(t, "ID12", "Raw conveyance", "Raw conveyance, in this plant,")
        record(t, "ID12", accepted=", ".join(fam["components"]))
        repin(t, "ID12", "0999")
    arm("a family-policy change made by the change rule", lawful, None)

    def section(t):
        lock = parse_lock(read(os.path.join(t, "tools", "identity.lock")))[1]
        key = sorted(lock)[0]
        fname, name = key.split("#", 1)
        edit(os.path.join(t, fname), lambda s: s.replace(f"<!-- identity:pin {name} -->",
                                                         f"<!-- identity:pin {name} -->\nPlanted.", 1))
    arm("a pinned section edited", section, "pinned section")

    def proposed(t):
        write(os.path.join(t, "docs", "design", "0999-planted.md"),
              f"# Planted\n\nIdentity: proposes {fam['id']}\n")
    arm("proposing a family-policy entry needs no acceptance", proposed, None)

    arm("prose supersession of an unprotected record only warns",
        lambda t: write(os.path.join(t, "docs", "design", "0999-planted.md"),
                        "# Planted\n\nThis supersedes [ADR 0005](0005-set-keys.md)'s example.\n"),
        None)

    return failures


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--self-test" in sys.argv[1:]:
        failures = self_test(root)
        for f in failures:
            print(f)
        print("identity self-test: " + ("FAILED" if failures else
              "every plant turns the check red for its own defect; the clean copy, a lawful change "
              "and an unprotected prose supersession stay green"))
        return 1 if failures else 0
    warnings: list[str] = []
    errors = check(root, warnings)
    for w in warnings:
        print("warning: " + w)
    for e in errors:
        print(e)
    n = len(parse_entries(read(os.path.join(root, "IDENTITY.md"))))
    print(f"identity: {n} entries, " + ("FAILED" if errors else
          "every pin holds, every supersession is declared, every quotation is verbatim"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
