# RegIntel

Static GitHub Pages site for **regulatory intelligence**: browse healthcare
regulatory obligations as a flattened product projection, and QA incoming
classified batches before they land in the live dataset.

This site does **not** parse OpenLaws. AI-facilitated extraction, monthly
diffs, and temporal versioning happen **before** `requirements.json` is
populated. What you upload here is already-classified JSON (or an Excel
sheet already in the 20-column extraction template). See
[DESIGN.md](DESIGN.md) for the site boundary and the three-taxonomy split.

Canonical field definitions: `PHASE 1/Metadata Summary v3.xlsx` (sibling
folder, not this git repo). Broader ontology:
`RegIntel Knowledge Architecture v3.docx`.

## Live site

- **Knowledge home**: `index.html` — Research Services home. Orients
  users to the Signal → Horizon → Codified pipeline and links into the
  research view. Quality Manager RSS monitoring lives in that view as
  **Quality Monitor**.

- **Research view**: `regintel.html` — Roles, Care Settings, **Quality Monitor**,
  **Policy**, Workforce Readiness, and Facility/Learner (a
  **type-level** archetype: Jurisdiction × HSTM Setting × HSTM Role —
  not a customer roster). Loads fresh from `requirements.json` and
  `wr.json` on every page load. Falls back to legacy `data.json` only if
  those two fetches fail. Policy Manager lists obligations the parser
  routed to a written-policy response (or tagged Policy / Procedure).
- **Admin tools** (passphrase toggle, top-right): Record Editor,
  Bulk-Apply, Pending Review, Export, WR Ingest — see below.

## Data model

`requirements.json` is the live **output-row projection**: a flat array
covering both Role and Care Setting extraction lanes, tagged
`"Source Dataset": "Role" | "Care Setting"`. A Record ID identifies one
row, not the underlying obligation. See [DESIGN.md](DESIGN.md).

`wr.json` (Workforce Readiness) is intentionally **not** part of that
projection — internally authored Domain/KSA framework, not
jurisdiction-driven regulatory content. None of the unified admin tools
write to it.

### Batch columns (47), in parser emission order

The parser skill emits 47 columns. `normalize_batch.py` still reads by
**exact header name**. The original 20 extraction columns are required
for identity; the rest are optional enrichment (absent = no opinion):

```
Jurisdiction, Jurisdiction Setting, Jurisdiction Role, HSTM Setting, HSTM Role,
Regulation Type, Oversight / Professional Agency, Requirement Level, Authority Level,
Explicit Training, Citation, Related Regulatory Provisions, Training Topic / Competency Item,
Relationship, Purpose, Approval Required, Approval Basis, Approval Scope,
Approval Responsibility, Approval Timing, Instructor/SME Qualification Required,
Hours Required, Frequency, Source URL, Notes / Research Flags,
Change Type, Change Detected Date, Change Source path, Applicability Rules, Impact Types,
Record ID, Obligation ID, Provision Relationship Types, Interpretive Conditions,
Prior Training Credit / Exemption, Prior Training Qualification,
Interpretive Review Status, Regulatory Lifecycle Stage, Product Use Case,
Regulated Competency, Regulatory Change Summary, Interpretive Summary,
Policy Action Relevance, Quality Manager Relevance, Operational Domain,
Human Interpretation / SME Review, Source Change Context
```

`Change Source path` (parser spelling) is accepted interchangeably with
the earlier `Change Source Path`. `Approval Required` is `Yes` / `No` /
`Unknown`. Hours Required stays verbatim (`NR` when unstated — never `0`).

The batch also carries `Obligation ID` (distinct from Record ID). Empty
enrichment cells on an extraction sheet mean no opinion; the normalizer
omits them rather than clearing existing tags. Impact Types on a
classified batch are parser-assigned; human review is QA/override.

RegIntel does **not** store Organizational Artifact crosswalks. Downstream
product impact (which policies, modules, etc.) is **inferred** from Impact
Type plus HSTM Setting / Role / Jurisdiction — not catalog IDs in this site.

`Authority Level` and `Approval Basis` were added in the 18 → 20 split.
Two axes that used to be conflated in `Requirement Level` are now separate:

