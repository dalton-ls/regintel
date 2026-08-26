(function () {
  const page = document.body.dataset.page || '';
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const icon = (path) =>
    `<span class="nav-icon"><svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">${path}</svg></span>`;

  const I = {
    home: '<path fill-rule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" clip-rule="evenodd"/>',
    monitor: '<path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>',
    roles: '<path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>',
    care: '<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>',
    policy: '<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/>',
    facility: '<path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zm14 5H2v7a2 2 0 002 2h12a2 2 0 002-2V9zM9 11a1 1 0 112 0 1 1 0 01-2 0zm-4 0a1 1 0 112 0 1 1 0 01-2 0zm8 0a1 1 0 112 0 1 1 0 01-2 0z" clip-rule="evenodd"/>',
    workforce: '<path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 14.094A5.973 5.973 0 004 17v1H1v-1a3 3 0 013.75-2.906z"/>',
    ingest: '<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>',
    bulk: '<path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd"/>',
    review: '<path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clip-rule="evenodd"/>',
    export: '<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/>',
  };

  function link(href, id, label, key) {
    const active = page === id ? ' active' : '';
    return `<a href="${href}" class="nav-item${active}">${icon(I[key])}<span class="nav-label">${label}</span></a>`;
  }

  sidebar.innerHTML = `
    <nav class="sidebar-nav">
      ${link('index.html', 'home', 'Home', 'home')}
      <div class="nav-section">Intelligence</div>
      ${link('regintel.html#quality-monitor', 'quality-monitor', 'Quality Monitor', 'monitor')}
      ${link('regintel.html#roles', 'roles', 'Obligations by Role', 'roles')}
      ${link('regintel.html#care-settings', 'care-settings', 'Obligations by Care Setting', 'care')}
      <div class="nav-section">Query</div>
      ${link('regintel.html#policy', 'policy', 'Policy', 'policy')}
      ${link('regintel.html#profile', 'profile', 'Facility/Learner', 'facility')}
      ${link('regintel.html#workforce', 'workforce', 'Workforce Readiness', 'workforce')}
      <div id="adminNav">
        <div style="border-top:1px solid #e2e8f0;margin:12px 0;"></div>
        ${link('ingest.html', 'ingest', 'WR Ingest', 'ingest')}
        ${link('bulk-apply.html', 'bulk-apply', 'Bulk-Apply', 'bulk')}
        ${link('pending-review.html', 'pending-review', 'Pending Review', 'review')}
        ${link('export.html', 'export', 'Export', 'export')}
      </div>
    </nav>`;

  const toggle = document.getElementById('sidebarToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }
})();
