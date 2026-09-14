import {
  CACHE_CONTROL,
  DISPLAY_WEEK_LIMIT,
  FETCH_HEADERS,
  FETCH_TIMEOUT_MS,
  LIVE_INGEST_BUDGET_MS,
  MONITOR_FEEDS,
  SCHEMA_VERSION,
  SOURCE_CONCURRENCY,
  STALE_AFTER_SECONDS,
  TIMEZONE,
} from "./config.js";
import { parseFrApi, parseGovInfo, parseRssItems } from "./parse.js";
import { dedupeItems, normalizeRawItems, sha256Hex } from "./normalize.js";
import { addDaysYmd, sortItems, sundayOfYmd, zonedYmd } from "./weeks.js";
import { emptyFailedPayload, validatePayload } from "./schema.js";
import { sanitizePayloadStrings } from "./text.js";
import { corsHeaders } from "./cors.js";

export { MONITOR_FEEDS, SCHEMA_VERSION, STALE_AFTER_SECONDS, TIMEZONE, DISPLAY_WEEK_LIMIT };
export { validatePayload, emptyFailedPayload };

function logEvent(log, level, event, fields) {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  if (log) log(line);
  else console.log(JSON.stringify(line));
}

function timeoutError(message = "timeout") {
  const timeout = new Error(message);
  timeout.code = "timeout";
  return timeout;
}

export async function fetchWithTimeout(url, init, timeoutMs, fetchImpl, parentSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onParent = () => ctrl.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      throw timeoutError();
    }
    parentSignal.addEventListener("abort", onParent, { once: true });
  }
  try {
    const pending = Promise.resolve(fetchImpl(url, { ...init, signal: ctrl.signal }));
    const aborted = new Promise((_, reject) => {
      ctrl.signal.addEventListener("abort", () => reject(timeoutError()), { once: true });
    });
    return await Promise.race([pending, aborted]);
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20 || err.code === "timeout")) {
      throw timeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParent);
  }
}

async function withRetry(fn, retries = 0) {
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

async function fetchRawItems(feed, fetchImpl, timeoutMs, signal) {
  if (feed.kind === "fr-api") {
    const res = await fetchWithTimeout(feed.url, { headers: FETCH_HEADERS }, timeoutMs, fetchImpl, signal);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return parseFrApi(payload, feed);
  }
  if (feed.kind === "govinfo-search") {
    const res = await fetchWithTimeout("https://www.govinfo.gov/wssearch/search", {
      method: "POST",
      headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ query: feed.query, offset: 0, pageSize: 20, historical: false }),
    }, timeoutMs, fetchImpl, signal);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return parseGovInfo(payload, feed);
  }
  const res = await fetchWithTimeout(feed.url, { headers: FETCH_HEADERS }, timeoutMs, fetchImpl, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRssItems(await res.text(), feed);
}

