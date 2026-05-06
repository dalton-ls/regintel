# RegIntel

Static GitHub Pages site for browsing healthcare regulatory training requirements,
with admin-only ingest tools for adding new records.

## Live site

`regintel.html` — main research view. Filters, searches, and groups records by
role and care setting. Loads embedded `RAW_DATA` first, falls back to fetching
`data.json`.

## Files

| File | Purpose |
|---|---|
| `regintel.html` | Main research view (also hosts the admin bar and import logic) |
| `ingest.html` | **WR Ingest** — uploads `data.json`, filters `WR *` sheets, applies to RegIntel |
| `ingest-role.html` | **Role Ingest** — uploads RegIntel JSON, filters `R *` sheets, applies to RegIntel |
| `ingest-cs.html` | **CS Ingest** — uploads RegIntel JSON, filters `CS *` sheets, applies to RegIntel |
| `data.json` | Full dataset (consumed by `regintel.html` when `RAW_DATA` is absent) |
| `export_data.py` | Converts `RegIntel_PoC.xlsx` → `data.json` |
| `RegIntel_PoC.xlsx` | Source spreadsheet for the dataset |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

## Admin workflow

Admin mode is unlocked from the toggle in the top-right of `regintel.html`
(passphrase: `regintel2025`).

In admin mode:
- The sidebar shows three ingest links (WR / Role / CS)
- The admin bar exposes **Import JSON** (manual upload) and **Export JSON** (current dataset)
- A **Clear imports (N)** button appears whenever user-applied imports exist

### Ingest tab → live site flow

1. Open an ingest tab (WR / Role / CS) and upload a JSON file
2. The tab filters its sheet keys, previews the records, and offers **Apply to RegIntel**
3. Clicking Apply writes the new records to `localStorage.regintel_user_imports`
   (deduped by `Citation` + `Training Topic / Competency Item` + `Jurisdiction`)
   and redirects to `regintel.html`
4. On load, `regintel.html` merges the localStorage imports on top of `RAW_DATA`
   so they appear immediately and survive page reloads
5. Admin → **Clear imports** wipes the localStorage layer and reloads the page

The legacy admin **Import JSON** modal uses the same localStorage mechanism, so
both paths persist identically.

## Branches

| Branch | Role |
|---|---|
| `claude/remove-search-bar-CoPA5` | Active development branch |
| `claude/create-website-skeleton-hYJMa` | GitHub Pages deployment branch (mirrors dev via PR merges) |
| `archive/ai-ingest-tools` | Frozen snapshot of the AI-powered ingest tools (`ingest-ai-parsed.html`, `ingest-parser.html`) — see that branch's README for restoration instructions |

The two active branches are kept in lockstep. New work commits land on the dev
branch and reach the deployment branch via merged PRs (or `git cherry-pick`).
