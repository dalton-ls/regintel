"""
Convert FINAL job-study Word docs into wr.json / wr.csv for WR Ingest.

Only *_FINAL.docx files are converted. Parent rows are Domain headings;
Child rows are Knowledge / Skill / Ability items.
"""

from __future__ import annotations

import csv
import json
import re
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

ROOT = Path(__file__).resolve().parent
JOBSTUDY_ROOT = Path(
    r"C:\Users\dascott\OneDrive - HealthStream, Inc\Research Services - Documents\e_jobstudies"
)

# Filename stem → WR sheet. Care Setting / Role labels come from the job
# study (not from Intelligence jurisdiction roles).
STUDIES = [
    {
        "path": JOBSTUDY_ROOT / "Skilled Nursing Facilities" / "JobStudy_CNA_SNF_FINAL.docx",
        "sheet": "WR CNA_SNF",
        "hstm_setting": "Skilled Nursing Facility",
        "hstm_role": ["Clinical, Non-Medication Dispensing"],
        "jurisdiction_role": "Certified Nursing Assistant (CNA)",
        "jurisdiction_setting": "skilled nursing facility",
    },
    {
        "path": JOBSTUDY_ROOT / "Skilled Nursing Facilities" / "JobStudy_LVN_SNF_FINAL.docx",
        "sheet": "WR LVN_SNF",
        "hstm_setting": "Skilled Nursing Facility",
        "hstm_role": ["Clinical, Medication Dispensing"],
        "jurisdiction_role": "Licensed Vocational Nurse (LVN)",
        "jurisdiction_setting": "skilled nursing facility",
    },
    {
        "path": JOBSTUDY_ROOT / "Skilled Nursing Facilities" / "JobStudy_RN_SNF_FINAL.docx",
        "sheet": "WR RN_SNF",
        "hstm_setting": "Skilled Nursing Facility",
        "hstm_role": ["Clinical, Medication Dispensing"],
        "jurisdiction_role": "Registered Nurse (RN)",
        "jurisdiction_setting": "skilled nursing facility",
    },
    {
        "path": JOBSTUDY_ROOT / "Assisted Living Facilities" / "JobStudy_CNA_ALF_FINAL.docx",
        "sheet": "WR CNA_ALF",
        "hstm_setting": "Assisted Living Facility",
        "hstm_role": ["Clinical, Non-Medication Dispensing"],
        "jurisdiction_role": "Certified Nursing Assistant (CNA)",
        "jurisdiction_setting": "residential care facility for the elderly",
    },
    {
        "path": JOBSTUDY_ROOT / "Assisted Living Facilities" / "JobStudy_LVN_ALF_FINAL.docx",
        "sheet": "WR LVN_ALF",
        "hstm_setting": "Assisted Living Facility",
        "hstm_role": ["Clinical, Medication Dispensing"],
        "jurisdiction_role": "Licensed Vocational Nurse (LVN)",
        "jurisdiction_setting": "residential care facility for the elderly",
    },
    {
        "path": JOBSTUDY_ROOT / "Assisted Living Facilities" / "JobStudy_RN_ALF_FINAL.docx",
        "sheet": "WR RN_ALF",
        "hstm_setting": "Assisted Living Facility",
        "hstm_role": ["Clinical, Medication Dispensing"],
        "jurisdiction_role": "Registered Nurse (RN)",
        "jurisdiction_setting": "residential care facility for the elderly",
    },
    {
        "path": JOBSTUDY_ROOT / "Home Health Agencies" / "JobStudy_HHA_HH_FINAL.docx",
        "sheet": "WR HHA_HH",
        "hstm_setting": "Home Health",
        "hstm_role": ["Clinical, Non-Medication Dispensing"],
        "jurisdiction_role": "Home Health Aide (HHA)",
        "jurisdiction_setting": "home health agency",
    },
    {
        "path": JOBSTUDY_ROOT / "Home Health Agencies" / "JobStudy_LVN_HH_FINAL.docx",
        "sheet": "WR LVN_HH",
        "hstm_setting": "Home Health",
        "hstm_role": ["Clinical, Medication Dispensing"],
        "jurisdiction_role": "Licensed Vocational Nurse (LVN)",
        "jurisdiction_setting": "home health agency",
    },
]

DOMAIN_RE = re.compile(r"^Domain\s+(\d+)\s*:\s*(.+)$", re.I)
KSA_RE = re.compile(r"^(Knowledge|Skill|Ability)\s*:\s*(.+)$", re.I)
STOP_HEADINGS = {"REFERENCES", "REFERENCE"}

CSV_COLUMNS = [
    "Sheet",
    "Jurisdiction",
    "Jurisdiction Setting",
    "Jurisdiction Role",
    "HSTM Setting",
    "HSTM Role",
    "Regulation Type",
    "Oversight / Professional Agency",
    "Requirement Level",
    "Authority Level",
    "Citation",
    "Training Topic / Competency Item",
    "Relationship",
    "Purpose",
    "Hours Required",
    "Source URL",
    "Notes / Research Flags",
]


def normalize_line(line: str) -> str:
    line = line.replace("\xa0", " ").replace("\r", " ").replace("\ufffd", "")
    line = re.sub(r"^[^A-Za-z0-9]+", "", line)
    return re.sub(r"\s+", " ", line).strip()


