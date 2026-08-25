/**
 * regintel-admin-proxy
 *
 * Holds the GitHub write token server-side and lets the RegIntel admin
 * screens commit directly to the repo. GET /monitor is unauthenticated
 * Quality Manager ingestion (scheduled + cached normalized payload).
 */

import {
  agePayload,
  emptyFailedPayload,
  ingestMonitor,
  jsonResponse,
  monitorCacheKey,
  readCachedPayload,
} from "./monitor/ingest.js";

const ALLOWED_PATHS = new Set(["requirements.json", "wr.json"]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubApiRequest(env, urlPath, init = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${urlPath}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${(env.GITHUB_TOKEN || "").trim()}`,
      "User-Agent": "regintel-admin-proxy",
      Accept: "application/vnd.github+json",
      ...(init.headers || {}),
    },
  });
}

async function getFile(env, path, branch) {
  const res = await githubApiRequest(env, `contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.content) {
    return { sha: body.sha, content: base64ToUtf8(body.content.replace(/\n/g, "")) };
  }
  const blobRes = await githubApiRequest(env, `git/blobs/${body.sha}`);
  if (!blobRes.ok) throw new Error(`GitHub blob GET ${path} failed: ${blobRes.status} ${await blobRes.text()}`);
  const blobBody = await blobRes.json();
  return { sha: body.sha, content: base64ToUtf8(blobBody.content.replace(/\n/g, "")) };
}

async function putFile(env, path, branch, message, newContentStr, sha) {
  const res = await githubApiRequest(env, `contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(newContentStr),
      sha,
      branch,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub PUT ${path} failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token && env.ADMIN_TOKEN && token === (env.ADMIN_TOKEN || "").trim();
}

function publicOrigin(env, requestUrl) {
  return env.MONITOR_PUBLIC_ORIGIN || requestUrl.origin;
}

async function refreshMonitorCache(env, origin) {
  const payload = await ingestMonitor();
  const aged = agePayload(payload, new Date());
  const response = jsonResponse(aged, "*");
  await caches.default.put(monitorCacheKey(origin), response.clone());
  return aged;
}

async function handleMonitor(request, env, ctx) {
  const originHeader = request.headers.get("Origin");
  const url = new URL(request.url);
  const origin = publicOrigin(env, url);
  const now = new Date();

  try {
    const fresh = await ingestMonitor();
    const aged = agePayload(fresh, now);
    const response = jsonResponse(aged, originHeader);
    if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(monitorCacheKey(origin), response.clone()));
    return response;
  } catch (err) {
    console.log(JSON.stringify({
      level: "error",
      event: "monitor_unavailable",
      error: String(err && err.message || err).replace(/https?:\/\/[^\s]+/gi, "[url]"),
    }));
    const cached = await readCachedPayload(caches.default, origin);
    if (cached) {
      const aged = agePayload(cached, now);
      aged.stale = true;
      aged.diagnostics = { ...aged.diagnostics, error: "Live ingest failed; serving last cached payload" };
      if (aged.overallStatus === "ok") aged.overallStatus = "stale";
      return jsonResponse(aged, originHeader);
    }
    return jsonResponse(emptyFailedPayload(now.toISOString(), "ingestion unavailable"), originHeader);
  }
}

async function handleHealth(request, env) {
  const originHeader = request.headers.get("Origin");
  const url = new URL(request.url);
  const cached = await readCachedPayload(caches.default, publicOrigin(env, url));
  if (!cached) {
    return json({ ok: false, status: "not_loaded", schemaVersion: "qm-monitor-v1" }, 503, originHeader);
  }
  const aged = agePayload(cached, new Date());
  return json({
    ok: aged.overallStatus !== "failed",
    overallStatus: aged.overallStatus,
    generatedAt: aged.generatedAt,
    lastSuccessAt: aged.lastSuccessAt,
    cacheAgeSeconds: aged.cacheAgeSeconds,
    stale: aged.stale,
    failedSources: aged.diagnostics && aged.diagnostics.failedSources,
    itemCount: (aged.items || []).length,
    schemaVersion: aged.schemaVersion,
    payloadHash: aged.payloadHash,
  }, aged.overallStatus === "failed" ? 503 : 200, originHeader);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/monitor") {
      return handleMonitor(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/monitor/health") {
      return handleHealth(request, env);
    }

    if (request.method === "GET" && url.pathname === "/file") {
      const path = url.searchParams.get("path") || "requirements.json";
      if (!ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);
      try {
        const { sha, content } = await getFile(env, path, env.GITHUB_BRANCH);
        return json({ sha, content: JSON.parse(content) }, 200, origin);
      } catch (err) {
        return json({ error: err.message }, 502, origin);
      }
    }

    if (request.method === "POST" && url.pathname === "/commit") {
      if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401, origin);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: "invalid JSON body" }, 400, origin); }

      const { path, message, content } = body;
      if (!path || !ALLOWED_PATHS.has(path)) return json({ error: "path not allowed" }, 400, origin);
      if (content === undefined) return json({ error: "missing content" }, 400, origin);

      const newContentStr = JSON.stringify(content, null, 2) + "\n";

      try {
        const { sha } = await getFile(env, path, env.GITHUB_BRANCH);
        const commit = await putFile(env, path, env.GITHUB_BRANCH, message || "Admin edit via regintel-admin-proxy", newContentStr, sha);
        return json({
          ok: true,
          commitSha: commit.commit && commit.commit.sha,
          commitUrl: commit.commit && commit.commit.html_url,
        }, 200, origin);
      } catch (err) {
        if (err.status === 409) {
          return json({ error: "conflict — the file changed since you loaded it; reload and try again" }, 409, origin);
        }
        return json({ error: err.message }, 502, origin);
      }
    }

    return json({ error: "not found" }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    const origin = env.MONITOR_PUBLIC_ORIGIN || "https://regintel-admin-proxy.regintel.workers.dev";
    ctx.waitUntil(refreshMonitorCache(env, origin).then((aged) => {
      console.log(JSON.stringify({
        level: "info",
        event: "scheduled_ingest",
        overallStatus: aged.overallStatus,
        items: (aged.items || []).length,
        generatedAt: aged.generatedAt,
      }));
    }).catch((err) => {
      console.log(JSON.stringify({
        level: "error",
        event: "scheduled_ingest_failed",
        error: String(err && err.message || err).replace(/https?:\/\/[^\s]+/gi, "[url]"),
      }));
    }));
  },
};
