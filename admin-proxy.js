/** Shared loader for admin screens: same-origin /api, then public GitHub, then local file. */
const ADMIN_PROXY_TIMEOUT_MS = 12000;
const REQUIREMENTS_TIMEOUT_MS = 90000;
const SAME_ORIGIN_TIMEOUT_MS = 8000;
const GITHUB_REPO_OWNER = 'dalton-ls';
const GITHUB_REPO_NAME = 'regintel';
const GITHUB_PROJECTION_BRANCH = 'main';
const REQUIREMENTS_MANIFEST = 'requirements/manifest.json';
const REQUIREMENTS_INDEX = 'requirements/index.json';
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

function sameOriginProjectionSource() {
  try {
    const host = location.hostname;
    if (/\.workers\.dev$/i.test(host) || /\.pages\.dev$/i.test(host)) return 'worker';
  } catch (err) { /* file: or non-browser */ }
  return 'local';
}

async function loadSameOriginJson(path) {
  const ms = path === 'requirements.json' ? REQUIREMENTS_TIMEOUT_MS : SAME_ORIGIN_TIMEOUT_MS;
  const res = await fetchWithTimeout(path, ms);
  if (!res.ok) throw new Error('same-origin HTTP ' + res.status);
  return res.json();
}

function wrapProjection(content, path, unwrap, source, proxyError) {
  if (unwrap) {
    const rows = unwrapRecordArray(content);
    if (!rows) throw new Error(path + ' did not return a record array');
    return { content: rows, source, proxyError: proxyError || '' };
  }
  return { content, source, proxyError: proxyError || '' };
}

async function loadJsonViaApi(workerUrl, path) {
  const ms = path === 'requirements.json' ? REQUIREMENTS_TIMEOUT_MS : ADMIN_PROXY_TIMEOUT_MS;
  const res = await fetchWithTimeout(workerUrl + '/file?path=' + encodeURIComponent(path), ms);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body && body.error) ? body.error : ('HTTP ' + res.status));
  }
  const body = await res.json();
  let content = body && Object.prototype.hasOwnProperty.call(body, 'content') ? body.content : body;
  if (typeof content === 'string') content = JSON.parse(content);
  return content;
}

function parseJsonl(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (trimmed) rows.push(JSON.parse(trimmed));
  });
  return rows;
}

function githubRawUrl(path) {
  return 'https://raw.githubusercontent.com/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME +
    '/' + GITHUB_PROJECTION_BRANCH + '/' + path;
}

async function loadShardedGithubRecords() {
  const manifest = await loadGithubFile(REQUIREMENTS_MANIFEST);
  const shards = (manifest && manifest.shards) || [];
  if (!shards.length) throw new Error('requirements manifest has no shards');
  const parts = await Promise.all(shards.map(async function (shard) {
    const res = await fetchWithTimeout(githubRawUrl(shard.path), REQUIREMENTS_TIMEOUT_MS);
    if (!res.ok) throw new Error('GitHub shard HTTP ' + res.status + ' ' + shard.path);
    return parseJsonl(await res.text());
  }));
  return parts.reduce(function (all, rows) { return all.concat(rows); }, []);
}

async function loadGithubFile(path) {
  const apiUrl = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME +
    '/contents/' + path + '?ref=' + encodeURIComponent(GITHUB_PROJECTION_BRANCH);
  const res = await fetchWithTimeout(apiUrl, ADMIN_PROXY_TIMEOUT_MS, {
    headers: { Accept: 'application/vnd.github.raw' }
  });
  if (res.ok) return JSON.parse(await res.text());
  const rawRes = await fetchWithTimeout(githubRawUrl(path), ADMIN_PROXY_TIMEOUT_MS);
  if (!rawRes.ok) throw new Error('GitHub HTTP ' + res.status);
  return JSON.parse(await rawRes.text());
}

async function loadRequirementsFromGithub() {
  try {
    const direct = await loadGithubFile('requirements.json');
    const rows = unwrapRecordArray(direct);
    if (rows) return rows;
  } catch (err) {
    console.warn('GitHub requirements.json stub or missing', err);
  }
  const sharded = await loadShardedGithubRecords();
  if (!sharded.length) throw new Error('GitHub did not return a record array');
  return sharded;
}

