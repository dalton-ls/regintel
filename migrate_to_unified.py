"""
migrate_to_unified.py

Converts the existing per-type datasets (role.json, caresetting.json) into
a single unified Requirements dataset, per the schema locked in DESIGN.md.

Background
----------
Care Setting and Role requirements share the same metadata shape (see
DESIGN.md), so they are combined into one unified record type here. Each
unified record keeps track of which source file it came from via
"Source Dataset", which also doubles as the admin-tool "lane" routing
signal (Role lane vs. Care Setting lane) until "Regulation Type" values
are fully backfilled.

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
(source dataset, sheet key, Citation, Training Topic / Competency Item,
Jurisdiction). Re-running this script against unchanged source data will
reproduce the same IDs, so downstream admin edits keyed by Record ID are
not invalidated by re-migration.
"""

import json
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
    "Explicit Training",
    "Citation",
    "Training Topic / Competency Item",
    "Relationship",
    "Purpose",
    "Approval Required",
    "Hours Required",
    "Frequency",
    "Source URL",
    "Notes / Research Flags",
]


def make_record_id(source_dataset, sheet_key, record):
    basis = "|".join([
        source_dataset,
        sheet_key,
        str(record.get("Citation", "")),
        str(record.get("Training Topic / Competency Item", "")),
        str(record.get("Jurisdiction", "")),
    ])
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]
    return "req_" + digest


def normalize_record(source_dataset, sheet_key, record):
    normalized = {"Record ID": make_record_id(source_dataset, sheet_key, record)}
    normalized["Source Dataset"] = source_dataset
    for field in UNIFIED_FIELDS:
        normalized[field] = record.get(field)
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
    for sheet_key, records in role_data.items():
        for record in records:
            unified.append(normalize_record("Role", sheet_key, record))

    cs_data = load("caresetting.json")
    for sheet_key, records in cs_data.items():
        for record in records:
            unified.append(normalize_record("Care Setting", sheet_key, record))

    warnings = validate(unified)

    with open("requirements.json", "w", encoding="utf-8") as f:
        json.dump(unified, f, indent=2, ensure_ascii=False)

    if warnings:
        with open("migration_warnings.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(warnings) + "\n")

    print("Wrote " + str(len(unified)) + " unified requirement records to requirements.json")
    if warnings:
        print(str(len(warnings)) + " validation warning(s) -- see migration_warnings.txt")


if __name__ == "__main__":
    migrate()
