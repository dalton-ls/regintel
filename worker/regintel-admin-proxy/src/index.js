/**
 * regintel-admin-proxy
 *
 * Holds the GitHub write token server-side and lets the RegIntel admin
 * screens (record-editor.html, bulk-apply.html, pending-review.html) commit
 * directly to the repo instead of stashing edits in browser localStorage.
 * This makes the admin tools usable from any browser/computer, since the
 * committed file on GitHub is the single source of truth.
 *
 * Endpoints:
 *   GET  /file?path=requirements.json|wr.json  -> { content, sha }
 *   GET  /monitor                      -> QM RSS + GovInfo search items (public)
 *   POST /commit                       -> { path, message, content } -> commits
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN>  (checked against the ADMIN_TOKEN
 * secret). This is a shared-secret gate for a single trusted operator, not a
 * multi-user auth system. GET /monitor is unauthenticated; it only fetches
 * an allowlisted set of public regulatory feeds.
 */

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
  // The Contents API omits inline content (encoding: "none") for files over
  // 1MB. requirements.json has grown past that threshold, so fall back to
  // the Git Data (blob) API, which supports blobs up to 100MB.
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

const MONITOR_FEEDS = [
  {
    id: "fr-snf-pps",
    folder: "official",
    title: "Federal Register — HHS/CMS — SNF PPS rules",
    kind: "rss",
    url: "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=health-and-human-services-department&conditions%5Bterm%5D=SNF%20PPS&conditions%5Btype%5D%5B%5D=RULE&conditions%5Btype%5D%5B%5D=PRORULE",
    filter: false,
  },
  {
    id: "fr-snf",
    folder: "official",
    title: "Federal Register — HHS/CMS — SNF rules",
    kind: "rss",
    url: "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=health-and-human-services-department&conditions%5Bterm%5D=skilled%20nursing%20facility&conditions%5Btype%5D%5B%5D=RULE&conditions%5Btype%5D%5B%5D=PRORULE",
    filter: false,
  },
  {
    id: "govinfo-fr-snf",
    folder: "official",
    title: "GovInfo FR — skilled nursing facility",
    kind: "govinfo-search",
    query: 'collection:fr "skilled nursing facility"',
    filter: false,
  },
  {
    id: "govinfo-fr-nh",
    folder: "official",
    title: "GovInfo FR — nursing home",
    kind: "govinfo-search",
    query: 'collection:fr "nursing home"',
    filter: false,
  },
  {
    id: "govinfo-fr-483",
    folder: "official",
    title: "GovInfo FR — 42 CFR 483",
    kind: "govinfo-search",
    query: 'collection:fr "42 CFR 483"',
    filter: false,
  },
  {
    id: "govinfo-fr-ltc",
    folder: "official",
    title: "GovInfo FR — long-term care facility",
    kind: "govinfo-search",
    query: 'collection:fr "long-term care facility"',
    filter: false,
  },
  {
    id: "govinfo-fr-pps",
    folder: "official",
    title: "GovInfo FR — SNF PPS",
    kind: "govinfo-search",
    query: 'collection:fr ("SNF PPS" OR "SNF payment")',
    filter: false,
  },
  {
    id: "govinfo-fr-qrp",
    folder: "official",
    title: "GovInfo FR — quality reporting nursing home",
    kind: "govinfo-search",
    query: 'collection:fr "quality reporting" ("nursing home" OR SNF)',
    filter: false,
  },
  {
    id: "snn",
    folder: "context",
    title: "Skilled Nursing News",
    kind: "rss",
    url: "https://skillednursingnews.com/feed/",
    filter: false,
  },
  {
    id: "snn-medicare",
    folder: "context",
    title: "Skilled Nursing News — Medicare",
    kind: "rss",
    url: "https://skillednursingnews.com/category/medicare/feed/",
    filter: false,
  },
  {
    id: "snn-medicaid",
    folder: "context",
    title: "Skilled Nursing News — Medicaid",
    kind: "rss",
    url: "https://skillednursingnews.com/category/medicaid/feed/",
    filter: false,
  },
  {
    id: "snn-compliance",
    folder: "context",
    title: "Skilled Nursing News — Compliance",
    kind: "rss",
    url: "https://skillednursingnews.com/category/compliance/feed/",
    filter: false,
  },
  {
    id: "snn-legislation",
    folder: "context",
    title: "Skilled Nursing News — Legislation",
    kind: "rss",
    url: "https://skillednursingnews.com/category/legislation/feed/",
    filter: false,
  },
  {
    id: "snn-staffing",
    folder: "context",
    title: "Skilled Nursing News — Staffing",
    kind: "rss",
    url: "https://skillednursingnews.com/category/staffing/feed/",
    filter: false,
  },
  {
    id: "snn-ma",
    folder: "context",
    title: "Skilled Nursing News — Medicare Advantage",
    kind: "rss",
    url: "https://skillednursingnews.com/category/medicare-advantage/feed/",
    filter: false,
  },
  {
    id: "snn-fraud",
    folder: "context",
    title: "Skilled Nursing News — Fraud",
    kind: "rss",
    url: "https://skillednursingnews.com/category/fraud/feed/",
    filter: false,
  },
  {
    id: "snn-litigation",
    folder: "context",
    title: "Skilled Nursing News — Litigation",
    kind: "rss",
    url: "https://skillednursingnews.com/category/litigation/feed/",
    filter: false,
  },
  {
    id: "willitcare",
    folder: "context",
    title: "Will It Care — national nursing-home changes",
    kind: "rss",
    url: "https://willitcare.com/changes.xml",
    filter: false,
  },
  {
    id: "nhr-sff",
    folder: "context",
    title: "NursingHomeRating.org — Special Focus Facilities",
    kind: "rss",
    url: "https://nursinghomerating.org/xml-sff.xml",
    filter: false,
  },
  {
    id: "kff-medicaid",
    folder: "context",
    title: "KFF — Medicaid",
    kind: "rss",
    url: "https://www.kff.org/topic/medicaid/feed/",
    filter: false,
  },
  {
    id: "kff-medicare",
    folder: "context",
    title: "KFF — Medicare",
    kind: "rss",
    url: "https://www.kff.org/topic/medicare/feed/",
    filter: false,
  },
  {
    id: "kff-private",
    folder: "context",
    title: "KFF — Private Insurance",
    kind: "rss",
    url: "https://www.kff.org/topic/private-insurance/feed/",
    filter: false,
  },
  {
    id: "kff-state",
    folder: "context",
    title: "KFF — State Health Policy Data",
    kind: "rss",
    url: "https://www.kff.org/topic/state-health-policy-data/feed/",
    filter: false,
  },
  {
    id: "aapacn-don",
    folder: "context",
    title: "AAPACN — LTC DON Chat",
    kind: "rss",
    url: "https://feeds.podcastmirror.com/ltc-don-chat",
    filter: false,
  },
  {
    id: "aapacn-nac",
    folder: "context",
    title: "AAPACN — LTC NAC Chat",
    kind: "rss",
    url: "https://feeds.podcastmirror.com/ltc-nac-chat",
    filter: false,
  },
];

