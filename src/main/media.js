'use strict';

/*
 * Serves MP3 files to the built-in player through an "abook://" URL scheme.
 * Only files the main process has listed for the player get a URL (an opaque
 * token), so the page can't ask for arbitrary files. Range requests are
 * supported so seeking works.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { protocol } = require('electron');
const { naturalCompare } = require('./util');
const local = require('./local');
const sdcard = require('./sdcard');

const SCHEME = 'abook';
const byToken = new Map();
const byPath = new Map();

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

function urlFor(file) {
  let token = byPath.get(file);
  if (!token) {
    token = crypto.randomUUID();
    byPath.set(file, token);
    byToken.set(token, file);
  }
  return `${SCHEME}://media/${token}.mp3`;
}

function handleProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const token = new URL(req.url).pathname.replace(/^\//, '').replace(/\.mp3$/, '');
    const file = byToken.get(token);
    if (!file) return new Response('Not found', { status: 404 });
    let size;
    try {
      size = (await fsp.stat(file)).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }
    let start = 0;
    let end = size - 1;
    let status = 200;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(m[2]));
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      status = 206;
    }
    const headers = {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
  });
}

const chapterTitle = (file) => file.replace(/\.mp3$/i, '').replace(/^\d{1,5}\s*-\s*/, '');

/**
 * Chapter list + playable URLs for a book.
 * source = { kind: 'local', dir } | { kind: 'card', mount, folder }
 */
async function open(source) {
  if (source?.kind === 'local') {
    const dir = local.dirByName(source.dir);
    const meta = await local.readBook(dir);
    if (!meta) throw new Error('This book is no longer on the computer.');
    return {
      key: meta.identifier,
      identifier: meta.identifier,
      title: meta.title,
      author: meta.author,
      source,
      tracks: meta.tracks.map((t) => ({ title: t.title, number: t.number, seconds: t.seconds || null, url: urlFor(path.join(dir, t.file)) })),
    };
  }
  if (source?.kind === 'card') {
    const dir = sdcard.bookPath(source.mount, source.folder);
    const names = (await fsp.readdir(dir)).filter((n) => /\.mp3$/i.test(n) && !n.startsWith('._')).sort(naturalCompare);
    if (!names.length) throw new Error('No MP3 files in this folder.');
    let meta = null;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(dir, sdcard.META_FILE), 'utf8'));
    } catch {
      /* folder not made by this app */
    }
    const numberByFile = new Map(
      (meta?.splitMinutes ? [] : meta?.tracks || []).filter((t) => t.file && t.number).map((t) => [t.file, t.number])
    );
    return {
      key: meta?.identifier || `folder:${source.folder}`,
      identifier: meta?.identifier || null,
      title: meta?.title || source.folder,
      author: meta?.author || '',
      source,
      tracks: names.map((n) => ({
        title: chapterTitle(n),
        number: numberByFile.get(n) ?? null, // position in the full book, when known
        seconds: null,
        url: urlFor(path.join(dir, n)),
      })),
    };
  }
  throw new Error('Unknown book location');
}

module.exports = { registerScheme, handleProtocol, open };
