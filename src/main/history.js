'use strict';

/*
 * Which titles were put on which drive, and when they were removed. Kept apart
 * from library.json and the saved books so it survives removing books from
 * My library. Stored in userData/history.json.
 *
 * Drives are recognised by a hidden file at their top level
 * (.listensync-drive.json: an id and the name given in the app), or by the
 * volume serial number when that file is missing. Naming a drive never
 * changes its volume name.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sdcard = require('./sdcard');

let file = null;
let data = { drives: {}, events: [] };
let saveTimer = null;

function init(dir) {
  file = path.join(dir, 'history.json');
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { drives: d.drives || {}, events: Array.isArray(d.events) ? d.events : [] };
  } catch {
    data = { drives: {}, events: [] };
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

function flush() {
  clearTimeout(saveTimer);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    console.error('Could not save history', err);
  }
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** The fields of a title on the drive that the history keeps. */
function entryOf(b) {
  return {
    folder: b.folder,
    identifier: b.identifier || null,
    title: b.title || b.folder,
    author: b.author || '',
    source: b.source || null,
    kind: b.kind || 'book',
    unit: b.unit || 'chapter',
    trackNumbers: b.trackNumbers || null,
    trackTotal: b.trackTotal || null,
    size: b.size || 0,
    addedAt: b.addedAt || null,
    createdAt: b.createdAt || null,
  };
}

const sameTitle = (a, b) => a.folder === b.folder && (a.identifier || null) === (b.identifier || null);

/** When a title we didn't see being copied was put on the drive. */
function foundTime(b, now) {
  const added = Date.parse(b.addedAt || '');
  if (Number.isFinite(added)) return added;
  if (Number.isFinite(b.createdAt) && b.createdAt > 0) return b.createdAt;
  return now;
}

function eventOf(type, driveId, b, at, extra = {}) {
  const { addedAt, createdAt, size, ...rest } = entryOf(b);
  return { type, at, driveId, ...rest, ...extra };
}

/**
 * Compare what we last knew was on a drive with what's on it now.
 * Titles that are gone were removed somewhere else (we only noticed now);
 * titles we don't know about were copied before history was kept, on another
 * computer, or by hand. `prev` is null for a drive we've never looked at.
 */
function reconcile(driveId, prev, books, now = Date.now()) {
  const contents = books.map(entryOf);
  const events = [];
  for (const b of prev || []) {
    if (!contents.some((c) => sameTitle(c, b))) events.push(eventOf('removed', driveId, b, now, { noticed: true }));
  }
  for (const b of contents) {
    if (!(prev || []).some((p) => sameTitle(p, b))) events.push(eventOf('copied', driveId, b, foundTime(b, now), { found: true }));
  }
  return { contents, events };
}

function newRecord(id, drive, now) {
  return { id, name: '', namedAt: 0, label: drive.label || '', serial: drive.serial || null, firstSeen: now, lastSeen: now, contents: null, contentsAt: null };
}

const driveFileFor = (rec) => ({ app: 'ListenSync', id: rec.id, name: rec.name, namedAt: rec.namedAt, createdAt: new Date(rec.firstSeen).toISOString() });

async function writeDriveFile(drive, rec) {
  if (drive.readOnly) return;
  await sdcard.writeDriveFile(drive.mount, driveFileFor(rec)).catch((err) => console.warn('Could not write the drive name', err.message));
}

/** Which known drive this is, or null. Picks up names given on another computer. */
async function identify(drive) {
  const now = Date.now();
  const onDrive = await sdcard.readDriveFile(drive.mount);
  let rec = null;
  if (onDrive) {
    rec = data.drives[onDrive.id];
    if (!rec) {
      // named on another computer: start keeping its history here too
      rec = data.drives[onDrive.id] = newRecord(onDrive.id, drive, now);
      rec.name = cleanName(onDrive.name);
      rec.namedAt = Number(onDrive.namedAt) || 0;
    }
  } else if (drive.serial) {
    rec = Object.values(data.drives).find((r) => r.serial && r.serial === drive.serial) || null;
  }
  if (!rec) return null;
  if (onDrive && (Number(onDrive.namedAt) || 0) > rec.namedAt) {
    rec.name = cleanName(onDrive.name);
    rec.namedAt = Number(onDrive.namedAt) || 0;
  }
  rec.label = drive.label || rec.label;
  rec.serial = drive.serial || rec.serial;
  rec.lastSeen = now;
  // the file was erased, or this computer has a newer name for it
  if (!onDrive || onDrive.name !== rec.name) await writeDriveFile(drive, rec);
  save();
  return rec;
}

