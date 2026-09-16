#!/usr/bin/env python3
"""Load/save the sharded live requirements projection.

Rows live in requirements/shards/*.jsonl. GET /requirements.json is a Worker
concat; this module is the Python equivalent for assign/dedupe/apply scripts.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARD_DIR = ROOT / "requirements" / "shards"
MANIFEST_PATH = ROOT / "requirements" / "manifest.json"
INDEX_PATH = ROOT / "requirements" / "index.json"
STUB_PATH = ROOT / "requirements.json"

SHARD_BUDGET_BYTES = 10 * 1024 * 1024
SHARD_SCHEMA_VERSION = 1

INDEX_FIELDS = (
    "Record ID",
    "Source Dataset",
    "Jurisdiction",
    "Jurisdiction Setting",
    "Jurisdiction Role",
    "HSTM Setting",
    "HSTM Role",
    "Canonical Role",
    "Display Role",
    "Role Classification Status",
    "Regulation Type",
    "Oversight / Professional Agency",
    "Requirement Level",
    "Authority Level",
    "Relationship",
    "Program",
    "Citation",
    "Obligation ID",
    "Product Use Case",
    "Policy Action Relevance",
    "Operational Domain",
    "Change Source Path",
)


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug or "unknown"


def _obligation_corpus(row: dict) -> str:
    oid = row.get("Obligation ID") or ""
    if "::" in oid:
        return oid.split("::", 1)[0].strip()
    return ""


def _change_source_path(row: dict) -> str:
    return (row.get("Change Source Path") or row.get("Change Source path") or "").strip()


def corpus_id(row: dict) -> str:
    corpus = _obligation_corpus(row)
    if corpus:
        return _slug(corpus)
    csp = _change_source_path(row)
    if csp:
        return _slug(csp.split(".", 1)[0])
    return _slug(row.get("Jurisdiction") or "unknown")


def _csp_parts(row: dict) -> list[str]:
    csp = _change_source_path(row)
    return [p for p in csp.split(".") if p]


def chapter_suffix(row: dict) -> str:
    take = []
    for part in _csp_parts(row)[1:]:
        if part.startswith(("section_", "article_")):
            break
        if part.startswith(("division_", "chapter_", "subchapter_", "part_", "group_")):
            take.append(part)
    return "-".join(take)


def article_suffix(row: dict) -> str:
    chapter = chapter_suffix(row)
    extra = next((part for part in _csp_parts(row) if part.startswith(("article_", "subarticle_"))), "")
    if not extra:
        return chapter
    return "-".join([p for p in (chapter, extra) if p])


def shard_id_for(row: dict, grain: str = "corpus") -> str:
    base = corpus_id(row)
    if grain == "article":
        extra = article_suffix(row)
        return f"{base}--{extra}" if extra else base
    if grain == "chapter":
        extra = chapter_suffix(row)
        return f"{base}--{extra}" if extra else base
    return base


def shard_path(shard_id: str) -> Path:
    return SHARD_DIR / f"{shard_id}.jsonl"


def records_to_jsonl(records: list[dict]) -> str:
    lines = [json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in records]
    return "\n".join(lines) + ("\n" if lines else "")


def parse_jsonl(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def index_row(row: dict, shard: str) -> dict:
    out = {"shard": shard}
    for field in INDEX_FIELDS:
        if field in row:
            out[field] = row[field]
    return out


def _encoded_size(records: list[dict]) -> int:
    return len(records_to_jsonl(records).encode("utf-8"))


def assign_shards(records: list[dict], budget: int = SHARD_BUDGET_BYTES) -> dict[str, list[dict]]:
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for row in records:
        by_corpus[corpus_id(row)].append(row)

    shards: dict[str, list[dict]] = {}
    for _corpus, group in by_corpus.items():
        if _encoded_size(group) <= budget:
            shards[shard_id_for(group[0], "corpus")] = group
            continue
        by_chapter: dict[str, list[dict]] = defaultdict(list)
        for row in group:
            by_chapter[shard_id_for(row, "chapter")].append(row)
        for sid, chapter_group in by_chapter.items():
            if _encoded_size(chapter_group) <= budget:
                shards[sid] = chapter_group
                continue
            by_article: dict[str, list[dict]] = defaultdict(list)
            for row in chapter_group:
                by_article[shard_id_for(row, "article")].append(row)
            for article_id, article_group in by_article.items():
                if _encoded_size(article_group) <= budget:
                    shards[article_id] = article_group
                    continue
                buckets: dict[str, list[dict]] = defaultdict(list)
                for row in article_group:
                    rid = row.get("Record ID") or ""
                    nibble = rid[-1] if rid else "0"
                    buckets[f"{article_id}--x{nibble}"].append(row)
                shards.update(buckets)
    return dict(shards)


def build_manifest(shards: dict[str, list[dict]]) -> dict:
    files = []
    total = 0
    for shard_id in sorted(shards):
        records = shards[shard_id]
        raw = records_to_jsonl(records)
        size = len(raw.encode("utf-8"))
        total += len(records)
        files.append({
            "id": shard_id,
            "path": f"requirements/shards/{shard_id}.jsonl",
            "records": len(records),
            "bytes": size,
        })
    return {
        "schemaVersion": SHARD_SCHEMA_VERSION,
        "budgetBytes": SHARD_BUDGET_BYTES,
        "recordCount": total,
        "shards": files,
    }


def build_index(shards: dict[str, list[dict]]) -> dict:
    rows = []
    for shard_id, records in shards.items():
        for row in records:
            rows.append(index_row(row, shard_id))
    return {
        "schemaVersion": SHARD_SCHEMA_VERSION,
        "recordCount": len(rows),
        "records": rows,
    }


def _bind(root: Path) -> None:
    global ROOT, SHARD_DIR, MANIFEST_PATH, INDEX_PATH, STUB_PATH
    ROOT = root
    SHARD_DIR = ROOT / "requirements" / "shards"
    MANIFEST_PATH = ROOT / "requirements" / "manifest.json"
    INDEX_PATH = ROOT / "requirements" / "index.json"
    STUB_PATH = ROOT / "requirements.json"


def write_shards(shards: dict[str, list[dict]]) -> None:
    if SHARD_DIR.exists():
        for old in SHARD_DIR.glob("*.jsonl"):
            old.unlink()
    else:
        SHARD_DIR.mkdir(parents=True, exist_ok=True)
    for shard_id, records in shards.items():
        shard_path(shard_id).write_text(records_to_jsonl(records), encoding="utf-8")
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(build_manifest(shards), indent=2) + "\n", encoding="utf-8")
    INDEX_PATH.write_text(json.dumps(build_index(shards), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    STUB_PATH.write_text(
        json.dumps({
            "sharded": True,
            "manifest": "requirements/manifest.json",
            "index": "requirements/index.json",
            "message": "Live rows are in requirements/shards/*.jsonl. The Worker concatenates GET /requirements.json.",
        }, indent=2)
        + "\n",
        encoding="utf-8",
    )


def load_records(root: Path | None = None) -> list[dict]:
    base = root or ROOT
    shard_dir = base / "requirements" / "shards"
    legacy = base / "requirements.json"
    if shard_dir.exists() and any(shard_dir.glob("*.jsonl")):
        rows = []
        for path in sorted(shard_dir.glob("*.jsonl")):
            rows.extend(parse_jsonl(path.read_text(encoding="utf-8")))
        return rows
    if legacy.exists():
        data = json.loads(legacy.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    raise FileNotFoundError("No sharded requirements or legacy requirements.json array found")


def save_records(records: list[dict], root: Path | None = None) -> dict[str, list[dict]]:
    if root is not None:
        _bind(root)
    shards = assign_shards(records)
    write_shards(shards)
    return shards


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Split or rewrite the sharded requirements projection")
    parser.add_argument("--from-legacy", action="store_true", help="Read a legacy requirements.json array")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.from_legacy:
        data = json.loads(STUB_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise SystemExit("requirements.json is not a legacy array")
        records = data
    else:
        records = load_records()
    shards = assign_shards(records)
    manifest = build_manifest(shards)
    print(f"records {manifest['recordCount']} shards {len(manifest['shards'])}")
    for entry in manifest["shards"]:
        over = " OVER" if entry["bytes"] > SHARD_BUDGET_BYTES else ""
        print(f"  {entry['id']}: {entry['records']} rows {entry['bytes']/1048576:.2f} MiB{over}")
    if args.write:
        write_shards(shards)
        print("wrote requirements/shards, manifest, index, and stub requirements.json")


if __name__ == "__main__":
    main()
