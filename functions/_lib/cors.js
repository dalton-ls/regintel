const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function allowOrigin(requestOrigin) {
  if (!requestOrigin || requestOrigin === "null") return "*";
  if (LOCAL_ORIGIN.test(requestOrigin)) return requestOrigin;
  if (/^https:\/\/[\w.-]+\.github\.io$/i.test(requestOrigin)) return requestOrigin;
  if (/^https:\/\/[\w.-]+\.pages\.dev$/i.test(requestOrigin)) return requestOrigin;
  return requestOrigin;
}

export function corsHeaders(requestOrigin) {
  return {
    "Access-Control-Allow-Origin": allowOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Cache-Control, Pragma",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function jsonHeaders(origin) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
    ...corsHeaders(origin),
  };
}

export function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders(origin),
  });
}

/** Wrap an already-serialized JSON value as `{ sha, content }` without parse/stringify. */
export function jsonWrappedContent(rawJson, origin, sha = null) {
  let raw = rawJson == null ? "" : String(rawJson);
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const shaPart = sha == null ? "null" : JSON.stringify(sha);
  return new Response(`{"sha":${shaPart},"content":${raw}}`, {
    status: 200,
    headers: jsonHeaders(origin),
  });
}