export async function ingestMonitor({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log,
  timeoutMs = FETCH_TIMEOUT_MS,
  feeds = MONITOR_FEEDS,
  signal,
  concurrency = SOURCE_CONCURRENCY,
} = {}) {
  const retrievedAt = now().toISOString();
  const todayYmd = zonedYmd(now(), TIMEZONE);
  const weekStartSunday = sundayOfYmd(todayYmd);
  const weekEndSaturday = addDaysYmd(weekStartSunday, 6);
  const sources = [];
  const included = [];
  const excluded = [];
  const unsafe = [];
  const invalidDates = [];
  const settled = new Array(feeds.length);
  let budgetExceeded = false;

  async function runFeed(feed) {
    if (signal && signal.aborted) throw timeoutError("live ingest budget exceeded");
    const started = Date.now();
    try {
      const raw = await withRetry(() => fetchRawItems(feed, fetchImpl, timeoutMs, signal));
      const normalized = await normalizeRawItems(raw, feed, retrievedAt);
      return { feed, normalized, durationMs: Date.now() - started };
    } catch (err) {
      if (err && err.code === "malformed") {
        logEvent(log, "error", "parse_failed", { sourceId: feed.id, error: safeErrorMessage(err) });
      }
      throw err;
    }
  }

  for (let i = 0; i < feeds.length; i += concurrency) {
    if (signal && signal.aborted) {
      budgetExceeded = true;
      for (let j = i; j < feeds.length; j += 1) {
        settled[j] = { status: "rejected", reason: timeoutError("live ingest budget exceeded") };
      }
      logEvent(log, "error", "ingest_budget_exceeded", { completed: i, remaining: feeds.length - i });
      break;
    }
    const batch = feeds.slice(i, i + concurrency).map((feed, offset) => {
      const index = i + offset;
      return runFeed(feed).then(
        (value) => { settled[index] = { status: "fulfilled", value }; },
        (reason) => { settled[index] = { status: "rejected", reason }; },
      );
    });
    await Promise.allSettled(batch);
    if (signal && signal.aborted) budgetExceeded = true;
  }

  for (let i = 0; i < settled.length; i += 1) {
    const feed = feeds[i];
    const result = settled[i] || { status: "rejected", reason: timeoutError("live ingest budget exceeded") };
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
        lastAttemptAt: retrievedAt,
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
        lastAttemptAt: retrievedAt,
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

  const payload = sanitizePayloadStrings({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: retrievedAt,
    refreshedAt: retrievedAt,
    cacheAgeSeconds: 0,
    stale: false,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    timezone: TIMEZONE,
    displayWeekLimit: DISPLAY_WEEK_LIMIT,
    weekBoundary: {
      timezone: TIMEZONE,
      todayYmd,
      weekStartSunday,
      weekEndSaturday,
      cadence: "Sunday-Saturday",
    },
    overallStatus,
    lastAttemptAt: retrievedAt,
    lastSuccessAt: okSources.length ? retrievedAt : "",
    fallback: false,
    fallbackReason: "",
    fallbackAt: "",
    liveAttemptAt: retrievedAt,
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
      budgetExceeded,
      duplicates: duplicates.slice(0, 40),
      unsafe: unsafe.slice(0, 40),
      invalidDateSamples: invalidDates.slice(0, 20),
    },
  });
  const cleaned = sanitizePayloadStrings(payload);
  cleaned.payloadHash = await sha256Hex(JSON.stringify({
    schemaVersion: cleaned.schemaVersion,
    generatedAt: cleaned.generatedAt,
    items: cleaned.items,
    sources: cleaned.sources.map((s) => ({ id: s.id, status: s.status, itemCount: s.itemCount, ok: s.ok })),
    excludedCount: excluded.length,
  }));

  const check = validatePayload(cleaned);
  if (!check.ok) {
    logEvent(log, "error", "payload_invalid", { error: check.error });
    throw new Error(`payload failed schema validation: ${check.error}`);
  }
  logEvent(log, "info", "ingest_complete", {
    overallStatus,
    items: items.length,
    failedSources: failed.length,
    budgetExceeded,
  });
  return cleaned;
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
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_CONTROL,
    Pragma: "no-cache",
    "X-QM-Schema": SCHEMA_VERSION,
    "X-QM-Generated-At": payload.generatedAt || "",
    "X-QM-Status": payload.overallStatus || "",
    ...corsHeaders(origin),
    ...extraHeaders,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers,
  });
}

export function markAsFallback(payload, reason, nowIso) {
  const next = { ...payload, diagnostics: { ...(payload.diagnostics || {}) } };
  next.stale = true;
  next.fallback = true;
  next.fallbackReason = reason;
  next.fallbackAt = nowIso;
  next.liveAttemptAt = nowIso;
  next.cacheAgeSeconds = typeof payload.cacheAgeSeconds === "number" ? payload.cacheAgeSeconds : 0;
  if (next.overallStatus === "ok" || next.overallStatus === "empty") next.overallStatus = "stale";
  next.diagnostics.error = reason;
  return next;
}

export async function ingestMonitorWithBudget(opts = {}) {
  const budget = opts.budgetMs || LIVE_INGEST_BUDGET_MS;
  const parent = opts.signal;
  const ctrl = new AbortController();
  const onParent = () => ctrl.abort();
  if (parent) {
    if (parent.aborted) ctrl.abort();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    return await ingestMonitor({ ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (parent) parent.removeEventListener("abort", onParent);
  }
}
