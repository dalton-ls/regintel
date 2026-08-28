(function () {
  window.REGINTEL_ORIGIN = "https://regintel.regintel.workers.dev";
  if (typeof location === "undefined") return;
  if (location.hostname !== "dalton-ls.github.io") return;
  const rest = location.pathname.replace(/^\/regintel\/?/, "/") || "/";
  location.replace(window.REGINTEL_ORIGIN + rest + location.search + location.hash);
})();
