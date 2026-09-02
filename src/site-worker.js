import { corsHeaders, json } from "../functions/_lib/cors.js";
import { ALLOWED_PATHS, getFileRaw, githubBranch } from "../functions/_lib/github.js";
import { onRequestGet as healthGet } from "../functions/api/health.js";
import { onRequestGet as fileGet } from "../functions/api/file.js";
import { onRequestPost as commitPost } from "../functions/api/commit.js";

function context(request, env) {
  return { request, env };
}

function liveJsonPath(pathname) {
  const path = pathname.replace(/^\//, "");
  return ALLOWED_PATHS.has(path) ? path : null;
}

async function serveGithubJson(env, path, request) {
  try {
    const raw = await getFileRaw(env, path, githubBranch(env));
    return new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.warn("live json fallback to assets", path, err);
    return serveAsset(request, env);
  }
}

async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const path = new URL(request.url).pathname;
  const bust = path === "/" || /\.(html|js)$/i.test(path);
  if (!bust) return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const jsonPath = liveJsonPath(pathname);

    if (request.method === "GET" && jsonPath) {
      return serveGithubJson(env, jsonPath, request);
    }

    if (!pathname.startsWith("/api")) {
      return serveAsset(request, env);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (pathname === "/api/health" || pathname === "/api") {
      if (request.method === "GET") return healthGet(context(request, env));
    }
    if (pathname === "/api/file" && request.method === "GET") {
      return fileGet(context(request, env));
    }
    if (pathname === "/api/commit" && request.method === "POST") {
      return commitPost(context(request, env));
    }

    return json({ error: "not found" }, 404, origin);
  },
};
