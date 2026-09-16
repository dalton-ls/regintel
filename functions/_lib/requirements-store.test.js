import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignShards,
  corpusId,
  filesFromRecords,
  isAllowedPath,
  parseJsonl,
  recordsToJsonl,
  shardIdFor,
  SHARD_BUDGET_BYTES,
} from "./requirements-store.js";

const t22 = {
  "Record ID": "req_aaa111",
  "Obligation ID": "CA CCR 22::22 CCR § 71829(d)(2)",
  "Change Source Path": "title_22.division_5.chapter_2_5.article_2.section_71829",
  Jurisdiction: "CA",
};

const t8 = {
  "Record ID": "req_bbb222",
  "Obligation ID": "CA CCR 8::8 CCR § 3203",
  "Change Source Path": "title_8.chapter_4.subchapter_7.article_1.section_3203",
  Jurisdiction: "CA",
};

test("corpus id prefers Obligation ID prefix", () => {
  assert.equal(corpusId(t22), "ca-ccr-22");
  assert.equal(corpusId(t8), "ca-ccr-8");
});

test("chapter grain uses Change Source Path", () => {
  assert.equal(shardIdFor(t22, "chapter"), "ca-ccr-22--division_5-chapter_2_5");
});

test("small corpora stay in one shard each", () => {
  const shards = assignShards([t22, t8]);
  assert.deepEqual([...shards.keys()].sort(), ["ca-ccr-22", "ca-ccr-8"]);
});

test("oversized corpus splits by chapter", () => {
  const bulky = [];
  for (let i = 0; i < 400; i++) {
    bulky.push({
      ...t22,
      "Record ID": "req_" + String(i).padStart(12, "0"),
      "Training Topic / Competency Item": "x".repeat(4000),
      "Change Source Path": i < 200
        ? "title_22.division_5.chapter_2_5.article_2.section_1"
        : "title_22.division_5.chapter_3.article_1.section_1",
    });
  }
  const shards = assignShards(bulky, 80_000);
  const ids = [...shards.keys()].sort();
  assert.ok(ids.some((id) => id.includes("chapter_2_5")));
  assert.ok(ids.some((id) => id.includes("chapter_3")));
  assert.ok(ids.every((id) => id.startsWith("ca-ccr-22")));
});

test("jsonl roundtrip and filesFromRecords deletes vanished shards", () => {
  const raw = recordsToJsonl([t22, t8]);
  assert.deepEqual(parseJsonl(raw).map((r) => r["Record ID"]), ["req_aaa111", "req_bbb222"]);
  const { files } = filesFromRecords([t22], ["requirements/shards/ca-ccr-8.jsonl"]);
  const deleted = files.filter((f) => f.delete).map((f) => f.path);
  assert.deepEqual(deleted, ["requirements/shards/ca-ccr-8.jsonl"]);
  assert.ok(files.some((f) => f.path === "requirements/shards/ca-ccr-22.jsonl" && f.content));
});

test("path allow-list blocks traversal", () => {
  assert.equal(isAllowedPath("requirements.json"), true);
  assert.equal(isAllowedPath("requirements/manifest.json"), true);
  assert.equal(isAllowedPath("requirements/shards/ca-ccr-22.jsonl"), true);
  assert.equal(isAllowedPath("requirements/shards/../wr.json"), false);
  assert.equal(isAllowedPath("secrets.json"), false);
  void SHARD_BUDGET_BYTES;
});
