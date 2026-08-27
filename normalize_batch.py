"""
normalize_batch.py

Converts one **already-extracted** incoming sheet (Excel workbook, one or more
tabs) using the 20-column extraction template — or a 47-column classified
parser batch — into a flat JSON array, ready to upload into the Pending
Review Queue (pending-review.html) -- NOT a drop-in replacement for
requirements.json the way migrate_to_unified.py is.

This script does **not** parse OpenLaws or run AI extraction. It only
normalizes classified output that already matches the extraction column
headers. Additive parser fields (approval family, product routing,
interpretation layers, change/applicability/impact) are copied through
when present; absence still means "no opinion" rather than "clear this."

Why this exists (and why it's not just "run migrate_to_unified.py again")
---------------------------------------------------------------------------
migrate_to_unified.py hardcodes exactly two source files (role.json,
caresetting.json) and fully regenerates requirements.json from scratch on
every run -- it has no notion of "add this new batch on top of what's
already there," and it bypasses Pending Review Queue's conflict detection
entirely. For sporadic incoming batches of thousands of rows across many
sheets, that's the wrong shape: re-running it means manually folding every
new sheet into those two files and hoping the full regeneration doesn't
silently clobber a prior manual correction.

This script instead normalizes ONE sheet/workbook at a time into the same
unified shape Pending Review Queue expects (a flat JSON array of records,
each with a Record ID), so each batch can be reviewed independently --
new Record IDs get added directly, records that already exist and differ
get queued as conflicts, nothing applies without a human decision.

Record ID stability
---------------------------------------------------------------------------
migrate_to_unified.py hashes (source_dataset, SHEET KEY, Citation, Training
Topic, Jurisdiction). The sheet key is just an Excel tab name -- not a
stable real-world identifier -- so the same regulation re-uploaded under a
differently-named sheet would hash to a different Record ID and look like
a brand-new record instead of surfacing as an update in Pending Review
Queue. This script drops the sheet key from the hash and adds Jurisdiction
Role / Jurisdiction Setting for extra collision safety, so the ID is
derived purely from content that identifies the regulation itself:

    req_ + sha1(source_dataset|Citation|Training Topic|Jurisdiction|
                Jurisdiction Role|Jurisdiction Setting)[:12]

Re-running this script against the same rows (from any sheet, any tab
name) reproduces the same IDs. Neither field added in the 20-column schema
("Authority Level", "Approval Basis") participates in the hash, so the
18 -> 20 migration could not and did not change any existing Record ID.

Expected headers (20 extraction columns, read by exact header name)
---------------------------------------------------------------------------
    Jurisdiction, Jurisdiction Setting, Jurisdiction Role, HSTM Setting,
    HSTM Role, Regulation Type, Oversight / Professional Agency,
    Requirement Level, Authority Level, Explicit Training, Citation,
    Training Topic / Competency Item, Relationship, Purpose,
    Approval Required, Approval Basis, Hours Required, Frequency,
    Source URL, Notes / Research Flags

A 47-column parser batch adds Related Regulatory Provisions, the approval
family (Scope / Responsibility / Timing / Instructor), prior-training
credit, provision relationship types, interpretive layers, product routing
(Product Use Case, Policy Action Relevance, Quality Manager Relevance,
Operational Domain), and identity/change fields. None of those extra
columns participates in Record ID. `Change Source path` (parser spelling)
is accepted interchangeably with `Change Source Path`.

Drift warnings raised (never blocking, never silently rewritten)
---------------------------------------------------------------------------
  * Jurisdiction == "Federal" -- the live dataset uses "US"; "Federal" would
    add a duplicate filter option on the research view for every row
  * Requirement Level == State Floor / Federal Floor / Competency -- a
    pre-migration sheet; those values belong in Authority Level now
  * Authority Level missing or outside {Federal Floor, State Floor,
    Competency}
  * Approval Required still carrying a rationale clause instead of bare
    Yes / No / Unknown -- the rationale belongs in Approval Basis
  * Explicit Training disagreeing with Requirement Level (it is derived)
  * Jurisdiction / HSTM Setting / HSTM Role values not seen before

Usage
---------------------------------------------------------------------------
    python3 normalize_batch.py <input.xlsx> --source-dataset Role
    python3 normalize_batch.py <input.xlsx> --source-dataset "Care Setting" -o batch.json
    python3 normalize_batch.py <input.xlsx>          # per row from Regulation Type
                                                      # (Individual/Continuing Education → Role;
                                                      #  Facility-Based / Organizational Policy → Care Setting).
                                                      # Sheet prefix R / CS is fallback only.

    python3 normalize_batch.py <input.json>          # JSON array input instead of Excel

Reads (optional):
    requirements.json in the current directory, or --reference <path> --
    used only to warn (never block or silently rewrite) when an incoming
    Jurisdiction / HSTM Setting / HSTM Role value hasn't been seen before,
    since that's the earliest, cheapest point to catch vocabulary drift
    (e.g. "Federal" vs "US") before it reaches the live site's filters.

Writes:
    <input>-normalized.json     (flat array, ready for Pending Review Queue)
    <input>-normalize-warnings.txt   (only if any warnings were raised)
"""

