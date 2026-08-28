import { json } from "../_lib/cors.js";
import {
  ALLOWED_PATHS,
  checkAuth,
  getFile,
  githubCredentialError,
  githubToken,
  putFile,
} from "../_lib/github.js";

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

  const { path, message, content } = body;
  if (!path || !ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);
  if (content === undefined) return json({ error: "missing content" }, 400, origin);

  const newContentStr = JSON.stringify(content, null, 2) + "\n";

  try {
    const { sha } = await getFile(env, path, env.GITHUB_BRANCH);
    const commit = await putFile(
      env,
      path,
      env.GITHUB_BRANCH,
      message || "Admin edit via regintel Pages Function",
      newContentStr,
      sha,
    );
    return json({
      ok: true,
      commitSha: commit.commit && commit.commit.sha,
      commitUrl: commit.commit && commit.commit.html_url,
    }, 200, origin);
  } catch (err) {
    if (err.status === 409) {
      return json({ error: "conflict — the file changed since you loaded it; reload and try again" }, 409, origin);
    }
    const msg = err && err.message ? err.message : String(err);
    if (/401/.test(msg) && /Bad credentials/i.test(msg)) {
      return json({ error: githubCredentialError() }, 502, origin);
    }
    return json({ error: msg }, 502, origin);
  }
}
