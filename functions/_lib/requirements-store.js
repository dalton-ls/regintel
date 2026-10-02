export const SHARD_BUDGET_BYTES = 10 * 1024 * 1024;
export const SHARD_SCHEMA_VERSION = 1;
export const MANIFEST_PATH = "requirements/manifest.json";
export const INDEX_PATH = "requirements/index.json";
export const STUB_PATH = "requirements.json";

export const INDEX_FIELDS = [
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
];

function slug(value) {
  const s = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "unknown";
}

function obligationCorpus(row) {
  const oid = row && row["Obligation ID"] ? String(row["Obligation ID"]) : "";
  const i = oid.indexOf("::");
  return i >= 0 ? oid.slice(0, i).trim() : "";
}

function changeSourcePath(row) {
  if (!row) return "";
  return String(row["Change Source Path"] || row["Change Source path"] || "").trim();
}

export function corpusId(row) {
  const corpus = obligationCorpus(row);
  if (corpus) return slug(corpus);
  const csp = changeSourcePath(row);
  if (csp) return slug(csp.split(".")[0]);
  return slug(row && row.Jurisdiction);
}

function cspParts(row) {
  return changeSourcePath(row).split(".").filter(Boolean);
}

export function chapterSuffix(row) {
  const take = [];
  for (const part of cspParts(row).slice(1)) {
    if (part.startsWith("section_") || part.startsWith("article_")) break;
    if (
      part.startsWith("division_") ||
      part.startsWith("chapter_") ||
      part.startsWith("subchapter_") ||
      part.startsWith("part_") ||
      part.startsWith("group_")
    ) {
      take.push(part);
    }
  }
  return take.join("-");
}

export function articleSuffix(row) {
  const chapter = chapterSuffix(row);
  const extra = cspParts(row).find((part) => part.startsWith("article_") || part.startsWith("subarticle_"));
  return extra ? [chapter, extra].filter(Boolean).join("-") : chapter;
}

export function shardIdFor(row, grain = "corpus") {
  const base = corpusId(row);
  if (grain === "article") {
    const extra = articleSuffix(row);
    return extra ? `${base}--${extra}` : base;
  }
  if (grain === "chapter") {
    const extra = chapterSuffix(row);
    return extra ? `${base}--${extra}` : base;
  }
  return base;
}

export function shardFilePath(shardId) {
  return `requirements/shards/${shardId}.jsonl`;
}

export function recordsToJsonl(records) {
  if (!records || !records.length) return "";
  return records.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function parseJsonl(text) {
  const rows = [];
  const raw = text == null ? "" : String(text);
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) rows.push(JSON.parse(trimmed));
  }
  return rows;
}

