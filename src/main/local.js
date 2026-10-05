'use strict';

/*
 * Books downloaded to this computer ("My library"). Each book lives in
 *   <Music>/ListenSync/<Title - Author>[ (high quality)]/
 *       001 - Chapter 1.mp3 ...
 *       listensync.json  (identifier, title, track list; written once the download is complete)
 * Books are identified by listensync.json, not by the folder name, so folders
 * can have readable names. A folder without it is an unfinished download.
 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { sanitizeName, titleWithAuthor } = require('./util');

const META = 'listensync.json';
const LEGACY_META = 'book.json'; // name used before v1.2
let root = null;

function init(dir) {
  root = dir;
}

function rootDir() {
  return root;
}

// identifier + quality -> folder name, built from listensync.json files
let index = null;
const key = (identifier, quality) => `${identifier}__${quality}`;

async function buildIndex() {
  index = new Map();
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const meta = await readBook(path.join(root, e.name));
    if (meta?.identifier) index.set(key(meta.identifier, meta.quality), e.name);
  }
}

/** Folder name of a saved book, if the index already knows it (sync, for the download queue). */
function knownDirName(identifier, quality) {
  return index?.get(key(identifier, quality)) || null;
}

function readableName(title, author, quality) {
  const base = sanitizeName(titleWithAuthor(title, author), 80);
  return quality === 'high' ? `${base} (high quality)` : base;
}

/**
 * Folder for downloading a book: its existing saved folder, or a new one
 * with a readable name. An existing folder without listensync.json is an
 * unfinished download of something, so it is reused rather than duplicated.
 */
async function dirFor(identifier, quality, title, author) {
  if (!/^[\w.-]+$/.test(identifier || '')) throw new Error('Invalid book id');
  if (!index) await buildIndex();
  const known = index.get(key(identifier, quality));
  if (known) return path.join(root, known);
  const base = readableName(title, author, quality);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} (${i})`;
    const dir = path.join(root, name);
    if (!fsSync.existsSync(dir)) return dir;
    const meta = await readBook(dir);
    if (!meta) return dir; // unfinished download with this name
  }
}

/** Resolve a folder name from the renderer, refusing anything outside the library. */
function dirByName(name) {
  if (typeof name !== 'string' || !name || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid folder');
  }
  return path.join(root, name);
}

async function readBook(dir) {
  try {
    let raw;
    try {
      raw = await fs.readFile(path.join(dir, META), 'utf8');
    } catch {
      // saved before v1.2: rename the old file
      raw = await fs.readFile(path.join(dir, LEGACY_META), 'utf8');
      await fs.rename(path.join(dir, LEGACY_META), path.join(dir, META)).catch(() => {});
    }
    const meta = JSON.parse(raw);
    // books saved by older versions were always complete and unnumbered
    meta.tracks = (meta.tracks || []).map((t, i) => ({ ...t, number: t.number ?? i + 1 }));
    meta.trackTotal = meta.trackTotal || meta.tracks.length;
    meta.unit = meta.unit || 'chapter';
    return meta;
  } catch {
    return null;
  }
}

async function writeBook(dir, meta) {
  await fs.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
  if (index) index.set(key(meta.identifier, meta.quality), path.basename(dir));
}

async function dirSize(dir) {
  let size = 0;
  for (const n of await fs.readdir(dir).catch(() => [])) {
    const st = await fs.stat(path.join(dir, n)).catch(() => null);
    if (st?.isFile()) size += st.size;
  }
  return size;
}

async function list() {
  await fs.mkdir(root, { recursive: true });
  const books = [];
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const meta = await readBook(dir);
    if (!meta) continue;
    const { tracks, ...rest } = meta;
    books.push({
      ...rest,
      dir: e.name,
      chapters: tracks?.length || 0,
      partial: (tracks?.length || 0) < meta.trackTotal,
      numbers: (tracks || []).map((t) => t.number),
      firstNumber: tracks?.[0]?.number ?? 1,
      lastNumber: tracks?.[tracks.length - 1]?.number ?? 0,
      size: await dirSize(dir),
    });
  }
  books.sort((a, b) => String(b.downloadedAt).localeCompare(String(a.downloadedAt)));
  return { root, books, total: books.reduce((a, b) => a + b.size, 0) };
}

/** The local copy of a book, preferring the requested quality. */
async function find(identifier, quality) {
  if (!index) await buildIndex();
  for (const q of [quality, quality === 'high' ? 'standard' : 'high']) {
    const name = index.get(key(identifier, q));
    if (!name) continue;
    const dir = path.join(root, name);
    const meta = await readBook(dir);
    if (meta) return { dir, meta };
    index.delete(key(identifier, q)); // folder was removed outside the app
  }
  return null;
}

async function remove(name) {
  await fs.rm(dirByName(name), { recursive: true, force: true, maxRetries: 3 });
  index = null;
}

/** Rename folders from the old "<identifier>__<quality>" scheme to readable names. */
async function migrateNames() {
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !/__(standard|high)$/.test(e.name)) continue;
    const dir = path.join(root, e.name);
    const meta = await readBook(dir);
    if (!meta) continue;
    const base = readableName(meta.title, meta.author, meta.quality);
    let name = base;
    for (let i = 2; fsSync.existsSync(path.join(root, name)); i++) name = `${base} (${i})`;
    await fs.rename(dir, path.join(root, name)).catch((err) => console.error('Could not rename', e.name, err.message));
  }
  index = null;
}

/**
 * Delete unfinished downloads left over from an earlier session: folders
 * without listensync.json, and MP3s in saved books that it doesn't list.
 */
async function cleanupPartial() {
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const meta = await readBook(dir);
    if (!meta) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    const listed = new Set(meta.tracks.map((t) => t.file));
    for (const n of await fs.readdir(dir).catch(() => [])) {
      if ((/\.mp3$/i.test(n) && !listed.has(n)) || n.endsWith('.part')) await fs.rm(path.join(dir, n), { force: true }).catch(() => {});
    }
  }
}

module.exports = { init, rootDir, dirFor, knownDirName, dirByName, readBook, writeBook, list, find, remove, cleanupPartial, migrateNames };
