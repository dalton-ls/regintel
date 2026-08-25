# regintel-admin-proxy

A small Cloudflare Worker that lets the RegIntel admin screens
(`record-editor.html`, `bulk-apply.html`, `pending-review.html`, and
in-place Edit on `regintel.html`) commit edits directly to
`requirements.json` (Role + Care Setting output rows) or `wr.json`
(Workforce Readiness) on GitHub — the live **output-row projection**,
not the OpenLaws source corpus or any pre-site parsed JSON. `export.html`
Also reads through it (no auth needed for reads) so its snapshot always
reflects the live committed data. `GET /monitor` is likewise unauthenticated:
it fetches the Quality Manager RSS bundle (SNF-focused Federal Register
feeds, GovInfo FR searches, Skilled Nursing News topic feeds, quality
signals, KFF payer context, and AAPACN practice podcasts) and
returns JSON for the knowledge home page.

Because the committed file is the single source of truth, this lets one
person work from multiple computers/browsers without losing edits or
needing to manually re-export/re-commit.

This is deliberately **not** a multi-user system — it's a single shared
secret gating write access for one trusted operator.

## One-time setup

1. **Create a fine-grained GitHub PAT**, scoped narrowly:
   - https://github.com/settings/personal-access-tokens/new
   - Repository access: **Only select repositories** → `regintel`
   - Permissions: **Contents** → **Read and write** (nothing else needed)
   - Copy the token — you won't see it again.

2. **Install Wrangler and log in to Cloudflare** (from this directory):
   ```
   npx wrangler login
   ```

3. **Set the two secrets**:
   ```
   npx wrangler secret put GITHUB_TOKEN
   # paste the fine-grained PAT from step 1

   npx wrangler secret put ADMIN_TOKEN
   # paste a long random string, e.g. generated with: openssl rand -hex 32
   ```

4. **Deploy**:
   ```
   npx wrangler deploy
   ```
   Wrangler prints the Worker's URL, e.g.
   `https://regintel-admin-proxy.<your-subdomain>.workers.dev`

5. **Point the admin screens at it**: open `record-editor.html`,
   `bulk-apply.html`, and `pending-review.html` in the repo root and set
   the `WORKER_URL` constant near the top of each `<script>` block to the
   URL from step 4.

## Public monitoring endpoint

`GET /monitor` (no auth) returns a versioned Quality Manager payload
(`schemaVersion: qm-monitor-v1`): normalized items, per-source health,
cache age, diagnostics, and a SHA-256 `payloadHash`. Official Federal
Register documents are pulled from the FR JSON API (not RSS) and
GovInfo search; Context remains RSS. OSHA is out of scope.

Ingestion runs in the Worker on every `GET /monitor` (page refresh) and also
hourly via cron. The JSON response is `Cache-Control: no-store` so browsers
and CDNs do not reuse a stale feed. The Worker Cache API keeps a last-good
copy only as a fallback if live ingest fails. `GET /monitor/health` is a
short status probe.

Payload fields of note: `generatedAt`, `lastSuccessAt`, `cacheAgeSeconds`,
`stale`, `overallStatus` (`ok` | `partial` | `failed` | `stale` | `empty`),
`sources[]`, `items[]`, `excluded[]` (off-topic Official items with
reasons), `diagnostics`, `timezone` (`America/New_York`),
`displayWeekLimit` (5). No migration of stored records is required; this
is a live cache, not a GitHub data file.

## Using it day to day

Each admin screen prompts once per browser session for the `ADMIN_TOKEN`
(the value you set in step 3) and caches it in `sessionStorage` — it is
never written into the HTML/JS source, so it isn't exposed by "view
source" on the static site. Enter it once per browser/device; after that,
edits, bulk-applies, conflict resolutions, and research-view in-place
saves commit straight to the `claude/create-website-skeleton-hYJMa` branch
on save (the branch GitHub Pages actually serves).

## Rotating the token

```
npx wrangler secret put ADMIN_TOKEN
```
and re-enter the new value in each browser you use (the old cached value
will start failing with 401s).

## What it does NOT do

- No per-user identity — anyone with the `ADMIN_TOKEN` can write.
- No merge/conflict UI beyond a single retry-on-409 — built for one
  operator, not concurrent multi-user editing.
- `GET /monitor` is a notification layer, not a legal-compliance
  determination. It does not write classified obligations.
  branch. Redeploy the Worker after changing `ALLOWED_PATHS` so Workforce
  in-place saves are accepted. `wr.json` is still a separate projection
  from the Role/Care Setting unified array.
