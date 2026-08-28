# RegIntel on Cloudflare Pages

The live site and admin API share one origin: **https://regintel.regintel.workers.dev**

- UI is static HTML/JS/JSON from this repo (Worker assets).
- Writes go through the same Worker at `/api/file` and `/api/commit`.
- Quality Monitor stays on `https://regintel-quality-monitor.regintel.workers.dev`.

The project is named **`regintel`**, not `regintel-admin-proxy`. That name collision is what made the old workers.dev API disappear.

## Secrets (one-time)

From the repo root:

```
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

`GITHUB_TOKEN` is a fine-grained PAT on `dalton-ls/regintel` with Contents: Read and write.

## Deploy

```
npx wrangler deploy
```

Or push to `claude/create-website-skeleton-hYJMa` after setting repo Actions secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers) and `CLOUDFLARE_ACCOUNT_ID` (`af9d5fca4b1386360ed10ebc7e96c435`).

Local: `npx wrangler dev`

The frozen Worker at `regintel-admin-proxy.regintel.workers.dev` returns 410 and points here. Do not publish the static site under that Worker name.
