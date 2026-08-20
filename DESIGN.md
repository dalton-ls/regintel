# RegIntel — Site Design

> **Status: live.** Phases 1–4, 6, and 7 of the knowledge-architecture
> vision are in the site. Phase 5 (Organizational Artifact crosswalk) is
> **permanently out of scope**. This document describes what the **site**
> is, what happens before it is populated, and how the current flattened
> projection maps to that architecture. Field-level extraction rules live
> in `PHASE 1/Metadata Summary v3.xlsx`. The broader ontology lives in
> `RegIntel Knowledge Architecture v3.docx` (document title: Version 5.0).
> How admin writes actually commit:
> [worker/regintel-admin-proxy/README.md](worker/regintel-admin-proxy/README.md).

## 1. What this site is

RegIntel is **regulatory knowledge infrastructure** with three experiences
on one engine:

| Experience | Question |
|---|---|
| Intelligence | What changed? |
| Policy | What kinds of organizational / product change may be required? |
| Workforce | Who needs to know or do something differently? |

This GitHub Pages app is the **Intelligence + Policy + Workforce research view**,
plus human-QA admin, over a flattened **output-row projection**. It is
not the parser, not the source corpus, and not the ontology.

The underlying question is no longer “does this regulation create a
training obligation?” It is: **what obligations does this source create,
who/what do they apply to, and what kind of organizational response is
implicated?** Which concrete HealthStream products are affected is inferred
by the consumer outside this site.

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
tags, applicability/impact tags). `normalize_batch.py` only
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
- **Obligation ID** identifies the underlying regulatory requirement
  before row explosion. It is distinct from Record ID and is stored on the
  row as `Obligation ID` so related projections can share classification
  and impact.
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

**Organizational implementation** (what must change): **Impact Types**
only. One requirement may carry multiple Impact Types (Policy + Training +
Documentation, etc.). RegIntel does **not** store Organizational Artifact
crosswalks, catalog IDs, or “affected_policies: 7” counts. Those concrete
references live in downstream HealthStream products. Here, **Impact Type +
Applicability (HSTM Setting / Role / Jurisdiction)** is the terminal signal;
the operator infers which downstream products (policy management, training
modules, competency programs, etc.) may be affected.

`Regulation Type` (Facility-Based/Organizational Training,
Individual/Continuing Education, Organizational Policy) remains a
**routing / compatibility** field for the current workforce product. It
is not the ontology. Impact Type is.

## 5. Current projection schema

The live file is still a flat output-row projection. The parser skill now
emits **47 columns**. The original 20 extraction columns plus Record ID
remain the identity core. The other 27 are additive — none participates
in the Record ID hash — so every ID minted under the 20-column schema
stays valid.

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
- `Approval Required` ∈ {Yes, No, Unknown}. Rationale lives in Approval Basis.
  `Unknown` is a filterable review state for unresolved cross-references,
  not a Yes/No guess.
- `Explicit Training` is derived from Requirement Level; never set
  independently.
- Neither Authority Level nor Approval Basis participates in the Record
  ID hash, so the 18 → 20 migration was additive.

Operator notes that are easy to get wrong:

- Federal jurisdiction is `US`, never `Federal`.
- Hours Required is `NR` when the source does not state a number, not `0`.
- Frequency stays verbatim regulatory language; do not canonicalize.
- Citation is mechanical (CITATION FORMAT tab), never freely composed.

### 5.2 Additive intelligence fields (Phases 2–4 — implemented)

These are **not** part of the Record ID hash. For extraction sheets,
absence means “no opinion yet,” not “clear this.” Pending Review treats
absent vs present-empty that way so an older extraction sheet cannot
blank newer fields.

For a **classified Impact Type batch**, v4 is stricter: a missing
`Impact Types` field is a classification error. An empty array is
allowed only when the classifier has a reasoned conclusion that no
supported organizational response is present.

