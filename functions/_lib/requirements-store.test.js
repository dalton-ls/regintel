import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_PATH,
  MANIFEST_PATH,
  SHARD_BUDGET_BYTES,
  assignShards,
  corpusId,
  filesForShardEdit,
  filesFromRecords,
  indexRow,
  isAllowedPath,
  parseJsonl,
  recordsToJsonl,
  shardFilePath,
  shardIdFor,
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

test("single-record edit rewrites only the owning shard", () => {
  const ownId = "ca-ccr-22";
  const ownPath = shardFilePath(ownId);
  const otherPaths = [];
  const shards = [];
  const indexRecords = [indexRow({ ...t22, "Requirement Level": "Other Training Reference" }, ownId)];
  for (let i = 0; i < 31; i++) {
    const id = "other-" + String(i).padStart(2, "0");
    const path = shardFilePath(id);
    otherPaths.push(path);
    shards.push({ id, path, records: 1, bytes: 10 });
    indexRecords.push({ shard: id, "Record ID": "other_" + i });
  }
  shards.push({ id: ownId, path: ownPath, records: 1, bytes: 10 });
  const index = { schemaVersion: 1, recordCount: 32, records: indexRecords };
  const manifest = {
    schemaVersion: 1,
    budgetBytes: SHARD_BUDGET_BYTES,
    recordCount: 32,
    shards,
  };
  const { files } = filesForShardEdit({
    index,
    manifest,
    loadedShards: new Map([[ownId, [{ ...t22, "Requirement Level": "Other Training Reference" }]]]),
    recordId: t22["Record ID"],
    fields: { "Requirement Level": "Explicit Training" },
  });
  const paths = files.map((file) => file.path);
  assert.deepEqual(paths, [ownPath, MANIFEST_PATH, INDEX_PATH]);
  for (const path of otherPaths) assert.equal(paths.includes(path), false);
  const rows = parseJsonl(files.find((file) => file.path === ownPath).content);
  assert.equal(rows[0]["Requirement Level"], "Explicit Training");
  const nextIndex = JSON.parse(files.find((file) => file.path === INDEX_PATH).content);
  const entry = nextIndex.records.find((row) => row["Record ID"] === t22["Record ID"]);
  assert.equal(entry["Requirement Level"], "Explicit Training");
  assert.equal(entry.shard, ownId);
  const nextManifest = JSON.parse(files.find((file) => file.path === MANIFEST_PATH).content);
  assert.equal(nextManifest.shards.length, 32);
  assert.equal(nextManifest.recordCount, 32);
  assert.equal(nextManifest.shards.find((shard) => shard.id === "other-00").bytes, 10);
});

test("routing change moves the row and deletes an emptied source shard", () => {
  const index = {
    schemaVersion: 1,
    recordCount: 2,
    records: [indexRow(t22, "ca-ccr-22"), indexRow(t8, "ca-ccr-8")],
  };
  const manifest = {
    schemaVersion: 1,
    budgetBytes: SHARD_BUDGET_BYTES,
    recordCount: 2,
    shards: [
      { id: "ca-ccr-8", path: shardFilePath("ca-ccr-8"), records: 1, bytes: 1 },
      { id: "ca-ccr-22", path: shardFilePath("ca-ccr-22"), records: 1, bytes: 1 },
    ],
  };
  const { files, destShardId } = filesForShardEdit({
    index,
    manifest,
    loadedShards: new Map([["ca-ccr-22", [t22]], ["ca-ccr-8", [t8]]]),
    recordId: t22["Record ID"],
    fields: {
      "Obligation ID": t8["Obligation ID"],
      "Change Source Path": t8["Change Source Path"],
    },
  });
  assert.equal(destShardId, "ca-ccr-8");
  assert.equal(files.find((file) => file.path === shardFilePath("ca-ccr-22")).delete, true);
  const dest = parseJsonl(files.find((file) => file.path === shardFilePath("ca-ccr-8")).content);
  assert.deepEqual(dest.map((row) => row["Record ID"]), ["req_bbb222", "req_aaa111"]);
  const nextManifest = JSON.parse(files.find((file) => file.path === MANIFEST_PATH).content);
  assert.deepEqual(nextManifest.shards.map((shard) => shard.id), ["ca-ccr-8"]);
  assert.equal(nextManifest.recordCount, 2);
});

test("delete rewrites only the shards that held those records", () => {
  const index = {
    schemaVersion: 1,
    recordCount: 2,
    records: [indexRow(t22, "ca-ccr-22"), indexRow(t8, "ca-ccr-8")],
  };
  const manifest = {
    schemaVersion: 1,
    budgetBytes: SHARD_BUDGET_BYTES,
    recordCount: 2,
    shards: [
      { id: "ca-ccr-8", path: shardFilePath("ca-ccr-8"), records: 1, bytes: 1 },
      { id: "ca-ccr-22", path: shardFilePath("ca-ccr-22"), records: 1, bytes: 1 },
    ],
  };
  const { files, found } = filesForShardEdit({
    index,
    manifest,
    loadedShards: new Map([["ca-ccr-22", [t22]], ["ca-ccr-8", [t8]]]),
    deletedIds: [t22["Record ID"]],
  });
  assert.equal(found, 1);
  assert.equal(files.find((file) => file.path === shardFilePath("ca-ccr-22")).delete, true);
  assert.equal(files.some((file) => file.path === shardFilePath("ca-ccr-8")), false);
  const nextIndex = JSON.parse(files.find((file) => file.path === INDEX_PATH).content);
  assert.deepEqual(nextIndex.records.map((row) => row["Record ID"]), ["req_bbb222"]);
  assert.equal(nextIndex.recordCount, 1);
});

test("path allow-list blocks traversal", () => {
  assert.equal(isAllowedPath("requirements.json"), true);
  assert.equal(isAllowedPath("requirements/manifest.json"), true);
  assert.equal(isAllowedPath("requirements/shards/ca-ccr-22.jsonl"), true);
  assert.equal(isAllowedPath("requirements/shards/../wr.json"), false);
  assert.equal(isAllowedPath("secrets.json"), false);
  void SHARD_BUDGET_BYTES;
});
