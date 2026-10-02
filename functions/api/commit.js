import { json } from "../_lib/cors.js";
import {
  ALLOWED_PATHS,
  checkAuth,
  commitFiles,
  getFile,
  githubBranch,
  githubCredentialError,
  githubToken,
  putFile,
} from "../_lib/github.js";
import { filesForRecordEdit, requirementFilesFromRecords } from "../_lib/requirements-io.js";

function unwrapRecords(content) {
  if (Array.isArray(content)) return content;
  if (content && Array.isArray(content.records)) return content.records;
  if (content && Array.isArray(content.content)) return content.content;
  return null;
}

async function commitFileList(env, branch, message, files, origin) {
  const commit = await commitFiles(env, branch, message, files);
  return json({
    ok: true,
    commitSha: commit.commit && commit.commit.sha,
    commitUrl: commit.commit && commit.commit.html_url,
    shards: files.filter((f) => !f.delete).length,
  }, 200, origin);
}

async function commitRequirementRecords(env, branch, message, records, origin) {
  const files = await requirementFilesFromRecords(env, records, branch);
  return commitFileList(env, branch, message, files, origin);
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin");
  const env = context.env;
  const request = context.request;

  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401, origin);
  if (!githubToken(env)) {
    return json({
      error: "GITHUB_TOKEN is not set. From the repo root run: npx wrangler secret put GITHUB_TOKEN",
    }, 503, origin);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON body" }, 400, origin); }

  const { path, message, content, recordId, fields, deletedIds } = body;
  if (!path || !ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);

  try {
    const branch = githubBranch(env);
    const commitMessage = message || "Admin edit via regintel Worker";

    if (path === "requirements.json") {
      if (recordId && fields && typeof fields === "object") {
        const files = await filesForRecordEdit(env, branch, { recordId, fields });
        return await commitFileList(env, branch, commitMessage, files, origin);
      }
      if (Array.isArray(deletedIds) && deletedIds.length) {
        const files = await filesForRecordEdit(env, branch, { deletedIds });
        return await commitFileList(env, branch, commitMessage, files, origin);
      }
      console.warn("full requirements replace rewrites every shard and can exceed the Workers free-plan subrequest limit");
      const records = unwrapRecords(content);
      if (!records) return json({ error: "missing content" }, 400, origin);
      return await commitRequirementRecords(env, branch, commitMessage, records, origin);
    }

    if (content === undefined) return json({ error: "missing content" }, 400, origin);
    const newContentStr = JSON.stringify(content, null, 2) + "\n";
    const { sha } = await getFile(env, path, branch);
    const commit = await putFile(env, path, branch, commitMessage, newContentStr, sha);
    return json({
      ok: true,
      commitSha: commit.commit && commit.commit.sha,
      commitUrl: commit.commit && commit.commit.html_url,
    }, 200, origin);
  } catch (err) {
    if (err.status === 409) {
      return json({ error: "conflict — the file changed since you loaded it; reload and try again" }, 409, origin);
    }
    if (err.status === 404) {
      return json({ error: err.message }, 404, origin);
    }
    const msg = err && err.message ? err.message : String(err);
    if (/401/.test(msg) && /Bad credentials/i.test(msg)) {
      return json({ error: githubCredentialError() }, 502, origin);
    }
    return json({ error: msg }, 502, origin);
  }
}
