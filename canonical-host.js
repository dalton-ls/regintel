(function () {
  if (typeof location === "undefined") return;
  if (location.hostname !== "dalton-ls.github.io") return;
  const rest = location.pathname.replace(/^\/regintel\/?/, "/") || "/";
  location.replace("https://regintel.regintel.workers.dev" + rest + location.search + location.hash);
})();
