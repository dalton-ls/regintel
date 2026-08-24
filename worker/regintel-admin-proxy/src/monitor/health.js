export function healthViewModel(payload) {
  if (!payload) {
    return {
      state: "loading",
      title: "Feeds have not yet loaded",
      detail: "Waiting for the Worker cache.",
      warning: "",
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
  const title = labels[payload.overallStatus] || payload.overallStatus;
  const warnings = [];
  if (payload.stale) warnings.push("Displayed data is older than the freshness window.");
  if (payload.overallStatus === "partial" || failed.length) {
    warnings.push(`${failed.length} source${failed.length === 1 ? "" : "s"} failed. Incomplete data is not a full refresh.`);
  }
  if (payload.overallStatus === "failed") warnings.push("Ingestion is unavailable. Nothing on this tab is a successful load.");
  if (payload.overallStatus === "empty") warnings.push("Sources responded, but no in-scope items were found.");
  if (emptyOk.length && payload.overallStatus !== "empty") {
    warnings.push(`${emptyOk.length} source${emptyOk.length === 1 ? "" : "s"} returned no items.`);
  }
  return {
    state: payload.overallStatus,
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