/** Start keeping history for a drive (if needed) and optionally give it a name. */
async function register(drive, name) {
  let rec = await identify(drive);
  if (!rec) {
    const id = crypto.randomUUID();
    rec = data.drives[id] = newRecord(id, drive, Date.now());
  }
  if (name !== undefined) {
    rec.name = cleanName(name);
    rec.namedAt = Date.now();
  }
  await writeDriveFile(drive, rec);
  save();
  return rec;
}

/** Rename a known drive; `drive` is given when it's plugged in, so its file is updated too. */
async function rename(id, name, drive) {
  const rec = data.drives[id];
  if (!rec) throw new Error('That drive is not known.');
  rec.name = cleanName(name);
  rec.namedAt = Date.now();
  if (drive) await writeDriveFile(drive, rec);
  save();
  return rec;
}

function logCopied(id, book) {
  const rec = data.drives[id];
  if (!rec) return;
  const entry = entryOf({ ...book, addedAt: new Date().toISOString() });
  rec.contents = (rec.contents || []).filter((c) => !sameTitle(c, entry)).concat(entry);
  data.events.push(eventOf('copied', id, entry, Date.now()));
  save();
}

function logRemoved(id, folder) {
  const rec = data.drives[id];
  const entry = rec?.contents?.find((c) => c.folder === folder);
  if (!entry) return;
  rec.contents = rec.contents.filter((c) => c !== entry);
  data.events.push(eventOf('removed', id, entry, Date.now()));
  save();
}

/** Bring a drive's history up to date with what's on it now. Returns true if anything changed. */
function update(id, books) {
  const rec = data.drives[id];
  if (!rec) return false;
  const now = Date.now();
  const { contents, events } = reconcile(id, rec.contents, books, now);
  const changed = events.length > 0 || rec.contents == null;
  rec.contents = contents;
  rec.contentsAt = now;
  rec.lastSeen = now;
  data.events.push(...events);
  save();
  return changed;
}

/** Forget what was copied where; drive names and what's on them now are kept. */
function clear() {
  data.events = [];
  save();
}

function forget(id) {
  delete data.drives[id];
  data.events = data.events.filter((e) => e.driveId !== id);
  save();
}

/**
 * Per identifier: the drives it was copied to, the last time, which tracks,
 * and which drives still have it (as far as we know).
 */
function summarize(drives, events) {
  const out = {};
  for (const e of events) {
    if (e.type !== 'copied' || !e.identifier) continue;
    const s = (out[e.identifier] ||= { lastAt: 0, drives: [], numbers: [], full: false, onDrives: [] });
    if (e.at > s.lastAt) s.lastAt = e.at;
    if (!s.drives.includes(e.driveId)) s.drives.push(e.driveId);
    const partial = e.trackNumbers && e.trackTotal && e.trackNumbers.length < e.trackTotal;
    if (partial) s.numbers = [...new Set([...s.numbers, ...e.trackNumbers])].sort((a, b) => a - b);
    else s.full = true;
  }
  for (const d of Object.values(drives)) {
    for (const c of d.contents || []) if (out[c.identifier] && !out[c.identifier].onDrives.includes(d.id)) out[c.identifier].onDrives.push(d.id);
  }
  return out;
}

function state() {
  return { drives: Object.values(data.drives), events: data.events, summary: summarize(data.drives, data.events) };
}

const get = (id) => data.drives[id] || null;

module.exports = { init, flush, identify, register, rename, logCopied, logRemoved, update, clear, forget, state, get, reconcile, summarize };
