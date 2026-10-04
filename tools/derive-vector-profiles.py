import json, io, collections

# CODEC.md §2.1 as of a5b6a2a — the may-report sets, transcribed from the table.
MAY_REPORT = {
    "flat-header-validator": {
        "unknown_magic", "unexpected_eof", "need_more_input",
        "malformed_uvarint", "non_shortest_uvarint", "uvarint_overflow",   # ON THE ID LENGTH only
        "unsupported_leaf_codec",
    },
    "flat-decoder": {
        "unknown_magic", "unexpected_eof", "need_more_input", "unknown_tag",
        "malformed_uvarint", "non_shortest_uvarint", "uvarint_overflow",
        "duplicate_key", "unsorted_keys", "trailing_bytes",
        "non_canonical_payload", "unsupported_leaf_codec", "leaf_codec_mismatch",
    },
    "closure-checker": {
        "unknown_magic", "unexpected_eof", "need_more_input", "unknown_tag",
        "malformed_uvarint", "non_shortest_uvarint", "uvarint_overflow",
        "duplicate_key", "unsorted_keys", "trailing_bytes",
        "bad_link_index", "unused_link", "duplicate_link_hash", "links_out_of_order",
        "leaf_codec_mismatch", "unsupported_leaf_codec",
    },
    "chunk-store": {"missing_chunk", "hash_mismatch", "address_conflict"},
    # Two keys added by the codec lane so speccheck's name-set check can pass; both are
    # a READING of section 2.1's own cells and are the vectors lane's to overrule.
    #   flat-encoder    "nothing; it emits or it fails locally" -> the EMPTY SET. Present
    #                   as a key on purpose: absent, the table cannot distinguish "no
    #                   reportable codes" from "a profile nobody entered".
    #   linked-resolver "every section 9 decoder verdict" — the same cell text as
    #                   flat-decoder, so flat-decoder's set PLUS the link codes, which a
    #                   resolver walks and a flat decoder never sees.
    # RULED, 2026-09-03 (vectors lane), and the answer is NOT to add it to four sets:
    #
    #   `limit_exceeded` is a UNIVERSAL VERDICT, not a per-profile entry. Section 9 calls
    #   resource-refused "valid so far, beyond a local limit -- the octets may be a value;
    #   I decline to spend", and section 10 says outright that two CONFORMING implementations
    #   with different local limits can return `limit_exceeded` and an invalid code FOR THE
    #   SAME OCTETS. No fault code can do that. So it is not a claim about the artifact at
    #   all; it is a claim about the reader's willingness to spend, and it is available to
    #   every profile that CONSUMES octets, by construction.
    #
    #   => Its absence from all six cells is therefore not six omissions. It is evidence the
    #   table's shape cannot express it -- the same shape as the codec lane's own ruling that
    #   leaf-codec knowledge is a MODIFIER because it cuts across profiles. This cuts across
    #   too, but it is not a modifier either: a modifier changes WHICH verdict is correct,
    #   this ADDS one available to everyone. It belongs in section 2.1's PROSE, stated once,
    #   not enumerated per cell -- which is why it is absent from MAY_REPORT here as well.
    #
    #   flat-encoder is correctly outside it: its own cell says it "fails locally" and
    #   reports nothing, so it has no verdict channel to refuse on.
    #
    # !! ONE GAP THIS EXPOSES, AND IT IS THE SPEC LANE'S CELL, NOT MINE TO PATCH:
    #   chunk-store's cell says it may report "ONLY the store-layer codes of section 9" --
    #   an exclusive only. A store handed a 10GB chunk must be able to decline, and section 9
    #   forbids dressing that up as invalidity, so under the cell as written such a store has
    #   NO code to say it with. Routed rather than worked around: adding a key here would make
    #   the tool disagree with section 2.1 silently, which is the two-records drift the gate
    #   exists to catch.
    #
    # => CONSEQUENCE FOR THE CORPUS, which is mine: `limit_exceeded` can never be an ordinary
    #   vector case. Two conforming implementations return DIFFERENT answers for one octet
    #   string, so there is no expected verdict to assert. That is why the plan's ruling 3 put
    #   envelope obligations in their own area with floors left to implementation tests -- and
    #   it now has a reason rather than a convention behind it.
    "flat-encoder": set(),
    "linked-resolver": {
        "unknown_magic", "unexpected_eof", "need_more_input", "unknown_tag",
        "malformed_uvarint", "non_shortest_uvarint", "uvarint_overflow",
        "duplicate_key", "unsorted_keys", "trailing_bytes",
        "non_canonical_payload", "unsupported_leaf_codec", "leaf_codec_mismatch",
        "bad_link_index", "unused_link", "duplicate_link_hash", "links_out_of_order",
    },
}

# deixis-codec-v2 (docs/CODEC.md since ADR 0011): v1's two codec codes are renamed at the
# version boundary and v1's node-kind code is retired, because v2 has one node production.
# Every other cell reads as in v1. Derived from MAY_REPORT rather than retyped, so the two
# tables cannot drift apart on anything the version did not change.
_RENAMED_V2 = {"unsupported_leaf_codec": "unsupported_slot_codec",
               "leaf_codec_mismatch": "slot_codec_mismatch"}
