"""
migrate_18_to_20.py

One-time, idempotent migration of requirements.json from the 18-field unified
schema to the 20-field schema, adding:

  1. "Authority Level"  -- splits the authority axis out of "Requirement Level"
  2. "Approval Basis"   -- splits the rationale clause out of "Approval Required"

Why this is safe
----------------
"Record ID" = req_ + sha1(Source Dataset | Citation | Training Topic /
Competency Item | Jurisdiction | Jurisdiction Role | Jurisdiction Setting)[:12].
Neither new field participates in that hash (verified against both
migrate_to_unified.py and normalize_batch.py), so no existing Record ID can
change. This is a purely additive migration: no re-hash, no orphaned admin
edits, no Pending Review Queue false "new record" classifications.

Two-axis rationale
------------------
"Requirement Level" historically conflated two independent dimensions:

    Explicit Training / Competency   -> specificity (how detailed is the mandate)
    State Floor / Federal Floor      -> authority   (whose floor is it)

After the split:

    Requirement Level in {Explicit Training, Other Training Reference}
    Authority Level   in {Federal Floor, State Floor, Competency}

Usage
-----
    python migrate_18_to_20.py            # migrate in place
    python migrate_18_to_20.py --check     # verify only, write nothing

Reads:
    requirements.json

Writes:
    requirements.json                       (20-field records)
    migration_18_to_20_warnings.txt         (every ambiguous split; removed if clean)
"""

import json
import os
import re
import sys
import hashlib

SOURCE_PATH = "requirements.json"
WARNINGS_PATH = "migration_18_to_20_warnings.txt"

EXPECTED_RECORD_COUNT = 286

# Canonical emission order for the 20 schema fields. "Record ID" and
# "Source Dataset" are bookkeeping and are emitted ahead of these.
UNIFIED_FIELDS_20 = [
    "Jurisdiction",
    "Jurisdiction Setting",
    "Jurisdiction Role",
    "HSTM Setting",
    "HSTM Role",
    "Regulation Type",
    "Oversight / Professional Agency",
    "Requirement Level",
    "Authority Level",
    "Explicit Training",
    "Citation",
    "Training Topic / Competency Item",
    "Relationship",
    "Purpose",
    "Approval Required",
    "Approval Basis",
    "Hours Required",
    "Frequency",
    "Source URL",
    "Notes / Research Flags",
]

REQUIREMENT_LEVEL_VALUES = {"Explicit Training", "Other Training Reference"}
AUTHORITY_LEVEL_VALUES = {"Federal Floor", "State Floor", "Competency"}
APPROVAL_REQUIRED_VALUES = {"Yes", "No"}

# Legacy Requirement Level values that carry an authority dimension.
LEGACY_AUTHORITY = {"State Floor", "Federal Floor", "Competency"}

# Live data contains ASCII hyphen, en-dash and em-dash separators.
APPROVAL_SPLIT_RE = re.compile(r"^(Yes|No)\s*[-–—:;]\s*(.+)$", re.DOTALL)


# ---------------------------------------------------------------------------
# Record ID -- reproduced verbatim from migrate_to_unified.py / normalize_batch.py
# so this script can prove IDs are unchanged without importing either module.
# ---------------------------------------------------------------------------

def make_record_id(source_dataset, record):
    basis = "|".join([
        source_dataset,
        str(record.get("Citation", "")),
        str(record.get("Training Topic / Competency Item", "")),
        str(record.get("Jurisdiction", "")),
        str(record.get("Jurisdiction Role", "")),
        str(record.get("Jurisdiction Setting", "")),
    ])
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]
    return "req_" + digest


def is_blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def as_text(value):
    return value.strip() if isinstance(value, str) else value


# ---------------------------------------------------------------------------
# Requirement Level -> (Requirement Level, Authority Level)
# ---------------------------------------------------------------------------

def derive_specificity(record):
    """The existing Explicit Training boolean already encodes the specificity
    axis, so reading it back out is a lossless reinterpretation rather than a
    guess. Returns (value, was_ambiguous)."""
    explicit = as_text(record.get("Explicit Training"))
    if isinstance(explicit, bool):
        return ("Explicit Training" if explicit else "Other Training Reference"), False
    if isinstance(explicit, str):
        if explicit.lower() in ("yes", "true"):
            return "Explicit Training", False
        if explicit.lower() in ("no", "false"):
            return "Other Training Reference", False
    # Explicit Training unpopulated: cannot read the specificity axis.
    return "Other Training Reference", True


