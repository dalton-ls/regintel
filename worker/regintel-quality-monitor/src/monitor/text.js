const CP1252_FROM_UNICODE = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

function looksLikeMojibake(text) {
  return /\u00E2.|\u00C3[\u0080-\u00BF]|\u00C2[\u00A0-\u00FF]|\u00F0\u009F/.test(text);
}

function codePointToCp1252Byte(code) {
  if (code < 0x80) return code;
  if (code >= 0xA0 && code <= 0xFF) return code;
  if (CP1252_FROM_UNICODE[code] != null) return CP1252_FROM_UNICODE[code];
  return null;
}

function decodeCp1252BytesAsUtf8(text) {
  const bytes = [];
  for (const ch of text) {
    const byte = codePointToCp1252Byte(ch.codePointAt(0));
    if (byte == null) return null;
    bytes.push(byte);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
    if (!decoded || decoded.includes("\uFFFD")) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function repairMojibake(value) {
  let s = String(value || "");
  s = s
    .replace(/\u00E2\u20AC[\u201C\u201D\u2013\u2014]/g, "\u2014")
    .replace(/\u00E2\u20AC[\u00A6\u2026]/g, "\u2026")
    .replace(/\u00E2\u20AC[\u2018\u2019]/g, "'")
    .replace(/\u00E2\u20AC\u2122/g, "(TM)")
    .replace(/\u00C2\u00A0/g, " ")
    .replace(/\u00C2\u00B7/g, "\u00B7");
  for (let i = 0; i < 3; i += 1) {
    if (!looksLikeMojibake(s)) break;
    const decoded = decodeCp1252BytesAsUtf8(s);
    if (!decoded || decoded === s) break;
    s = decoded;
  }
  return s;
}

export function asciiPunctuation(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2026\u22EF]/g, "...")
    .replace(/[\u2022\u25CF\u25A0\u25AA]/g, "*")
    .replace(/[\u00B7\u2027\u2219]/g, " | ")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&hellip;/gi, "...")
    .replace(/&bull;/gi, "*");
}

export function sanitizeFeedText(value) {
  if (value == null) return "";
  return asciiPunctuation(repairMojibake(decodeHtmlEntities(String(value))));
}

export function sanitizeUrlText(value) {
  return repairMojibake(decodeHtmlEntities(String(value || ""))).trim();
}

export function sanitizeFeedRecord(record, { urlKeys = ["link", "sourceUrl", "html_url"] } = {}) {
  if (!record || typeof record !== "object") return record;
  const out = { ...record };
  for (const key of Object.keys(out)) {
    if (typeof out[key] !== "string") continue;
    out[key] = urlKeys.includes(key) ? sanitizeUrlText(out[key]) : sanitizeFeedText(out[key]);
  }
  return out;
}

export function sanitizePayloadStrings(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const next = {};
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string") {
          next[key] = /url|link|href/i.test(key) ? sanitizeUrlText(child) : sanitizeFeedText(child);
        } else {
          next[key] = walk(child);
        }
      }
      return next;
    }
    return value;
  };
  return walk(payload);
}
