import { json } from "../_lib/cors.js";
import { ALLOWED_PATHS, getFileRaw, githubBranch } from "../_lib/github.js";

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin");
  const env = context.env;
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "requirements.json";
  if (!ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);
  try {
    const raw = await getFileRaw(env, path, githubBranch(env));
    return json({ sha: null, content: JSON.parse(raw) }, 200, origin);
  } catch (err) {
    return json({ error: err.message }, 502, origin);
  }
}
