# Contributing (internal)

RegIntel is a Cloudflare Worker that serves static HTML/JS/JSON from the
repo root and hosts `/api` for admin GitHub writes. There is no SPA build.

## Prerequisites

- Node.js 18 or newer
- Python 3.10+ (only for Excel / batch scripts)
- A Cloudflare account that can deploy the `regintel` Worker
- A GitHub PAT with Contents: Read and write on this repo (for local admin writes)

## Clone and run locally

```
git clone <this-repo>
cd regintel
git checkout main
npm install
copy .dev.vars.example .dev.vars   # Windows
# cp .dev.vars.example .dev.vars   # macOS / Linux
```

Put real values in `.dev.vars` (`GITHUB_TOKEN`, `ADMIN_TOKEN`). Never commit
that file.

```
npx wrangler login
npm run dev
```

Open the printed `localhost` URL. `/api/health` should report GitHub auth
once `GITHUB_TOKEN` is set.

Opening `index.html` from disk is fine for read-only browsing. Admin
screens that commit need the Worker origin plus the bearer token
(`ADMIN_TOKEN`), entered once per browser session.

## Python batch tools

From the repo root:

```
python -m pip install -r scripts/requirements.txt
python scripts/normalize_batch.py incoming_sheet.xlsx --source-dataset Role
```

Excel converters: `scripts/export_wr.py`, `scripts/export_role.py`,
`scripts/export_caresetting.py`, `scripts/export_data.py`. Defaults write
JSON to the repo root.

Job-study Word → `wr.json`:

```
python scripts/convert_jobstudies_wr.py --jobstudy-root "<path-to-e_jobstudies>"
```

Or set `JOBSTUDY_ROOT`. Without either, the script looks in `incoming/`.
A `wr.csv` dump is local-only (gitignored); `wr.json` is the source of truth.

One-time migrations live in `scripts/legacy/` and are not for ongoing ingest.

## Deploy

Production deploys on push to `main` via `.github/workflows/deploy-worker.yml`.

Two things are easy to miss:

- `requirements.json`, `wr.json`, and `program-taxonomy.json` are read **live from
  GitHub HEAD** on every request, so a data commit shows up immediately. HTML/JS
  changes do **not** — they ship only with a Worker deploy. If the record badge
  updates but the UI doesn't, the deploy didn't run.
- The workflow only fires on `main`. Check `git status -sb` shows
  `main...origin/main`; a local `main` tracking another remote branch pushes fine
  and deploys nothing. `npx wrangler deploy` from the repo root is the manual
  fallback.
Repo Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Manual:

```
npm run deploy
```

First-time Worker secrets (from repo root):

```
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

Quality Monitor is a second Worker:

```
cd worker/regintel-quality-monitor
npx wrangler deploy
```

`worker/regintel-admin-proxy` is a frozen 410 stub on an old hostname.
Do not deploy the live site under that Worker name.

## Tests

```
npm test
```

Runs the Quality Monitor ingest suite (`node --test`).

## Admin UI gate

The top-right Admin toggle only reveals sidebar links. The passphrase is
the constant `REGINTEL_ADMIN_PASSPHRASE` in `admin-gate.js`. It is **not**
authorization. GitHub writes require `ADMIN_TOKEN`.