const FETCH_HEADERS = {
  "User-Agent": "RegIntel-monitor/1.0 (Quality Manager regulatory monitoring)",
  Accept: "application/rss+xml, application/xml, text/xml, application/json, */*",
};

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function xmlAttr(block, name, attr) {
  const match = block.match(new RegExp(`<${name}[^>]*\\s${attr}=["']([^"']+)["'][^>]*/?>`, "i"));
  return match ? match[1].trim() : "";
}

function parseRssItems(xml, source) {
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return chunks.slice(0, 25).map((block) => {
    const link = xmlTag(block, "link") || xmlAttr(block, "link", "href") || xmlTag(block, "guid");
    const published = xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "dc:date");
    return {
      title: xmlTag(block, "title") || xmlTag(block, "dc:title"),
      link,
      published,
      snippet: xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content"),
      source: source.title,
      folder: source.folder,
      sourceId: source.id,
    };
  }).filter((item) => item.title && item.link);
}

function govInfoDetailsUrl(row, fields) {
  const pkg = fields.packageid || fields.packageId || row.packageId || row.packageid;
  const granule = fields.granuleid || fields.granuleId || row.granuleId || row.granuleid;
  if (pkg && granule) return `https://www.govinfo.gov/app/details/${pkg}/${granule}`;
  if (fields.url) return fields.url;
  if (row.granuleLink) return row.granuleLink;
  if (row.packageLink) return row.packageLink;
  if (row.govcenterlink) return row.govcenterlink;
  if (pkg) return `https://www.govinfo.gov/app/details/${pkg}`;
  return "";
}

