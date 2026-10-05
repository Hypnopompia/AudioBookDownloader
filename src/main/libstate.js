'use strict';

/*
 * Per-book personal state: starred, read / not interested, and the listening
 * position. Keyed by archive.org identifier (or "folder:<name>" for folders on
 * a card that weren't added by this app). Stored in userData/library.json.
 */

const fs = require('node:fs');
const path = require('node:path');

const STATUSES = new Set(['read', 'not_interested']);
let file = null;
let books = {};
let saveTimer = null;

function init(dir) {
  file = path.join(dir, 'library.json');
  try {
    books = JSON.parse(fs.readFileSync(file, 'utf8')).books || {};
  } catch {
    books = {};
  }
}

function all() {
  return books;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

function flush() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ books }));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    console.error('Could not save library', err);
  }
}

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Merge a validated patch into a book's entry and return the entry. */
function update(key, patch = {}) {
  if (typeof key !== 'string' || !key || key.length > 300) throw new Error('Invalid book');
  const cur = books[key] || {};
  const next = { ...cur };
  if ('starred' in patch) next.starred = !!patch.starred;
  if ('status' in patch) next.status = STATUSES.has(patch.status) ? patch.status : null;
  for (const k of ['title', 'author', 'source', 'identifier']) if (str(patch[k]) !== undefined) next[k] = str(patch[k]);
  if (Number.isFinite(patch.runtime)) next.runtime = patch.runtime;
  if (Number.isInteger(patch.lastCopied)) next.lastCopied = patch.lastCopied; // highest track number copied to a card
  if ('position' in patch) {
    const p = patch.position;
    next.position =
      p && Number.isInteger(p.track) && Number.isFinite(p.time)
        ? {
            track: p.track,
            number: Number.isInteger(p.number) ? p.number : null, // track number in the full book (survives partial copies)
            time: Math.max(0, p.time),
            tracks: Number(p.tracks) || null,
            chapter: str(p.chapter, 200) || '',
            at: Date.now(),
          }
        : null;
  }
  next.updatedAt = Date.now();
  books[key] = next;
  save();
  return next;
}

module.exports = { init, all, update, flush };