import sys
import re
import json
import hashlib
import argparse
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    pd = None

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

# Schema v3 / parser-skill extension. These values are optional enrichment:
# an absent or blank cell means "no opinion" and is deliberately omitted
# from the JSON so Pending Review cannot accidentally clear an existing tag.
OPTIONAL_ENRICHMENT_FIELDS = [
    "Related Regulatory Provisions",
    "Approval Scope", "Approval Responsibility", "Approval Timing",
    "Instructor/SME Qualification Required",
    "Obligation ID",
    "Change Type", "Change Detected Date", "Change Source Path",
    "Applicability Rules", "Impact Types",
    "Impact Basis", "Impact Confidence", "Impact Review",
    "Provision Relationship Types",
    "Interpretive Conditions",
    "Prior Training Credit / Exemption", "Prior Training Qualification",
    "Interpretive Review Status",
    "Regulatory Lifecycle Stage",
    "Product Use Case",
    "Regulated Competency",
    "Regulatory Change Summary",
    "Interpretive Summary",
    "Policy Action Relevance",
    "Quality Manager Relevance",
    "Operational Domain",
    "Human Interpretation / SME Review",
    "Source Change Context",
]

ARRAY_FIELDS = {
    "HSTM Role", "Impact Types",
    "Provision Relationship Types", "Related Regulatory Provisions",
}
BOOLEAN_FIELDS = {"Impact Review"}
JSON_FIELDS = {"Applicability Rules"}
INTEGER_FIELDS = set()
PIPE_NULL = {"nan", "NaN", "None", "none", ""}

# Parser workbook spelling vs the earlier live-dataset spelling.
HEADER_ALIASES = {
    "Change Source Path": ("Change Source path", "Change Source Path"),
}

# --- 20-field schema vocabularies -------------------------------------------
# Requirement Level carries the specificity axis; Authority Level carries the
# authority axis. See DESIGN.md §2 for why they were split.
REQUIREMENT_LEVEL_VALUES = {"Explicit Training", "Other Training Reference"}
AUTHORITY_LEVEL_VALUES = {"Federal Floor", "State Floor", "Competency"}
APPROVAL_REQUIRED_VALUES = {"Yes", "No", "Unknown"}
IMPACT_CONFIDENCE_VALUES = {"High", "Medium", "Low"}

# A Requirement Level of State Floor / Federal Floor / Competency means the
# sheet predates the 18 -> 20 split. "Explicit Training" is deliberately NOT in
# this set: it is valid in both schemas and so cannot mark a pre-migration sheet.
LEGACY_REQUIREMENT_LEVEL_VALUES = {"State Floor", "Federal Floor", "Competency"}

# The live dataset uses "US" as the federal marker. A batch arriving with
# "Federal" would create a second, duplicate filter option on the research view
# for every row it contains.
FEDERAL_JURISDICTION_ALIASES = {"Federal", "federal", "FEDERAL", "US Federal", "Fed"}

