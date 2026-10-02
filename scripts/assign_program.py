#!/usr/bin/env python3
"""Assign the additive, live-only `Program` field on every row in requirements.json.

`Program` is the research view's grouping level between Oversight Agency and
obligation (State > Agency > Program > obligation). It is navigation metadata:
not a parser column, not a Record ID input, not the ontology (Impact Type is).

ALL vocabulary and rules live in ../program-taxonomy.json — edit that file, not
this script. The taxonomy has one lane per tab:
  * care-setting  (Facility-Based/Organizational Training, Organizational Policy)
                  grouped by training-topic family
  * role          (Individual/Continuing Education) grouped by credential
                  lifecycle stage

Resolution order inside a lane: purpose_overrides (exact) > purpose_prefix_overrides
> citation_rules > purpose_hint_rules > rule_order (regex on Purpose, first
match wins) > rule_order against Training Topic (if fallback_to_training_topic)
> unassigned_label.

Extensibility:
  * Add a program: append to lane.programs and add rules to lane.rule_order.
  * Rename a program: change label, put the old label in aliases; rows migrate
    on the next --write.
  * A value already on a row that matches no program label is preserved (with a
    warning) unless --force; so an ad-hoc value set in the drawer survives until
    you decide whether to promote it into the taxonomy.
  * Unmatched rows are listed grouped by Purpose so you can see whether they
    need a new rule or a new program. --check exits non-zero if any exist.

Usage:
    python scripts/assign_program.py                 # dry run + report
    python scripts/assign_program.py --write         # stamp requirements.json
    python scripts/assign_program.py --check         # CI: fail on unassigned
    python scripts/assign_program.py --force         # re-derive even where a
                                                     #  non-taxonomy value exists
"""
import argparse
import collections
import json
import re
import sys
from pathlib import Path

from requirements_store import load_records, save_records, ROOT, STUB_PATH

ROOT = Path(__file__).resolve().parents[1]
REQ = ROOT / "requirements.json"
TAX = ROOT / "program-taxonomy.json"


class Lane:
    def __init__(self, name, spec, unassigned):
        self.name = name
        self.unassigned = unassigned
        self.regulation_types = set(spec.get("regulation_types", []))
        self.programs = spec.get("programs", [])
        self.labels = [p["label"] for p in self.programs]
        self.alias_to_label = {a: p["label"] for p in self.programs for a in p.get("aliases", [])}
        self.overrides = spec.get("purpose_overrides", {})
        self.prefix_overrides = [(o["prefix"], o["program"]) for o in spec.get("purpose_prefix_overrides", [])]
        self.citation_rules = [(re.compile(r["match"]), r["program"]) for r in spec.get("citation_rules", [])]
        self.hint_rules = [(re.compile(r["match"], re.I), r["program"]) for r in spec.get("purpose_hint_rules", [])]
        self.rules = [(re.compile(r["match"], re.I), r["program"]) for r in spec.get("rule_order", [])]
        self.topic_fallback = bool(spec.get("fallback_to_training_topic", True))
        # every program a rule points at must exist
        targets = {p for _, p in self.rules} | {p for _, p in self.citation_rules} | {p for _, p in self.hint_rules} \
                  | set(self.overrides.values()) | {p for _, p in self.prefix_overrides}
        missing = targets - set(self.labels)
        if missing:
            raise SystemExit(f"[{name}] rules reference programs not defined in taxonomy: {sorted(missing)}")

    def classify(self, row):
        purpose = (row.get("Purpose") or "").strip()
        if purpose in self.overrides:
            return self.overrides[purpose], "override"
        for prefix, prog in self.prefix_overrides:
            if purpose.startswith(prefix):
                return prog, "override"
        cite = row.get("Citation") or ""
        for rx, prog in self.citation_rules:
            if rx.search(cite):
                return prog, "citation"
        for rx, prog in self.hint_rules:
            if rx.search(purpose):
                return prog, "hint"
        for rx, prog in self.rules:
            if rx.search(purpose):
                return prog, "purpose"
        if self.topic_fallback:
            topic = row.get("Training Topic / Competency Item") or ""
            for rx, prog in self.rules:
                if rx.search(topic):
                    return prog, "topic"
        return self.unassigned, "none"


