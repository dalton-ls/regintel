import { sanitizeFeedText, sanitizeUrlText } from "./text.js";

export function decodeXml(value) {
  const stripped = String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ");
  return sanitizeFeedText(stripped);
}

function decodeXmlUrl(value) {
  const stripped = String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ");
  return sanitizeUrlText(stripped);
}

function xmlInner(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1] : "";
}

function xmlTag(block, name) {
  const inner = xmlInner(block, name);
  return inner ? decodeXml(inner) : "";
}

function xmlTagUrl(block, name) {
  const inner = xmlInner(block, name);
  return inner ? decodeXmlUrl(inner) : "";
}

function xmlAttr(block, name, attr) {
  const match = block.match(new RegExp(`<${name}[^>]*\\s${attr}=["']([^"']+)["'][^>]*/?>`, "i"));
  return match ? sanitizeUrlText(match[1]) : "";
}

export function looksLikeXmlFeed(xml) {
  return /<(rss|feed|rdf:RDF)\b/i.test(xml);
}

export function parseRssItems(xml, source) {
  if (!looksLikeXmlFeed(xml) && !/<item[\s\S]*?<\/item>/i.test(xml) && !/<entry[\s\S]*?<\/entry>/i.test(xml)) {
    const err = new Error(`${source.id} malformed XML`);
    err.code = "malformed";
    throw err;
  }
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return chunks.map((block) => {
    const link = xmlTagUrl(block, "link") || xmlAttr(block, "link", "href") || xmlTagUrl(block, "guid");
    const published = xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "dc:date");
    const updated = xmlTag(block, "updated") || xmlTag(block, "dc:modified") || "";
    return {
      title: xmlTag(block, "title") || xmlTag(block, "dc:title"),
      link,
      published,
      lastModified: updated,
      snippet: xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content"),
      agency: xmlTag(block, "dc:creator") || xmlTag(block, "author") || source.agency || "",
      documentType: xmlTag(block, "category") || "",
    };
  }).filter((item) => item.title);
}

export function parseFrApi(payload, source) {
  const results = payload && payload.results;
  if (!payload || typeof payload !== "object" || !Array.isArray(results)) {
    const err = new Error(`${source.id} malformed JSON`);
    err.code = "malformed";
    throw err;
  }
  return results.map((row) => {
    const agencies = Array.isArray(row.agencies)
      ? row.agencies.map((a) => a.name || a.raw_name || "").filter(Boolean).join("; ")
      : (source.agency || "");
    return {
      title: sanitizeFeedText(row.title || ""),
      link: sanitizeUrlText(row.html_url || row.pdf_url || ""),
      published: row.publication_date || "",
      lastModified: row.signing_date || "",
      snippet: sanitizeFeedText(row.abstract || row.excerpts || ""),
      agency: sanitizeFeedText(agencies || source.agency || ""),
      documentType: sanitizeFeedText(row.type || ""),
      citation: sanitizeFeedText(row.citation || ""),
      documentNumber: row.document_number || "",
      effectiveDate: row.effective_on || "",
    };
  });
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
    || "";
}

export function parseGovInfo(payload, source) {
  if (!payload || typeof payload !== "object") {
    const err = new Error(`${source.id} malformed JSON`);
    err.code = "malformed";
    throw err;
  }
  const rows = payload.results || payload.resultSet || payload.documents || [];
  if (!Array.isArray(rows)) {
    const err = new Error(`${source.id} malformed JSON`);
    err.code = "malformed";
    throw err;
  }
  return rows.map((row) => {
    const fields = row.fieldMap || {};
    const pkg = fields.packageid || fields.packageId || row.packageId || "";
    return {
      title: decodeXml(fields.title || row.title || row.line1 || ""),
      link: govInfoDetailsUrl(row, fields),
      published: govInfoPublished(row, fields),
      snippet: decodeXml(fields.teaser || row.teaser || row.snippet || row.summary || row.line2 || ""),
      agency: decodeXml(fields.agency || row.agency || source.agency || ""),
      documentNumber: pkg || fields.granuleid || "",
      citation: decodeXml(fields.citation || ""),
    };
  });
}
