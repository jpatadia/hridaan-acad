/*
 * Optional cloud sync through a private (secret) GitHub Gist in the parent's account.
 *
 * Each device stores { token, gistId, role } locally:
 *   role 'student' = practice device: pulls, merges and pushes after every answer
 *   role 'viewer'  = parent view: read-only, only pulls
 * The token only needs the "gist" permission.
 */
(function (g) {
  'use strict';
  const NJ = (g.NJ = g.NJ || {});
  const FILE = 'njsla-coach-progress.json';
  const API = 'https://api.github.com';

  function headers(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  async function call(token, path, opts = {}) {
    let res;
    try {
      res = await fetch(API + path, { ...opts, headers: headers(token), cache: 'no-store' });
    } catch (e) {
      throw new Error('offline');
    }
    if (res.status === 401) throw new Error('The sync key was rejected (it may have expired or been deleted). Create a new one and reconnect.');
    if (res.status === 403 || res.status === 404) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ? `GitHub said: ${body.message}. Check that the key has the "gist" permission.` : `GitHub error ${res.status}`);
    }
    if (!res.ok) throw new Error(`GitHub error ${res.status}`);
    return res.json();
  }

  // Find the progress gist in the account, or null.
  async function findGist(token) {
    for (let page = 1; page <= 10; page++) {
      const list = await call(token, `/gists?per_page=100&page=${page}`);
      const hit = list.find((gi) => gi.files && gi.files[FILE]);
      if (hit) return hit.id;
      if (list.length < 100) return null;
    }
    return null;
  }

  async function createGist(token, state) {
    const gist = await call(token, '/gists', {
      method: 'POST',
      body: JSON.stringify({ description: 'NJSLA Math Coach progress (used by the app — do not edit)', public: false, files: { [FILE]: { content: JSON.stringify(state) } } }),
    });
    return gist.id;
  }

  async function read(token, gistId) {
    const gist = await call(token, `/gists/${gistId}`);
    const f = gist.files && gist.files[FILE];
    if (!f) throw new Error('The progress file is missing from the gist.');
    let content = f.content;
    if (f.truncated && f.raw_url) {
      const r = await fetch(f.raw_url, { cache: 'no-store' });
      content = await r.text();
    }
    return JSON.parse(content);
  }

  async function write(token, gistId, state) {
    await call(token, `/gists/${gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(state) } } }) });
  }

  // Setup link: lets a second device connect without typing the key.
  function makeSetupLink(cfg, role) {
    const payload = btoa(JSON.stringify({ t: cfg.token, g: cfg.gistId, r: role }));
    return `${location.href.split("#")[0]}#sync=${payload}`;
  }
  function readSetupLink(hash) {
    const m = /#sync=([A-Za-z0-9+/=]+)/.exec(hash || '');
    if (!m) return null;
    try {
      const o = JSON.parse(atob(m[1]));
      return o.t ? { token: o.t, gistId: o.g || null, role: o.r === 'viewer' ? 'viewer' : 'student' } : null;
    } catch (e) { return null; }
  }

  NJ.sync = { FILE, findGist, createGist, read, write, makeSetupLink, readSetupLink };
})(typeof globalThis !== 'undefined' ? globalThis : this);
