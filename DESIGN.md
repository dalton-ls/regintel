# RegIntel — Site Design

> **Status: live.** Phases 1–7 of the knowledge-architecture vision are in
> the site. This document describes what the **site** is, what happens
> before it is populated, and how the current flattened projection maps
> to that architecture. Field-level extraction rules live in
> `PHASE 1/Metadata Summary v3.xlsx`. The broader ontology lives in
> `RegIntel Knowledge Architecture v3.docx`. How admin writes actually
> commit: [worker/regintel-admin-proxy/README.md](worker/regintel-admin-proxy/README.md).

## 1. What this site is

RegIntel is **regulatory knowledge infrastructure** with three experiences
on one engine:

| Experience | Question |
|---|---|
| Intelligence | What changed? |
| Policy | What organizational artifacts need to change? |
| Workforce | Who needs to know or do something differently? |

This GitHub Pages app is the **Intelligence + Workforce research view**,
plus human-QA admin, over a flattened **output-row projection**. It is
not the parser, not the source corpus, and not the ontology.

The underlying question is no longer “does this regulation create a
training obligation?” It is: **what obligations does this source create,
who/what do they apply to, and which HealthStream product types
what HealthStream product types are affected?**

## 2. System boundary — parsing happens before the site

```text
OpenLaws monthly JSON
        │
        ▼
Source-level temporal diff          (jsonl_diff / diff_guide)
        │
        ▼
AI + structural parsing             (pre-site; not this repo)
        │
        ▼
Requirement extraction
Obligation grouping
Classification
        │
        ▼
Output JSON  ──────────────────────►  REGINTEL
                                         │
                          research view + admin QA
```

The site **never parses OpenLaws JSON**. Monthly snapshots, diffs, and
AI-facilitated extraction run before `requirements.json` is populated.
Incoming files are already-classified batches (extraction sheets, change
tags, applicability/impact/artifact tags). `normalize_batch.py` only
normalizes an already-extracted 20-column sheet for Pending Review.

The pre-site pipeline lives beside this repo (`PHASE 1/`, `PHASE 2 DIFF/`),
not inside it.

## 3. Normalized core → product projection

The 20-column (+ additive) row in `requirements.json` is a **projection**
used by the current product. It is not the knowledge model.

- **Record ID** identifies one **output row** (a per-setting/role
  projection). Hash:
  `req_` + sha1(Source Dataset | Citation | Training Topic | Jurisdiction |
  Jurisdiction Role | Jurisdiction Setting)[:12]
- **Obligation** identity (`obligation_id` / pipeline `parent_key`) is a
  grouping concept in extraction. It is not persisted as a key on the row.
- **Source Dataset** (`Role` | `Care Setting`) is a legacy extraction
  lane, not a property of the regulation.

Do not store derived counts (“7 policies”, “4,300 learners”) on the row.
Those are computed from type-level applicability, not from customer
rosters.

## 4. Three taxonomies — do not mix them

**Regulatory reality** (what the source says): Jurisdiction, Jurisdiction
Setting, Jurisdiction Role, Oversight / Professional Agency, Citation,
verbatim Training Topic, Frequency, Hours.

**HealthStream product taxonomy** (how we organize): HSTM Setting, HSTM
Role, Regulation Type. Jurisdiction Setting ≠ HSTM Setting.

**Organizational implementation** (what must change): Impact Types →
Organizational Artifacts. One requirement can carry multiple Impact
Types.

`Regulation Type` (Facility-Based/Organizational Training,
Individual/Continuing Education, Organizational Policy) remains a
**routing / compatibility** field for the current workforce product. It
is not the ontology. Impact Type is.

## 5. Current projection schema

### 5.1 Extraction columns (the original 20)

Canonical definitions: Metadata Summary v3, FIELDS tab. Emission order:

Jurisdiction, Jurisdiction Setting, Jurisdiction Role, HSTM Setting,
HSTM Role, Regulation Type, Oversight / Professional Agency,
Requirement Level, Authority Level, Explicit Training, Citation,
Training Topic / Competency Item, Relationship, Purpose, Approval
Required, Approval Basis, Hours Required, Frequency, Source URL,
Notes / Research Flags.

Invariants enforced at every write path (`migrate_to_unified.py`,
Record Editor, Bulk-Apply, Pending Review):

