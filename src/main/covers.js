'use strict';

/*
 * Cover images through a "cover://" URL scheme, saved on disk the first time.
 *
 * archive.org tells browsers to re-check covers every 5 minutes, so the
 * built-in cache asks again for every cover each time a shelf is shown, and
 * its cover service sometimes answers with an error that the browser then
 * keeps for those 5 minutes. Here a cover is downloaded once (retrying
 * errors), kept for a month, and errors are never saved, so the next view
 * tries again. The folder is trimmed to MAX_BYTES, least recently used first.
 *
 *   cover://img/<encodeURIComponent(https URL)>
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { protocol } = require('electron');
const { UA, sleep } = require('./http');

const SCHEME = 'cover';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_BYTES = 400 * 1024 * 1024;
const TRIM_TO = 300 * 1024 * 1024;

let dir = null;
const inFlight = new Map();

// registered with the other custom schemes in main.js (Electron takes one list)
const schemePrivileges = { scheme: SCHEME, privileges: { standard: true, secure: true } };

const keyFor = (url) => crypto.createHash('sha1').update(url).digest('hex');

/** Download a cover, retrying server errors (archive.org's image service has bad moments). */
async function download(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      const type = res.headers.get('content-type') || '';
      if (res.ok && /^image\//i.test(type)) return { type: type.split(';')[0], body: Buffer.from(await res.arrayBuffer()) };
      last = new Error(`HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break; // missing or not an image: retrying won't help
    } catch (err) {
      last = err;
    }
    if (attempt === 0) await sleep(1500);
  }
  throw last;
}

async function getCover(url) {
  const file = path.join(dir, keyFor(url));
  try {
    const [meta, st] = await Promise.all([fs.readFile(`${file}.type`, 'utf8'), fs.stat(file)]);
    if (Date.now() - st.mtimeMs < MAX_AGE_MS) {
      fs.utimes(file, new Date(), st.mtime).catch(() => {}); // last used, for trimming
      return { type: meta, body: await fs.readFile(file) };
    }
  } catch {
    /* not saved yet */
  }
  if (inFlight.has(url)) return inFlight.get(url);
  // archive.org's cover service sometimes fails for an item whose thumbnail file is fine
  const thumb = /^https:\/\/archive\.org\/services\/img\/([^/?#]+)$/.exec(url);
  const p = download(url)
    .catch((err) => (thumb ? download(`https://archive.org/download/${thumb[1]}/__ia_thumb.jpg`) : Promise.reject(err)))
    .then(async (cover) => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, cover.body);
      await fs.writeFile(`${file}.type`, cover.type);
      return cover;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

/** Remove the least recently used covers once the folder is over MAX_BYTES. */
async function trim() {
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /^[0-9a-f]{40}$/.test(n));
  const files = [];
  for (const n of names) {
    const st = await fs.stat(path.join(dir, n)).catch(() => null);
    if (st) files.push({ n, size: st.size, used: st.atimeMs });
  }
  let total = files.reduce((a, f) => a + f.size, 0);
  if (total <= MAX_BYTES) return;
  files.sort((a, b) => a.used - b.used);
  for (const f of files) {
    if (total <= TRIM_TO) break;
    await fs.rm(path.join(dir, f.n), { force: true });
    await fs.rm(path.join(dir, `${f.n}.type`), { force: true });
    total -= f.size;
  }
}

function init(coverDir) {
  dir = coverDir;
  protocol.handle(SCHEME, async (req) => {
    let url;
    try {
      url = decodeURIComponent(new URL(req.url).pathname.slice(1));
    } catch {
      return new Response('Bad cover URL', { status: 400 });
    }
    if (!/^https:\/\//i.test(url)) return new Response('Bad cover URL', { status: 400 });
    try {
      const { type, body } = await getCover(url);
      return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
    } catch {
      return new Response('Cover not available', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
  });
  setTimeout(() => trim().catch(() => {}), 60000);
}

module.exports = { schemePrivileges, init };