- `Requirement Level` — specificity: `Explicit Training`, `Other Training Reference`
- `Authority Level` — authority: `Federal Floor`, `State Floor`, `Competency`

`Approval Required` is bare `Yes`/`No`; rationale lives in `Approval Basis`.
`Explicit Training` is **derived** from `Requirement Level`. Don't set it
directly.

Neither new field participates in `Record ID`. See [DESIGN.md §5.1](DESIGN.md).

### Additive intelligence fields (Phases 2–4)

Optional on a row. Produced **after** extraction; uploaded through Pending
Review. Absence = “this batch has no opinion,” not “clear the field.”

- `Change Type`, `Change Detected Date`, `Change Source Path` — source-level
  temporal tags from the pre-site OpenLaws diff
- `Applicability Rules` — array of rule objects
- `Impact Types` — array of tags from the Phase 4 closed taxonomy (Policy,
  Procedure, Training, Competency, Credential, Documentation, Workflow,
  Staffing, Reporting, Audit, Physical Environment). One row may carry
  several. See [`impact-types.js`](impact-types.js). The parser assigns
  these as a first-pass judgment; this site is QA/override, not the
  primary tagger. This is the **terminal implementation signal in
  RegIntel** — use it with care-setting / role / jurisdiction to infer
  affected downstream products outside this site.
- `Impact Basis`, `Impact Confidence` (`High` / `Medium` / `Low`),
  `Impact Review` (`true` = needs QA) — parser evidence that travels with
  Impact Types. First-class fields; not folded into Notes.

Legacy `Other` values may appear on older rows; prefer specific types when
reviewing new batches.

### Operator notes

- **`Jurisdiction` must be `US` for federal, never `Federal`.** A batch
  using `Federal` silently adds a duplicate filter option. `normalize_batch.py`
  raises a hard warning.
- **`Hours Required` should be `NR` when the regulation doesn't state a
  number, not `0`.** Existing `0` values have not been bulk-converted:
  some are genuinely zero.
- **Record ID** is
  `req_` + sha1(Source Dataset | Citation | Training Topic | Jurisdiction |
  Jurisdiction Role | Jurisdiction Setting)[:12] — not the Excel tab name.

`role.json` / `caresetting.json` are the original per-type source files.
`migrate_to_unified.py` is a **one-time / full-regeneration** tool; do not
use it for ongoing batches (it bypasses Pending Review):

```
python3 migrate_to_unified.py
```

### Ongoing bulk ingestion: `normalize_batch.py`

For a new already-extracted sheet — not OpenLaws raw, not a full
regeneration — normalize it and feed Pending Review:

```
python3 normalize_batch.py incoming_sheet.xlsx --source-dataset Role
```

This computes the same Record IDs as `migrate_to_unified.py`, validates
the anchor rule, and warns (without blocking) on vocabulary drift.
It does **not** emit Change / Applicability / Impact fields;
those arrive as separate reviewed batches.

Warnings raised:

- `Jurisdiction`, `HSTM Setting`, or `HSTM Role` value not seen in the
  reference `requirements.json`
- **`Jurisdiction` is `Federal`** rather than `US`
- `Requirement Level` arriving as `State Floor` / `Federal Floor` /
  `Competency` (pre-18→20 sheet; those values belong in `Authority Level`)
- `Authority Level` missing or outside the closed set
- `Approval Required` arriving as a rationale clause instead of bare
  `Yes` / `No` / `Unknown`
- `Explicit Training` disagreeing with `Requirement Level`

Upload the written JSON into `pending-review.html`. New IDs can be added;
conflicts are reviewed field-by-field. The queue also shows **type-level
scope** for the batch: which / how many HSTM Settings and HSTM Roles, for
which jurisdictions, by Impact Type — filterable. That is an archetype
count, not a customer headcount.

> **Uploading a pre-migration sheet is safe but lossy.** An absent field
> means “keep what we have.” A genuinely *new* record from an old sheet
> enters without `Authority Level` / `Approval Basis` and will fail
> validation on its next edit — the queue flags this before you commit.

## Unified admin tools (`requirements.json`)

