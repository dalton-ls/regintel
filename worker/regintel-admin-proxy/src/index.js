/**
 * Frozen stub. The live admin API is Cloudflare Pages Functions at
 * https://regintel.pages.dev/api — not this workers.dev hostname.
 * Occupying this script name prevents a static-site publish from
 * colliding with it again.
 */
const PAGES_API = "https://regintel.regintel.workers.dev/api";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
        },
      });
    }
    return json({
      error: "Admin API moved",
      service: "regintel-admin-proxy",
      api: PAGES_API,
    }, 410);
  },
};
