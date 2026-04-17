const searchInput = document.querySelector('.search-input');
const rows = document.querySelectorAll('.data-table tbody tr');

searchInput?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
});

document.querySelector('.btn-primary')?.addEventListener('click', () => {
  alert('Add Watcher — coming soon');
});

document.querySelector('.btn-outline')?.addEventListener('click', () => {
  const btn = document.querySelector('.btn-outline');
  btn.textContent = 'Refreshing…';
  setTimeout(() => {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh`;
  }, 1200);
});
