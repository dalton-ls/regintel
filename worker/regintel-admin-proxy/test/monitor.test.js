import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestMonitor, agePayload, emptyFailedPayload, validatePayload } from "../src/monitor/ingest.js";
import { classifyRelevance } from "../src/monitor/relevance.js";
import { parseEffectiveDate, parseLooseDate, canonicalizeUrl, normalizeRawItems, dedupeItems } from "../src/monitor/normalize.js";
import { parseRssItems, parseFrApi } from "../src/monitor/parse.js";
import { groupItemsByWeek, zonedYmd, sundayOfYmd } from "../src/monitor/weeks.js";
import { healthViewModel } from "../src/monitor/health.js";
import { SCHEMA_VERSION } from "../src/monitor/config.js";

const SNF_RULE = {
  title: "Medicare Program; Prospective Payment System and Consolidated Billing for Skilled Nursing Facilities",
  type: "Rule",
  abstract: "Updates the SNF PPS for FY 2027. This final rule is effective October 1, 2026.",
  document_number: "2026-12345",
  html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-12345/snf-pps",
  publication_date: "2026-08-01",
  effective_on: "2026-10-01",
  agencies: [{ name: "Centers for Medicare & Medicaid Services" }],
  citation: "91 FR 11111",
};

const IPPS_RULE = {
  title: "Medicare Program; Hospital Inpatient Prospective Payment Systems for Acute Care Hospitals",
  type: "Rule",
  abstract: "Updates the IPPS for acute care hospitals.",
  document_number: "2026-99999",
  html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-99999/ipps",
  publication_date: "2026-08-01",
  agencies: [{ name: "Centers for Medicare & Medicaid Services" }],
  citation: "91 FR 22222",
};

const HOSPICE_RULE = {
  title: "Medicare Program; FY 2027 Hospice Wage Index and Payment Rate Update",
  type: "Rule",
  abstract: "Updates hospice payment rates.",
  document_number: "2026-88888",
  html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-88888/hospice",
  publication_date: "2026-08-01",
  agencies: [{ name: "CMS" }],
  citation: "91 FR 33333",
};

const IRF_RULE = {
  title: "Medicare Program; Inpatient Rehabilitation Facility Prospective Payment System",
  type: "Proposed Rule",
  abstract: "IRF PPS proposed updates.",
  document_number: "2026-77777",
  html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-77777/irf",
  publication_date: "2026-08-01",
};

const IPF_RULE = {
  title: "Medicare Program; Inpatient Psychiatric Facility Prospective Payment System",
  type: "Rule",
  abstract: "IPF PPS updates.",
  document_number: "2026-66666",
  html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-66666/ipf",
  publication_date: "2026-08-01",
};

const FR_SNF = {
  id: "fr-snf-pps",
  folder: "official",
  title: "Federal Register — HHS/CMS — SNF PPS rules",
  queryLabel: "SNF PPS",
  agency: "HHS / CMS",
  kind: "fr-api",
  url: "https://www.federalregister.gov/api/v1/documents.json?snf-pps",
};

const FR_OTHER = {
  id: "fr-snf",
  folder: "official",
  title: "Federal Register — HHS/CMS — SNF rules",
  queryLabel: "SNF",
  agency: "HHS / CMS",
  kind: "fr-api",
  url: "https://www.federalregister.gov/api/v1/documents.json?snf",
};

const RSS = {
  id: "snn",
  folder: "context",
  title: "Skilled Nursing News",
  queryLabel: "SNN",
  kind: "rss",
  url: "https://skillednursingnews.com/feed/",
};

const RSS_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>SNF staffing rule explained</title>
    <link>https://skillednursingnews.com/staffing</link>
    <pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate>
    <description>Context for skilled nursing facilities.</description>
  </item>
