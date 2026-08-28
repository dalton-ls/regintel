"""
export_wr.py
------------
Converts RegIntel_POC_WR.xlsx → wr.json for the RegIntel web tool.

This is the primary data file for the RegIntel UI and the source of truth for
the regintel.html inline data embed.

Sheets exported (WR * only; job-study Domain/KSA rows):
    WR CNA_SNF / WR LVN_SNF / WR RN_SNF
    WR CNA_ALF / WR LVN_ALF / WR RN_ALF
    WR HHA_HH / WR LVN_HH

Usage:
    python export_wr.py                                    # defaults below
    python export_wr.py my_file.xlsx                       # custom input
    python export_wr.py my_file.xlsx out.json              # custom input + output

HSTM Role handling:
    Pipe-delimited values are split into arrays.
    "Clinical, Non-Medication Dispensing | Managerial Staff"
    → ["Clinical, Non-Medication Dispensing", "Managerial Staff"]
"""

import sys
import json
import pandas as pd
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────────
DEFAULT_INPUT  = "RegIntel_POC_WR.xlsx"
DEFAULT_OUTPUT = "wr.json"

SHEETS = [
    "WR CNA_SNF",
    "WR LVN_SNF",
    "WR RN_SNF",
    "WR CNA_ALF",
    "WR LVN_ALF",
    "WR RN_ALF",
    "WR HHA_HH",
    "WR LVN_HH",
]

# Columns to drop before export — excluded by design, not absent from file
DROP_COLUMNS = [
    "Tier",
    "Tier Priority",
]

NULLABLE_COLUMNS = [
    "Jurisdiction Setting",
    "HSTM Setting",
    "Jurisdiction Role",
    "HSTM Role",
    "Approval Required",
    "Notes / Research Flags",
    "Citation",
    "Purpose",
]

INTEGER_COLUMNS = [
    "Hours Required",
]

ARRAY_COLUMNS = [
    "HSTM Role",
]

PIPE_NULL = {"nan", "NaN", "None", "none", ""}


def clean_value(val):
    if pd.isna(val):
        return None
    if hasattr(val, "item"):
        return val.item()
    return val


def to_array(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    if s in PIPE_NULL:
        return None
    parts = [p.strip() for p in s.split("|") if p.strip() and p.strip() not in PIPE_NULL]
    return parts if parts else None


def export_sheet(df, sheet_name):
    if df.empty:
        return []

    # Drop excluded columns if present
    cols_to_drop = [c for c in DROP_COLUMNS if c in df.columns]
    if cols_to_drop:
        df = df.drop(columns=cols_to_drop)

    df = df.where(pd.notnull(df), None)

    records = []
    for _, row in df.iterrows():
        record = {}
        for col in df.columns:
            val = row[col]

            if col in ARRAY_COLUMNS:
                record[col] = to_array(val)
                continue

            if col in NULLABLE_COLUMNS:
                s = str(val).strip() if val is not None else None
                record[col] = None if s in (None,) or s in PIPE_NULL else s
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


def main():
    input_path  = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(DEFAULT_OUTPUT)

    if not input_path.exists():
        print(f"\nERROR: File not found -- {input_path}")
        print(f"       Place the Excel file in the same folder as this script,")
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
        output[sheet_name] = export_sheet(workbook[sheet_name].copy(), sheet_name)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)

    total_rows = sum(len(v) for v in output.values())
    print(f"\nWritten:  {output_path}")
    print(f"Summary:  {len(output)} sheet(s), {total_rows} total rows")

    # Embed data inline in regintel.html so it works without a web server
    html_path = Path("regintel.html")
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8")
        begin_marker = "/* DATA_BEGIN */"
        end_marker   = "/* DATA_END */"
        start = html.find(begin_marker)
        end   = html.find(end_marker)
        if start != -1 and end != -1:
            json_str  = json.dumps(output, indent=2, ensure_ascii=False, default=str)
            new_block = f"{begin_marker}\n  const RAW_DATA = {json_str};\n  {end_marker}"
            html      = html[:start] + new_block + html[end + len(end_marker):]
            html_path.write_text(html, encoding="utf-8")
            print(f"Updated:  {html_path} (RAW_DATA block refreshed)\n")
        else:
            print(f"NOTE: DATA_BEGIN/DATA_END markers not found in {html_path} — inline embed skipped\n")
    else:
        print()


if __name__ == "__main__":
    main()
