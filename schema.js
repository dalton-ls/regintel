// Parser skill output contract (47 columns). Shared by the research view,
// admin screens, and normalize_batch.py's JS counterparts.
//
// Extraction columns (1–20, plus Record ID / Obligation ID) are the original
// projection. The rest are additive: none participate in the Record ID hash,
// so v2 IDs remain valid. Headers must match the parser byte-for-byte.
// `Change Source path` is the parser spelling; the site also accepts the
// earlier `Change Source Path`.
// Impact Basis / Confidence / Review are not in this 47-column list. The
// current skill keeps 5b-4 evidence in Notes / Research Flags. Ingest still
// copies those three fields through when an older batch includes them.

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

const SCHEMA_VOCAB = {
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
  "Source Change Context"
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
