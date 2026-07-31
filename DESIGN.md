# RegIntel Data Model & Admin Workflow — Design Document

> **Status: implemented and live.** The schema in §2, the migration in §4,
> and all four screens in §5 exist and are merged into the deployment
> branch. See [README.md](README.md) for the current file layout and
> [worker/regintel-admin-proxy/README.md](worker/regintel-admin-proxy/README.md)
> for how the admin tools actually commit changes (a detail this design
> doc doesn't specify — it was decided during implementation, see below).

## 1. Overview

RegIntel currently stores regulatory content as separate JSON files per content type (Workforce Readiness, Role, Care Setting), edited only through read-only preview/upload "ingest" tools, with no ability to edit individual records or push edits back into version-controlled files. As research scales to all 50 states plus federal, and as OpenLaws/RegWatch begins feeding data in at volume, this document defines a unified data model and an admin workflow that supports rapid bulk ingestion, individual and at-scale editing, and safe handling of conflicting updates.

## 2. Unified Requirements Schema

Care Setting and Role data merge into one table, since a single regulation frequently applies to both a setting and a role (e.g., a Texas SNF regulation that is also binding on RNs working there). Each record has the following fields:

- Record ID — stable, immutable identifier assigned once per record; used for all edits, dedup, and conflict detection instead of string-matching on content fields.
- Jurisdiction — Federal or a specific state.
- Jurisdiction Setting — the care setting as named in the source regulation (optional).
- Jurisdiction Role — the professional title as named in the source regulation, verbatim (optional).
- HSTM Setting — canonical HealthStream care-setting taxonomy value mapped from Jurisdiction Setting.
- HSTM Role — canonical HealthStream role taxonomy value mapped from Jurisdiction Role.
- Regulation Type — Facility-based/Organizational training, Individual/Continuing Education, or Organizational Policy. This field also acts as the signal for which admin "lane" (Care Setting vs. Role) a record is primarily associated with.
- Oversight / Professional Agency — the regulatory/licensing body with enforcement authority.
- Requirement Level — Explicit Training or Other Training Reference. **Specificity axis only** (see §2.1).
- Authority Level — Federal Floor, State Floor, or Competency. **Authority axis only** (see §2.1).
- Explicit Training — Yes/No, derived from Requirement Level. Not independently editable.
- Citation — full regulatory citation, BB-style per OpenLaws formatting.
- Training Topic / Competency Item — the specific training subject, one per row.
- Relationship — Parent (domain) or Child (KSA/sub-topic).
- Purpose — brief explanation of the training's regulatory intent.
- Approval Required — bare Yes/No, so the field stays filterable.
- Approval Basis — freeform rationale for the approval determination (e.g. "CDPH-approved program"). Empty when there is none.
- Hours Required — numeric value or "NR."
- Frequency — One-time, Annual, Biennial, Upon hire, Before performing duties, Ongoing, etc.
- Source URL — link to the primary regulatory source.
- Notes / Research Flags — free-text internal annotation.

Validation rule: every record must have at least one of Jurisdiction Setting or Jurisdiction Role populated (both, when the regulation applies to both).

Additional validation rules, enforced at all four write paths (`migrate_to_unified.py`, `record-editor.html`, `bulk-apply.html`, `pending-review.html`):

- `Requirement Level` ∈ {`Explicit Training`, `Other Training Reference`}
- `Authority Level` ∈ {`Federal Floor`, `State Floor`, `Competency`}
- `Approval Required` ∈ {`Yes`, `No`} — the old verbose forms are rejected so vocabulary drift cannot reappear
- `Explicit Training` == `Yes` iff `Requirement Level` == `Explicit Training`. It is *derived*, never set independently.

### 2.1 The two-axis split (18 → 20 fields)

The original schema had 18 fields and a single `Requirement Level` that silently
conflated two independent dimensions:

| Value | Dimension it actually described |
|---|---|
| `Explicit Training` | specificity — how detailed is the mandate |
| `Competency` | specificity |
| `State Floor` | authority — whose floor is it |
| `Federal Floor` | authority |

Because the two axes shared one field, a record could not express "an explicit
training mandate that is a state floor" — picking one value discarded the other.
Splitting them into `Requirement Level` (specificity) and `Authority Level`
(authority) makes both independently filterable.

`Approval Required` had drifted the same way: 51 distinct values across 286
records, most carrying a trailing rationale (`No - employer-administered`,
`Yes - CDPH-approved program`), which made the field useless as a filter. It is
now bare `Yes`/`No`, with the rationale clause preserved verbatim in
`Approval Basis`.

**Neither new field participates in the Record ID hash.** The ID is

```
req_ + sha1(Source Dataset | Citation | Training Topic / Competency Item |
            Jurisdiction | Jurisdiction Role | Jurisdiction Setting)[:12]
```

so the 18 → 20 migration was purely additive: no re-hash, no orphaned admin
edits keyed to an old ID, and no false "new record" classifications in the
Pending Review Queue. `migrate_18_to_20.py` verifies this by recomputing every
Record ID after migrating and asserting the set is unchanged.

`Explicit Training` was previously both editable and derived at the same time,
which is how it could disagree with `Requirement Level`. It is now a computed,
read-only display in `record-editor.html`; `bulk-apply.html` recomputes it in the
same commit whenever `Requirement Level` changes, so a batch cannot desynchronize.

## 3. Workforce Readiness Schema

Kept as its own separate structure (unchanged from today's Domain/KSA model), since it represents an internally authored competency framework rather than jurisdiction-driven regulatory mandates.

## 4. Ingestion & Conflict Handling

Pipeline: OpenLaws (raw regulations) -> RegWatch AI parser (maps into the schema above) -> Excel output -> uploaded into RegIntel via an ingest tool.

On upload, each incoming record is checked against existing Record IDs:

- New Record ID -> added directly to the unified table.
- Existing Record ID with identical content -> no action needed.
- Existing Record ID with differing content -> always routed to a Pending Review Queue. There is no automatic overwrite under any circumstance, since an update may reflect a genuine regulatory change or may conflict with a manual correction already made in RegIntel — either way, it must be reviewed and is flagged to the content development team before anything changes.

## 5. Admin Interface

Four screens support the workflow:

1. Individual Record Editor — search/select a single record, edit any field in a form, save. Used for spot corrections.
2. Filter -> Bulk-Apply Tool — filter records by any combination of Jurisdiction, HSTM Setting, HSTM Role, Regulation Type, etc.; preview the matching set; apply a single field change across all matching records at once, with a preview step before committing.
3. Pending Review Queue — lists every incoming record that conflicts with existing data, showing a field-by-field diff (existing vs. incoming); the reviewer chooses to keep existing, use incoming, or manually reconcile. Nothing here applies automatically.
4. Export — generates the current dataset as JSON (Requirements and/or Workforce Readiness) as a manual backup download.

**Implementation note:** screens 1–3 commit directly to `requirements.json` on GitHub as each save/apply happens (via the Cloudflare Worker proxy — see the README linked above), rather than requiring a separate manual "commit into the repository yourself" step as originally envisioned here. This was a deliberate scope decision to support one operator working from multiple computers without a localStorage-based handoff. Export's role changed accordingly: it's now a convenience snapshot, not the mechanism by which edits reach the repository.

## 6. Out of Scope (for now)

Facility subtypes, accreditation bodies (Joint Commission/DNV/CARF), and multi-level research-status tracking are explicitly excluded from this iteration, per direction to keep the schema and workflow minimal and focused on efficient large-scale ingestion and editing.
