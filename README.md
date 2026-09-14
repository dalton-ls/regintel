# RegIntel

Cloudflare Worker plus static HTML/JS for **regulatory intelligence**:
browse healthcare regulatory obligations as a flattened product projection,
and QA incoming classified batches before they land in the live dataset.

Day-1 setup (clone, `npm install`, local Worker, secrets, Python tools) is
in [CONTRIBUTING.md](CONTRIBUTING.md). This file is the product map.

This site does **not** parse OpenLaws. AI-facilitated extraction, monthly
diffs, and temporal versioning happen **before** `requirements.json` is
populated. Monthly apply from `RegIntel_Work` writes this file after
`complete-review` (backup first). SME QA can still enter through Pending
Review. See [DESIGN.md](DESIGN.md) for the site boundary and the three-taxonomy split.

Canonical field definitions: `PHASE 1/Metadata Summary v4.xlsx` (sibling
folder / Research Services catalog, not this git repo). Broader ontology:
`RegIntel Knowledge Architecture v3.docx`.

## Live origins

| Surface | URL |
|---|---|
| Site + admin API | https://regintel.regintel.workers.dev |
| Quality Monitor API | https://regintel-quality-monitor.regintel.workers.dev |

Local: `npm install` then `npm run dev` (see [CONTRIBUTING.md](CONTRIBUTING.md)).
Opening HTML from disk works for browsing; admin writes need the Worker and
`ADMIN_TOKEN`.

## Site pages

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
- **Admin tools** (passphrase toggle, top-right): Bulk-Apply,
  Pending Review, Export, WR Ingest — see below.

## Data model

`requirements.json` is the live **output-row projection**: a flat array
of classified rows. `"Source Dataset": "Role" | "Care Setting"` is kept
for Record ID identity. The research view **Obligations by Role** tab
shows `Regulation Type` = Individual/Continuing Education. **Obligations
by Care Setting** shows Facility-Based/Organizational Training and
Organizational Policy. See [DESIGN.md](DESIGN.md).

`wr.json` (Workforce Readiness) is intentionally **not** part of that
projection — internally authored Domain/KSA framework, not
jurisdiction-driven regulatory content. None of the unified admin tools
write to it.

### Batch columns (50 parser + live occupation status)

The parser skill emits 50 columns. `scripts/normalize_batch.py` still reads by
**exact header name**. Parser `--source-dataset` is the corpus label hashed
inside the skill (`CA CCR 22`); this script's `--source-dataset` is the
legacy site lane (`Role` / `Care Setting`) inferred from Regulation Type.
The original 20 extraction columns are required
for identity; the rest are optional enrichment (absent = no opinion).
`Canonical Role`, `Role Qualifier`, and `Display Role` are columns 48–50.
The live file also stores `Role Classification Status` (`Classified` /
`Needs Classification`). That status field is not a parser emit column.

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
Human Interpretation / SME Review, Source Change Context,
Canonical Role, Role Qualifier, Display Role
```

`Role Classification Status` is stored on live rows after apply/mapping; it is
not in the parser emission list.

### `Program` (live-only grouping field)

Both research-view trees group State → Agency → **Program** → obligation.
`Program` is stamped on every row and its vocabulary lives in ONE file:
**`program-taxonomy.json`** (served live from GitHub HEAD like
`requirements.json`). It has one lane per tab:

| Lane | Regulation Type | Grouping axis |
|---|---|---|
| `care-setting` | Facility-Based/Organizational Training, Organizational Policy | training-topic family (Dementia & Cognitive Care, Infection Prevention & Control, …) |
| `role` | Individual/Continuing Education | credential lifecycle stage (Initial Certification & Licensure Training, Certification Renewal & CE, Competency Evaluation & Examination, Training Program & Vendor Approval, Specialty Permit & Expanded Scope) |

`Program` is UI navigation metadata only — not a parser column, not a Record
ID input, not the ontology (Impact Type is). `Purpose` stays the parser's
free-text intent label and is shown in the drawer.

**After every apply** (new rows arrive without `Program` and render under
*Unassigned (needs review)* until you do):

```
python scripts/assign_program.py            # dry run: counts + unassigned list
python scripts/assign_program.py --write
python scripts/assign_program.py --check    # CI-style: exit 1 if anything is unassigned
```

**Flexing the taxonomy** — all in `program-taxonomy.json`, no code changes:

- *New program*: append to `lanes.<lane>.programs` and add a regex to
  `rule_order` (first match wins; order matters). Re-run the script.
- *Rename*: change `label`, put the old label in `aliases`; rows migrate on
  the next `--write`.
- *Misroute*: add an entry to `purpose_overrides` (exact) or
  `purpose_prefix_overrides` rather than hand-editing rows, so the next apply
  lands in the same bucket.
- *Ad-hoc value*: the drawer and Bulk-Apply dropdowns are populated from the
  taxonomy **∪ every Program value present on live rows**, so a value typed
  or bulk-applied outside the taxonomy is never rejected. The script preserves
  it (flagged `<-- not in taxonomy`) until you promote it or `--force`.
- *Unmatched rows* print grouped by Purpose so you can see whether they need
  a rule or a new program.

Rule of thumb for adding a program: it should hold ≥ 3 obligations across
≥ 2 citations, otherwise it belongs as a rule under an existing family.

### `scripts/dedupe_requirements.py`

Two extraction passes over the same Title 22 sections produced duplicate rows
(same Citation + Training Topic + HSTM Setting + Regulation Type, different
`Purpose` and therefore different Record IDs). This merges each group into the
richer row, unions Impact Types, and stamps `[DEDUP date] merged duplicate
req_…` into Notes. Dry run first; `--report out.csv` lists every merge.
It never merges a Parent sentence with its enumerated Child topics.

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
- Parser 5b-4 evidence (basis / confidence / review) is **not** a parser
  emit field in the current skill. It lands in `Notes / Research Flags`. Older
  batches may still carry `Impact Basis`, `Impact Confidence`, and
  `Impact Review`; ingest still copies those through when present.

Legacy `Other` values may appear on older rows; prefer specific types when
reviewing new batches.

### Operator notes

- **`Jurisdiction` must be `US` for federal, never `Federal`.** A batch
  using `Federal` silently adds a duplicate filter option. `scripts/normalize_batch.py`
  raises a hard warning.
- **`Hours Required` should be `NR` when the regulation doesn't state a
  number, not `0`.** Existing `0` values have not been bulk-converted:
  some are genuinely zero.
- **Record ID** is
  `req_` + sha1(Source Dataset | Citation | Training Topic | Jurisdiction |
  Jurisdiction Role | Jurisdiction Setting)[:12] — not the Excel tab name.

`role.json` / `caresetting.json` are empty legacy stubs kept for the
one-time regenerator. `scripts/legacy/migrate_to_unified.py` is a
**full-regeneration** tool; do not use it for ongoing batches (it bypasses
Pending Review):

```
python scripts/legacy/migrate_to_unified.py
```

### Ongoing bulk ingestion: `scripts/normalize_batch.py`

For a new already-extracted sheet — not OpenLaws raw, not a full
regeneration — normalize it and feed Pending Review:

```
python scripts/normalize_batch.py incoming_sheet.xlsx --source-dataset Role
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