export function indexRow(row, shard) {
  const out = { shard };
  for (const field of INDEX_FIELDS) {
    if (row && Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  }
  return out;
}

function encodedSize(records) {
  return new TextEncoder().encode(recordsToJsonl(records)).length;
}

export function assignShards(records, budget = SHARD_BUDGET_BYTES) {
  const byCorpus = new Map();
  for (const row of records || []) {
    const id = corpusId(row);
    if (!byCorpus.has(id)) byCorpus.set(id, []);
    byCorpus.get(id).push(row);
  }

  const shards = new Map();
  for (const group of byCorpus.values()) {
    if (encodedSize(group) <= budget) {
      shards.set(shardIdFor(group[0], "corpus"), group);
      continue;
    }
    const byChapter = new Map();
    for (const row of group) {
      const sid = shardIdFor(row, "chapter");
      if (!byChapter.has(sid)) byChapter.set(sid, []);
      byChapter.get(sid).push(row);
    }
    for (const [sid, chapterGroup] of byChapter) {
      if (encodedSize(chapterGroup) <= budget) {
        shards.set(sid, chapterGroup);
        continue;
      }
      const byArticle = new Map();
      for (const row of chapterGroup) {
        const aid = shardIdFor(row, "article");
        if (!byArticle.has(aid)) byArticle.set(aid, []);
        byArticle.get(aid).push(row);
      }
      for (const [articleId, articleGroup] of byArticle) {
        if (encodedSize(articleGroup) <= budget) {
          shards.set(articleId, articleGroup);
          continue;
        }
        for (const row of articleGroup) {
          const rid = row["Record ID"] || "";
          const nibble = rid ? rid[rid.length - 1] : "0";
          const hid = `${articleId}--x${nibble}`;
          if (!shards.has(hid)) shards.set(hid, []);
          shards.get(hid).push(row);
        }
      }
    }
  }
  return shards;
}

export function buildManifest(shards) {
  const files = [];
  let total = 0;
  const ids = [...shards.keys()].sort();
  for (const shardId of ids) {
    const records = shards.get(shardId);
    const raw = recordsToJsonl(records);
    total += records.length;
    files.push({
      id: shardId,
      path: shardFilePath(shardId),
      records: records.length,
      bytes: new TextEncoder().encode(raw).length,
    });
  }
  return {
    schemaVersion: SHARD_SCHEMA_VERSION,
    budgetBytes: SHARD_BUDGET_BYTES,
    recordCount: total,
    shards: files,
  };
}

export function buildIndex(shards) {
  const records = [];
  for (const [shardId, rows] of shards) {
    for (const row of rows) records.push(indexRow(row, shardId));
  }
  return {
    schemaVersion: SHARD_SCHEMA_VERSION,
    recordCount: records.length,
    records,
  };
}

export function rowMatchesShard(row, shardId) {
  if (!row || !shardId) return false;
  const corpus = corpusId(row);
  const chapter = shardIdFor(row, "chapter");
  const article = shardIdFor(row, "article");
  const rid = row["Record ID"] || "";
  const nibble = rid ? rid[rid.length - 1] : "0";
  return shardId === corpus
    || shardId === chapter
    || shardId === article
    || shardId === `${article}--x${nibble}`;
}

/** Keep the current shard when the row still belongs there. Otherwise pick an existing manifest shard, or the grain sibling shards already use. */
export function destinationShardId(row, manifest, currentShardId) {
  if (currentShardId && rowMatchesShard(row, currentShardId)) return currentShardId;
  const ids = ((manifest && manifest.shards) || []).map((s) => s.id).filter(Boolean);
  const corpus = corpusId(row);
  const chapter = shardIdFor(row, "chapter");
  const article = shardIdFor(row, "article");
  const rid = row["Record ID"] || "";
  const nibble = rid ? rid[rid.length - 1] : "0";
  const nibbleId = `${article}--x${nibble}`;
  if (ids.includes(nibbleId)) return nibbleId;
  if (ids.includes(article)) return article;
  if (ids.includes(chapter)) return chapter;
  if (ids.includes(corpus)) return corpus;
  const siblings = ids.filter((id) => id === corpus || id.startsWith(corpus + "--"));
  if (!siblings.length) return corpus;
  if (siblings.some((id) => /--x[0-9a-z]$/i.test(id))) return nibbleId;
  if (siblings.some((id) => id.includes("-article_") || id.includes("-subarticle_"))) return article;
  return chapter;
}

function copyRows(rows) {
  return (rows || []).map((row) => Object.assign({}, row));
}

function manifestEntry(shardId, rows) {
  const raw = recordsToJsonl(rows);
  return {
    id: shardId,
    path: shardFilePath(shardId),
    records: rows.length,
    bytes: new TextEncoder().encode(raw).length,
  };
}

function cloneIndex(index) {
  const records = ((index && index.records) || []).map((row) => Object.assign({}, row));
  return {
    schemaVersion: (index && index.schemaVersion) || SHARD_SCHEMA_VERSION,
    recordCount: records.length,
    records,
  };
}

function cloneManifest(manifest) {
  return {
    schemaVersion: (manifest && manifest.schemaVersion) || SHARD_SCHEMA_VERSION,
    budgetBytes: (manifest && manifest.budgetBytes) || SHARD_BUDGET_BYTES,
    recordCount: (manifest && manifest.recordCount) || 0,
    shards: ((manifest && manifest.shards) || []).map((shard) => Object.assign({}, shard)),
  };
}

function upsertManifestShard(manifest, shardId, rows) {
  const path = shardFilePath(shardId);
  const existing = manifest.shards.findIndex((shard) => shard.id === shardId || shard.path === path);
  if (!rows.length) {
    if (existing >= 0) manifest.shards.splice(existing, 1);
    return;
  }
  const entry = manifestEntry(shardId, rows);
  if (existing >= 0) {
    manifest.shards[existing] = entry;
    return;
  }
  manifest.shards.push(entry);
  manifest.shards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function filesFromTouched(touched, index, manifest) {
  manifest.recordCount = manifest.shards.reduce((total, shard) => total + (shard.records || 0), 0);
  index.recordCount = index.records.length;
  const files = [];
  for (const [shardId, rows] of touched) {
    const path = shardFilePath(shardId);
    if (!rows.length) files.push({ path, delete: true });
    else files.push({ path, content: recordsToJsonl(rows) });
  }
  files.push({ path: MANIFEST_PATH, content: JSON.stringify(manifest, null, 2) + "\n" });
  files.push({ path: INDEX_PATH, content: JSON.stringify(index) + "\n" });
  return files;
}

/**
 * File list for a drawer edit or delete. Only touched shard files, the index, and the manifest.
 * loadedShards must already contain every shard the edit reads.
 */
export function filesForShardEdit({ index, manifest, loadedShards, recordId, fields, deletedIds }) {
  if (recordId) {
    return filesForOneRecord({ index, manifest, loadedShards, recordId, fields: fields || {} });
  }
  return filesForDeletes({ index, manifest, loadedShards, deletedIds: deletedIds || [] });
}

function filesForOneRecord({ index, manifest, loadedShards, recordId, fields }) {
  const nextIndex = cloneIndex(index);
  const idx = nextIndex.records.findIndex((row) => row && row["Record ID"] === recordId);
  if (idx < 0) return { files: [], found: 0 };
  const sourceId = nextIndex.records[idx].shard;
  if (!sourceId) return { files: [], found: 0 };
  const sourceRows = copyRows(loadedShards && loadedShards.get(sourceId));
  const rowIdx = sourceRows.findIndex((row) => row && row["Record ID"] === recordId);
  if (rowIdx < 0) {
    throw new Error("Record " + recordId + " is indexed in " + sourceId + " but missing from that shard");
  }
  const merged = Object.assign({}, sourceRows[rowIdx], fields);
  const destId = destinationShardId(merged, manifest, sourceId);
  const nextManifest = cloneManifest(manifest);
  const touched = new Map();
  if (destId === sourceId) {
    sourceRows[rowIdx] = merged;
    touched.set(sourceId, sourceRows);
  } else {
    sourceRows.splice(rowIdx, 1);
    touched.set(sourceId, sourceRows);
    const destRows = copyRows(loadedShards && loadedShards.get(destId));
    const existing = destRows.findIndex((row) => row && row["Record ID"] === merged["Record ID"]);
    if (existing >= 0) destRows[existing] = merged;
    else destRows.push(merged);
    touched.set(destId, destRows);
  }
  nextIndex.records[idx] = Object.assign({}, nextIndex.records[idx], indexRow(merged, destId));
  for (const [shardId, rows] of touched) upsertManifestShard(nextManifest, shardId, rows);
  return { files: filesFromTouched(touched, nextIndex, nextManifest), found: 1, destShardId: destId };
}

function filesForDeletes({ index, manifest, loadedShards, deletedIds }) {
  const idSet = new Set((deletedIds || []).filter(Boolean));
  const nextIndex = cloneIndex(index);
  const shardIds = new Set();
  let found = 0;
  nextIndex.records = nextIndex.records.filter((row) => {
    if (!row || !idSet.has(row["Record ID"])) return true;
    found += 1;
    if (row.shard) shardIds.add(row.shard);
    return false;
  });
  if (!found) return { files: [], found: 0 };
  const nextManifest = cloneManifest(manifest);
  const touched = new Map();
  for (const shardId of shardIds) {
    const rows = copyRows(loadedShards && loadedShards.get(shardId))
      .filter((row) => !idSet.has(row && row["Record ID"]));
    touched.set(shardId, rows);
    upsertManifestShard(nextManifest, shardId, rows);
  }
  return { files: filesFromTouched(touched, nextIndex, nextManifest), found };
}

export function filesFromRecords(records, previousShardPaths = []) {
  const shards = assignShards(records);
  const files = [];
  const keep = new Set();
  for (const [shardId, rows] of shards) {
    const path = shardFilePath(shardId);
    keep.add(path);
    files.push({ path, content: recordsToJsonl(rows) });
  }
  files.push({ path: MANIFEST_PATH, content: JSON.stringify(buildManifest(shards), null, 2) + "\n" });
  files.push({ path: INDEX_PATH, content: JSON.stringify(buildIndex(shards)) + "\n" });
  files.push({
    path: STUB_PATH,
    content: JSON.stringify({
      sharded: true,
      manifest: MANIFEST_PATH,
      index: INDEX_PATH,
      message: "Live rows are in requirements/shards/*.jsonl. The Worker concatenates GET /requirements.json.",
    }, null, 2) + "\n",
  });
  for (const path of previousShardPaths) {
    if (!keep.has(path)) files.push({ path, delete: true });
  }
  return { shards, files };
}

export function isAllowedPath(path) {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  if (path === "requirements.json" || path === "wr.json" || path === "program-taxonomy.json") return true;
  if (path === MANIFEST_PATH || path === INDEX_PATH) return true;
  return /^requirements\/shards\/[a-z0-9][a-z0-9._-]*\.jsonl$/.test(path);
}

export const ALLOWED_LIVE_JSON = new Set(["requirements.json", "wr.json", "program-taxonomy.json"]);