- Anchor: at least one of Jurisdiction Setting or Jurisdiction Role.
- `Requirement Level` ∈ {Explicit Training, Other Training Reference}
  — **specificity only**.
- `Authority Level` ∈ {Federal Floor, State Floor, Competency}
  — **authority only**. The 18 → 20 split exists because these two axes
  used to share one field.
- `Approval Required` ∈ {Yes, No}. Rationale lives in Approval Basis.
- `Explicit Training` is derived from Requirement Level; never set
  independently.
- Neither Authority Level nor Approval Basis participates in the Record
  ID hash, so the 18 → 20 migration was additive.

Operator notes that are easy to get wrong:

- Federal jurisdiction is `US`, never `Federal`.
- Hours Required is `NR` when the source does not state a number, not `0`.
- Frequency stays verbatim regulatory language; do not canonicalize.
- Citation is mechanical (CITATION FORMAT tab), never freely composed.

### 5.2 Additive intelligence fields (Phases 2–5 — implemented)

These are **not** part of the Record ID hash. Absence means “no opinion
yet,” not “clear this.” Pending Review treats absent vs present-empty
that way so an older extraction sheet cannot blank newer fields.

| Field | Shape | Closed values | Produced by |
|---|---|---|---|
| Change Type | string | New, Amended, Removed, Administrative-non-material | Pre-site diff → Pending Review tag batch |
| Change Detected Date | ISO date | — | Diff run timestamp |
| Change Source Path | string | — | OpenLaws path that triggered the match |
| Applicability Rules | array of objects | Anchor: setting / role / organization_type / profession / activity | Human-authored via Pending Review |
| Impact Types | array of strings | **Policy, Procedure, Training, Competency, Credential, Documentation, Workflow, Staffing, Reporting, Audit, Physical Environment** | Human-authored via Pending Review |
| Organizational Artifacts | array of objects | `artifact_type` ∈ Impact Types | Human-authored via Pending Review (placeholder catalog until a real HSTM catalog exists) |

Impact Type is a **closed taxonomy** (Phase 4). One obligation may carry
**multiple** tags — e.g. Policy + Training + Documentation at once. Impact
Type names **what kind** of organizational response is required; Phase 5's
Organizational Artifacts name the specific **which** (which policy, which
module). Definitions live in [`impact-types.js`](impact-types.js).

Legacy rows may still carry `Other` from an earlier product-routing pass;
the site displays it but advises replacing it with specific types.

Applicability Rule is a parallel, additive check. It does **not** replace
the output-row anchor (Setting OR Role). A rule with only
jurisdiction/authority/circumstance set has no target.

Workforce Readiness (`wr.json`) stays a separate Domain/KSA framework.
None of the unified admin tools write to it.

## 6. Type-level impact — not customer counts

Facility/Learner Query is a **reusable archetype** (Jurisdiction × HSTM
Setting × HSTM Role), not a customer. It answers “which obligations
apply to this *type* of facility/learner?” across both extraction lanes.

When a classified batch is uploaded into Pending Review, the queue shows
**type-level scope** for the incoming rows: how many and which care
settings, how many and which roles, for which jurisdictions, broken down
by Impact Type (the Phase 4 closed taxonomy). Those dimensions are
filterable. Nothing here is a headcount of learners or a count of a
named customer’s policies.

## 7. Admin workflow

Four screens, all reading/writing the projection file
`requirements.json` on GitHub via the Cloudflare Worker:

1. **Record Editor** — spot-correct one output row.
2. **Bulk-Apply** — one field change across a filtered set (Impact Types
   included; structured Applicability / Artifact objects are not
   bulk-edited from a plain text box).
3. **Pending Review** — classify an incoming batch by Record ID. New IDs
   can be added; differing content is always queued. **Nothing
   auto-overwrites.** This is also how change tags and
   applicability/impact/artifact tags enter the projection.
4. **Export** — convenience snapshot, not the write path.

Human QA is part of the architecture: the site proposes nothing about
raw source text. It reviews already-classified output.

## 8. Out of scope for this site

- Parsing or diffing OpenLaws inside the browser.
- Treating the Excel extraction spec as the runtime data model.
- Persisting `obligation_id` on the JSON (still a pipeline grouping key).
- A graph database.
- Customer-specific facility or learner rosters, or storing “N learners
  affected” on a regulatory row.
- Replacing placeholder Organizational Artifacts with a live HealthStream
  catalog (blocked on that catalog existing).
