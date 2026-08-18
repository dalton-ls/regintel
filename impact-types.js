// Phase 4 — Impact Type closed taxonomy (single source of truth for the site).
// Names WHAT kind of organizational response an Obligation demands once it
// applies. One obligation may carry multiple tags. RegIntel stops here:
// downstream products (specific policies, training modules, etc.) are
// inferred by the operator from Impact Type + HSTM Setting/Role/Jurisdiction —
// not stored as Organizational Artifact crosswalks in this site.
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
