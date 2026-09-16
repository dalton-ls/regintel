import { json, jsonWrappedContent } from "../_lib/cors.js";
import { ALLOWED_PATHS, getFileRaw, githubBranch } from "../_lib/github.js";
import { loadRequirementRecords } from "../_lib/requirements-io.js";

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin");
  const env = context.env;
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "requirements.json";
  if (!ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);
  try {
    const branch = githubBranch(env);
    if (path === "requirements.json") {
      const records = await loadRequirementRecords(env, branch);
      return jsonWrappedContent(JSON.stringify(records), origin);
    }
    const raw = await getFileRaw(env, path, branch);
    return jsonWrappedContent(raw, origin);
  } catch (err) {
    try {
      if (path === "requirements.json") throw err;
      const assetRes = await env.ASSETS.fetch(new Request(new URL("/" + path, context.request.url)));
      if (assetRes.ok) {
        return jsonWrappedContent(await assetRes.text(), origin);
      }
    } catch (_) { /* keep the GitHub error */ }
    return json({ error: err.message }, 502, origin);
  }
}
