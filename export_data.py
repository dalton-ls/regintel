"""
export_data.py
--------------
Converts RegIntel_PoC.xlsx → data.json for the RegIntel web tool.

Usage:
    python export_data.py                          # uses default filename below
    python export_data.py my_matrix.xlsx           # specify a different file
    python export_data.py my_matrix.xlsx out.json  # specify both input and output

Run this script any time you update the Excel file.
The website reads data.json automatically — no other changes needed.
"""

import sys
import json
import pandas as pd
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────────
DEFAULT_INPUT  = "RegIntel_PoC.xlsx"
DEFAULT_OUTPUT = "data.json"

# Sheets to export. Add sheet names here as you build them out.
# Sheets listed here but not found in the workbook are silently skipped.
SHEETS = [
    "R LPN",
    "CS ALF",
    "CS SNF",
    # Add future sheets here as they are built out, e.g.:
    # "CS Home Health",
    # "CS Hospice",
    # "CS CAH",
]

# Columns where blank cells should export as null (not 0 or empty string).
NULLABLE_COLUMNS = [
    "Jurisdiction",
    "Jurisdiction Role",
    "Jurisdiction Setting",
    "Oversight / Professional Agency",
    "HSTM Role",
    "HSTM Setting",
    "Tier Priority",
    "Requirement Level",
    "Citation",
    "Training Topic / Competency Item",
    "Purpose",
    "Approval Required",
    "Hours Required",
    "Frequency",
    "Explicit Training",
    "Relationship",
    "Notes / Research Flags",
    "Source URL",
]

# Columns that should always export as integers when non-null.
# NOTE: Hours Required is intentionally excluded — values like "160 hrs" are
# mixed strings that cannot be cleanly cast. Keep it in NULLABLE_COLUMNS above.
INTEGER_COLUMNS = [
    "Tier",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def clean_value(val):
    """Convert a single cell value to a JSON-safe Python type."""
    if pd.isna(val):
        return None
    if hasattr(val, "item"):
        return val.item()
    return val


def export_sheet(df, sheet_name):
    """Clean and serialize one sheet to a list of row dicts."""
    if df.empty:
        return []

    df = df.where(pd.notnull(df), None)

    records = []
    for _, row in df.iterrows():
        record = {}
        for col in df.columns:
            val = row[col]

            if col in NULLABLE_COLUMNS:
                s = str(val).strip() if val is not None else None
                record[col] = None if s in (None, "", "nan", "NaN", "None") else s
                continue

            if col in INTEGER_COLUMNS:
                try:
                    record[col] = None if val is None else int(float(val))
                except (ValueError, TypeError):
                    record[col] = None
                continue

            record[col] = clean_value(val)

        records.append(record)

    print(f"  OK  {sheet_name}: {len(records)} rows, {len(df.columns)} columns")
    return records


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    input_path  = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(DEFAULT_OUTPUT)

    if not input_path.exists():
        print(f"\nERROR: File not found -- {input_path}")
        print(f"       Put the Excel file in the same folder as this script,")
        print(f"       or pass the full path as an argument.")
        sys.exit(1)

    print(f"\nReading:  {input_path}")

    try:
        workbook = pd.read_excel(input_path, sheet_name=None, dtype=str)
    except Exception as e:
        print(f"ERROR reading workbook: {e}")
        sys.exit(1)

    found_sheets    = set(workbook.keys())
    expected_sheets = set(SHEETS)
    missing         = expected_sheets - found_sheets
    extra           = found_sheets - expected_sheets

    if missing:
        print(f"\nNOTE: Sheets in config but not in workbook (skipped): {sorted(missing)}")
    if extra:
        print(f"\nNOTE: Sheets in workbook but not in config (not exported): {sorted(extra)}")
        print(f"      Add their names to the SHEETS list at the top of this script.")

    output = {}
    print()
    for sheet_name in SHEETS:
        if sheet_name not in workbook:
            continue
        df = workbook[sheet_name].copy()
        output[sheet_name] = export_sheet(df, sheet_name)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)

    total_rows = sum(len(v) for v in output.values())
    print(f"\nWritten:  {output_path}")
    print(f"Summary:  {len(output)} sheet(s), {total_rows} total rows\n")


if __name__ == "__main__":
    main()
