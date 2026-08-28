import { json } from "../_lib/cors.js";
import { githubAuthStatus, githubBranch, githubToken } from "../_lib/github.js";

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin");
  const env = context.env;
  const githubAuth = await githubAuthStatus(env);
  return json({
    ok: githubAuth === "ok",
    service: "regintel-pages-api",
    branch: githubBranch(env),
    githubTokenConfigured: Boolean(githubToken(env)),
    githubAuth,
    adminTokenConfigured: Boolean((env.ADMIN_TOKEN || "").trim()),
  }, 200, origin);
}