Three screens, all reading/writing `requirements.json` directly against
GitHub — no browser localStorage, usable from any computer:

| Screen | File | Purpose |
|---|---|---|
| Filter → Bulk-Apply | `bulk-apply.html` | Filter rows, preview one field change, apply |
| Pending Review Queue | `pending-review.html` | Upload a classified batch; resolve conflicts; see type-level affected settings/roles/jurisdictions |
| Export | `export.html` | Download the current dataset (and/or `wr.json`) as a backup snapshot |

**How writes work**: each screen re-fetches the latest `requirements.json`
immediately before saving, then commits via the Cloudflare Worker
**https://regintel.regintel.workers.dev/api**. The Worker holds the GitHub
write token server-side and is gated by a shared bearer token (entered once
per browser session, `sessionStorage` only). Setup is in
[CONTRIBUTING.md](CONTRIBUTING.md).

Export is a convenience backup, not a required write path.

## Legacy admin tools

These predate the unified projection and still operate on the old
per-sheet JSON shape and a `localStorage` overlay (`regintel_user_imports`):

| Tab | Upload file | Source script |
|---|---|---|
| WR Ingest (`ingest.html`) | `wr.json` | `scripts/export_wr.py` |

**WR Ingest is still the primary way to get Workforce Readiness content
in.** Role and Care Setting data go through Pending Review + Bulk-Apply.
  The research-view **Import JSON** / **Export JSON** /
**Clear imports** controls use the same `localStorage` mechanism as WR
Ingest; they merge WR records, they are not the identity model (Record ID
is).

## Files

| Path | Purpose |
|---|---|
| `index.html` | Research Services home (pipeline + tool navigation) |
| `regintel.html` | Research view (Quality Monitor, Roles, Care Settings, Policy, WR, Facility/Learner) |
| `quality-monitor.html` | Quality Manager RSS monitor (embedded in research view) |
| `schema.js` | 50-column parser contract plus live `Role Classification Status` |
| `bulk-apply.html` / `pending-review.html` / `export.html` | Unified admin tools |
| `ingest.html` | WR ingest only |
| `requirements.json` | Live output-row projection — source of truth for Role + Care Setting |
| `wr.json` | Workforce Readiness (`WR *` sheets) |
| `data.json` | Last-resort fetch fallback if `requirements.json` / `wr.json` fail |
| `role.json` / `caresetting.json` | Empty stubs for `scripts/legacy/migrate_to_unified.py` |
| `scripts/normalize_batch.py` | Normalize one already-extracted sheet for Pending Review |
| `scripts/assign_program.py` | Stamp the live-only `Program` grouping field (run after every apply) |
| `scripts/dedupe_requirements.py` | Merge duplicate output rows from overlapping extraction passes |
| `scripts/export_*.py` | Excel → JSON converters (run from repo root) |
| `scripts/legacy/` | One-time migrations — not day-to-day |
| `impact-types.js` | Phase 4 Impact Type closed taxonomy |
| `program-taxonomy.json` | `Program` grouping vocabulary + assignment rules (both lanes) |
| `DESIGN.md` | Site boundary, projection schema, admin workflow |
| `src/site-worker.js` + `functions/api/` | Same-origin admin API: `GET /api/file`, `POST /api/commit` |
| `worker/regintel-quality-monitor/` | Quality Monitor RSS/FR API (cron + KV) |
| `worker/regintel-admin-proxy/` | Frozen 410 stub on the old workers.dev hostname |

Pre-site OpenLaws diff / change-tag scripts and the current parser skill live
in the operator workspace (`RegIntel_Work/01_Tooling/`), not this repo.
Approved monthly packages are applied into `requirements.json` from that
workspace after `complete-review`.

Admin sidebar links are a UI gate only (see [CONTRIBUTING.md](CONTRIBUTING.md)).
GitHub writes require `ADMIN_TOKEN`.

## Branches

| Branch | Role |
|---|---|
| `main` | **Default.** Cloudflare Worker `regintel` (site + `/api`) plus GitHub source. |
| `admin-workflow-redesign` | Merged feature branch. Archive-only. |
| `archive/ai-ingest-tools` | Frozen snapshot of in-browser AI ingest tools — parsing does **not** belong on the live site. |
