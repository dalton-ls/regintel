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

export function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      ...corsHeaders(origin),
    },
  });
}
