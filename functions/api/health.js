import { json } from "../_lib/cors.js";
import { githubToken } from "../_lib/github.js";

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin");
  const env = context.env;
  return json({
    ok: true,
    service: "regintel-pages-api",
    githubTokenConfigured: Boolean(githubToken(env)),
    adminTokenConfigured: Boolean((env.ADMIN_TOKEN || "").trim()),
  }, 200, origin);
}
