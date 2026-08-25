const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const KNOWN_ORIGINS = new Set([
  "https://dalton-ls.github.io",
  "https://regintel-admin-proxy.regintel.workers.dev",
]);

export function allowOrigin(requestOrigin) {
  if (!requestOrigin) return "*";
  if (LOCAL_ORIGIN.test(requestOrigin)) return requestOrigin;
  if (KNOWN_ORIGINS.has(requestOrigin)) return requestOrigin;
  if (/^https:\/\/[\w.-]+\.github\.io$/i.test(requestOrigin)) return requestOrigin;
  return requestOrigin;
}

export function corsHeaders(requestOrigin) {
  return {
    "Access-Control-Allow-Origin": allowOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
