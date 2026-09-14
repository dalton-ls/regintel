// Parser skill output contract (50 columns). Shared by the research view,
// admin screens, and normalize_batch.py's JS counterparts.
//
// Extraction columns (1–20, plus Record ID / Obligation ID) are the original
// projection. The rest are additive: none participate in the Record ID hash,
// so v2 IDs remain valid. Headers must match the parser byte-for-byte.
// `Change Source path` is the parser spelling; the site also accepts the
// earlier `Change Source Path`.
// Impact Basis / Confidence / Review are not in the parser emit list. The
// current skill keeps 5b-4 evidence in Notes / Research Flags. Ingest still
// copies those three fields through when an older batch includes them.
// Canonical Role / Role Qualifier / Display Role are columns 48–50.
// Role Classification Status is live-only (not emitted by the parser).
// Program is live-only too: a closed set of training-topic families used as
// the research-view grouping level (State > Agency > Program > requirement).
// Assigned by scripts/assign_program.py after each apply; never hashed.

const EXTRACTION_COLUMNS = [
  "Jurisdiction",
  "Jurisdiction Setting",
  "Jurisdiction Role",
  "HSTM Setting",
  "HSTM Role",
  "Regulation Type",
  "Oversight / Professional Agency",
  "Requirement Level",
  "Authority Level",
  "Explicit Training",
  "Citation",
  "Training Topic / Competency Item",
  "Relationship",
  "Purpose",
  "Approval Required",
  "Approval Basis",
  "Hours Required",
  "Frequency",
  "Source URL",
  "Notes / Research Flags"
];

const PARSER_COLUMNS = [
  "Jurisdiction",
  "Jurisdiction Setting",
  "Jurisdiction Role",
  "HSTM Setting",
  "HSTM Role",
  "Regulation Type",
  "Oversight / Professional Agency",
  "Requirement Level",
  "Authority Level",
  "Explicit Training",
  "Citation",
  "Related Regulatory Provisions",
  "Training Topic / Competency Item",
  "Relationship",
  "Purpose",
  "Approval Required",
  "Approval Basis",
  "Approval Scope",
  "Approval Responsibility",
  "Approval Timing",
  "Instructor/SME Qualification Required",
  "Hours Required",
  "Frequency",
  "Source URL",
  "Notes / Research Flags",
  "Change Type",
  "Change Detected Date",
  "Change Source path",
  "Applicability Rules",
  "Impact Types",
  "Record ID",
  "Obligation ID",
  "Provision Relationship Types",
  "Interpretive Conditions",
  "Prior Training Credit / Exemption",
  "Prior Training Qualification",
  "Interpretive Review Status",
  "Regulatory Lifecycle Stage",
  "Product Use Case",
  "Regulated Competency",
  "Regulatory Change Summary",
  "Interpretive Summary",
  "Policy Action Relevance",
  "Quality Manager Relevance",
  "Operational Domain",
  "Human Interpretation / SME Review",
  "Source Change Context"
];

const ROLE_NOMENCLATURE_FIELDS = [
  "Canonical Role",
  "Role Qualifier",
  "Display Role",
  "Role Classification Status"
];

// Fallback only. The live vocabulary is program-taxonomy.json (both lanes);
// loadProgramVocab() below fetches it and unions it with whatever Program
// values already exist on rows, so an ad-hoc value is never rejected by a
// dropdown. Edit the JSON, not this list.
const PROGRAM_VOCAB_FALLBACK = [
  "Orientation & Staff Development",
  "Administrator & Leadership Qualification",
  "Nurse Assistant Certification & In-Service",
  "EMS & Prehospital Personnel",
  "Home Care & Home Health Aide Training",
  "Dementia & Cognitive Care",
  "Medication Administration & Assistance",
  "Restricted Health Conditions & Specialized Care",
  "Personal Care & ADL Assistance",
  "Hospice & End-of-Life Care",
  "Infection Prevention & Control",
  "Emergency Preparedness & Disaster Response",
  "CPR, First Aid & AED",
  "Resident Rights, Abuse Prevention & Ethics",
  "Behavioral Health & Special Treatment Programs",
  "Patient Safety, Security & Violence Prevention",
  "Cultural Competency & Health Equity",
  "Perinatal, Newborn & Pediatric Care",
  "Child & Youth Care",
  "Food & Dietetic Services",
  "Clinical Service Line Competency",
  "Policies, Procedures & Documentation",
  "Public Health & Other Licensed Programs",
  "Initial Certification & Licensure Training",
  "Certification Renewal & Continuing Education",
  "Competency Evaluation & Examination",
  "Training Program & Vendor Approval",
  "Specialty Permit & Expanded Scope",
  "Unassigned (needs review)"
];
const PROGRAM_VOCAB = PROGRAM_VOCAB_FALLBACK.slice();