function abortOrMessage(err) {
  return err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || String(err);
}

// Worker /api/file, then public GitHub, then the deployed/local file.
// unwrapArray:true returns { content: record[] } for requirements.json.
// preferSameOrigin:true tries GET /path first (the site Worker already serves GitHub JSON there).
async function loadProjectionContent(workerUrl, path, opts) {
  const unwrap = !!(opts && opts.unwrapArray);
  const preferSameOrigin = !!(opts && opts.preferSameOrigin);
  let proxyError = '';
  if (preferSameOrigin && typeof location !== 'undefined' && location.protocol !== 'file:') {
    try {
      return wrapProjection(await loadSameOriginJson(path), path, unwrap, sameOriginProjectionSource(), '');
    } catch (err) {
      proxyError = abortOrMessage(err);
      console.warn('Same-origin ' + path + ' unavailable', err);
    }
  }
  if (workerUrl && workerUrl !== 'REPLACE_WITH_WORKER_URL') {
    try {
      return wrapProjection(await loadJsonViaApi(workerUrl, path), path, unwrap, 'worker', proxyError);
    } catch (err) {
      proxyError = proxyError || abortOrMessage(err);
      console.warn('Admin proxy unavailable for ' + path, err);
    }
  }
  try {
    if (path === 'requirements.json') {
      return wrapProjection(await loadRequirementsFromGithub(), path, unwrap, 'github', proxyError);
    }
    return wrapProjection(await loadGithubFile(path), path, unwrap, 'github', proxyError);
  } catch (err) {
    console.warn('GitHub projection unavailable for ' + path, err);
    if (!proxyError) proxyError = abortOrMessage(err);
  }
  try {
    return wrapProjection(await loadSameOriginJson(path), path, unwrap, 'local', proxyError);
  } catch (err) {
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      throw new Error('Cannot load ' + path + ' from a file:// URL. Open the site over http(s) (the Cloudflare Worker origin or npm run dev).');
    }
    throw err;
  }
}

async function loadRequirementsAndWr(workerUrl, opts) {
  const reqOpts = Object.assign({ unwrapArray: true }, opts || {});
  const wrOpts = Object.assign({}, opts || {});
  const [reqResult, wrResult] = await Promise.allSettled([
    loadProjectionContent(workerUrl, 'requirements.json', reqOpts),
    loadProjectionContent(workerUrl, 'wr.json', wrOpts)
  ]);
  if (reqResult.status !== 'fulfilled') throw reqResult.reason;
  return {
    requirements: reqResult.value,
    wr: wrResult.status === 'fulfilled' ? wrResult.value : null,
    wrError: wrResult.status === 'rejected' ? wrResult.reason : null
  };
}

async function loadRequirementsProjection(workerUrl) {
  const loaded = await loadProjectionContent(workerUrl, 'requirements.json', { unwrapArray: true });
  return { records: loaded.content, source: loaded.source, proxyError: loaded.proxyError || '' };
}

async function loadRequirementsIndex(workerUrl) {
  try {
    const loaded = await loadProjectionContent(workerUrl, REQUIREMENTS_INDEX, {});
    const content = loaded.content;
    const records = content && Array.isArray(content.records) ? content.records : unwrapRecordArray(content);
    return { index: records || [], source: loaded.source, proxyError: loaded.proxyError || '' };
  } catch (err) {
    return { index: [], source: 'none', proxyError: abortOrMessage(err) };
  }
}

async function commitRequirements(workerUrl, token, payload) {
  const body = Object.assign({ path: 'requirements.json' }, payload || {});
  return fetch(workerUrl + '/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
}

function proxyUnavailableNote(recordCount, proxyError) {
  const detail = proxyError ? ' (' + proxyError + ')' : '';
  return '<div class="warn-note">Admin API is unreachable' + detail + ', so this screen loaded local <code>requirements.json</code> (' +
    recordCount + ' records). You can review and preview. Apply/save needs the admin API at <code>/api</code> on the Cloudflare site (not the old <code>regintel-admin-proxy</code> hostname).</div>';
}