def split_requirement_level(record, warnings, record_id):
    current = as_text(record.get("Requirement Level"))
    jurisdiction = as_text(record.get("Jurisdiction")) or ""

    # Already migrated: an "Authority Level" key is the migration marker.
    # Note "Explicit Training" is BOTH a legacy Requirement Level value and a
    # new-vocab one, so the marker key -- not the value -- decides which branch
    # applies. Without that, every legacy 'Explicit Training' record would be
    # misread as already migrated.
    if "Authority Level" in record and current in REQUIREMENT_LEVEL_VALUES:
        existing_authority = as_text(record.get("Authority Level"))
        if existing_authority in AUTHORITY_LEVEL_VALUES:
            return current, existing_authority
        # New-vocab Requirement Level but no valid Authority Level. Only
        # reachable on a partially migrated file; derive authority and say so.
        if current == "Explicit Training":
            authority = "Federal Floor" if jurisdiction == "US" else "State Floor"
        else:
            authority = "Competency"
        warnings.append(
            record_id + ": Authority Level key present but value missing/invalid ("
            + repr(record.get("Authority Level")) + "); derived '" + authority + "'"
        )
        return current, authority

    if current in ("State Floor", "Federal Floor"):
        specificity, ambiguous = derive_specificity(record)
        if ambiguous:
            warnings.append(
                record_id + ": Requirement Level '" + current
                + "' but Explicit Training is unpopulated ("
                + repr(record.get("Explicit Training"))
                + "); defaulted Requirement Level to 'Other Training Reference'"
            )
        return specificity, current

    if current == "Competency":
        return "Other Training Reference", "Competency"

    if current == "Explicit Training":
        # Legacy specificity-only value: authority must be inferred from
        # jurisdiction. US is the federal marker in the live dataset.
        authority = "Federal Floor" if jurisdiction == "US" else "State Floor"
        return "Explicit Training", authority

    if is_blank(current):
        warnings.append(
            record_id + ": Requirement Level is empty; defaulted to "
            "'Other Training Reference' / 'Competency'"
        )
        return "Other Training Reference", "Competency"

    warnings.append(
        record_id + ": unrecognized Requirement Level " + repr(record.get("Requirement Level"))
        + "; defaulted to 'Other Training Reference' / 'Competency'"
    )
    return "Other Training Reference", "Competency"


# ---------------------------------------------------------------------------
# Approval Required -> (Approval Required, Approval Basis)
# ---------------------------------------------------------------------------

def split_approval(record, warnings, record_id):
    raw = record.get("Approval Required")
    existing_basis = record.get("Approval Basis")

    # Already migrated: bare Yes/No with an Approval Basis key present.
    if as_text(raw) in APPROVAL_REQUIRED_VALUES and "Approval Basis" in record:
        return as_text(raw), existing_basis if existing_basis is not None else ""

    if is_blank(raw):
        warnings.append(
            record_id + ": Approval Required is empty (" + repr(raw)
            + "); left as-is, Approval Basis set to empty string"
        )
        return raw, ""

    text = as_text(raw)
    if not isinstance(text, str):
        warnings.append(
            record_id + ": Approval Required is non-string " + repr(raw)
            + "; left as-is, Approval Basis flagged"
        )
        return raw, "[MIGRATION] unparsed: " + str(raw)

    if text in APPROVAL_REQUIRED_VALUES:
        return text, ""

    match = APPROVAL_SPLIT_RE.match(text)
    if match:
        return match.group(1), match.group(2).strip()

    warnings.append(
        record_id + ": Approval Required " + repr(text)
        + " matches neither bare Yes/No nor '<Yes|No> - <rationale>'; "
        "left as-is and flagged in Approval Basis"
    )
    return raw, "[MIGRATION] unparsed: " + text


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

def migrate_record(record, warnings):
    record_id = record.get("Record ID")
    source_dataset = record.get("Source Dataset")

    requirement_level, authority_level = split_requirement_level(
        record, warnings, record_id
    )
    approval_required, approval_basis = split_approval(record, warnings, record_id)

    out = {"Record ID": record_id, "Source Dataset": source_dataset}
    for field in UNIFIED_FIELDS_20:
        if field == "Requirement Level":
            out[field] = requirement_level
        elif field == "Authority Level":
            out[field] = authority_level
        elif field == "Explicit Training":
            # Derived, never independently set. This is the single point where
            # the two fields are forced into agreement.
            out[field] = "Yes" if requirement_level == "Explicit Training" else "No"
        elif field == "Approval Required":
            out[field] = approval_required
        elif field == "Approval Basis":
            out[field] = approval_basis
        else:
            out[field] = record.get(field)

    # Carry forward any unexpected extra keys rather than dropping data.
    for key, value in record.items():
        if key not in out:
            out[key] = value
            warnings.append(
                str(record_id) + ": carried forward unexpected extra field " + repr(key)
            )
    return out


