/**
 * regintel-quality-monitor
 *
 * Public Quality Monitor API. Independent of regintel-admin-proxy so
 * admin-proxy deploys cannot 404 this hostname. GET /monitor always
 * returns CORS JSON: last-good KV first, live ingest in the background.
 */

import {
  agePayload,
  emptyFailedPayload,
  ingestMonitorWithBudget,
  jsonResponse,
  markAsFallback,
} from "../../regintel-admin-proxy/src/monitor/ingest.js";
import { corsHeaders } from "../../regintel-admin-proxy/src/monitor/cors.js";

const KV_KEY = "qm-monitor-v1";
const MIN_REFRESH_MS = 45 * 1000;

function logMonitor(level, event, fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      ...corsHeaders(origin),
    },
  });
}

async function readKv(env) {
  if (!env.MONITOR_KV) return null;
  try {
    return await env.MONITOR_KV.get(KV_KEY, "json");
  } catch (err) {
    logMonitor("error", "kv_read_failed", { error: String(err && err.message || err) });
    return null;
  }
}

async function writeKv(env, payload) {
  if (!env.MONITOR_KV) return;
  await env.MONITOR_KV.put(KV_KEY, JSON.stringify(payload));
}

function needsRefresh(payload, now) {
  const generated = Date.parse(payload && payload.generatedAt || 0);
  if (Number.isNaN(generated)) return true;
  return now.getTime() - generated > MIN_REFRESH_MS;
}

async function refreshIntoKv(env) {
  const liveAttemptAt = new Date().toISOString();
  logMonitor("info", "ingest_start", { liveAttemptAt });
  try {
    const fresh = await ingestMonitorWithBudget();
    const aged = agePayload(fresh, new Date());
    aged.liveAttemptAt = liveAttemptAt;
    const liveFailed = aged.overallStatus === "failed" && !(aged.items || []).length;
    if (liveFailed) {
      const prev = await readKv(env);
      if (prev) {
        const fallback = markAsFallback(agePayload(prev, new Date()), "live ingest returned no items", liveAttemptAt);
        await writeKv(env, fallback);
        logMonitor("info", "ingest_stored_fallback", { reason: fallback.fallbackReason });
        return fallback;
      }
    }
    aged.fallback = false;
    aged.fallbackReason = "";
    aged.fallbackAt = "";
    await writeKv(env, aged);
    logMonitor("info", "ingest_stored_live", {
      overallStatus: aged.overallStatus,
      items: (aged.items || []).length,
    });
    return aged;
  } catch (err) {
    const reason = String(err && err.message || err).replace(/https?:\/\/[^\s]+/gi, "[url]");
    logMonitor("error", "ingest_failed", { error: reason });
    const prev = await readKv(env);
    if (prev) {
      const fallback = markAsFallback(agePayload(prev, new Date()), reason, liveAttemptAt);
      await writeKv(env, fallback);
      return fallback;
    }
    const failed = emptyFailedPayload(liveAttemptAt, reason);
    failed.liveAttemptAt = liveAttemptAt;
    await writeKv(env, failed);
    return failed;
  }
}

async function handleMonitor(request, env, ctx) {
  const origin = request.headers.get("Origin");
  const now = new Date();
  const stored = await readKv(env);

  if (stored) {
    const aged = agePayload(stored, now);
    if (needsRefresh(stored, now) && ctx && ctx.waitUntil) {
      ctx.waitUntil(refreshIntoKv(env).catch((err) => {
        logMonitor("error", "background_ingest_failed", { error: String(err && err.message || err) });
      }));
    }
    return jsonResponse(aged, origin);
  }

  const first = await refreshIntoKv(env);
  return jsonResponse(agePayload(first, now), origin);
}

async function handleHealth(request, env) {
  const origin = request.headers.get("Origin");
  const stored = await readKv(env);
  if (!stored) {
    return json({ ok: false, status: "not_loaded", schemaVersion: "qm-monitor-v1" }, 200, origin);
  }
  const aged = agePayload(stored, new Date());
  return json({
    ok: aged.overallStatus !== "failed" || !!(aged.items && aged.items.length),
    overallStatus: aged.overallStatus,
    generatedAt: aged.generatedAt,
    stale: aged.stale,
    fallback: !!aged.fallback,
    itemCount: (aged.items || []).length,
    schemaVersion: aged.schemaVersion,
  }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      if (request.method === "GET" && url.pathname === "/monitor") {
        return handleMonitor(request, env, ctx);
      }
      if (request.method === "GET" && url.pathname === "/monitor/health") {
        return handleHealth(request, env);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (err) {
      logMonitor("error", "worker_exception", {
        path: url.pathname,
        error: String(err && err.message || err).replace(/https?:\/\/[^\s]+/gi, "[url]"),
      });
      const stored = await readKv(env);
      if (stored) {
        return jsonResponse(markAsFallback(agePayload(stored, new Date()), "worker exception", new Date().toISOString()), origin);
      }
      return json({
        error: "worker exception",
        schemaVersion: "qm-monitor-v1",
        overallStatus: "failed",
        generatedAt: new Date().toISOString(),
        stale: false,
        sources: [],
        items: [],
      }, 200, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshIntoKv(env).then((aged) => {
      logMonitor("info", "scheduled_ingest", {
        overallStatus: aged.overallStatus,
        items: (aged.items || []).length,
        generatedAt: aged.generatedAt,
      });
    }).catch((err) => {
      logMonitor("error", "scheduled_ingest_failed", {
        error: String(err && err.message || err).replace(/https?:\/\/[^\s]+/gi, "[url]"),
      });
    }));
  },
};
