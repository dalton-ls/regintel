"""
export_data.py
--------------
Converts RegIntel_PoC.xlsx → data.json for the RegIntel web tool.

Usage:
    python export_data.py                          # uses default filename below
    python export_data.py my_matrix.xlsx           # specify a different file
    python export_data.py my_matrix.xlsx out.json  # specify both

Run this script any time you update the Excel file.
The website reads data.json automatically — no other changes needed.

HSTM Role handling:
    The "HSTM Role" column now supports multiple audiences separated by " | ".
    In the JSON output, HSTM Role is always an array (even for single values).
    Example: "Clinical, Non-Medication Dispensing | Managerial Staff"
         →   ["Clinical, Non-Medication Dispensing", "Managerial Staff"]
"""

import sys
import json
import pandas as pd
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────────
DEFAULT_INPUT  = "RegIntel_PoC.xlsx"
DEFAULT_OUTPUT = "data.json"

SHEETS = [
    "R LPN",
    "CS ALF",
    "CS SNF",
    "Home Health",
    "Hospice",
    "CAH",
]

# Columns where blank cells should export as null
NULLABLE_COLUMNS = [
    "Jurisdiction Setting",
    "HSTM Setting",
    "Jurisdiction Role",
    "HSTM Role",          # still nullable if completely empty
    "Approval Required",
    "Notes / Research Flags",
    "Citation",
    "Purpose",
]

# Columns that export as integers when non-null
INTEGER_COLUMNS = [
    "Tier",
    "Hours Required",
]

# Columns that export as arrays (pipe-delimited in Excel)
ARRAY_COLUMNS = [
    "HSTM Role",          # may contain "Audience A | Audience B | Audience C"
]

PIPE_NULL = {"nan", "NaN", "None", "none", ""}


def clean_value(val):
    """Convert a single cell value to a JSON-safe Python type."""
    if pd.isna(val):
        return None
    if hasattr(val, "item"):
        return val.item()
    return val


def to_array(raw):
    """
    Parse a pipe-delimited string into a cleaned array.
    'Clinical, Non-Medication Dispensing | Managerial Staff'
    → ['Clinical, Non-Medication Dispensing', 'Managerial Staff']
    Returns None if value is empty/null.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if s in PIPE_NULL:
        return None
    parts = [p.strip() for p in s.split("|") if p.strip() and p.strip() not in PIPE_NULL]
    return parts if parts else None


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

            # Array columns — parse pipe-delimited into list
            if col in ARRAY_COLUMNS:
                record[col] = to_array(val)
                continue

            # Nullable string columns
            if col in NULLABLE_COLUMNS:
                s = str(val).strip() if val is not None else None
                record[col] = None if s in (None,) or s in PIPE_NULL else s
                continue

            # Integer columns
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