# Matches a verbose Approval Required, i.e. one that still has its rationale
# clause attached instead of it living in Approval Basis. Both ASCII hyphen and
# en/em-dash separators appear in real sheets.
VERBOSE_APPROVAL_RE = re.compile(r"^(Yes|No)\s*[-–—:;]\s*(.+)$", re.DOTALL)


def derive_explicit_training(requirement_level):
    """Explicit Training is a derived view of Requirement Level, never an
    independently supplied column."""
    return "Yes" if requirement_level == "Explicit Training" else "No"


ROLE_REGULATION_TYPE = "Individual/Continuing Education"
CARE_REGULATION_TYPES = {
    "Facility-Based/Organizational Training",
    "Organizational Policy",
}
INSTRUCTION_SHEET_NAMES = {"Review Instructions"}


def source_dataset_from_sheet_name(name):
    if name.startswith("R "):
        return "Role"
    if name.startswith("CS "):
        return "Care Setting"
    return None


def source_dataset_from_regulation_type(raw_row):
    rt = str((raw_row or {}).get("Regulation Type") or "").strip()
    if rt == ROLE_REGULATION_TYPE:
        return "Role"
    if rt in CARE_REGULATION_TYPES:
        return "Care Setting"
    return None


def resolve_source_dataset(raw_row, cli_source_dataset, sheet_name):
    if cli_source_dataset:
        return cli_source_dataset
    inferred = source_dataset_from_regulation_type(raw_row)
    if inferred:
        return inferred
    return source_dataset_from_sheet_name(sheet_name or "")


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


def strip_stray_asterisk(val):
    """Catches footnote-marker asterisks that leaked from a header
    ("HSTM Role*") into the cell value beneath it, e.g. "Managerial Staff*"."""
    if isinstance(val, str):
        stripped = val.strip()
        if stripped.endswith("*") and not stripped.endswith("**"):
            return stripped[:-1].strip()
        return stripped
    return val


def to_array(raw):
    if raw is None:
        return None
    if isinstance(raw, list):
        parts = [strip_stray_asterisk(str(p).strip()) for p in raw if str(p).strip() and str(p).strip() not in PIPE_NULL]
        return parts if parts else None
    s = str(raw).strip()
    if s in PIPE_NULL:
        return None
    parts = [strip_stray_asterisk(p.strip()) for p in s.split("|") if p.strip() and p.strip() not in PIPE_NULL]
    return parts if parts else None


def clean_scalar(val, field):
    if val is None:
        return None
    if pd is not None and pd.isna(val):
        return None
    s = str(val).strip() if not isinstance(val, str) else val.strip()
    if s in PIPE_NULL:
        return None
    if field in INTEGER_FIELDS:
        try:
            return int(float(s))
        except (ValueError, TypeError):
            return None
    return strip_stray_asterisk(s)


def to_bool(val):
    """Parse an optional boolean enrichment cell. Absent/blank returns None."""
    if val is None:
        return None
    if pd is not None and pd.isna(val):
        return None
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in PIPE_NULL:
        return None
    if s in {"true", "yes", "1"}:
        return True
    if s in {"false", "no", "0"}:
        return False
    return val


def clean_json_array(val, field):
    """Parse a JSON array from an optional enrichment cell.

    Empty cells intentionally return None and are not emitted; this preserves
    Pending Review's absent-vs-empty safety contract.
    """
    text = clean_scalar(val, field)
    if text is None:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    return parsed if isinstance(parsed, list) else text


def raw_for_field(raw_row, field):
    aliases = HEADER_ALIASES.get(field, (field,))
    for key in aliases:
        if key in raw_row and raw_row.get(key) is not None:
            return raw_row.get(key)
    return raw_row.get(field)


