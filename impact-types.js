// Phase 4 — Impact Type closed taxonomy (single source of truth for the site).
// Names WHAT kind of organizational response an Obligation demands once it
// applies. One obligation may carry multiple tags. The parser assigns a
// first-pass, evidence-based judgment; this site is QA/override. Downstream
// products (specific policies, training modules, etc.) are inferred by the
// consumer from Impact Type + HSTM Setting/Role/Jurisdiction — not stored
// as Organizational Artifact crosswalks.
const IMPACT_TYPES = [
  "Policy",
  "Procedure",
  "Training",
  "Competency",
  "Credential",
  "Documentation",
  "Workflow",
  "Staffing",
  "Reporting",
  "Audit",
  "Physical Environment"
];

const IMPACT_TYPE_DEFINITIONS = {
  "Policy": "Requires/affects organizational policy",
  "Procedure": "Requires/affects operational procedure",
  "Training": "Requires workforce training",
  "Competency": "Requires demonstration of competence",
  "Credential": "Requires individual credential/license/CE",
  "Documentation": "Requires documentation/recordkeeping",
  "Workflow": "Changes operational workflow",
  "Staffing": "Changes staffing/qualification requirements",
  "Reporting": "Requires reporting/notification",
  "Audit": "Requires monitoring/assessment",
  "Physical Environment": "Requires environmental/infrastructure change"
};

// Legacy rows may still carry the old product-routing bucket from an earlier pass.
const LEGACY_IMPACT_TYPES = ["Other"];

function isKnownImpactType(type) {
  return IMPACT_TYPES.includes(type) || LEGACY_IMPACT_TYPES.includes(type);
}

const IMPACT_BADGE_SLUGS = {
  "Policy": "policy",
  "Procedure": "procedure",
  "Training": "training",
  "Competency": "competency",
  "Credential": "credential",
  "Documentation": "documentation",
  "Workflow": "workflow",
  "Staffing": "staffing",
  "Reporting": "reporting",
  "Audit": "audit",
  "Physical Environment": "environment",
  "Other": "legacy"
};

function impactBadgeSlug(type) {
  return IMPACT_BADGE_SLUGS[type] || "default";
}

function impactBadgeClass(type) {
  return "badge-impact-" + impactBadgeSlug(type);
}

function impactEditorBadgeClass(type) {
  return "impact-" + impactBadgeSlug(type);
}

function impactEditorChipClass(type) {
  return "chip-impact-" + impactBadgeSlug(type);
}

function impactTypeTitle(type) {
  if (IMPACT_TYPE_DEFINITIONS[type]) return IMPACT_TYPE_DEFINITIONS[type];
  if (LEGACY_IMPACT_TYPES.includes(type)) return "Legacy value — prefer a specific Impact Type";
  return "";
}

function filterValidImpactTypes(types) {
  if (!Array.isArray(types)) return [];
  return types.filter(isKnownImpactType);
}

function buildImpactTypeFacetValues(records) {
  const seen = new Set(IMPACT_TYPES);
  (records || []).forEach(r => {
    const tags = Array.isArray(r.impact_types) ? r.impact_types : (Array.isArray(r["Impact Types"]) ? r["Impact Types"] : []);
    tags.forEach(t => { if (t) seen.add(t); });
  });
  const legacy = LEGACY_IMPACT_TYPES.filter(t => seen.has(t));
  return IMPACT_TYPES.concat(legacy);
}

function initImpactTypeCounts() {
  const counts = {};
  IMPACT_TYPES.forEach(t => { counts[t] = 0; });
  counts["(untagged)"] = 0;
  LEGACY_IMPACT_TYPES.forEach(t => { counts[t] = 0; });
  return counts;
}

// Parser judgment metadata that may travel with Impact Types on older
// classified batches. The current 47-column parser skill does not emit
// these as columns; 5b-4 evidence is in Notes / Research Flags.
const IMPACT_CONFIDENCE_VALUES = ["High", "Medium", "Low"];

function isKnownImpactConfidence(value) {
  return IMPACT_CONFIDENCE_VALUES.includes(value);
}

function normalizeImpactReview(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (value == null || value === "") return null;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return null;
}

function formatImpactReview(value) {
  const flag = normalizeImpactReview(value);
  if (flag === true) return "Needs QA";
  if (flag === false) return "No";
  return "";
}

function readImpactJudgment(record) {
  if (!record || typeof record !== "object") {
    return { types: [], hasTypesField: false, basis: "", confidence: "", review: null };
  }
  const hasTypesField = Object.prototype.hasOwnProperty.call(record, "Impact Types")
    || record.impact_types_present === true;
  const rawTypes = record["Impact Types"] !== undefined ? record["Impact Types"] : record.impact_types;
  const types = Array.isArray(rawTypes) ? rawTypes : [];
  const basis = record["Impact Basis"] || record.impact_basis || "";
  const confidence = record["Impact Confidence"] || record.impact_confidence || "";
  const reviewRaw = record["Impact Review"] !== undefined ? record["Impact Review"] : record.impact_review;
  return {
    types: types,
    hasTypesField: hasTypesField,
    basis: basis,
    confidence: confidence,
    review: normalizeImpactReview(reviewRaw)
  };
}
