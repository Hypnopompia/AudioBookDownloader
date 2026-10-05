'use strict';

/*
 * "Check books": read every chapter back from the SD card and compare it
 * with what it should be. The expected size + MD5 of each chapter comes from
 * (in order of preference):
 *   1. the book's .book.json on the card (written by this app since v1.2),
 *   2. the copy saved on this computer, if there is one,
 *   3. archive.org's file list (archive.org publishes an MD5 for every file).
 * Chapters are matched by play order (001, 002, ...).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { naturalCompare } = require('./util');
const sdcard = require('./sdcard');
const local = require('./local');
const catalog = require('./catalog');

function md5File(file, onBytes, signal) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024, signal });
    stream.on('data', (chunk) => {
      hash.update(chunk);
      onBytes?.(chunk.length);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readCardMeta(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, sdcard.META_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Expected chapters as [{ size, md5, localFile? }] in play order, or null if unknown. */
async function expectedTracks(meta) {
  if (meta?.tracks?.length && meta.tracks.every((t) => t.size)) {
    return { source: 'card', tracks: meta.tracks.map((t) => ({ size: t.size, md5: t.md5 || null })) };
  }
  if (!meta?.identifier) return null;
  const quality = meta.format === '64Kbps MP3' ? 'standard' : 'high';
  // partial copies list which track numbers they hold
  const wanted = meta.trackNumbers ? new Set(meta.trackNumbers) : null;
  const pick = (tracks) => (wanted ? tracks.filter((t, i) => wanted.has(t.number || i + 1)) : tracks);
  const found = await local.find(meta.identifier, quality);
  if (found && found.meta.quality === quality) {
    const tracks = pick(found.meta.tracks);
    if (!wanted || tracks.length === wanted.size) {
      return {
        source: 'computer',
        tracks: tracks.map((t) => ({ size: t.size, md5: t.md5 || null, localFile: path.join(found.dir, t.file) })),
      };
    }
  }
  const details = await catalog.getDetails(meta.identifier, quality);
  if (details.format !== meta.format) return null; // can't tell which encoding was copied
  return { source: 'archive.org', tracks: pick(details.tracks).map((t) => ({ size: t.size, md5: t.md5 || null })) };
}

/**
 * Check one book folder. Returns
 *   { folder, status: 'ok' | 'problem' | 'unknown', problems: [string], checkedFrom }
 */
async function verifyBook(mount, folder, { onBytes, signal } = {}) {
  const dir = sdcard.bookPath(mount, folder);
  const meta = await readCardMeta(dir);
  const files = (await fsp.readdir(dir)).filter((n) => /\.mp3$/i.test(n) && !n.startsWith('._')).sort(naturalCompare);
  let expected;
  try {
    expected = await expectedTracks(meta);
  } catch (err) {
    return { folder, status: 'unknown', problems: [`Couldn't get the file list from archive.org: ${err.message}`] };
  }
  if (!expected) {
    return { folder, status: 'unknown', problems: ['This folder wasn’t added by this app, so there is nothing to compare it with.'] };
  }

  const problems = [];
  const want = expected.tracks;
  if (files.length < want.length) problems.push(`${want.length - files.length} of ${want.length} chapters are missing.`);
  if (files.length > want.length) problems.push(`There are ${files.length - want.length} extra MP3 files in the folder.`);

  for (let i = 0; i < Math.min(files.length, want.length); i++) {
    signal?.throwIfAborted();
    const file = path.join(dir, files[i]);
    const exp = want[i];
    const size = (await fsp.stat(file)).size;
    if (exp.size && size !== exp.size) {
      problems.push(`Chapter ${i + 1} is incomplete (${size.toLocaleString()} of ${exp.size.toLocaleString()} bytes).`);
      onBytes?.(size);
      continue;
    }
    let reference = exp.md5;
    if (!reference && exp.localFile && fs.existsSync(exp.localFile)) reference = await md5File(exp.localFile, null, signal);
    if (!reference) {
      onBytes?.(size); // size matched; nothing more to compare against
      continue;
    }
    const actual = await md5File(file, onBytes, signal);
    if (actual !== reference) problems.push(`Chapter ${i + 1} is damaged (its contents don’t match the original).`);
  }
  return { folder, status: problems.length ? 'problem' : 'ok', problems, checkedFrom: expected.source, checkedAt: Date.now() };
}

/** Check several books, reporting progress in bytes read. */
async function verifyCard(mount, folders, { onProgress, signal } = {}) {
  const sizes = [];
  for (const f of folders) {
    let total = 0;
    const dir = sdcard.bookPath(mount, f);
    for (const n of await fsp.readdir(dir).catch(() => [])) {
      if (/\.mp3$/i.test(n)) total += (await fsp.stat(path.join(dir, n)).catch(() => ({ size: 0 }))).size;
    }
    sizes.push(total);
  }
  const bytesTotal = sizes.reduce((a, b) => a + b, 0);
  let bytesDone = 0;
  const results = [];
  for (let i = 0; i < folders.length; i++) {
    const startDone = bytesDone;
    onProgress?.({ folder: folders[i], index: i, count: folders.length, bytesDone, bytesTotal });
    let last = 0;
    const r = await verifyBook(mount, folders[i], {
      signal,
      onBytes: (b) => {
        bytesDone += b;
        const now = Date.now();
        if (now - last > 200) {
          last = now;
          onProgress?.({ folder: folders[i], index: i, count: folders.length, bytesDone, bytesTotal });
        }
      },
    });
    bytesDone = startDone + sizes[i];
    results.push(r);
  }
  onProgress?.({ folder: null, index: folders.length, count: folders.length, bytesDone: bytesTotal, bytesTotal });
  return results;
}

module.exports = { verifyBook, verifyCard, md5File };
