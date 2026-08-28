/** Shared loader for admin screens: same-origin /api, then public GitHub, then local file. */
const ADMIN_PROXY_TIMEOUT_MS = 25000;
const GITHUB_REPO_OWNER = 'dalton-ls';
const GITHUB_REPO_NAME = 'regintel';
const GITHUB_PROJECTION_BRANCH = 'claude/create-website-skeleton-hYJMa';
function canonicalOrigin() {
  return (typeof window !== 'undefined' && window.REGINTEL_ORIGIN)
    ? window.REGINTEL_ORIGIN
    : 'https://regintel.regintel.workers.dev';
}

function adminApiBase() {
  try {
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return location.origin + '/api';
    }
    if (/\.pages\.dev$/i.test(host)) return location.origin + '/api';
    if (/\.workers\.dev$/i.test(host) && !/^regintel-admin-proxy\./i.test(host)) {
      return location.origin + '/api';
    }
  } catch (err) { /* file: or non-browser */ }
  return canonicalOrigin() + '/api';
}

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

async function fetchWithTimeout(url, ms, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({ cache: 'no-store' }, init || {}, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function parseProjectionResponse(res, label) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body && body.error) ? (label + ' HTTP ' + res.status + ': ' + body.error) : (label + ' HTTP ' + res.status));
  }
  const body = await res.json();
  let content = body && Object.prototype.hasOwnProperty.call(body, 'content') ? body.content : body;
  if (typeof content === 'string') content = JSON.parse(content);
  const rows = unwrapRecordArray(content);
  if (!rows) throw new Error(label + ' did not return a record array');
  return rows;
}

async function loadJsonViaApi(workerUrl, path) {
  const res = await fetchWithTimeout(workerUrl + '/file?path=' + encodeURIComponent(path), ADMIN_PROXY_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body && body.error) ? body.error : ('HTTP ' + res.status));
  }
  const body = await res.json();
  let content = body && Object.prototype.hasOwnProperty.call(body, 'content') ? body.content : body;
  if (typeof content === 'string') content = JSON.parse(content);
  return content;
}

async function loadRequirementsFromGithub() {
  const apiUrl = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME +
    '/contents/requirements.json?ref=' + encodeURIComponent(GITHUB_PROJECTION_BRANCH);
  const res = await fetchWithTimeout(apiUrl, ADMIN_PROXY_TIMEOUT_MS, {
    headers: { Accept: 'application/vnd.github.raw' }
  });
  if (!res.ok) throw new Error('GitHub HTTP ' + res.status);
  const text = await res.text();
  const rows = unwrapRecordArray(JSON.parse(text));
  if (!rows) throw new Error('GitHub did not return a record array');
  return rows;
}

async function loadRequirementsProjection(workerUrl) {
  let proxyError = '';
  if (workerUrl && workerUrl !== 'REPLACE_WITH_WORKER_URL') {
    try {
      const res = await fetchWithTimeout(workerUrl + '/file?path=requirements.json', ADMIN_PROXY_TIMEOUT_MS);
      return { records: await parseProjectionResponse(res, 'Admin proxy'), source: 'worker' };
    } catch (err) {
      proxyError = err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || String(err);
      console.warn('Admin proxy unavailable', err);
    }
  }
  try {
    const rows = await loadRequirementsFromGithub();
    return { records: rows, source: 'github', proxyError };
  } catch (err) {
    console.warn('GitHub projection unavailable', err);
    if (!proxyError) proxyError = (err && err.message) || String(err);
  }
  try {
    const local = await fetch('requirements.json', { cache: 'no-store' });
    if (!local.ok) {
      throw new Error('Failed to load requirements.json (admin proxy unavailable, local HTTP ' + local.status + ')');
    }
    const rows = unwrapRecordArray(await local.json());
    if (!rows) throw new Error('requirements.json is not a JSON array of records');
    return { records: rows, source: 'local', proxyError };
  } catch (err) {
    if (location.protocol === 'file:') {
      throw new Error('Cannot load requirements.json from a file:// URL. Open the site over http(s) (GitHub Pages or a local server).');
    }
    throw err;
  }
}

function proxyUnavailableNote(recordCount, proxyError) {
  const detail = proxyError ? ' (' + proxyError + ')' : '';
  return '<div class="warn-note">Admin API is unreachable' + detail + ', so this screen loaded local <code>requirements.json</code> (' +
    recordCount + ' records). You can review and preview. Apply/save needs the admin API at <code>/api</code> on the Cloudflare site (not the old <code>regintel-admin-proxy</code> hostname).</div>';
}
