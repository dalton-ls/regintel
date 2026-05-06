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
| `ingest.html` | **WR Ingest** — uploads `wr.json`, filters `WR *` sheets, applies to RegIntel |
| `ingest-role.html` | **Role Ingest** — uploads `role.json`, filters `R *` sheets, applies to RegIntel |
| `ingest-cs.html` | **CS Ingest** — uploads `caresetting.json`, filters `CS *` sheets, applies to RegIntel |
| `wr.json` | Workforce Readiness dataset (`WR *` sheets) |
| `role.json` | Role dataset (`R *` sheets) |
| `caresetting.json` | Care Setting dataset (`CS *` sheets) |
| `data.json` | Legacy full dataset (consumed by `regintel.html` when `RAW_DATA` is absent) |
| `export_wr.py` | Converts `RegIntel_POC_WR.xlsx` → `wr.json` |
| `export_role.py` | Converts `RegIntel_POC_Role.xlsx` → `role.json` |
| `export_caresetting.py` | Converts `RegIntel_POC_CareSetting.xlsx` → `caresetting.json` |
| `export_data.py` | Legacy: converts `RegIntel_PoC.xlsx` → `data.json` |
| `RegIntel_PoC.xlsx` | Source spreadsheet for the legacy dataset |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

## Admin workflow

Admin mode is unlocked from the toggle in the top-right of `regintel.html`
(passphrase: `regintel2025`).

In admin mode:
- The sidebar shows three ingest links (WR / Role / CS)
- The admin bar exposes **Import JSON** (manual upload) and **Export JSON** (current dataset)
- A **Clear imports (N)** button appears whenever user-applied imports exist

### Ingest tab → live site flow

| Tab | Upload file | Source script |
|---|---|---|
| WR Ingest (`ingest.html`) | `wr.json` | `export_wr.py` |
| Role Ingest (`ingest-role.html`) | `role.json` | `export_role.py` |
| CS Ingest (`ingest-cs.html`) | `caresetting.json` | `export_caresetting.py` |

1. Run the relevant Python script against the Excel source to produce the JSON file
2. Open the matching ingest tab and upload the JSON file
3. The tab filters its sheet keys, previews the records, and offers **Apply to RegIntel**
4. Clicking Apply writes the new records to `localStorage.regintel_user_imports`
   (deduped by `Citation` + `Training Topic / Competency Item` + `Jurisdiction`)
   and redirects to `regintel.html`
5. On load, `regintel.html` merges the localStorage imports on top of `RAW_DATA`
   so they appear immediately and survive page reloads
6. Admin → **Clear imports** wipes the localStorage layer and reloads the page

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
