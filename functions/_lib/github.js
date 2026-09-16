import { isAllowedPath } from "./requirements-store.js";

export { isAllowedPath };
export const ALLOWED_PATHS = {
  has(path) {
    return isAllowedPath(path);
  },
};

export const DEFAULT_BRANCH = "main";

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
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
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

/** One git commit that adds/updates/deletes multiple files. Fails 409 if main moved. */
export async function commitFiles(env, branch, message, files) {
  if (!files || !files.length) {
    throw new Error("commitFiles requires at least one file");
  }
  const refRes = await githubApiRequest(env, `git/refs/heads/${encodeURIComponent(branch)}`);
  const refText = await refRes.text();
  if (!refRes.ok) throw new Error(`GitHub ref GET failed: ${refRes.status} ${refText}`);
  const ref = JSON.parse(refText);
  const refObj = Array.isArray(ref) ? ref[0] : ref;
  const parentSha = refObj && refObj.object && refObj.object.sha;
  if (!parentSha) throw new Error("GitHub ref missing object sha");

  const parentRes = await githubApiRequest(env, `git/commits/${parentSha}`);
  const parentText = await parentRes.text();
  if (!parentRes.ok) throw new Error(`GitHub commit GET failed: ${parentRes.status} ${parentText}`);
  const parent = JSON.parse(parentText);
  const baseTree = parent && parent.tree && parent.tree.sha;
  if (!baseTree) throw new Error("GitHub commit missing tree sha");

  const tree = [];
  for (const file of files) {
    if (!isAllowedPath(file.path)) {
      throw new Error("path not allowed: " + file.path);
    }
    if (file.delete) {
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blobRes = await githubApiRequest(env, "git/blobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    const blobText = await blobRes.text();
    if (!blobRes.ok) throw new Error(`GitHub blob POST failed: ${blobRes.status} ${blobText}`);
    const blob = JSON.parse(blobText);
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTreeRes = await githubApiRequest(env, "git/trees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  const newTreeText = await newTreeRes.text();
  if (!newTreeRes.ok) throw new Error(`GitHub tree POST failed: ${newTreeRes.status} ${newTreeText}`);
  const newTree = JSON.parse(newTreeText);

  const commitRes = await githubApiRequest(env, "git/commits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message || "Admin edit via regintel Worker",
      tree: newTree.sha,
      parents: [parentSha],
    }),
  });
  const commitText = await commitRes.text();
  if (!commitRes.ok) throw new Error(`GitHub commit POST failed: ${commitRes.status} ${commitText}`);
  const commit = JSON.parse(commitText);

  const updateRes = await githubApiRequest(env, `git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  const updateText = await updateRes.text();
  if (updateRes.status === 422 || updateRes.status === 409) {
    const err = new Error("conflict — the file changed since you loaded it; reload and try again");
    err.status = 409;
    throw err;
  }
  if (!updateRes.ok) throw new Error(`GitHub ref update failed: ${updateRes.status} ${updateText}`);

  const htmlUrl = `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${commit.sha}`;
  return { commit: { sha: commit.sha, html_url: htmlUrl } };
}