def normalize_row(raw_row, source_dataset):
    record = {"Source Dataset": source_dataset}
    for field in UNIFIED_FIELDS:
        raw_val = raw_for_field(raw_row, field)
        if field in ARRAY_FIELDS:
            record[field] = to_array(raw_val)
        else:
            record[field] = clean_scalar(raw_val, field)
    for field in OPTIONAL_ENRICHMENT_FIELDS:
        raw_val = raw_for_field(raw_row, field)
        if field in JSON_FIELDS:
            value = clean_json_array(raw_val, field)
        elif field in ARRAY_FIELDS:
            value = to_array(raw_val)
        elif field in BOOLEAN_FIELDS:
            value = to_bool(raw_val)
        else:
            value = clean_scalar(raw_val, field)
        if value is not None:
            record[field] = value
    record["Record ID"] = make_record_id(source_dataset, record)
    return record


def load_reference_values(reference_path):
    """Distinct known-good values per field, from an existing requirements.json,
    used only to warn on drift -- never to block or silently rewrite."""
    if not reference_path or not Path(reference_path).exists():
        return {}
    try:
        existing = json.loads(Path(reference_path).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    known = {"Jurisdiction": set(), "HSTM Setting": set(), "HSTM Role": set(),
             "Authority Level": set()}
    for r in existing:
        if r.get("Jurisdiction"):
            known["Jurisdiction"].add(r["Jurisdiction"])
        if r.get("HSTM Setting"):
            known["HSTM Setting"].add(r["HSTM Setting"])
        if r.get("Authority Level"):
            known["Authority Level"].add(r["Authority Level"])
        hstm_role = r.get("HSTM Role")
        if isinstance(hstm_role, list):
            known["HSTM Role"].update(hstm_role)
        elif hstm_role:
            known["HSTM Role"].add(hstm_role)
    return known


def validate(records, known_values):
    warnings = []
    seen_ids = {}
    for record in records:
        record_id = record["Record ID"]
        if not record.get("Jurisdiction Setting") and not record.get("Jurisdiction Role"):
            warnings.append(
                record_id + ": missing both Jurisdiction Setting and Jurisdiction Role"
            )
        if record_id in seen_ids:
            warnings.append(
                record_id + ": duplicate Record ID within this batch (check for identical "
                "Citation/Training Topic/Jurisdiction/Role/Setting combos)"
            )
        seen_ids[record_id] = True

        # --- HARD WARNING: Jurisdiction must be "US", never "Federal" --------
        # The live dataset uses "US". A batch using "Federal" does not fail any
        # schema rule, so nothing downstream would stop it -- it would just
        # quietly add a duplicate Jurisdiction filter option on the research
        # view for every row in the batch. Cheapest place to catch it is here.
        jurisdiction = record.get("Jurisdiction")
        if jurisdiction in FEDERAL_JURISDICTION_ALIASES:
            warnings.append(
                record_id + ": *** Jurisdiction is " + repr(jurisdiction)
                + " -- the live dataset uses 'US' for federal. Uploading this "
                "batch as-is would create a duplicate Jurisdiction filter "
                "option on the research view for every row. Fix the sheet "
                "before uploading."
            )

        # --- Requirement Level -----------------------------------------------
        requirement_level = record.get("Requirement Level")
        if requirement_level in LEGACY_REQUIREMENT_LEVEL_VALUES:
            warnings.append(
                record_id + ": Requirement Level is " + repr(requirement_level)
                + " -- that is a pre-migration (18-field) value and belongs in "
                "Authority Level now. This sheet was produced before the 18 -> 20 "
                "split; re-export it from the current parser before uploading."
            )
        elif requirement_level not in REQUIREMENT_LEVEL_VALUES:
            warnings.append(
                record_id + ": Requirement Level " + repr(requirement_level)
                + " is not one of " + ", ".join(sorted(REQUIREMENT_LEVEL_VALUES))
            )

        # --- Authority Level --------------------------------------------------
        authority_level = record.get("Authority Level")
        if authority_level is None or authority_level == "":
            warnings.append(
                record_id + ": Authority Level is empty -- required in the "
                "20-field schema (one of " + ", ".join(sorted(AUTHORITY_LEVEL_VALUES)) + ")"
            )
        elif authority_level not in AUTHORITY_LEVEL_VALUES:
            warnings.append(
                record_id + ": Authority Level " + repr(authority_level)
                + " is not one of " + ", ".join(sorted(AUTHORITY_LEVEL_VALUES))
                + " -- possible vocabulary drift"
            )
        elif (known_values.get("Authority Level")
              and authority_level not in known_values["Authority Level"]):
            warnings.append(
                record_id + ": Authority Level " + repr(authority_level)
                + " not seen in the reference dataset (known values: "
                + ", ".join(sorted(known_values["Authority Level"]))
                + ") -- possible vocabulary drift"
            )

        # --- Approval Required / Approval Basis -------------------------------
        approval_required = record.get("Approval Required")
        approval_text = approval_required if isinstance(approval_required, str) else ""
        verbose = VERBOSE_APPROVAL_RE.match(approval_text.strip())
        if verbose:
            warnings.append(
                record_id + ": Approval Required " + repr(approval_required)
                + " still carries its rationale clause. In the 20-field schema "
                "Approval Required is bare " + "/".join(sorted(APPROVAL_REQUIRED_VALUES))
                + " and the rationale (" + repr(verbose.group(2).strip())
                + ") belongs in Approval Basis."
            )
        elif approval_required not in APPROVAL_REQUIRED_VALUES:
            warnings.append(
                record_id + ": Approval Required " + repr(approval_required)
                + " must be bare 'Yes', 'No', or 'Unknown'"
            )

        # --- Explicit Training must agree with Requirement Level --------------
        expected_explicit = derive_explicit_training(requirement_level)
        if record.get("Explicit Training") != expected_explicit:
            warnings.append(
                record_id + ": Explicit Training " + repr(record.get("Explicit Training"))
                + " disagrees with Requirement Level " + repr(requirement_level)
                + " (expected " + repr(expected_explicit) + ") -- it is a derived "
                "field and should not be supplied independently"
            )

        confidence = record.get("Impact Confidence")
        if confidence is not None and confidence not in IMPACT_CONFIDENCE_VALUES:
            warnings.append(
                record_id + ": Impact Confidence " + repr(confidence)
                + " is not one of " + ", ".join(sorted(IMPACT_CONFIDENCE_VALUES))
            )
        review = record.get("Impact Review")
        if review is not None and not isinstance(review, bool):
            warnings.append(
                record_id + ": Impact Review " + repr(review)
                + " should be true/false (or Yes/No on the sheet)"
            )
        impact_types = record.get("Impact Types")
        if isinstance(impact_types, list) and impact_types and not record.get("Impact Basis"):
            warnings.append(
                record_id + ": Impact Types is tagged but Impact Basis is empty — "
                "parser judgments should carry a short evidence rationale"
            )

        if known_values.get("Jurisdiction") and record.get("Jurisdiction") not in known_values["Jurisdiction"]:
            warnings.append(
                record_id + ": Jurisdiction " + repr(record.get("Jurisdiction")) +
                " not seen in the reference dataset (known values: " +
                ", ".join(sorted(known_values["Jurisdiction"])) + ") -- possible vocabulary drift"
            )
        if known_values.get("HSTM Setting") and record.get("HSTM Setting") and record["HSTM Setting"] not in known_values["HSTM Setting"]:
            warnings.append(
                record_id + ": HSTM Setting " + repr(record["HSTM Setting"]) +
                " not seen in the reference dataset -- confirm against the Definitions Sheet"
            )
        hstm_role = record.get("HSTM Role") or []
        for v in hstm_role:
            if known_values.get("HSTM Role") and v not in known_values["HSTM Role"]:
                warnings.append(
                    record_id + ": HSTM Role " + repr(v) +
                    " not seen in the reference dataset -- confirm against the Definitions Sheet"
                )
    return warnings


def load_excel(input_path, cli_source_dataset):
    workbook = pd.read_excel(input_path, sheet_name=None, dtype=str)
    records = []
    for sheet_name, df in workbook.items():
        if sheet_name in INSTRUCTION_SHEET_NAMES:
            continue
        if df.empty:
            continue
        df = df.where(pd.notnull(df), None)
        sheet_records = []
        lane_counts = {}
        for _, row in df.iterrows():
            raw_row = row.to_dict()
            source_dataset = resolve_source_dataset(raw_row, cli_source_dataset, sheet_name)
            if not source_dataset:
                print(
                    f"ERROR: sheet '{sheet_name}' has a row with no Regulation Type "
                    f"of Individual/Continuing Education, Facility-Based/Organizational "
                    f"Training, or Organizational Policy, and the tab is not 'R '/'CS '. "
                    f"Pass --source-dataset Role|\"Care Setting\", or classify the row."
                )
                sys.exit(1)
            sheet_records.append(normalize_row(raw_row, source_dataset))
            lane_counts[source_dataset] = lane_counts.get(source_dataset, 0) + 1
        records.extend(sheet_records)
        lanes = ", ".join(f"{lane}={count}" for lane, count in sorted(lane_counts.items()))
        print(f"  OK  {sheet_name}: {len(sheet_records)} rows -> {lanes}")
    return records


def load_json_array(input_path, cli_source_dataset):
    raw = json.loads(Path(input_path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        print("ERROR: JSON input must be a flat array of row objects.")
        sys.exit(1)
    records = []
    for row in raw:
        source_dataset = resolve_source_dataset(row, cli_source_dataset, None)
        if not source_dataset:
            print(
                "ERROR: JSON row is missing Regulation Type, and --source-dataset "
                "was not given. Classify the row or pass --source-dataset Role|"
                "\"Care Setting\"."
            )
            sys.exit(1)
        records.append(normalize_row(row, source_dataset))
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Excel workbook (.xlsx) or JSON array (.json) using the 20-column extraction template or the 47-column parser batch")
    parser.add_argument("--source-dataset", choices=["Role", "Care Setting"], default=None,
                         help="Force the Source Dataset identity field. If omitted, inferred per row from Regulation Type (Individual/Continuing Education → Role; Facility-Based/Organizational Policy → Care Setting). Sheet prefix R / CS is fallback only.")
    parser.add_argument("--reference", default="requirements.json",
                         help="Existing requirements.json to check incoming Jurisdiction/HSTM values against (default: requirements.json in the current directory; pass '' to skip)")
    parser.add_argument("-o", "--output", default=None, help="Output path (default: <input>-normalized.json)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: file not found -- {input_path}")
        sys.exit(1)

    output_path = Path(args.output) if args.output else input_path.with_name(input_path.stem + "-normalized.json")
    warnings_path = input_path.with_name(input_path.stem + "-normalize-warnings.txt")

    print(f"\nReading:  {input_path}")

    if input_path.suffix.lower() in (".xlsx", ".xls"):
        if pd is None:
            print("ERROR: pandas is required to read Excel input (pip install pandas openpyxl).")
            sys.exit(1)
        records = load_excel(input_path, args.source_dataset)
    elif input_path.suffix.lower() == ".json":
        records = load_json_array(input_path, args.source_dataset)
    else:
        print("ERROR: input must be .xlsx, .xls, or .json")
        sys.exit(1)

    known_values = load_reference_values(args.reference) if args.reference else {}
    warnings = validate(records, known_values)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False, default=str)

    if warnings:
        with open(warnings_path, "w", encoding="utf-8") as f:
            f.write("\n".join(warnings) + "\n")

    print(f"\nWritten:  {output_path}")
    print(f"Summary:  {len(records)} record(s)")
    if warnings:
        print(f"{len(warnings)} warning(s) -- see {warnings_path}")
        print("(warnings never block output -- review them, they don't stop this batch from being usable)")
    print(f"\nNext step: upload {output_path} into pending-review.html to classify against the live dataset.\n")


if __name__ == "__main__":
    main()
