const ALLOWED_PATHS = new Set(["requirements.json", "wr.json"]);

export { ALLOWED_PATHS };

export const DEFAULT_BRANCH = "claude/create-website-skeleton-hYJMa";

export function githubToken(env) {
  return (env.GITHUB_TOKEN || "").trim();
}

export function githubBranch(env) {
  return ((env && env.GITHUB_BRANCH) || DEFAULT_BRANCH).trim();
}

export async function githubAuthStatus(env) {
  const token = githubToken(env);
  if (!token) return "missing";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "regintel-pages-api",
        Accept: "application/vnd.github+json",
      },
      signal: ctrl.signal,
    });
    if (res.status === 401) return "bad_credentials";
    if (res.status === 403) return "forbidden";
    if (res.ok) return "ok";
    return "http_" + res.status;
  } catch (err) {
    return err && err.name === "AbortError" ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

export async function githubApiRequest(env, urlPath, init = {}, { forceAnonymous = false } = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${urlPath}`;
  const token = forceAnonymous ? "" : githubToken(env);
  const headers = {
    "User-Agent": "regintel-pages-api",
    Accept: "application/vnd.github+json",
    ...(init.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function getFile(env, path, branch) {
  const res = await githubApiRequest(env, `contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.content) {
    return { sha: body.sha, content: base64ToUtf8(body.content.replace(/\n/g, "")) };
  }
  const blobRes = await githubApiRequest(env, `git/blobs/${body.sha}`);
  if (!blobRes.ok) throw new Error(`GitHub blob GET ${path} failed: ${blobRes.status} ${await blobRes.text()}`);
  const blobBody = await blobRes.json();
  return { sha: body.sha, content: base64ToUtf8(blobBody.content.replace(/\n/g, "")) };
}

export async function getFileRaw(env, path, branch) {
  const reqPath = `contents/${path}?ref=${encodeURIComponent(branch)}`;
  const rawHeaders = { headers: { Accept: "application/vnd.github.raw" } };
  let res = await githubApiRequest(env, reqPath, rawHeaders);
  if (res.status === 401 && githubToken(env)) {
    res = await githubApiRequest(env, reqPath, rawHeaders, { forceAnonymous: true });
  }
  if (res.ok) return res.text();
  const apiStatus = res.status;
  const apiBody = await res.text();
  if (apiStatus === 403 || /too large/i.test(apiBody)) {
    const viaBlob = await getFile(env, path, branch);
    return viaBlob.content;
  }
  const rawUrl = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${branch}/${path}`;
  const rawRes = await fetch(rawUrl, { headers: { "User-Agent": "regintel-pages-api" } });
  if (!rawRes.ok) throw new Error(`GitHub GET ${path} failed: ${apiStatus} ${apiBody}`);
  return rawRes.text();
}

export async function putFile(env, path, branch, message, newContentStr, sha) {
  const res = await githubApiRequest(env, `contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(newContentStr),
      sha,
      branch,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub PUT ${path} failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token && env.ADMIN_TOKEN && token === (env.ADMIN_TOKEN || "").trim();
}

export function githubCredentialError() {
  return "GITHUB_TOKEN was rejected by GitHub (401 Bad credentials). Create a fine-grained PAT with repository dalton-ls/regintel and Contents: Read and write, then from the repo root run: npx wrangler secret put GITHUB_TOKEN";
}
