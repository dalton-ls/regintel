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
