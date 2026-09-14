import { MAX_ITEMS_PER_SOURCE } from "./config.js";
import { classifyRelevance } from "./relevance.js";
import { sanitizeFeedRecord, sanitizeFeedText } from "./text.js";

export function canonicalizeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== "https:") return null;
    u.hash = "";
    const drop = [];
    u.searchParams.forEach((_, key) => {
      if (/^utm_/i.test(key) || key === "fbclid") drop.push(key);
    });
    drop.forEach((key) => u.searchParams.delete(key));
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const search = u.searchParams.toString();
    return `${u.origin}${path}${search ? `?${search}` : ""}`;
  } catch {
    return null;
  }
}

export function parseLooseDate(value) {
  if (value == null || value === "") return { isoDate: "", valid: false, missing: true };
  const raw = String(value).trim();
  if (!raw) return { isoDate: "", valid: false, missing: true };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return { isoDate: "", valid: false, missing: false, invalid: true };
    }
    return { isoDate: raw, valid: true, missing: false };
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { isoDate: "", valid: false, missing: false, invalid: true };
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return { isoDate: "", valid: false, missing: false, invalid: true };
  return { isoDate: dt.toISOString().slice(0, 10), valid: true, missing: false };
}

export function parseEffectiveDate(text, explicit) {
  if (explicit) {
    const parsed = parseLooseDate(explicit);
    if (parsed.valid) return parsed.isoDate;
  }
  const m = String(text || "").match(/effective(?:\s+date)?(?:\s*(?:on|of|:))?\s+(\w+\s+\d{1,2},\s+\d{4})/i);
  if (!m) return "";
  const parsed = parseLooseDate(m[1]);
  return parsed.valid ? parsed.isoDate : "";
}

export function parseCitation(raw, url) {
  const blob = `${raw.citation || ""} ${raw.title || ""} ${raw.snippet || ""}`;
  const fr = blob.match(/\b(\d{1,3})\s+FR\s+(\d{1,6})\b/i);
  const docFromUrl = String(url || "").match(/\/documents\/\d{4}\/\d{2}\/\d{2}\/(\d{4}-\d+)\b/);
  const pkg = String(url || "").match(/\/app\/details\/(FR-[^/?#]+)/i);
  return {
    citation: raw.citation || (fr ? `${fr[1]} FR ${fr[2]}` : ""),
    documentNumber: raw.documentNumber || (docFromUrl ? docFromUrl[1] : "") || (pkg ? pkg[1] : ""),
  };
}

export function parseDocumentType(raw) {
  const t = `${raw.documentType || ""} ${raw.title || ""} ${raw.snippet || ""}`.toLowerCase();
  if (/\bproposed rule\b/.test(t) || /\bprorule\b/.test(t)) {
    return { documentType: "proposed rule", ruleStatus: "proposed" };
  }
  if (/\bfinal rule\b/.test(t) || t.includes("rule") && !/\bproposed\b/.test(t) && raw.documentType) {
    if (String(raw.documentType).toLowerCase() === "rule") {
      return { documentType: "final rule", ruleStatus: "final" };
    }
  }
  if (/\bfinal rule\b/.test(t)) return { documentType: "final rule", ruleStatus: "final" };
  if (/\bnotice\b/.test(t)) return { documentType: "notice", ruleStatus: "" };
  return { documentType: raw.documentType || "", ruleStatus: "" };
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function dedupeKeyFor(item) {
  if (item.documentNumber) return `doc:${String(item.documentNumber).toLowerCase()}`;
  if (item.citation) return `cite:${String(item.citation).toLowerCase()}`;
  if (item.sourceUrl) return `url:${item.sourceUrl.toLowerCase()}`;
  return `hash:${item.contentHash || item.title}`;
}

export async function normalizeRawItems(rawItems, source, retrievedAt) {
  const included = [];
  const excluded = [];
  const unsafe = [];
  const invalidDates = [];
  const slice = rawItems.slice(0, MAX_ITEMS_PER_SOURCE);

  for (const incoming of slice) {
    const raw = sanitizeFeedRecord(incoming);
    const sourceUrl = canonicalizeUrl(raw.link);
    if (raw.link && !sourceUrl) {
      unsafe.push({
        title: raw.title || "",
        sourceId: source.id,
        source: source.title,
        url: String(raw.link),
        reason: "URL is not https or is malformed",
      });
      continue;
    }
    const pub = parseLooseDate(raw.published);
    if (raw.published && !pub.valid) invalidDates.push({ title: raw.title, sourceId: source.id, value: raw.published });
    const cites = parseCitation(raw, sourceUrl || raw.link);
    const types = parseDocumentType(raw);
    const effectiveDate = parseEffectiveDate(`${raw.title || ""} ${raw.snippet || ""}`, raw.effectiveDate);
    const lastMod = parseLooseDate(raw.lastModified);
    const relevance = classifyRelevance(raw, source);
    const contentHash = await sha256Hex([
      raw.title || "",
      sourceUrl || "",
      cites.documentNumber || "",
      pub.isoDate,
    ].join("|"));
    const item = {
      title: sanitizeFeedText(raw.title || "").trim(),
      source: sanitizeFeedText(source.title),
      sourceId: source.id,
      sourceUrl: sourceUrl || "",
      queryLabel: sanitizeFeedText(source.queryLabel || source.title),
      citation: cites.citation,
      documentNumber: cites.documentNumber,
      agency: sanitizeFeedText(raw.agency || source.agency || ""),
      documentType: types.documentType,
      ruleStatus: types.ruleStatus,
      publicationDate: pub.valid ? pub.isoDate : "",
      effectiveDate,
      applicability: relevance.applicability,
      retrievedAt,
      lastModified: lastMod.valid ? lastMod.isoDate : "",
      relevance: relevance.classification,
      relevanceReason: sanitizeFeedText(relevance.reasons.join(" | ")),
      relevanceScore: relevance.score,
      contentHash,
      folder: source.folder,
      snippet: sanitizeFeedText(String(raw.snippet || "")).slice(0, 400),
    };
    item.dedupeKey = dedupeKeyFor(item);
    if (!item.title) continue;
    if (!relevance.include) {
      excluded.push({
        title: item.title,
        sourceId: source.id,
        source: sanitizeFeedText(source.title),
        queryLabel: item.queryLabel,
        sourceUrl: item.sourceUrl,
        classification: item.relevance,
        reasons: relevance.reasons.map((reason) => sanitizeFeedText(reason)),
        exclusionCode: relevance.exclusionCode || "excluded",
      });
      continue;
    }
    included.push(item);
  }

  return { included, excluded, unsafe, invalidDates };
}

export function dedupeItems(items) {
  const seen = new Map();
  const kept = [];
  const duplicates = [];
  for (const item of items) {
    const key = item.dedupeKey;
    if (seen.has(key)) {
      duplicates.push({
        title: item.title,
        sourceId: item.sourceId,
        duplicateOf: seen.get(key),
        dedupeKey: key,
      });
      continue;
    }
    seen.set(key, item.sourceId);
    kept.push(item);
  }
  return { items: kept, duplicates };
}
