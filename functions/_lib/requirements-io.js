import { getFileRaw, githubBranch } from "./github.js";
import {
  INDEX_PATH,
  MANIFEST_PATH,
  filesFromRecords,
  parseJsonl,
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

export { INDEX_PATH, MANIFEST_PATH };