// Returns { labels, byLane: {laneName: [labels]}, unassigned, version }.
// `records` (optional) adds any Program value present on live rows.
async function loadProgramVocab(records) {
  let tax = null;
  try {
    const res = await fetch("program-taxonomy.json", { cache: "no-store" });
    if (res.ok) tax = await res.json();
  } catch (e) { /* fall through to fallback */ }
  const byLane = {};
  const labels = [];
  const seen = new Set();
  const push = v => { if (v && !seen.has(v)) { seen.add(v); labels.push(v); } };
  const unassigned = (tax && tax.unassigned_label) || "Unassigned (needs review)";
  if (tax && tax.lanes) {
    Object.keys(tax.lanes).forEach(lane => {
      byLane[lane] = (tax.lanes[lane].programs || []).map(p => p.label);
      byLane[lane].forEach(push);
    });
  } else {
    PROGRAM_VOCAB_FALLBACK.forEach(push);
  }
  (Array.isArray(records) ? records : []).forEach(r => push(r && r["Program"]));
  push(unassigned);
  return { labels, byLane, unassigned, version: tax ? tax.version : null, live: !!tax };
}


const SCHEMA_VOCAB = {
  "Program": PROGRAM_VOCAB,
  "Jurisdiction": ["US"],
  "Authority Level": ["Federal Floor", "State Floor", "Competency"],
    "HSTM Role": [
    "Clinical, Medication Dispensing",
    "Clinical, Non-Medication Dispensing",
    "Non-Clinical, Patient-Facing",
    "Non-Clinical, Non-Patient Facing",
    "Managerial Staff",
    "Physicians & Practitioners"
  ],
  "Role Classification Status": ["Classified", "Needs Classification"],
  "Regulation Type": [
    "Facility-Based/Organizational Training",
    "Individual/Continuing Education",
    "Organizational Policy"
  ],
  "Requirement Level": ["Explicit Training", "Other Training Reference"],
  "Explicit Training": ["Yes", "No"],
  "Relationship": ["Parent", "Child"],
  "Approval Required": ["Yes", "No", "Unknown"],
  "Approval Scope": [
    "Program/Curriculum",
    "Instructor/SME",
    "Facility Documentation",
    "Learner Credential",
    "Unknown",
    "Not Applicable"
  ],
  "Approval Responsibility": [
    "HealthStream/Content Provider",
    "Facility",
    "Learner",
    "Shared",
    "Unclear",
    "Not Applicable",
    "Unknown"
  ],
  "Approval Timing": [
    "Before publication/use",
    "Before facility implementation",
    "During/after delivery",
    "Not stated",
    "Unknown"
  ],
  "Instructor/SME Qualification Required": ["Yes", "No", "Unknown"],
  "Prior Training Credit / Exemption": [
    "None stated",
    "Full exemption",
    "Partial credit",
    "Conditional",
    "Unknown"
  ],
  "Change Type": ["New", "Amended", "Removed", "Administrative-non-material"],
  "Provision Relationship Types": [
    "Defines Topic",
    "Adds Approval Condition",
    "Adds Instructor Qualification",
    "Creates Prior-Training Credit",
    "Limits Applicability",
    "Incorporates Requirements",
    "Adds Implementation Condition",
    "Conflicts or Qualifies Primary Section"
  ],
  "Interpretive Review Status": [
    "Not needed",
    "Cross-reference reviewed",
    "Additional-code review needed",
    "Ambiguous"
  ],
  "Regulatory Lifecycle Stage": [
    "Horizon Signal",
    "Proposed/Pre-enactment",
    "Codified/Effective",
    "Amended/Changed",
    "Repealed/Removed"
  ],
  "Product Use Case": [
    "Training/Content",
    "Policy Manager",
    "Quality Manager",
    "Multiple",
    "Research-only",
    "Unknown"
  ],
  "Regulated Competency": ["Yes", "No", "Unknown"],
  "Policy Action Relevance": [
    "Create/Update Policy",
    "Review Existing Policy",
    "Policy Not Indicated",
    "Unknown"
  ],
  "Quality Manager Relevance": [
    "SNF operational logic",
    "SNF quality/safety action",
    "PIP/PDSA",
    "Not applicable",
    "Unknown"
  ],
  "Operational Domain": [
    "Investigations",
    "Facility Assessment",
    "Survey Process",
    "Quality/Safety",
    "Policy/Procedure",
    "Infection Control",
    "Other",
    "Unknown"
  ],
  "Human Interpretation / SME Review": [
    "Not needed",
    "Required",
    "Recommended",
    "Completed",
    "Unknown"
  ]
};