| Field | Shape | Closed values | Produced by |
|---|---|---|---|
| Change Type | string | New, Amended, Removed, Administrative-non-material | Pre-site diff → Pending Review tag batch |
| Change Detected Date | ISO date | — | Diff run timestamp |
| Change Source Path | string | — | OpenLaws path that triggered the match |
| Applicability Rules | array of objects | Anchor: setting / role / organization_type / profession / activity | Human-authored via Pending Review |
| Impact Types | array of strings | **Policy, Procedure, Training, Competency, Credential, Documentation, Workflow, Staffing, Reporting, Audit, Physical Environment** | Parser first-pass (stage 5b); human QA/override in Pending Review |
| Impact Basis | string | — | Parser evidence rationale; required with a classified Impact Types value |
| Impact Confidence | string | High, Medium, Low | Parser confidence |
| Impact Review | boolean | true = needs QA | Parser review flag |

Impact Type is a **closed taxonomy** (Phase 4). One obligation may carry
**multiple** tags. Impact Type names **what kind** of organizational
response is required — not a specific policy ID or training module.
Definitions live in [`impact-types.js`](impact-types.js).

`Impact Basis`, `Impact Confidence`, and `Impact Review` are first-class
classification metadata on the same row. They are not stored in
`Notes / Research Flags`. Downstream product impact is **inferred** from
Impact Type + care-setting / role / jurisdiction applicability, not stored
as catalog references.

Legacy rows may still carry `Other` from an earlier product-routing pass;
the site displays it but advises replacing it with specific types.

Applicability Rule is a parallel, additive check. It does **not** replace
the output-row anchor (Setting OR Role). A rule with only
jurisdiction/authority/circumstance set has no target.

### 5.3 Parser routing and interpretation (47-column batch)

A classified parser batch also carries product-routing and interpretation
fields. Vocabularies live in [`schema.js`](schema.js). Empty still means
“no opinion” on an older extraction sheet.

| Field | Closed values | Role |
|---|---|---|
| Product Use Case | Training/Content, Policy Manager, Quality Manager, Multiple, Research-only, Unknown | Router. Research-only / Unknown stop product-specific judgment. |
| Policy Action Relevance | Create/Update Policy, Review Existing Policy, Policy Not Indicated, Unknown | Regulatory implication only — not a template ID or owner. |
| Quality Manager Relevance | SNF operational logic, SNF quality/safety action, PIP/PDSA, Not applicable, Unknown | Currently SNF-only except PIP/PDSA. |
| Operational Domain | Investigations, Facility Assessment, Survey Process, Quality/Safety, Policy/Procedure, Infection Control, Other, Unknown | Operational area implicated. |
| Source Change Context / Regulatory Change Summary / Interpretive Summary | free text | Three layers: verbatim excerpt, source-grounded requirement, product implication. |
| Approval Scope / Responsibility / Timing, Instructor/SME Qualification, Prior Training Credit | see schema.js | Approval family. Activated by training/CE gates; skipped on Organizational Policy. |

The research-view **Policy Manager** sidebar is the Policy experience:
rows whose Regulation Type is Organizational Policy, whose Impact Types
include Policy or Procedure, or whose parser routing marks Policy Manager
/ Create-or-Review. It is not a leftover `Regulation Type` value.

Workforce Readiness (`wr.json`) stays a separate Domain/KSA framework.
None of the unified admin tools write to it.

## 6. Type-level impact — not customer counts

Facility/Learner Query is a **reusable archetype** (Jurisdiction × HSTM
Setting × HSTM Role), not a customer. Forward query: which obligations
apply to this *type* of facility/learner? Reverse query: which type-level
dimensions — including Impact Types — a record touches. Neither query
uses customer rosters or catalog IDs.

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
   included; structured Applicability objects are not bulk-edited from a
   plain text box).
3. **Pending Review** — classify an incoming batch by Record ID. New IDs
   can be added; differing content is always queued. **Nothing
   auto-overwrites.** This is also how change tags and applicability/impact
   tags enter the projection.
4. **Export** — convenience snapshot, not the write path.

Human QA is part of the architecture: the site does not parse source
text. It reviews already-classified output. For Impact Types, humans
**override** parser judgments; they do not supply the primary tags.

## 8. Out of scope for this site

- Parsing or diffing OpenLaws inside the browser.
- Treating the Excel extraction spec as the runtime data model.
- A graph database.
- Customer-specific facility or learner rosters, or storing “N learners
  affected” on a regulatory row.
- **Organizational Artifact crosswalks** — no policy IDs, training module
  IDs, placeholder catalog entries, or artifact counts in
  `requirements.json`. Impact Type + applicability is the handoff for
  inferring downstream products outside this site.