Four screens, all reading/writing `requirements.json` directly against
GitHub — no browser localStorage, usable from any computer:

| Screen | File | Purpose |
|---|---|---|
| Individual Record Editor | `record-editor.html` | Search/select an output row, edit, save |
| Filter → Bulk-Apply | `bulk-apply.html` | Filter rows, preview one field change, apply |
| Pending Review Queue | `pending-review.html` | Upload a classified batch; resolve conflicts; see type-level affected settings/roles/jurisdictions |
| Export | `export.html` | Download the current dataset (and/or `wr.json`) as a backup snapshot |

**How writes work**: each screen re-fetches the latest `requirements.json`
immediately before saving, then commits via the Cloudflare Worker
(`worker/regintel-admin-proxy/`). The Worker holds the GitHub write token
server-side and is gated by a shared bearer token (entered once per
browser session, `sessionStorage` only). Setup:
[worker/regintel-admin-proxy/README.md](worker/regintel-admin-proxy/README.md).

Export is a convenience backup, not a required write path.

## Legacy admin tools

These predate the unified projection and still operate on the old
per-sheet JSON shape and a `localStorage` overlay (`regintel_user_imports`):

| Tab | Upload file | Source script |
|---|---|---|
| WR Ingest (`ingest.html`) | `wr.json` | `export_wr.py` |

**WR Ingest is still the primary way to get Workforce Readiness content
in.** Role and Care Setting data go through Pending Review + Bulk-Apply +
Record Editor. The research-view **Import JSON** / **Export JSON** /
**Clear imports** controls use the same `localStorage` mechanism as WR
Ingest; they merge WR records, they are not the identity model (Record ID
is).

## Files

| File | Purpose |
|---|---|
| `regintel.html` | Research view (Quality Monitor, Roles, Care Settings, Policy, WR, Facility/Learner) |
| `quality-monitor.html` | Quality Manager RSS monitor (embedded in research view) |
| `schema.js` | 47-column parser contract, closed vocabularies, Policy-relevance helper |
| `record-editor.html` / `bulk-apply.html` / `pending-review.html` / `export.html` | Unified admin tools |
| `requirements.json` | Live output-row projection — source of truth for Role + Care Setting |
| `wr.json` | Workforce Readiness (`WR *` sheets) |
| `role.json` / `caresetting.json` | Legacy per-type files consumed by `migrate_to_unified.py` |
| `migrate_to_unified.py` | One-time / full regeneration of `requirements.json` |
| `normalize_batch.py` | Normalize one already-extracted sheet for Pending Review |
| `impact-types.js` | Phase 4 Impact Type closed taxonomy (shared by admin + research UI) |
| `index.html` | Research Services home (pipeline + tool navigation) |
| `DESIGN.md` | Site boundary, projection schema, admin workflow |
| `worker/regintel-admin-proxy/` | Cloudflare Worker that commits `requirements.json` |
| `ingest.html` | WR ingest only |
| `export_wr.py` / `export_role.py` / `export_caresetting.py` | Excel → JSON converters |
| `data.json` | Legacy fallback if `requirements.json` / `wr.json` can't be fetched |
| `export_data.py` | Legacy: `RegIntel_PoC.xlsx` → `data.json` |
| `.nojekyll` | GitHub Pages: serve files as-is |

Pre-site OpenLaws diff / change-tag scripts live in the sibling
`PHASE 2 DIFF/` folder, not this repo.

## Admin passphrase

Unlocked from the toggle in the top-right of `regintel.html`
(passphrase: `regintel2025`). Gates sidebar links and legacy admin-bar
controls. Unrelated to the Worker admin token, which gates GitHub writes.

## Branches

| Branch | Role |
|---|---|
| `claude/create-website-skeleton-hYJMa` | **Default — GitHub Pages deployment.** Unified projection, `requirements.json`, and admin tools live here. |
| `admin-workflow-redesign` | Feature branch the unified-schema work was developed on; merged. Safe to delete. |
| `archive/ai-ingest-tools` | Frozen snapshot of in-browser AI ingest tools — parsing does **not** belong on the live site; see that branch’s README if you need the archive. |
