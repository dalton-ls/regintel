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

async function loadGithubFile(path) {
  const apiUrl = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME +
    '/contents/' + path + '?ref=' + encodeURIComponent(GITHUB_PROJECTION_BRANCH);
  const res = await fetchWithTimeout(apiUrl, ADMIN_PROXY_TIMEOUT_MS, {
    headers: { Accept: 'application/vnd.github.raw' }
  });
  if (!res.ok) throw new Error('GitHub HTTP ' + res.status);
  return JSON.parse(await res.text());
}

async function loadRequirementsFromGithub() {
  const rows = unwrapRecordArray(await loadGithubFile('requirements.json'));
  if (!rows) throw new Error('GitHub did not return a record array');
  return rows;
}

function abortOrMessage(err) {
  return err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || String(err);
}

// Worker /api/file, then public GitHub, then the deployed/local file.
// unwrapArray:true returns { content: record[] } for requirements.json.
async function loadProjectionContent(workerUrl, path, opts) {
  const unwrap = !!(opts && opts.unwrapArray);
  let proxyError = '';
  if (workerUrl && workerUrl !== 'REPLACE_WITH_WORKER_URL') {
    try {
      const content = await loadJsonViaApi(workerUrl, path);
      if (unwrap) {
        const rows = unwrapRecordArray(content);
        if (!rows) throw new Error(path + ' did not return a record array');
        return { content: rows, source: 'worker' };
      }
      return { content, source: 'worker' };
    } catch (err) {
      proxyError = abortOrMessage(err);
      console.warn('Admin proxy unavailable for ' + path, err);
    }
  }
  try {
    const content = await loadGithubFile(path);
    if (unwrap) {
      const rows = unwrapRecordArray(content);
      if (!rows) throw new Error('GitHub did not return a record array');
      return { content: rows, source: 'github', proxyError };
    }
    return { content, source: 'github', proxyError };
  } catch (err) {
    console.warn('GitHub projection unavailable for ' + path, err);
    if (!proxyError) proxyError = abortOrMessage(err);
  }
  try {
    const local = await fetch(path, { cache: 'no-store' });
    if (!local.ok) {
      throw new Error('Failed to load ' + path + ' (admin proxy unavailable, local HTTP ' + local.status + ')');
    }
    const parsed = await local.json();
    if (unwrap) {
      const rows = unwrapRecordArray(parsed);
      if (!rows) throw new Error(path + ' is not a JSON array of records');
      return { content: rows, source: 'local', proxyError };
    }
    return { content: parsed, source: 'local', proxyError };
  } catch (err) {
    if (location.protocol === 'file:') {
      throw new Error('Cannot load ' + path + ' from a file:// URL. Open the site over http(s) (GitHub Pages or a local server).');
    }
    throw err;
  }
}

async function loadRequirementsProjection(workerUrl) {
  const loaded = await loadProjectionContent(workerUrl, 'requirements.json', { unwrapArray: true });
  return { records: loaded.content, source: loaded.source, proxyError: loaded.proxyError || '' };
}

function proxyUnavailableNote(recordCount, proxyError) {
  const detail = proxyError ? ' (' + proxyError + ')' : '';
  return '<div class="warn-note">Admin API is unreachable' + detail + ', so this screen loaded local <code>requirements.json</code> (' +
    recordCount + ' records). You can review and preview. Apply/save needs the admin API at <code>/api</code> on the Cloudflare site (not the old <code>regintel-admin-proxy</code> hostname).</div>';
}