def load_taxonomy(path=TAX):
    tax = json.loads(Path(path).read_text(encoding="utf-8"))
    unassigned = tax.get("unassigned_label", "Unassigned (needs review)")
    lanes = {name: Lane(name, spec, unassigned) for name, spec in tax["lanes"].items()}
    by_type = {}
    for lane in lanes.values():
        for rt in lane.regulation_types:
            if rt in by_type:
                raise SystemExit(f"Regulation Type {rt!r} claimed by two lanes")
            by_type[rt] = lane
    return tax, lanes, by_type, unassigned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true", help="exit 1 if any row is unassigned")
    ap.add_argument("--force", action="store_true", help="re-derive even where a non-taxonomy value is present")
    ap.add_argument("--input", default=str(REQ))
    ap.add_argument("--output", default=str(REQ))
    ap.add_argument("--taxonomy", default=str(TAX))
    args = ap.parse_args()

    tax, lanes, by_type, unassigned = load_taxonomy(args.taxonomy)
    input_path = Path(args.input)
    if input_path.resolve() == STUB_PATH.resolve():
        rows = load_records(ROOT)
    else:
        rows = json.loads(input_path.read_text(encoding="utf-8"))

    counts = collections.defaultdict(collections.Counter)      # lane -> program -> n
    how = collections.Counter()
    preserved = collections.Counter()                          # non-taxonomy values kept
    migrated = collections.Counter()                           # alias -> label
    unassigned_rows = collections.defaultdict(collections.Counter)  # lane -> (purpose, cite) -> n
    per_setting = collections.defaultdict(collections.Counter)
    no_lane = collections.Counter()

    for r in rows:
        lane = by_type.get(r.get("Regulation Type"))
        if lane is None:
            no_lane[r.get("Regulation Type")] += 1
            continue
        current = r.get("Program")
        if current in lane.alias_to_label:
            r["Program"] = lane.alias_to_label[current]
            migrated[(current, r["Program"])] += 1
            counts[lane.name][r["Program"]] += 1
            continue
        if current and current != unassigned and current not in lane.labels and not args.force:
            preserved[(lane.name, current)] += 1
            counts[lane.name][current] += 1
            continue
        prog, method = lane.classify(r)
        r["Program"] = prog
        how[method] += 1
        counts[lane.name][prog] += 1
        if lane.name == "care-setting":
            per_setting[r.get("HSTM Setting") or "(no HSTM Setting)"][prog] += 1
        else:
            per_setting["role: " + (r.get("Display Role") or "(no Display Role)")][prog] += 1
        if prog == unassigned:
            unassigned_rows[lane.name][(r.get("Purpose") or "", (r.get("Citation") or "").split("(")[0])] += 1

    print(f"taxonomy version {tax.get('version')}  |  method: {dict(how)}")
    if no_lane:
        print("rows with a Regulation Type no lane claims (left untouched):", dict(no_lane))
    for lane_name, c in counts.items():
        print(f"\n[{lane_name}] {sum(c.values())} rows")
        for label in lanes[lane_name].labels + [unassigned]:
            if c[label]:
                print(f"  {c[label]:5d}  {label}")
        for label, n in c.items():
            if label not in lanes[lane_name].labels and label != unassigned:
                print(f"  {n:5d}  {label}   <-- not in taxonomy (preserved; promote or fix)")
    if migrated:
        print("\nalias migrations:", {f"{a} -> {b}": n for (a, b), n in migrated.items()})

    print("\nDistinct programs per bucket:")
    for s, c in sorted(per_setting.items()):
        print(f"  {s}: {len(c)} programs / {sum(c.values())} rows")

    total_unassigned = sum(sum(c.values()) for c in unassigned_rows.values())
    if total_unassigned:
        print(f"\nUNASSIGNED: {total_unassigned} rows. Add a rule to program-taxonomy.json or a new program.")
        for lane_name, c in unassigned_rows.items():
            print(f"  [{lane_name}]  (rows | Purpose | citation)")
            for (p, cite), n in c.most_common():
                print(f"    {n:3d} | {p[:100]} | {cite}")

    if args.write:
        output_path = Path(args.output)
        if output_path.resolve() == STUB_PATH.resolve():
            save_records(rows, ROOT)
            print(f"\nWrote sharded requirements ({len(rows)} rows)")
        else:
            output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"\nWrote {args.output}")
    if args.check and total_unassigned:
        sys.exit(1)


if __name__ == "__main__":
    main()
