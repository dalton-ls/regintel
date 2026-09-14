#!/usr/bin/env python3
"""Merge duplicate output rows in requirements.json.

Two extraction passes over the same Title 22 sections produced pairs of rows
with identical Citation + Training Topic + HSTM Setting + Regulation Type but
different Purpose labels (section-heading style vs sentence style) and
therefore different Record IDs. This script merges each group into one row.

Match rule (conservative):
  * exact:  same Citation, HSTM Setting, Regulation Type, and normalized
            Training Topic text
  * contained: same Citation / Setting / Type / Relationship, one normalized
            topic is a substring of the other, and the shorter is >= 60% of the
            longer (verbatim vs trimmed extraction of the same clause). This
            deliberately does NOT merge a Parent sentence with its enumerated
            Child topics. Nothing fuzzier than that.

Keeper = the row with the most populated fields; ties go to the row whose
Notes carry SME_APPROVED / QA stamps, then the later Change Detected Date.
Empty fields on the keeper are filled from the discarded row; Impact Types
are unioned; the discarded Record ID is stamped into Notes / Research Flags.

Usage:
    python scripts/dedupe_requirements.py                 # dry run + report
    python scripts/dedupe_requirements.py --write         # rewrite requirements.json
    python scripts/dedupe_requirements.py --report out.csv
"""
import json, re, sys, argparse, collections, csv, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQ = ROOT / "requirements.json"

def norm(t):
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()

def empty(v):
    return v in (None, "", [], {})

def score(r):
    filled = sum(1 for v in r.values() if not empty(v))
    notes = r.get("Notes / Research Flags") or ""
    stamped = 1 if re.search(r"SME_APPROVED|\[QA ", notes) else 0
    return (filled, stamped, r.get("Change Detected Date") or "")

def merge(keep, drop, today):
    for k, v in drop.items():
        if k in ("Record ID", "Purpose", "Program"):
            continue
        if empty(keep.get(k)) and not empty(v):
            keep[k] = v
    it = list(keep.get("Impact Types") or [])
    for t in drop.get("Impact Types") or []:
        if t not in it:
            it.append(t)
    if it:
        keep["Impact Types"] = it
    stamp = f"[DEDUP {today}] merged duplicate {drop.get('Record ID')} (Purpose: {drop.get('Purpose')})"
    notes = keep.get("Notes / Research Flags") or ""
    keep["Notes / Research Flags"] = (notes + " | " + stamp) if notes and notes != "None" else stamp
    return keep

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--input", default=str(REQ))
    ap.add_argument("--output", default=str(REQ))
    ap.add_argument("--report", default=None)
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    n0 = len(rows)

    # bucket by citation/setting/type, then cluster topics
    buckets = collections.defaultdict(list)
    for r in rows:
        buckets[(r.get("Citation"), r.get("HSTM Setting"), r.get("Regulation Type"))].append(r)

    removed = {}   # dropped record id -> kept record id
    report = []
    for key, group in buckets.items():
        if len(group) < 2:
            continue
        clusters = []  # list of lists
        for r in group:
            t = norm(r.get("Training Topic / Competency Item"))
            placed = False
            for c in clusters:
                ct = norm(c[0].get("Training Topic / Competency Item"))
                same_rel = (r.get("Relationship") or "") == (c[0].get("Relationship") or "")
                shorter, longer = sorted([t, ct], key=len)
                contained = (same_rel and len(shorter) > 25 and shorter in longer
                             and len(shorter) / max(1, len(longer)) >= 0.6)
                if t == ct or contained:
                    c.append(r); placed = True; break
            if not placed:
                clusters.append([r])
        for c in clusters:
            if len(c) < 2:
                continue
            c.sort(key=score, reverse=True)
            keep, drops = c[0], c[1:]
            for d in drops:
                match = "exact" if norm(d["Training Topic / Competency Item"]) == norm(keep["Training Topic / Competency Item"]) else "contained"
                report.append({
                    "kept_record_id": keep["Record ID"], "dropped_record_id": d["Record ID"],
                    "match": match, "citation": key[0], "hstm_setting": key[1] or "",
                    "kept_purpose": keep.get("Purpose"), "dropped_purpose": d.get("Purpose"),
                    "kept_topic": keep.get("Training Topic / Competency Item"),
                    "dropped_topic": d.get("Training Topic / Competency Item"),
                })
                merge(keep, d, today)
                removed[d["Record ID"]] = keep["Record ID"]

    out = [r for r in rows if r["Record ID"] not in removed]
    print(f"rows: {n0} -> {len(out)}  (merged {len(removed)}: "
          f"{sum(1 for x in report if x['match']=='exact')} exact, "
          f"{sum(1 for x in report if x['match']=='contained')} contained)")
    by_setting = collections.Counter(x["hstm_setting"] or "(none)" for x in report)
    print("by setting:", dict(by_setting))

    if args.report:
        with open(args.report, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(report[0].keys()))
            w.writeheader(); w.writerows(report)
        print("report:", args.report)
    if args.write:
        Path(args.output).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("wrote", args.output)

if __name__ == "__main__":
    main()
