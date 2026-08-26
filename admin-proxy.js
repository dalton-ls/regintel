/** Shared loader for admin screens: try the Cloudflare proxy, then local requirements.json. */
const ADMIN_PROXY_TIMEOUT_MS = 8000;

function unwrapRecordArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.content)) return raw.content;
  if (Array.isArray(raw.records)) return raw.records;
  if (Array.isArray(raw.rows)) return raw.rows;
  const buckets = Object.keys(raw)
    .filter(k => Array.isArray(raw[k]) && raw[k].length && raw[k][0] && typeof raw[k][0] === 'object')
    .map(k => raw[k]);
  return buckets.length ? buckets.flat() : null;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function loadRequirementsProjection(workerUrl) {
  if (workerUrl && workerUrl !== 'REPLACE_WITH_WORKER_URL') {
    try {
      const res = await fetchWithTimeout(workerUrl + '/file?path=requirements.json', ADMIN_PROXY_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      let content = body && Object.prototype.hasOwnProperty.call(body, 'content') ? body.content : body;
      if (typeof content === 'string') content = JSON.parse(content);
      const rows = unwrapRecordArray(content);
      if (!rows) throw new Error('Admin proxy did not return a record array');
      return { records: rows, source: 'worker' };
    } catch (err) {
      console.warn('Admin proxy unavailable', err);
    }
  }
  try {
    const local = await fetch('requirements.json', { cache: 'no-store' });
    if (!local.ok) {
      throw new Error('Failed to load requirements.json (admin proxy unavailable, local HTTP ' + local.status + ')');
    }
    const rows = unwrapRecordArray(await local.json());
    if (!rows) throw new Error('requirements.json is not a JSON array of records');
    return { records: rows, source: 'local' };
  } catch (err) {
    if (location.protocol === 'file:') {
      throw new Error('Cannot load requirements.json from a file:// URL. Open the site over http(s) (GitHub Pages or a local server).');
    }
    throw err;
  }
}

function proxyUnavailableNote(recordCount) {
  return '<div class="warn-note">Admin proxy is unreachable, so this screen loaded local <code>requirements.json</code> (' +
    recordCount + ' records). You can review and preview. Apply/save still needs <code>regintel-admin-proxy.regintel.workers.dev</code>.</div>';
}