const PIPE_ARRAY_FIELDS = new Set([
  "HSTM Role",
  "Impact Types",
  "Provision Relationship Types",
  "Related Regulatory Provisions"
]);

const JSON_SCHEMA_FIELDS = new Set(["Applicability Rules"]);

const V3_ADDITIVE_FIELDS = [
  "Related Regulatory Provisions",
  "Approval Scope",
  "Approval Responsibility",
  "Approval Timing",
  "Instructor/SME Qualification Required",
  "Change Type",
  "Change Detected Date",
  "Change Source path",
  "Applicability Rules",
  "Impact Types",
  "Obligation ID",
  "Provision Relationship Types",
  "Interpretive Conditions",
  "Prior Training Credit / Exemption",
  "Prior Training Qualification",
  "Interpretive Review Status",
  "Regulatory Lifecycle Stage",
  "Product Use Case",
  "Regulated Competency",
  "Regulatory Change Summary",
  "Interpretive Summary",
  "Policy Action Relevance",
  "Quality Manager Relevance",
  "Operational Domain",
  "Human Interpretation / SME Review",
  "Source Change Context",
  "Canonical Role",
  "Role Qualifier",
  "Display Role",
  "Role Classification Status"
];

const POLICY_ACTION_VALUES = SCHEMA_VOCAB["Policy Action Relevance"];
const PRODUCT_USE_CASE_VALUES = SCHEMA_VOCAB["Product Use Case"];
const OPERATIONAL_DOMAIN_VALUES = SCHEMA_VOCAB["Operational Domain"];

function schemaFirstPresent(record, keys) {
  if (!record || typeof record !== "object") return "";
  for (let i = 0; i < keys.length; i++) {
    const v = record[keys[i]];
    if (v != null && v !== "") return v;
  }
  return "";
}

function splitPipeList(val) {
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (val == null || val === "") return [];
  return String(val).split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
}

function readChangeSourcePath(record) {
  return schemaFirstPresent(record, ["Change Source path", "Change Source Path", "change_source_path"]);
}

function isPolicyRelevant(row) {
  if (!row) return false;
  const regulationType = row.regulation_type || row["Regulation Type"] || "";
  if (regulationType === "Organizational Policy") return true;
  const product = row.product_use_case || row["Product Use Case"] || "";
  if (product === "Policy Manager" || product === "Multiple") return true;
  const action = row.policy_action_relevance || row["Policy Action Relevance"] || "";
  if (action === "Create/Update Policy" || action === "Review Existing Policy") return true;
  const types = Array.isArray(row.impact_types)
    ? row.impact_types
    : splitPipeList(row["Impact Types"]);
  return types.indexOf("Policy") !== -1 || types.indexOf("Procedure") !== -1;
}

function policyActionBadgeClass(action) {
  if (action === "Create/Update Policy") return "badge-policy-create";
  if (action === "Review Existing Policy") return "badge-policy-review";
  if (action === "Policy Not Indicated") return "badge-policy-none";
  return "badge-policy-unknown";
}

function productUseCaseBadgeClass(value) {
  if (value === "Policy Manager") return "badge-puc-policy";
  if (value === "Training/Content") return "badge-puc-training";
  if (value === "Quality Manager") return "badge-puc-quality";
  if (value === "Multiple") return "badge-puc-multiple";
  if (value === "Research-only") return "badge-puc-research";
  return "badge-puc-unknown";
}

function formatHoursDisplay(row) {
  const raw = String((row && (row.hours_raw != null ? row.hours_raw : row["Hours Required"])) || "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "none") return "";
  if (raw.toUpperCase() === "NR") return "NR";
  const n = Number(raw);
  if (!isNaN(n) && n > 0 && String(n) === raw) return n + " hr" + (n !== 1 ? "s" : "");
  return raw;
}

function hasMeaningfulHours(row) {
  return !!formatHoursDisplay(row);
}
