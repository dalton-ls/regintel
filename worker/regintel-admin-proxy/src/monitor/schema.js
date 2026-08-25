import { SCHEMA_VERSION } from "./config.js";

const OVERALL = new Set(["ok", "partial", "failed", "stale", "empty"]);
const SOURCE_STATUS = new Set(["ok", "empty", "failed", "timeout", "malformed"]);
const RELEVANCE = new Set(["direct_snf", "long_term_care", "cross_setting", "excluded"]);

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "payload is not an object" };
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `unsupported schemaVersion ${payload.schemaVersion}` };
  }
  if (typeof payload.generatedAt !== "string" || !payload.generatedAt) {
    return { ok: false, error: "missing generatedAt" };
  }
  if (!Array.isArray(payload.sources)) return { ok: false, error: "sources must be an array" };
  if (!Array.isArray(payload.items)) return { ok: false, error: "items must be an array" };
  if (!OVERALL.has(payload.overallStatus)) return { ok: false, error: "invalid overallStatus" };
  if (typeof payload.cacheAgeSeconds !== "number" || payload.cacheAgeSeconds < 0) {
    return { ok: false, error: "invalid cacheAgeSeconds" };
  }
  if (typeof payload.stale !== "boolean") return { ok: false, error: "missing stale flag" };
  if (!payload.diagnostics || typeof payload.diagnostics !== "object") {
    return { ok: false, error: "missing diagnostics" };
  }
  if (typeof payload.payloadHash !== "string" || payload.payloadHash.length < 16) {
    return { ok: false, error: "missing payloadHash" };
  }

  for (const src of payload.sources) {
    if (!src || !src.id || !src.title) return { ok: false, error: "source missing id/title" };
    if (typeof src.ok !== "boolean") return { ok: false, error: `source ${src.id} missing ok` };
    if (!SOURCE_STATUS.has(src.status)) return { ok: false, error: `source ${src.id} invalid status` };
    if (typeof src.itemCount !== "number") return { ok: false, error: `source ${src.id} missing itemCount` };
    if (!src.ok && !src.error) return { ok: false, error: `failed source ${src.id} missing error` };
  }

  for (const item of payload.items) {
    if (!item || !item.title) return { ok: false, error: "item missing title" };
    if (!item.sourceId) return { ok: false, error: "item missing sourceId" };
    if (item.sourceUrl && !String(item.sourceUrl).startsWith("https://")) {
      return { ok: false, error: "item sourceUrl is not https" };
    }
    if (item.relevance && !RELEVANCE.has(item.relevance)) {
      return { ok: false, error: `item has invalid relevance ${item.relevance}` };
    }
    if (item.relevance === "excluded") {
      return { ok: false, error: "excluded items must not appear in items[]" };
    }
  }

  return { ok: true };
}

export function emptyFailedPayload(generatedAt, error, sources) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    refreshedAt: generatedAt,
    cacheAgeSeconds: 0,
    stale: false,
    staleAfterSeconds: 0,
    timezone: "America/New_York",
    displayWeekLimit: 5,
    overallStatus: "failed",
    lastAttemptAt: generatedAt,
    lastSuccessAt: "",
    fallback: false,
    fallbackReason: "",
    fallbackAt: "",
    liveAttemptAt: generatedAt,
    sources: sources || [],
    items: [],
    excluded: [],
    diagnostics: {
      included: 0,
      excluded: 0,
      duplicatesDropped: 0,
      undated: 0,
      unsafeUrls: 0,
      invalidDates: 0,
      failedSources: (sources || []).filter((s) => !s.ok).length,
      error: error || "ingestion unavailable",
    },
    payloadHash: "0".repeat(64),
  };
}
