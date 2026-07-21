# RegIntel

Static GitHub Pages site for browsing healthcare regulatory training requirements,
with admin tools for editing records and reviewing incoming data batches.

## Live site

- **Research view**: `regintel.html` — filters, searches, and groups records by
  role and care setting. Loads fresh from `requirements.json` (unified Role +
  Care Setting data) and `wr.json` (Workforce Readiness) on every page load —
  no data is embedded in the HTML, so admin edits show up immediately. Falls
  back to the legacy `data.json` only if those two fetches fail.
- **Admin tools** (unlocked via the passphrase toggle, top-right): Record
  Editor, Bulk-Apply, Pending Review, Export — see below.

## Data model

`requirements.json` is the unified dataset: a flat array of records covering
both Role and Care Setting requirements, tagged `"Source Dataset": "Role" |
"Care Setting"`. See [DESIGN.md](DESIGN.md) for the full schema and the
rationale for unifying these two content types.

`wr.json` (Workforce Readiness) is intentionally **not** part of the unified
schema — it's an internally authored competency framework (Domain/KSA model),
not jurisdiction-driven regulatory content, and none of the admin tools below
write to it.

`role.json` / `caresetting.json` are the original per-type source files.
`migrate_to_unified.py` reads them and produces `requirements.json`:

```
python3 migrate_to_unified.py
```

It assigns each record a stable `Record ID` (hashed from source + Citation +
Training Topic + Jurisdiction, so IDs survive re-runs), validates the "at
least one of Jurisdiction Setting/Role" rule, and writes
`migration_warnings.txt` if anything fails validation.

## Unified admin tools (requirements.json)

Four screens, all reading/writing `requirements.json` directly against
GitHub — no browser localStorage, no manual export/import step, usable from
any computer:

| Screen | File | Purpose |
|---|---|---|
| Individual Record Editor | `record-editor.html` | Search/select a record, edit any field, save |
| Filter → Bulk-Apply | `bulk-apply.html` | Filter records, preview a field change across all matches, apply |
| Pending Review Queue | `pending-review.html` | Upload an incoming batch, resolve conflicts field-by-field (keep existing / use incoming / manually reconcile) |
| Export | `export.html` | Download the current dataset (and/or `wr.json`) as a backup snapshot |

**How writes work**: each screen re-fetches the latest `requirements.json`
immediately before saving, then commits the updated file straight to GitHub
via a small Cloudflare Worker (`worker/regintel-admin-proxy/`) that holds the
GitHub write token server-side. The Worker is a single-operator tool gated by
a shared bearer token (entered once per browser session, cached in
`sessionStorage` only — never written into any HTML file). Full setup,
secret rotation, and architecture notes: [worker/regintel-admin-proxy/README.md](worker/regintel-admin-proxy/README.md).

Because every save commits directly, there's no "apply my local edits"
step — the Export screen is a convenience backup, not a required part of the
workflow.

## Legacy admin tools (pre-unified schema)

These predate the unified schema and still operate on the old per-sheet
JSON shape and a `localStorage` overlay (`regintel_user_imports`) rather than
committing to GitHub:

| Tab | Upload file | Source script |
|---|---|---|
| WR Ingest (`ingest.html`) | `wr.json` | `export_wr.py` |
| Role Ingest (`ingest-role.html`) | `role.json` | `export_role.py` |
| CS Ingest (`ingest-cs.html`) | `caresetting.json` | `export_caresetting.py` |

**WR Ingest is still the primary way to get Workforce Readiness content in**,
since WR is out of scope for the unified tools by design. **Role Ingest and
CS Ingest are superseded** by Pending Review Queue + Bulk-Apply + Record
Editor for anything touching `requirements.json` — prefer those. The legacy
admin-bar **Import JSON** / **Export JSON** / **Clear imports** controls use
the same `localStorage` mechanism as these three tabs.

## Files

| File | Purpose |
|---|---|
| `regintel.html` | Main research view (also hosts the admin bar and legacy import logic) |
| `record-editor.html` / `bulk-apply.html` / `pending-review.html` / `export.html` | Unified admin tools (see above) |
| `requirements.json` | Unified Role + Care Setting dataset — the live source of truth |
| `wr.json` | Workforce Readiness dataset (`WR *` sheets) |
| `role.json` / `caresetting.json` | Original per-type source files consumed by `migrate_to_unified.py` |
| `migrate_to_unified.py` | Builds `requirements.json` from `role.json` + `caresetting.json` |
| `DESIGN.md` | Schema and admin-workflow design document |
| `worker/regintel-admin-proxy/` | Cloudflare Worker that lets the unified admin tools commit to GitHub |
| `ingest.html` / `ingest-role.html` / `ingest-cs.html` | Legacy per-type ingest tools (see above) |
| `export_wr.py` / `export_role.py` / `export_caresetting.py` | Convert the respective Excel source into its JSON file |
| `data.json` | Legacy full dataset — only used as a fallback if `requirements.json`/`wr.json` can't be fetched |
| `export_data.py` | Legacy: converts `RegIntel_PoC.xlsx` → `data.json` |
| `RegIntel_PoC.xlsx` | Source spreadsheet for the legacy dataset |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

## Admin passphrase

Admin mode is unlocked from the toggle in the top-right of `regintel.html`
(passphrase: `regintel2025`). This gates the sidebar links and the legacy
admin-bar controls in the research view. It is unrelated to the unified
tools' admin token (see the Worker README) — that token gates GitHub writes,
this passphrase gates UI visibility.

## Branches

| Branch | Role |
|---|---|
| `claude/create-website-skeleton-hYJMa` | **Default branch — GitHub Pages deployment branch.** The unified schema, `requirements.json`, and all four unified admin tools now live here. |
| `admin-workflow-redesign` | The feature branch the unified-schema work was developed on; merged into the deployment branch. Kept around for history; safe to delete. |
| `archive/ai-ingest-tools` | Frozen snapshot of the AI-powered ingest tools (`ingest-ai-parsed.html`, `ingest-parser.html`) — see that branch's README for restoration instructions |
