import { getFileRaw, githubBranch } from "./github.js";
import {
  INDEX_PATH,
  MANIFEST_PATH,
  destinationShardId,
  filesForShardEdit,
  filesFromRecords,
  parseJsonl,
  shardFilePath,
} from "./requirements-store.js";

export async function previousShardPaths(env, branch) {
  try {
    const manifest = JSON.parse(await getFileRaw(env, MANIFEST_PATH, branch));
    return (manifest.shards || []).map((s) => s.path).filter(Boolean);
  } catch {
    return [];
  }
}

export async function loadRequirementRecords(env, branch = githubBranch(env)) {
  try {
    const manifest = JSON.parse(await getFileRaw(env, MANIFEST_PATH, branch));
    const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
    if (shards.length) {
      const parts = await Promise.all(shards.map((s) => getFileRaw(env, s.path, branch)));
      return parts.flatMap(parseJsonl);
    }
  } catch (err) {
    console.warn("sharded requirements load failed", err);
  }
  const raw = await getFileRaw(env, "requirements.json", branch);
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  throw new Error("requirements.json is not a record array and shards were not readable");
}

export async function requirementFilesFromRecords(env, records, branch = githubBranch(env)) {
  const previous = await previousShardPaths(env, branch);
  return filesFromRecords(records, previous).files;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

async function readJson(env, path, branch) {
  return JSON.parse(await getFileRaw(env, path, branch));
}

async function readShard(env, branch, manifest, shardId) {
  const meta = ((manifest && manifest.shards) || []).find((shard) => shard.id === shardId);
  const path = (meta && meta.path) || shardFilePath(shardId);
  return parseJsonl(await getFileRaw(env, path, branch));
}

/** Drawer save/delete: read the index and only the shards that own the rows. */
export async function filesForRecordEdit(env, branch, { recordId, fields, deletedIds } = {}) {
  const [index, manifest] = await Promise.all([
    readJson(env, INDEX_PATH, branch),
    readJson(env, MANIFEST_PATH, branch),
  ]);
  const indexRecords = Array.isArray(index.records) ? index.records : [];

  if (recordId) {
    const entry = indexRecords.find((row) => row && row["Record ID"] === recordId);
    if (!entry || !entry.shard) throw notFound("Record " + recordId + " was not found");
    const sourceRows = await readShard(env, branch, manifest, entry.shard);
    const current = sourceRows.find((row) => row && row["Record ID"] === recordId);
    if (!current) throw notFound("Record " + recordId + " was not found");
    const merged = Object.assign({}, current, fields);
    const destId = destinationShardId(merged, manifest, entry.shard);
    const loadedShards = new Map([[entry.shard, sourceRows]]);
    if (destId !== entry.shard) {
      const destKnown = ((manifest && manifest.shards) || []).some((shard) => shard.id === destId);
      loadedShards.set(destId, destKnown ? await readShard(env, branch, manifest, destId) : []);
    }
    const result = filesForShardEdit({ index, manifest, loadedShards, recordId, fields });
    if (!result.found) throw notFound("Record " + recordId + " was not found");
    return result.files;
  }

  const ids = (deletedIds || []).filter(Boolean);
  const idSet = new Set(ids);
  const shardIds = [];
  for (const row of indexRecords) {
    if (row && idSet.has(row["Record ID"]) && row.shard && !shardIds.includes(row.shard)) {
      shardIds.push(row.shard);
    }
  }
  if (!shardIds.length) throw notFound("Those records were not found in requirements.json");
  const loadedShards = new Map();
  await Promise.all(shardIds.map(async (shardId) => {
    loadedShards.set(shardId, await readShard(env, branch, manifest, shardId));
  }));
  const result = filesForShardEdit({ index, manifest, loadedShards, deletedIds: ids });
  if (!result.found) throw notFound("Those records were not found in requirements.json");
  return result.files;
}

export { INDEX_PATH, MANIFEST_PATH };
