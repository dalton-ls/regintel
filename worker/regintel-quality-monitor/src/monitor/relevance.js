const DIRECT_PATTERNS = [
  { id: "skilled_nursing", re: /\bskilled nursing (facility|facilities|care)\b/i },
  { id: "snf", re: /\bSNFs?\b/ },
  { id: "snf_pps", re: /\bSNF PPS\b/i },
  { id: "pdpm", re: /\bPDPM\b/ },
  { id: "cfr_483", re: /\b42\s*C\.?F\.?R\.?\s*(?:part\s*)?483\b/i },
  { id: "nursing_home", re: /\bnursing homes?\b/i },
  { id: "mds", re: /\bMDS(?:\s|-)?(?:3\.0|RAI)?\b/ },
  { id: "rai", re: /\bRAI (manual|process|instrument)\b/i },
  { id: "pbj", re: /\b(PBJ|payroll[- ]based journal)\b/i },
  { id: "snf_qrp", re: /\bSNF QRP\b/i },
  { id: "consolidated_billing", re: /\bconsolidated billing\b/i },
];

const LTC_PATTERNS = [
  { id: "ltc", re: /\blong[- ]term care (facility|facilities|services)?\b/i },
  { id: "ltc_abbrev", re: /\bLTC(?:F)?\b/ },
  { id: "nursing_facility", re: /\bnursing facilit(?:y|ies)\b/i },
];

const OFF_TOPIC = [
  { id: "hospital_ipps", re: /\b(IPPS|inpatient prospective payment(?: systems?)?|hospital inpatient prospective)\b/i, label: "hospital IPPS" },
  { id: "hospice", re: /\bhospice\b/i, label: "hospice" },
  { id: "irf", re: /\b(IRF PPS|inpatient rehabilitation facility|inpatient rehabilitation prospective)\b/i, label: "IRF" },
  { id: "ipf", re: /\b(IPF PPS|inpatient psychiatric facility|inpatient psychiatric prospective)\b/i, label: "IPF" },
];

function matches(patterns, text) {
  return patterns.filter((p) => p.re.test(text)).map((p) => p.id || p.label);
}

/**
 * Deterministic SNF/LTC relevance. The numeric score is advisory only —
 * include/exclude follows classification, never the score alone.
 */
export function classifyRelevance(raw, source) {
  const title = String(raw.title || "");
  const snippet = String(raw.snippet || raw.abstract || "");
  const text = `${title}\n${snippet}`;
  const folder = source.folder || "context";
  const directHits = matches(DIRECT_PATTERNS, text);
  const ltcHits = matches(LTC_PATTERNS, text);
  const offHits = OFF_TOPIC.filter((p) => p.re.test(text));
  const strongSnf = directHits.length > 0;
  const reasons = [];
  let score = directHits.length * 3 + ltcHits.length * 2 - offHits.length * 4;

  if (folder !== "official") {
    const classification = strongSnf ? "direct_snf" : (ltcHits.length ? "long_term_care" : "cross_setting");
    reasons.push(strongSnf
      ? `Context item with SNF signals (${directHits.join(", ")})`
      : (ltcHits.length
        ? `Context item with LTC signals (${ltcHits.join(", ")})`
        : "Context feed item retained for review; not a product-change trigger"));
    return {
      classification,
      include: true,
      score,
      reasons,
      applicability: applicabilityFrom(classification, directHits, ltcHits, offHits),
    };
  }

  const titleOffTopic = OFF_TOPIC.filter((p) => p.re.test(title));
  if (titleOffTopic.length && !strongSnf) {
    reasons.push(`Excluded: title is ${titleOffTopic.map((p) => p.label).join(", ")} without documented SNF relevance`);
    return {
      classification: "excluded",
      include: false,
      score,
      reasons,
      exclusionCode: titleOffTopic[0].id,
      applicability: titleOffTopic.map((p) => p.label).join(", "),
    };
  }

  if (offHits.length && !strongSnf && !ltcHits.length) {
    reasons.push(`Excluded as off-topic (${offHits.map((p) => p.label).join(", ")}) with no SNF or LTC signal`);
    return {
      classification: "excluded",
      include: false,
      score,
      reasons,
      exclusionCode: offHits[0].id,
      applicability: offHits.map((p) => p.label).join(", "),
    };
  }

  if (source.id === "fr-snf-pps" && offHits.length && !/\bSNF PPS\b|\bskilled nursing\b/i.test(title)) {
    reasons.push("Excluded: SNF PPS query returned a non-SNF PPS provider-setting rule");
    return {
      classification: "excluded",
      include: false,
      score,
      reasons,
      exclusionCode: offHits[0].id,
      applicability: offHits.map((p) => p.label).join(", "),
    };
  }

  if (offHits.length && (strongSnf || ltcHits.length)) {
    reasons.push(`Cross-setting: also discusses ${offHits.map((p) => p.label).join(", ")}`);
    if (strongSnf) reasons.push(`SNF relevance: ${directHits.join(", ")}`);
    if (ltcHits.length) reasons.push(`LTC relevance: ${ltcHits.join(", ")}`);
    return {
      classification: "cross_setting",
      include: true,
      score,
      reasons,
      applicability: applicabilityFrom("cross_setting", directHits, ltcHits, offHits),
    };
  }

  if (strongSnf) {
    reasons.push(`Direct SNF: ${directHits.join(", ")}`);
    return {
      classification: "direct_snf",
      include: true,
      score,
      reasons,
      applicability: applicabilityFrom("direct_snf", directHits, ltcHits, offHits),
    };
  }

  if (ltcHits.length) {
    reasons.push(`Long-term care: ${ltcHits.join(", ")}`);
    return {
      classification: "long_term_care",
      include: true,
      score,
      reasons,
      applicability: applicabilityFrom("long_term_care", directHits, ltcHits, offHits),
    };
  }

  reasons.push("Excluded: Official item has no documented SNF or long-term-care relevance");
  return {
    classification: "excluded",
    include: false,
    score,
    reasons,
    exclusionCode: "no_snf_relevance",
    applicability: "",
  };
}

function applicabilityFrom(classification, directHits, ltcHits, offHits) {
  if (classification === "direct_snf") return "Skilled nursing facility";
  if (classification === "long_term_care") return "Long-term care / nursing facility";
  if (classification === "cross_setting") {
    const parts = ["Skilled nursing / LTC"];
    offHits.forEach((p) => parts.push(p.label));
    return parts.join("; ");
  }
  return "";
}

export function relevanceLabel(classification) {
  return {
    direct_snf: "SNF Direct",
    long_term_care: "Long-term care",
    cross_setting: "Cross-setting",
    excluded: "Excluded as off-topic",
  }[classification] || classification;
}
