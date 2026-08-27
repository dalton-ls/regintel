"""
migrate_to_unified.py

**One-time / full regeneration only.** Converts the legacy per-type datasets
(role.json, caresetting.json) into a single unified Requirements projection,
per the schema in DESIGN.md. Do not use this for ongoing batches — it
fully regenerates requirements.json and bypasses Pending Review's conflict
detection. For sporadic incoming sheets, use normalize_batch.py and Pending
Review instead.

Background
----------
Care Setting and Role requirements share the same metadata shape (see
DESIGN.md), so they are combined into one unified record type here. Each
unified record keeps track of which source file it came from via
"Source Dataset". That field is a Record ID identity input only.
Research-view tabs route on Regulation Type (Individual/Continuing
Education → Obligations by Role; Facility-Based/Organizational Training
and Organizational Policy → Obligations by Care Setting).

Workforce Readiness (wr.json) is intentionally NOT included. WR stays a
separate dataset per the locked design.

Usage
-----
    python migrate_to_unified.py

Reads:
    role.json
    caresetting.json

Writes:
    requirements.json        (unified array of requirement records)
    migration_warnings.txt   (validation warnings, if any)

Record IDs
----------
Each record gets a stable "Record ID" derived from a hash of
(source dataset, Citation, Training Topic / Competency Item, Jurisdiction,
Jurisdiction Role, Jurisdiction Setting) -- deliberately NOT the sheet key
(the Excel tab a record happened to arrive on), since that's not a stable
real-world identifier: the same regulation re-submitted under a
differently-named tab must hash to the same ID. This matches
normalize_batch.py's formula exactly, so a batch normalized by that script
and a full re-migration by this one always agree on IDs for the same
content. Re-running either against unchanged data reproduces the same
IDs, so downstream admin edits keyed by Record ID are not invalidated.
"""

import json
import os
import hashlib

UNIFIED_FIELDS = [
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


# Canonical vocabularies for the 20-field schema. "Requirement Level" carries
# the specificity axis only; "Authority Level" carries the authority axis. They
# were conflated in the 18-field schema -- see DESIGN.md §2.
REQUIREMENT_LEVEL_VALUES = {"Explicit Training", "Other Training Reference"}
AUTHORITY_LEVEL_VALUES = {"Federal Floor", "State Floor", "Competency"}
APPROVAL_REQUIRED_VALUES = {"Yes", "No"}

# Legacy "Requirement Level" values that mean the source sheet predates the
# 18 -> 20 split. Note "Explicit Training" is deliberately absent: it is valid
# in both schemas, so it cannot be used as a pre-migration marker.
LEGACY_REQUIREMENT_LEVEL_VALUES = {"State Floor", "Federal Floor", "Competency"}


def is_blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def derive_explicit_training(requirement_level):
    """Explicit Training is a derived view of the specificity axis, never an
    independently set field. Deriving it in one place is what keeps it from
    disagreeing with Requirement Level."""
    return "Yes" if requirement_level == "Explicit Training" else "No"


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


def normalize_record(source_dataset, record):
    normalized = {"Record ID": make_record_id(source_dataset, record)}
    normalized["Source Dataset"] = source_dataset
    for field in UNIFIED_FIELDS:
        normalized[field] = record.get(field)
    # Explicit Training is derived, never carried through from the source. If a
    # source row set it independently and it disagreed with Requirement Level,
    # this is where that disagreement gets resolved in favour of the axis field.
    normalized["Explicit Training"] = derive_explicit_training(
        normalized.get("Requirement Level")
    )
    return normalized


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate(unified):
    warnings = []
    seen_ids = {}
    for record in unified:
        record_id = record["Record ID"]
        if not record.get("Jurisdiction Setting") and not record.get("Jurisdiction Role"):
            warnings.append(
                record_id + ": missing both Jurisdiction Setting and Jurisdiction Role"
            )
        # --- 20-field schema vocabulary checks ---------------------------
        requirement_level = record.get("Requirement Level")
        if requirement_level in LEGACY_REQUIREMENT_LEVEL_VALUES:
            warnings.append(
                record_id + ": Requirement Level is the pre-migration value "
                + repr(requirement_level) + " -- this source sheet predates the "
                "18 -> 20 split; it belongs in Authority Level instead"
            )
        elif requirement_level not in REQUIREMENT_LEVEL_VALUES:
            warnings.append(
                record_id + ": Requirement Level " + repr(requirement_level)
                + " is not one of " + repr(sorted(REQUIREMENT_LEVEL_VALUES))
            )

        authority_level = record.get("Authority Level")
        if authority_level not in AUTHORITY_LEVEL_VALUES:
            warnings.append(
                record_id + ": Authority Level " + repr(authority_level)
                + " is not one of " + repr(sorted(AUTHORITY_LEVEL_VALUES))
            )

        approval_required = record.get("Approval Required")
        if approval_required not in APPROVAL_REQUIRED_VALUES:
            warnings.append(
                record_id + ": Approval Required " + repr(approval_required)
                + " must be bare 'Yes' or 'No' -- any rationale belongs in "
                "Approval Basis"
            )

        expected_explicit = derive_explicit_training(requirement_level)
        if record.get("Explicit Training") != expected_explicit:
            warnings.append(
                record_id + ": Explicit Training " + repr(record.get("Explicit Training"))
                + " disagrees with Requirement Level " + repr(requirement_level)
                + " (expected " + repr(expected_explicit) + ")"
            )

        if record_id in seen_ids:
            warnings.append(
                record_id + ": duplicate Record ID (collision with an earlier record; "
                "check for identical Citation/Training Topic/Jurisdiction combos)"
            )
        seen_ids[record_id] = True
    return warnings


def migrate():
    unified = []

    role_data = load("role.json")
    for records in role_data.values():
        for record in records:
            unified.append(normalize_record("Role", record))

    cs_data = load("caresetting.json")
    for records in cs_data.values():
        for record in records:
            unified.append(normalize_record("Care Setting", record))

    warnings = validate(unified)

    with open("requirements.json", "w", encoding="utf-8") as f:
        json.dump(unified, f, indent=2, ensure_ascii=False)

    warnings_path = "migration_warnings.txt"
    if warnings:
        with open(warnings_path, "w", encoding="utf-8") as f:
            f.write("\n".join(warnings) + "\n")
    elif os.path.exists(warnings_path):
        # Remove a stale file from a prior run so a clean re-run can't be
        # mistaken for one that still has unresolved warnings.
        os.remove(warnings_path)

    print("Wrote " + str(len(unified)) + " unified requirement records to requirements.json")
    if warnings:
        print(str(len(warnings)) + " validation warning(s) -- see migration_warnings.txt")


if __name__ == "__main__":
    migrate()
