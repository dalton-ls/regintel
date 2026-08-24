import {
  CACHE_CONTROL,
  DISPLAY_WEEK_LIMIT,
  FETCH_HEADERS,
  FETCH_TIMEOUT_MS,
  MONITOR_FEEDS,
  SCHEMA_VERSION,
  STALE_AFTER_SECONDS,
  TIMEZONE,
} from "./config.js";
import { parseFrApi, parseGovInfo, parseRssItems } from "./parse.js";
import { dedupeItems, normalizeRawItems, sha256Hex } from "./normalize.js";
import { sortItems } from "./weeks.js";
import { emptyFailedPayload, validatePayload } from "./schema.js";

export { MONITOR_FEEDS, SCHEMA_VERSION, STALE_AFTER_SECONDS, TIMEZONE, DISPLAY_WEEK_LIMIT };
export { validatePayload, emptyFailedPayload };

function logEvent(log, level, event, fields) {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  if (log) log(line);
  else console.log(JSON.stringify(line));
}

export async function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const timeoutError = () => {
    const timeout = new Error("timeout");
    timeout.code = "timeout";
    return timeout;
  };
  try {
    const pending = Promise.resolve(fetchImpl(url, { ...init, signal: ctrl.signal }));
    const aborted = new Promise((_, reject) => {
      ctrl.signal.addEventListener("abort", () => reject(timeoutError()));
    });
    return await Promise.race([pending, aborted]);
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20 || err.code === "timeout")) {
      throw timeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err && err.code === "malformed") throw err;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, 250 * (2 ** i)));
    }
  }
  throw last;
}

function sourceErrorStatus(err) {
  if (err && err.code === "timeout") return "timeout";
  if (err && err.code === "malformed") return "malformed";
  return "failed";
}

function safeErrorMessage(err) {
  const msg = String((err && err.message) || err || "unknown error");
  return msg.replace(/https?:\/\/[^\s]+/gi, "[url]").slice(0, 240);
}