</channel></rss>`;

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function textRes(text, status = 200) {
  return new Response(text, { status });
}

function fetchMap(routes) {
  return async (url) => {
    const key = String(url);
    for (const [needle, impl] of Object.entries(routes)) {
      if (key.includes(needle)) {
        return typeof impl === "function" ? impl(url) : impl;
      }
    }
    return new Response("missing mock " + key, { status: 404 });
  };
}

test("feed success returns versioned payload and SNF item metadata", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF],
    fetchImpl: fetchMap({ "snf-pps": jsonRes({ results: [SNF_RULE] }) }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.schemaVersion, SCHEMA_VERSION);
  assert.equal(payload.overallStatus, "ok");
  assert.equal(payload.stale, false);
  assert.equal(payload.items.length, 1);
  const item = payload.items[0];
  assert.equal(item.citation, "91 FR 11111");
  assert.equal(item.agency.includes("Medicare"), true);
  assert.equal(item.ruleStatus, "final");
  assert.equal(item.publicationDate, "2026-08-01");
  assert.equal(item.effectiveDate, "2026-10-01");
  assert.equal(item.relevance, "direct_snf");
  assert.equal(item.documentNumber, "2026-12345");
  assert.equal(item.sourceUrl.startsWith("https://"), true);
  assert.ok(payload.payloadHash.length >= 32);
  assert.equal(validatePayload(payload).ok, true);
  assert.equal(payload.sources[0].ok, true);
  assert.equal(payload.sources[0].status, "ok");
  assert.ok(payload.sources[0].lastSuccessAt);
});

test("feed timeout is a visible source failure, not empty success", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF],
    timeoutMs: 30,
    fetchImpl: () => new Promise(() => {}),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.overallStatus, "failed");
  assert.equal(payload.sources[0].ok, false);
  assert.equal(payload.sources[0].status, "timeout");
  assert.match(payload.sources[0].error, /timeout/i);
  assert.equal(payload.items.length, 0);
});

test("malformed XML fails the RSS source", async () => {
  const payload = await ingestMonitor({
    feeds: [RSS],
    fetchImpl: fetchMap({ "skillednursingnews.com/feed": textRes("<html>not a feed</html>") }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.sources[0].ok, false);
  assert.equal(payload.sources[0].status, "malformed");
});

test("malformed JSON fails the FR source", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF],
    fetchImpl: fetchMap({ "snf-pps": jsonRes({ nope: true }) }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.sources[0].status, "malformed");
  assert.equal(payload.overallStatus, "failed");
});

test("partial source failure does not look complete", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF, RSS],
    fetchImpl: fetchMap({
      "snf-pps": jsonRes({ results: [SNF_RULE] }),
      "skillednursingnews.com/feed": textRes("nope", 500),
    }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.overallStatus, "partial");
  assert.equal(payload.diagnostics.failedSources, 1);
  assert.equal(payload.items.length, 1);
  const health = healthViewModel(payload);
  assert.equal(health.state, "partial");
  assert.match(health.warning, /failed/i);
  assert.match(health.warning, /Incomplete/i);
});

test("completely unavailable ingestion", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF, RSS],
    fetchImpl: () => new Response("down", { status: 503 }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.overallStatus, "failed");
  assert.equal(payload.items.length, 0);
  assert.equal(payload.sources.every((s) => !s.ok), true);
  const failed = emptyFailedPayload("2026-08-24T15:00:00.000Z", "ingestion unavailable", payload.sources);
  assert.equal(failed.overallStatus, "failed");
  assert.equal(validatePayload({ ...failed, payloadHash: "a".repeat(64), staleAfterSeconds: 1 }).ok, true);
});

test("stale cache is flagged from generatedAt", () => {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-08-24T08:00:00.000Z",
    overallStatus: "ok",
    staleAfterSeconds: 6 * 3600,
    cacheAgeSeconds: 0,
    stale: false,
    sources: [],
    items: [],
    diagnostics: {},
    payloadHash: "b".repeat(64),
    timezone: "America/New_York",
    displayWeekLimit: 5,
  };
  const aged = agePayload(payload, new Date("2026-08-24T15:30:00.000Z"));
  assert.equal(aged.stale, true);
  assert.equal(aged.overallStatus, "stale");
  assert.ok(aged.cacheAgeSeconds > 6 * 3600);
  assert.match(healthViewModel(aged).warning, /older than the freshness window/i);
});

test("empty feed is success with no items, not a failure", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF],
    fetchImpl: fetchMap({ "snf-pps": jsonRes({ results: [] }) }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.sources[0].ok, true);
  assert.equal(payload.sources[0].status, "empty");
  assert.equal(payload.overallStatus, "empty");
  assert.equal(payload.items.length, 0);
  assert.match(healthViewModel(payload).warning, /no in-scope items/i);
});

test("duplicate document numbers collapse to one item", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF, FR_OTHER],
    fetchImpl: fetchMap({
      "snf-pps": jsonRes({ results: [SNF_RULE] }),
      "documents.json?snf": jsonRes({ results: [{ ...SNF_RULE, html_url: "https://www.federalregister.gov/documents/2026/08/01/2026-12345/copy" }] }),
    }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.diagnostics.duplicatesDropped, 1);
});

test("missing dates stay visible as undated rather than dropped", async () => {
  const rss = `<?xml version="1.0"?><rss><channel><item>
    <title>Undated skilled nursing bulletin</title>
    <link>https://skillednursingnews.com/undated</link>
    <description>SNF note</description>
  </item></channel></rss>`;
  const payload = await ingestMonitor({
    feeds: [RSS],
    fetchImpl: fetchMap({ "skillednursingnews.com/feed": textRes(rss) }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.items[0].publicationDate, "");
  const grouped = groupItemsByWeek(payload.items, new Date("2026-08-24T15:00:00Z"));
  const undated = grouped.weeks.find((w) => w.key === "undated");
  assert.equal(undated.items.length, 1);
});

test("invalid dates are not treated as publication dates", async () => {
  assert.equal(parseLooseDate("2026-99-99").valid, false);
  assert.equal(parseLooseDate("not-a-date").invalid, true);
  const retrievedAt = "2026-08-24T15:00:00.000Z";
  const { included } = await normalizeRawItems([{
    title: "Skilled nursing facility memo",
    link: "https://www.federalregister.gov/documents/2026/08/01/2026-00000/memo",
    published: "not-a-date",
    snippet: "skilled nursing facility",
  }], FR_SNF, retrievedAt);
  assert.equal(included[0].publicationDate, "");
});

test("unsafe URLs are rejected", async () => {
  assert.equal(canonicalizeUrl("javascript:alert(1)"), null);
  assert.equal(canonicalizeUrl("http://federalregister.gov/x"), null);
  const { included, unsafe } = await normalizeRawItems([{
    title: "Skilled nursing facility memo",
    link: "javascript:alert(1)",
    published: "2026-08-01",
    snippet: "SNF",
  }], FR_SNF, "2026-08-24T15:00:00.000Z");
  assert.equal(included.length, 0);
  assert.equal(unsafe.length, 1);
});

test("off-topic hospital, hospice, IRF, and IPF results are excluded from Official", async () => {
  const payload = await ingestMonitor({
    feeds: [FR_SNF],
    fetchImpl: fetchMap({
      "snf-pps": jsonRes({ results: [IPPS_RULE, HOSPICE_RULE, IRF_RULE, IPF_RULE, SNF_RULE] }),
    }),
    now: () => new Date("2026-08-24T15:00:00Z"),
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].documentNumber, "2026-12345");
  const codes = payload.excluded.map((x) => x.exclusionCode);
  assert.ok(codes.includes("hospital_ipps"));
  assert.ok(codes.includes("hospice"));
  assert.ok(codes.includes("irf"));
  assert.ok(codes.includes("ipf"));
  assert.equal(payload.items[0].relevance, "direct_snf");
});

test("correct SNF relevance classification including cross-setting", () => {
  const source = { id: "fr-snf", folder: "official", title: "FR" };
  const snf = classifyRelevance({ title: "Updates for skilled nursing facilities and 42 CFR 483", snippet: "" }, source);
  assert.equal(snf.classification, "direct_snf");
  assert.equal(snf.include, true);
  const ltc = classifyRelevance({ title: "Long-term care facility staffing guidance", snippet: "" }, source);
  assert.equal(ltc.classification, "long_term_care");
  const cross = classifyRelevance({
    title: "Medicare payment updates for skilled nursing facilities and hospice",
    snippet: "SNF PPS and hospice wage index",
  }, source);
  assert.equal(cross.classification, "cross_setting");
  assert.equal(cross.include, true);
  assert.ok(cross.reasons.join(" ").includes("hospice"));
  assert.equal(typeof cross.score, "number");
});

test("effective-date parsing from explicit field and prose", () => {
  assert.equal(parseEffectiveDate("", "2026-10-01"), "2026-10-01");
  assert.equal(parseEffectiveDate("This final rule is effective October 1, 2026."), "2026-10-01");
});

test("week grouping uses America/New_York and keeps this week plus Date not stated", () => {
  const now = new Date("2026-08-24T15:00:00Z");
  assert.equal(zonedYmd(new Date("2026-08-23T03:30:00Z"), "America/New_York"), "2026-08-22");
  assert.equal(sundayOfYmd("2026-08-24"), "2026-08-23");
  const items = [
    { title: "A", publicationDate: "2026-08-24", source: "a" },
    { title: "B", publicationDate: "2026-08-10", source: "a" },
    { title: "C", publicationDate: "2026-07-20", source: "a" },
    { title: "D", publicationDate: "2026-07-06", source: "a" },
    { title: "E", publicationDate: "2026-06-22", source: "a" },
    { title: "F", publicationDate: "2026-06-08", source: "a" },
    { title: "G", publicationDate: "", source: "a" },
  ];
  const grouped = groupItemsByWeek(items, now, "America/New_York", 5);
  assert.equal(grouped.timezone, "America/New_York");
  assert.equal(grouped.displayWeekLimit, 5);
  assert.ok(grouped.hiddenOlderCount >= 1);
  assert.equal(grouped.weeks[0].badge, "this-week");
  assert.equal(grouped.weeks[0].items[0].title, "A");
  const undated = grouped.weeks.find((w) => w.key === "undated");
  assert.equal(undated.label, "Date not stated");
  assert.equal(undated.items[0].title, "G");
});

test("source-health warning rendering for loading, partial, stale, and failed", () => {
  assert.equal(healthViewModel(null).state, "loading");
  assert.match(healthViewModel(null).title, /not yet loaded/i);
  const partial = healthViewModel({
    overallStatus: "partial",
    stale: false,
    sources: [
      { ok: true, status: "ok" },
      { ok: false, status: "failed", error: "HTTP 500" },
    ],
  });
  assert.match(partial.warning, /Incomplete/);
  const failed = healthViewModel({ overallStatus: "failed", stale: false, sources: [{ ok: false, status: "failed" }] });
  assert.match(failed.warning, /unavailable/i);
});

test("FR parser extracts structured fields", () => {
  const rows = parseFrApi({ results: [SNF_RULE] }, FR_SNF);
  assert.equal(rows[0].documentNumber, "2026-12345");
  assert.equal(rows[0].effectiveDate, "2026-10-01");
});

test("RSS parser requires feed markup", () => {
  assert.throws(() => parseRssItems("hello", RSS), /malformed/i);
  const items = parseRssItems(RSS_XML, RSS);
  assert.equal(items[0].title.includes("staffing"), true);
});

test("dedupe prefers document number over URL", async () => {
  const a = (await normalizeRawItems([{
    title: "Skilled nursing facility PPS",
    link: "https://www.federalregister.gov/documents/2026/08/01/2026-12345/one",
    published: "2026-08-01",
    documentNumber: "2026-12345",
    snippet: "SNF PPS",
  }], FR_SNF, "2026-08-24T15:00:00.000Z")).included[0];
  const b = (await normalizeRawItems([{
    title: "Skilled nursing facility PPS copy",
    link: "https://www.federalregister.gov/documents/2026/08/01/2026-12345/two",
    published: "2026-08-01",
    documentNumber: "2026-12345",
    snippet: "SNF PPS",
  }], FR_OTHER, "2026-08-24T15:00:00.000Z")).included[0];
  const { items, duplicates } = dedupeItems([a, b]);
  assert.equal(items.length, 1);
  assert.equal(duplicates.length, 1);
});
