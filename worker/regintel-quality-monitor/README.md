# regintel-quality-monitor

Public Quality Monitor API. Independent of the site+admin Worker
(`regintel` at regintel.regintel.workers.dev). This Worker only serves
`GET /monitor`.

- Last-good payload is stored in KV and returned immediately.
- Live ingest runs in the background (and hourly cron), not on the
  browser's critical path.
- No GitHub write token. Admin commits stay on Cloudflare Pages Functions
  (`https://regintel.regintel.workers.dev/api`).

Do not `wrangler deploy` `regintel-admin-proxy` expecting it to host
the feed. Point `quality-monitor.html` at:

`https://regintel-quality-monitor.regintel.workers.dev`
