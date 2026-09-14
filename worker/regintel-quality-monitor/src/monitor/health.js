export function healthViewModel(payload, loading) {
  if (loading) {
    return {
      state: "loading",
      title: "Refreshing",
      detail: "Live request in progress.",
      warning: "Live request in progress.",
    };
  }
  if (!payload) {
    return {
      state: "loading",
      title: "Refreshing",
      detail: "Waiting for the Worker.",
      warning: "Waiting for the Worker.",
    };
  }
  const failed = (payload.sources || []).filter((s) => !s.ok);
  const emptyOk = (payload.sources || []).filter((s) => s.ok && s.status === "empty");
  const labels = {
    ok: "Fresh",
    partial: "Partial",
    failed: "Failed",
    stale: "Stale",
    empty: "No items found",
  };
  const title = payload.fallback ? "Stale fallback" : (labels[payload.overallStatus] || payload.overallStatus);
  const warnings = [];
  if (payload.fallback) {
    warnings.push(`Showing cached fallback from ${payload.generatedAt || "unknown"}. Live ingest failed: ${payload.fallbackReason || "unknown"}.`);
  } else if (payload.stale) {
    warnings.push("Displayed data is older than the freshness window.");
  }
  if (payload.overallStatus === "partial" || failed.length) {
    warnings.push(`${failed.length} source${failed.length === 1 ? "" : "s"} failed. Incomplete data is not a full refresh.`);
  }
  if (payload.overallStatus === "failed") warnings.push("Ingestion is unavailable. Nothing on this tab is a successful load.");
  if (payload.overallStatus === "empty") warnings.push("Sources responded, but no in-scope items were found.");
  if (emptyOk.length && payload.overallStatus !== "empty") {
    warnings.push(`${emptyOk.length} source${emptyOk.length === 1 ? "" : "s"} returned no items.`);
  }
  return {
    state: payload.fallback ? "stale" : payload.overallStatus,
    title,
    detail: "",
    warning: warnings.join(" "),
    failedCount: failed.length,
    emptyCount: emptyOk.length,
  };
}

export function formatCacheAge(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