def verify(before, after, warnings):
    ok = True

    def check(label, condition, detail=""):
        nonlocal ok
        status = "PASS" if condition else "FAIL"
        if not condition:
            ok = False
        print("  [" + status + "] " + label + ((" -- " + detail) if detail else ""))

    print("\nVerification")
    print("-" * 68)

    check(
        "record count preserved: " + str(len(before)) + " -> " + str(len(after)),
        len(before) == len(after),
    )
    check(
        "record count == expected " + str(EXPECTED_RECORD_COUNT),
        len(after) == EXPECTED_RECORD_COUNT,
        "got " + str(len(after)),
    )

    ids_before = set(r.get("Record ID") for r in before)
    ids_after = set(r.get("Record ID") for r in after)
    missing = ids_before - ids_after
    added = ids_after - ids_before
    check(
        "Record ID set identical before/after",
        not missing and not added,
        "missing=" + str(sorted(missing)[:5]) + " added=" + str(sorted(added)[:5]),
    )

    # Independently recompute every Record ID from the migrated record to prove
    # the hash inputs were untouched by the migration.
    recomputed_mismatch = [
        r["Record ID"] for r in after
        if make_record_id(r.get("Source Dataset") or "", r) != r["Record ID"]
    ]
    check(
        "every Record ID still reproduces from its own hash inputs",
        not recomputed_mismatch,
        str(len(recomputed_mismatch)) + " mismatch(es): " + str(recomputed_mismatch[:5]),
    )

    bad_vocab_rl = [r["Record ID"] for r in after
                    if r["Requirement Level"] not in REQUIREMENT_LEVEL_VALUES]
    check("Requirement Level within canonical vocabulary", not bad_vocab_rl,
          str(len(bad_vocab_rl)) + " offender(s): " + str(bad_vocab_rl[:5]))

    bad_vocab_al = [r["Record ID"] for r in after
                    if r["Authority Level"] not in AUTHORITY_LEVEL_VALUES]
    check("Authority Level within canonical vocabulary", not bad_vocab_al,
          str(len(bad_vocab_al)) + " offender(s): " + str(bad_vocab_al[:5]))

    # WARN, not FAIL. The spec requires unparseable Approval Required values be
    # left verbatim rather than guessed at, so a residual non-Yes/No value is an
    # expected outcome of a faithful migration -- it is a data-quality item for
    # the operator, not a migration defect. It IS a blocker for the write-path
    # validators in step 3, so it must be resolved by hand before those land.
    bad_vocab_ar = [r["Record ID"] for r in after
                    if r["Approval Required"] not in APPROVAL_REQUIRED_VALUES]
    if bad_vocab_ar:
        print("  [WARN] Approval Required not bare Yes/No on "
              + str(len(bad_vocab_ar)) + " record(s): " + str(bad_vocab_ar[:5])
              + " -- needs a manual decision, see warnings file")
    else:
        check("Approval Required is bare Yes/No", True)

    desync = [
        r["Record ID"] for r in after
        if (r["Explicit Training"] == "Yes")
        != (r["Requirement Level"] == "Explicit Training")
    ]
    check("Explicit Training == (Requirement Level == 'Explicit Training')",
          not desync, str(len(desync)) + " desynced: " + str(desync[:5]))

    anchor_violations = [
        r["Record ID"] for r in after
        if is_blank(r.get("Jurisdiction Setting")) and is_blank(r.get("Jurisdiction Role"))
    ]
    check("anchor rule holds (Jurisdiction Setting or Jurisdiction Role populated)",
          not anchor_violations,
          str(len(anchor_violations)) + " violation(s): " + str(anchor_violations[:5]))

    field_shape = [r["Record ID"] for r in after if len(r) != len(UNIFIED_FIELDS_20) + 2]
    check("every record has exactly 22 keys (20 schema + Record ID + Source Dataset)",
          not field_shape, str(len(field_shape)) + " offender(s)")

    # Non-hash fields outside the two being split must be byte-identical.
    untouched = [f for f in UNIFIED_FIELDS_20
                 if f not in ("Requirement Level", "Authority Level",
                              "Explicit Training", "Approval Required",
                              "Approval Basis")]
    by_id_before = {r["Record ID"]: r for r in before}
    drifted = []
    for rec in after:
        prev = by_id_before.get(rec["Record ID"])
        if not prev:
            continue
        for f in untouched:
            if prev.get(f) != rec.get(f):
                drifted.append((rec["Record ID"], f))
    check("all other 15 fields unchanged", not drifted,
          str(len(drifted)) + " drift(s): " + str(drifted[:5]))

    return ok


