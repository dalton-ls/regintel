import { DISPLAY_WEEK_LIMIT, TIMEZONE } from "./config.js";

export function zonedYmd(date, timeZone = TIMEZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseYmd(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), month: Number(m[2]), d: Number(m[3]) };
}

export function sundayOfYmd(ymd) {
  const p = parseYmd(ymd);
  if (!p) return "";
  const utc = new Date(Date.UTC(p.y, p.month - 1, p.d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  return utc.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd, days) {
  const p = parseYmd(ymd);
  if (!p) return "";
  const utc = new Date(Date.UTC(p.y, p.month - 1, p.d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatWeekLabel(startYmd, endYmd) {
  const a = parseYmd(startYmd);
  const b = parseYmd(endYmd);
  if (!a || !b) return startYmd;
  const left = `${a.month}/${a.d}`;
  const right = `${b.month}/${b.d}`;
  return `${a.y}: ${left === right ? left : `${left}–${right}`}`;
}

export function groupItemsByWeek(items, now = new Date(), timeZone = TIMEZONE, limit = DISPLAY_WEEK_LIMIT) {
  const todayYmd = zonedYmd(now, timeZone);
  const thisSunday = sundayOfYmd(todayYmd);
  const lastSunday = addDaysYmd(thisSunday, -7);
  const groups = new Map();
  const undated = [];
  let hiddenOlder = 0;

  const ensure = (key, meta) => {
    if (!groups.has(key)) groups.set(key, { ...meta, items: [] });
    return groups.get(key);
  };

  ensure(thisSunday, {
    key: thisSunday,
    start: thisSunday,
    badge: "this-week",
    label: formatWeekLabel(thisSunday, todayYmd),
  });

  for (const item of items) {
    const ymd = item.publicationDate || "";
    if (!ymd) {
      undated.push(item);
      continue;
    }
    if (ymd > todayYmd) continue;
    const start = sundayOfYmd(ymd);
    if (!start || start > thisSunday) continue;
    const weekEnd = addDaysYmd(start, 6);
    const displayEnd = weekEnd > todayYmd ? todayYmd : weekEnd;
    const badge = start === thisSunday ? "this-week" : (start === lastSunday ? "last-week" : "");
    ensure(start, {
      key: start,
      start,
      badge,
      label: formatWeekLabel(start, displayEnd),
    }).items.push(item);
  }

  const datedKeys = [...groups.keys()].sort().reverse();
  const visibleKeys = datedKeys.slice(0, limit);
  hiddenOlder = datedKeys.slice(limit).reduce((n, k) => n + groups.get(k).items.length, 0);

  const weeks = visibleKeys.map((k) => groups.get(k));
  weeks.push({
    key: "undated",
    start: "",
    badge: "",
    label: "Date not stated",
    items: undated,
  });

  return {
    weeks,
    hiddenOlderCount: hiddenOlder,
    timezone: timeZone,
    displayWeekLimit: limit,
  };
}

export function sortItems(items, dir = "desc") {
  const mul = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const da = a.publicationDate || "";
    const db = b.publicationDate || "";
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -mul : mul;
    }
    const sa = (a.source || "").localeCompare(b.source || "");
    if (sa) return sa;
    return (a.title || "").localeCompare(b.title || "");
  });
}
