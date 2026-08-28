import { corsHeaders, json } from "../functions/_lib/cors.js";
import { onRequestGet as healthGet } from "../functions/api/health.js";
import { onRequestGet as fileGet } from "../functions/api/file.js";
import { onRequestPost as commitPost } from "../functions/api/commit.js";

function context(request, env) {
  return { request, env };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/health" || url.pathname === "/api") {
      if (request.method === "GET") return healthGet(context(request, env));
    }
    if (url.pathname === "/api/file" && request.method === "GET") {
      return fileGet(context(request, env));
    }
    if (url.pathname === "/api/commit" && request.method === "POST") {
      return commitPost(context(request, env));
    }

    return json({ error: "not found" }, 404, origin);
  },
};