_RETIRED_V2 = {"unknown_tag"}
# Added in v2: v1 declared impossible ids invalid but named no code for them (a gap the
# vectors lane found while planning the v2 corpus). Every profile that reads an id can
# observe it, so every profile that reads a header may name it.
_ADDED_V2 = {"malformed_slot_codec_id"}
_READS_IDS = {"flat-header-validator", "flat-decoder", "closure-checker", "linked-resolver"}
MAY_REPORT_V2 = {
    profile: {_RENAMED_V2.get(c, c) for c in codes if c not in _RETIRED_V2}
             | (_ADDED_V2 if profile in _READS_IDS else set())
    for profile, codes in MAY_REPORT.items()
}

# A vector file declares the specification it was authored against in its own "spec"
# field; that choice selects the table. The v1 corpus cites the kept v1 text.
MAY_REPORT_BY_SPEC = {
    "docs/CODEC.md": MAY_REPORT_V2,
    "docs/CODEC-v1.md": MAY_REPORT,
}

# WHERE THE FAULT SITS -> the least capable profile that can observe AND name it.
# This is the whole derivation; min_profile is never authored.
LOCUS_MIN = collections.OrderedDict([
    ("header",  "flat-header-validator"),   # magic, id, and the id-LENGTH uvarint
    ("body",    "flat-decoder"),            # tag, structure, keys, body-resident uvarints, remainder
    ("payload", "flat-decoder"),            # im(e) membership — also requires the codec-holding modifier (v1: leaf-holding)
    ("links",   "closure-checker"),         # link header, indices, digests
    ("chunk-payload", "linked-resolver"),   # im(e) inside a dxl2 chunk: closure-checker never applies D,
                                            # and "payload" would name flat-decoder, which reads no chunk
    ("store",   "chunk-store"),             # the address <-> octets relation
])

# fault_locus is AUTHORED IN EACH VECTOR FILE, never here. This tool held its own copy
# until 2026-09-03 and that was a second record of one fact - the exact drift it exists to
# catch, in the catcher. A case with no fault_locus is REFUSED rather than defaulted:
# defaulting would silently derive a min_profile from an assumption nobody stated.
FILES = ["vectors/codec-flat.json", "vectors/codec-invalid.json", "vectors/codec-linked.json",
         "vectors/codec-precedence.json",
         "vectors/codec-v2-flat.json", "vectors/codec-v2-invalid.json", "vectors/codec-v2-linked.json",
         "vectors/codec-v2-precedence.json"]


# ---- the derivation itself runs ONLY as a script -------------------------
# WHY THIS GUARD IS LOAD-BEARING, found by speccheck's own red arm: importing this
# module to READ its tables used to execute the whole body, which RE-DERIVES and
# REWRITES the corpus. So a check that imported the tables silently repaired the
# very field it was about to verify — its red arm could not fire — and speccheck
# mutated vectors/ on every run, in CI, as a side effect of a read-only check.
# A table is data; importing data must not write to the tree.
def run():
    total, changed = 0, []
    for path in FILES:
        d = json.load(io.open(path, encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
        # BY SHAPE, never by name. This enumerated ("cases", "invalid_cases") until
        # 2026-09-03, when the codec lane's gate - carrying the same enumerated form -
        # silently skipped five of twenty cases and reported "all consistent": a true
        # count of the WRONG POPULATION, in a checker. An enumeration of key names is
        # always one short, and batch 3 adds another array, so this would have been the
        # next instance rather than a hypothetical one.
        buckets = [k for k, v in d.items()
                   if isinstance(v, list) and v and isinstance(v[0], dict) and "name" in v[0]]
        table = MAY_REPORT_BY_SPEC[(d.get("spec") or "docs/CODEC.md").split()[0]]
        print("  read %s %s" % (path.split("/")[-1], buckets))
        touched = False
        for bucket in buckets:
            for c in d[bucket]:
                if "code" not in c:
                    continue                      # accept/bridge cases carry no verdict
                n = c["name"]
                locus = c.get("fault_locus")
                assert locus, f"{n}: no fault_locus - REFUSING to derive from an assumption"
                assert locus in LOCUS_MIN, f"{n}: unknown fault_locus {locus!r}"
                derived = LOCUS_MIN[locus]
                if c.get("min_profile") != derived:
                    changed.append((n, c.get("min_profile"), derived))
                    touched = True
                assert c["code"] in table[derived], \
                    f"{n}: {c['code']} not reportable by {derived}"
                # keep min_profile immediately after fault_locus, derived
                new = collections.OrderedDict()
                for k, v in c.items():
                    if k == "min_profile":
                        continue
                    new[k] = v
                    if k == "fault_locus":
                        new["min_profile"] = derived
                c.clear()
                c.update(new)
                total += 1
        # WRITE ONLY IF THE DERIVATION TOUCHED THIS FILE. Rewriting a file whose content is
        # semantically identical REFORMATS it - measured 2026-09-03: adding
        # codec-flat.json to FILES produced 91 insertions of pure churn, because
        # json.dumps re-indents compact literals a human wrote by hand - and comparing
        # the SERIALIZED text does not fix it, because a file that derives nothing still
        # renders differently from how a person typed it. A tool that
        # touches files it had no reason to touch is the import side effect with a
        # smaller blast radius: it buries a real diff in noise, and it makes every
        # run of an authoring tool look like an edit.
        if touched:
            io.open(path, "w", encoding="utf-8").write(
                json.dumps(d, indent=2, ensure_ascii=False) + "\n")
            print("  wrote %s" % path.split("/")[-1])
    print("re-derived %d cases across %d files; invariant holds for all" % (total, len(FILES)))
    for n, was, now in changed:
        print(f"  CHANGED  {n}\n           {was} -> {now}")
    if not changed:
        print("  (no row moved)")


if __name__ == "__main__":
    run()
