# regintel-admin-proxy

A small Cloudflare Worker that lets the RegIntel admin screens
(`record-editor.html`, `bulk-apply.html`, `pending-review.html`, and
in-place Edit on `regintel.html`) commit edits directly to
`requirements.json` (Role + Care Setting output rows) or `wr.json`
(Workforce Readiness) on GitHub — the live **output-row projection**,
not the OpenLaws source corpus or any pre-site parsed JSON. `export.html`
also reads through it (no auth needed for reads) so its snapshot always
reflects the live committed data.
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
- Only writes `requirements.json` and `wr.json` on the configured GitHub
  branch. Redeploy the Worker after changing `ALLOWED_PATHS` so Workforce
  in-place saves are accepted. `wr.json` is still a separate projection
  from the Role/Care Setting unified array.