function govInfoPublished(row, fields) {
  return fields.dateIssued || fields.publishdate || fields.publicationDate
    || row.dateIssued || row.publishDate || row.publicationDate || row.date
    || row.line2 || "";
}

function normalizeGovInfoRows(payload, source) {
  const rows = payload.results || payload.resultSet || payload.documents || [];
  return rows.slice(0, 20).map((row) => {
    const fields = row.fieldMap || {};
    return {
      title: decodeXml(fields.title || row.title || row.line1 || ""),
      link: govInfoDetailsUrl(row, fields),
      published: govInfoPublished(row, fields),
      snippet: decodeXml(fields.teaser || row.teaser || row.snippet || row.summary || row.line2 || ""),
      source: source.title,
      folder: source.folder,
      sourceId: source.id,
    };
  }).filter((item) => item.title && item.link);
}

async function fetchRssFeed(source) {
  const res = await fetch(source.url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`${source.id} HTTP ${res.status}`);
  return parseRssItems(await res.text(), source);
}

async function fetchGovInfoSearch(source) {
  const body = JSON.stringify({
    query: source.query,
    offset: 0,
    pageSize: 20,
    historical: false,
  });
  const res = await fetch("https://www.govinfo.gov/wssearch/search", {
    method: "POST",
    headers: { ...FETCH_HEADERS, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`${source.id} search HTTP ${res.status}`);
  const payload = await res.json();
  const items = normalizeGovInfoRows(payload, source);
  if (!items.length) throw new Error(`${source.id} search returned no rows`);
  return items;
}

async function loadMonitor() {
  const settled = await Promise.allSettled(MONITOR_FEEDS.map(async (feed) => {
    const items = feed.kind === "govinfo-search"
      ? await fetchGovInfoSearch(feed)
      : await fetchRssFeed(feed);
    return { feed, items };
  }));

  const items = [];
  const sources = [];
  for (let i = 0; i < settled.length; i += 1) {
    const feed = MONITOR_FEEDS[i];
    const result = settled[i];
    if (result.status === "fulfilled") {
      sources.push({ id: feed.id, title: feed.title, folder: feed.folder, ok: true, count: result.value.items.length });
      items.push(...result.value.items);
    } else {
      sources.push({ id: feed.id, title: feed.title, folder: feed.folder, ok: false, error: String(result.reason && result.reason.message || result.reason) });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = (item.link || item.title).replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  deduped.sort((a, b) => Date.parse(b.published || 0) - Date.parse(a.published || 0));
  return { generatedAt: new Date().toISOString(), sources, items: deduped.slice(0, 150) };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/monitor") {
      try {
        const cache = caches.default;
        const cacheKey = new Request(new URL("/monitor", url.origin), { method: "GET" });
        const cached = await cache.match(cacheKey);
        if (cached) {
          const headers = new Headers(cached.headers);
          const cors = corsHeaders(origin);
          Object.keys(cors).forEach((key) => headers.set(key, cors[key]));
          return new Response(cached.body, { status: cached.status, headers });
        }
        const payload = await loadMonitor();
        const response = new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            ...corsHeaders(origin),
          },
        });
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (err) {
        return json({ error: err.message }, 502, origin);
      }
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
        // Fetch the current sha immediately before writing to minimize the
        // race window against a near-simultaneous commit from another tab.
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
};