def paragraphs_from_docx_xml(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))
    paras: list[str] = []
    for para in root.iter(f"{W_NS}p"):
        parts: list[str] = []
        for node in para.iter(f"{W_NS}t"):
            if node.text:
                parts.append(node.text)
            if node.tail:
                parts.append(node.tail)
        line = normalize_line("".join(parts))
        if line:
            paras.append(line)
    return paras


def paragraphs_via_word(path: Path) -> list[str]:
    """Fallback for OLE/CFB files saved with a .docx extension."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "extract.txt"
        script = (
            f"$word = New-Object -ComObject Word.Application; "
            f"$word.Visible = $false; $word.DisplayAlerts = 0; "
            f"$doc = $word.Documents.Open({json.dumps(str(path))}, $false, $true); "
            f"$doc.SaveAs([ref]{json.dumps(str(out))}, [ref]2); "
            f"$doc.Close($false); $word.Quit()"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            check=True,
            capture_output=True,
            text=True,
        )
        text = out.read_text(encoding="utf-8", errors="replace")
    paras = [normalize_line(p) for p in text.splitlines()]
    return [p for p in paras if p]


def docx_paragraphs(path: Path) -> list[str]:
    try:
        return paragraphs_from_docx_xml(path)
    except zipfile.BadZipFile:
        print(f"  NOTE  {path.name} is not OOXML; extracting via Word")
        return paragraphs_via_word(path)


def meta_value(paras: list[str], label: str) -> str | None:
    joined = " ".join(paras)
    m = re.search(rf"{re.escape(label)}\s+([A-Za-z]+ \d{{4}})", joined, re.I)
    if m and label.casefold() == "date of review":
        return m.group(1)
    for i, line in enumerate(paras):
        if line.casefold() == label.casefold() and i + 1 < len(paras):
            nxt = paras[i + 1]
            if nxt.isupper() and len(nxt.split()) <= 4:
                continue
            return nxt
    return None


def parse_ksas(paras: list[str]) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    started = False
    for line in paras:
        if line.upper() in STOP_HEADINGS:
            break
        domain = DOMAIN_RE.match(line)
        if domain:
            started = True
            items.append(("Parent", f"Domain {int(domain.group(1))}: {domain.group(2).strip()}"))
            continue
        if not started:
            continue
        ksa = KSA_RE.match(line)
        if ksa:
            kind = ksa.group(1).title()
            items.append(("Child", f"{kind}: {ksa.group(2).strip()}"))
    return items


def make_record(study: dict, relationship: str, topic: str, review_date: str | None, source_name: str) -> dict:
    citation = f"Job Study — {study['jurisdiction_role']} × {study['hstm_setting']} (FINAL)"
    notes = f"Source: {source_name}"
    if review_date:
        notes += f" | Date of Review: {review_date}"
    return {
        "Jurisdiction": "US",
        "Jurisdiction Setting": study["jurisdiction_setting"],
        "Jurisdiction Role": study["jurisdiction_role"],
        "HSTM Setting": study["hstm_setting"],
        "HSTM Role": study["hstm_role"],
        "Regulation Type": None,
        "Oversight / Professional Agency": None,
        "Requirement Level": "Other Training Reference",
        "Authority Level": "Competency",
        "Citation": citation,
        "Training Topic / Competency Item": topic,
        "Relationship": relationship,
        "Purpose": "Workforce Readiness",
        "Hours Required": None,
        "Source URL": None,
        "Notes / Research Flags": notes,
    }


def unique_records(records: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for rec in records:
        key = (
            rec.get("Citation"),
            rec.get("Training Topic / Competency Item"),
            rec.get("Jurisdiction"),
            rec.get("HSTM Setting"),
            rec.get("Jurisdiction Role"),
            rec.get("Relationship"),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(rec)
    return out


def csv_row(sheet: str, record: dict) -> dict:
    row = {"Sheet": sheet}
    for col in CSV_COLUMNS[1:]:
        val = record.get(col)
        if col == "HSTM Role" and isinstance(val, list):
            row[col] = " | ".join(val)
        else:
            row[col] = "" if val is None else val
    return row


def main() -> None:
    wr: dict[str, list[dict]] = {}
    csv_rows: list[dict] = []
    print()
    for study in STUDIES:
        path: Path = study["path"]
        if not path.exists():
            raise SystemExit(f"Missing FINAL job study: {path}")
        paras = docx_paragraphs(path)
        review_date = meta_value(paras, "Date of Review")
        items = parse_ksas(paras)
        parents = sum(1 for rel, _ in items if rel == "Parent")
        children = sum(1 for rel, _ in items if rel == "Child")
        if not parents or not children:
            raise SystemExit(f"No Domain/KSA structure in {path.name} (parents={parents}, children={children})")
        records = unique_records([
            make_record(study, rel, topic, review_date, path.name)
            for rel, topic in items
        ])
        wr[study["sheet"]] = records
        csv_rows.extend(csv_row(study["sheet"], rec) for rec in records)
        dropped = (parents + children) - len(records)
        extra = f", dropped {dropped} duplicate(s)" if dropped else ""
        print(f"  OK  {study['sheet']}: {parents} domains, {children} KSAs ({path.name}){extra}")

    json_path = ROOT / "wr.json"
    csv_path = ROOT / "wr.csv"
    json_path.write_text(json.dumps(wr, indent=2, ensure_ascii=False), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(csv_rows)

    total = sum(len(v) for v in wr.values())
    print(f"\nWritten:  {json_path}")
    print(f"Written:  {csv_path}")
    print(f"Summary:  {len(wr)} sheet(s), {total} total rows\n")


if __name__ == "__main__":
    main()