def distribution(records):
    print("\nDistributions after migration")
    print("-" * 68)
    for field in ("Requirement Level", "Authority Level", "Approval Required"):
        counts = {}
        for r in records:
            counts[r.get(field)] = counts.get(r.get(field), 0) + 1
        print("  " + field + ":")
        for value, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print("      " + str(n).rjust(4) + "  " + repr(value))

    print("  Requirement Level x Authority Level:")
    cross = {}
    for r in records:
        key = (r.get("Requirement Level"), r.get("Authority Level"))
        cross[key] = cross.get(key, 0) + 1
    for (rl, al), n in sorted(cross.items(), key=lambda kv: -kv[1]):
        print("      " + str(n).rjust(4) + "  " + rl + "  /  " + al)

    populated = sum(1 for r in records if not is_blank(r.get("Approval Basis")))
    print("  Approval Basis populated: " + str(populated) + " of " + str(len(records)))
    flagged = [r["Record ID"] for r in records
               if isinstance(r.get("Approval Basis"), str)
               and r["Approval Basis"].startswith("[MIGRATION]")]
    print("  Approval Basis flagged [MIGRATION]: " + str(len(flagged))
          + (" -> " + str(flagged) if flagged else ""))


def main():
    check_only = "--check" in sys.argv

    with open(SOURCE_PATH, "r", encoding="utf-8") as f:
        before = json.load(f)

    print("Read " + str(len(before)) + " records from " + SOURCE_PATH)
    already = sum(1 for r in before if "Authority Level" in r)
    if already:
        print("Note: " + str(already) + " record(s) already carry 'Authority Level' "
              "-- re-run detected, migration is idempotent.")

    warnings = []
    after = [migrate_record(r, warnings) for r in before]

    ok = verify(before, after, warnings)
    distribution(after)

    print("\nWarnings")
    print("-" * 68)
    if warnings:
        print("  " + str(len(warnings)) + " ambiguous split(s) -- see " + WARNINGS_PATH)
        for w in warnings[:20]:
            print("      " + w)
        if len(warnings) > 20:
            print("      ... " + str(len(warnings) - 20) + " more")
    else:
        print("  none -- every split was unambiguous")

    if check_only:
        print("\n--check: no files written.")
        return 0 if ok else 1

    if not ok:
        print("\nVerification FAILED. requirements.json NOT written.")
        return 1

    with open(SOURCE_PATH, "w", encoding="utf-8") as f:
        json.dump(after, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("\nWrote " + str(len(after)) + " 20-field records to " + SOURCE_PATH)

    if warnings:
        with open(WARNINGS_PATH, "w", encoding="utf-8") as f:
            f.write("migrate_18_to_20.py -- ambiguous splits requiring human review\n")
            f.write("=" * 68 + "\n\n")
            f.write("\n".join(warnings) + "\n")
        print("Wrote " + str(len(warnings)) + " warning(s) to " + WARNINGS_PATH)
    elif os.path.exists(WARNINGS_PATH):
        # Clear a stale file so a clean re-run can't be mistaken for one with
        # unresolved warnings. Prefer deleting it, but some filesystems (e.g. a
        # OneDrive-synced checkout) disallow unlink while permitting writes, so
        # fall back to overwriting with an explicit all-clear rather than
        # leaving misleading stale warnings on disk.
        try:
            os.remove(WARNINGS_PATH)
            print("Removed stale " + WARNINGS_PATH + " (this run was clean)")
        except OSError as exc:
            with open(WARNINGS_PATH, "w", encoding="utf-8") as f:
                f.write("migrate_18_to_20.py -- no warnings.\n")
                f.write("Every split was unambiguous on the most recent run.\n")
            print("Could not unlink " + WARNINGS_PATH + " (" + str(exc)
                  + "); overwrote it with an all-clear instead.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