async function fetchRawItems(feed, fetchImpl, timeoutMs) {
  if (feed.kind === "fr-api") {
    const res = await fetchWithTimeout(feed.url, { headers: FETCH_HEADERS }, timeoutMs, fetchImpl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return parseFrApi(payload, feed);
  }
  if (feed.kind === "govinfo-search") {
    const res = await fetchWithTimeout("https://www.govinfo.gov/wssearch/search", {
      method: "POST",
      headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ query: feed.query, offset: 0, pageSize: 20, historical: false }),
    }, timeoutMs, fetchImpl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return parseGovInfo(payload, feed);
  }
  const res = await fetchWithTimeout(feed.url, { headers: FETCH_HEADERS }, timeoutMs, fetchImpl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRssItems(await res.text(), feed);
}

export async function ingestMonitor({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log,
  timeoutMs = FETCH_TIMEOUT_MS,
  feeds = MONITOR_FEEDS,
} = {}) {
  const retrievedAt = now().toISOString();
  const sources = [];
  const included = [];
  const excluded = [];
  const unsafe = [];
  const invalidDates = [];

  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const started = Date.now();
    const raw = await withRetry(() => fetchRawItems(feed, fetchImpl, timeoutMs));
    const normalized = await normalizeRawItems(raw, feed, retrievedAt);
    return { feed, normalized, durationMs: Date.now() - started };
  }));

  for (let i = 0; i < settled.length; i += 1) {
    const feed = feeds[i];
    const result = settled[i];
    if (result.status === "fulfilled") {
      const { normalized, durationMs } = result.value;
      included.push(...normalized.included);
      excluded.push(...normalized.excluded);
      unsafe.push(...normalized.unsafe);
      invalidDates.push(...normalized.invalidDates);
      const itemCount = normalized.included.length;
      sources.push({
        id: feed.id,
        title: feed.title,
        queryLabel: feed.queryLabel || feed.title,
        folder: feed.folder,
        ok: true,
        status: itemCount ? "ok" : "empty",
        itemCount,
        fetchedCount: itemCount + normalized.excluded.length + normalized.unsafe.length,
        excludedCount: normalized.excluded.length,
        lastSuccessAt: retrievedAt,
        error: "",
        durationMs,
      });
      logEvent(log, "info", "source_ok", { sourceId: feed.id, itemCount, status: itemCount ? "ok" : "empty" });
    } else {
      const status = sourceErrorStatus(result.reason);
      sources.push({
        id: feed.id,
        title: feed.title,
        queryLabel: feed.queryLabel || feed.title,
        folder: feed.folder,
        ok: false,
        status,
        itemCount: 0,
        fetchedCount: 0,
        excludedCount: 0,
        lastSuccessAt: "",
        error: safeErrorMessage(result.reason),
        durationMs: 0,
      });
      logEvent(log, "error", "source_failed", { sourceId: feed.id, status, error: safeErrorMessage(result.reason) });
    }
  }

  const { items: unique, duplicates } = dedupeItems(included);
  const items = sortItems(unique, "desc");
  const failed = sources.filter((s) => !s.ok);
  const okSources = sources.filter((s) => s.ok);
  let overallStatus = "ok";
  if (!okSources.length) overallStatus = "failed";
  else if (failed.length) overallStatus = "partial";
  else if (!items.length) overallStatus = "empty";

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: retrievedAt,
    refreshedAt: retrievedAt,
    cacheAgeSeconds: 0,
    stale: false,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    timezone: TIMEZONE,
    displayWeekLimit: DISPLAY_WEEK_LIMIT,
    overallStatus,
    lastSuccessAt: okSources.length ? retrievedAt : "",
    sources,
    items,
    excluded: excluded.slice(0, 80),
    diagnostics: {
      included: items.length,
      excluded: excluded.length,
      duplicatesDropped: duplicates.length,
      undated: items.filter((it) => !it.publicationDate).length,
      unsafeUrls: unsafe.length,
      invalidDates: invalidDates.length,
      failedSources: failed.length,
      duplicates: duplicates.slice(0, 40),
      unsafe: unsafe.slice(0, 40),
      invalidDateSamples: invalidDates.slice(0, 20),
    },
  };
  payload.payloadHash = await sha256Hex(JSON.stringify({
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    items: payload.items,
    sources: payload.sources.map((s) => ({ id: s.id, status: s.status, itemCount: s.itemCount, ok: s.ok })),
    excludedCount: excluded.length,
  }));

  const check = validatePayload(payload);
  if (!check.ok) {
    logEvent(log, "error", "payload_invalid", { error: check.error });
    throw new Error(`payload failed schema validation: ${check.error}`);
  }
  logEvent(log, "info", "ingest_complete", {
    overallStatus,
    items: items.length,
    failedSources: failed.length,
  });
  return payload;
}

export function agePayload(payload, now = new Date()) {
  const generated = Date.parse(payload.generatedAt || 0);
  const cacheAgeSeconds = Number.isNaN(generated) ? 0 : Math.max(0, Math.round((now.getTime() - generated) / 1000));
  const stale = cacheAgeSeconds > (payload.staleAfterSeconds || STALE_AFTER_SECONDS);
  let overallStatus = payload.overallStatus;
  if (stale && overallStatus === "ok") overallStatus = "stale";
  else if (stale && overallStatus === "partial") overallStatus = "partial";
  return { ...payload, cacheAgeSeconds, stale, overallStatus: stale && overallStatus === "ok" ? "stale" : overallStatus };
}

export function monitorCacheKey(origin) {
  return new Request(new URL("/monitor", origin), { method: "GET" });
}

export async function readCachedPayload(cache, origin) {
  if (!cache) return null;
  const cached = await cache.match(monitorCacheKey(origin));
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return null;
  }
}

export function jsonResponse(payload, origin, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": CACHE_CONTROL,
    "X-QM-Schema": SCHEMA_VERSION,
    "X-QM-Generated-At": payload.generatedAt || "",
    "X-QM-Status": payload.overallStatus || "",
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(payload), { status: payload.overallStatus === "failed" && !payload.items.length ? 503 : 200, headers });
}
