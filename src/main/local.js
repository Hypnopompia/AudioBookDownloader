'use strict';

/*
 * Books downloaded to this computer ("My library"). Each book lives in
 *   <Music>/Audiobook SD Loader/<identifier>__<quality>/
 *       001 - Chapter 1.mp3 ...
 *       book.json   (title, author, chapter list; written once the download is complete)
 * A folder without book.json is an unfinished download.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const META = 'book.json';
let root = null;

function init(dir) {
  root = dir;
}

function rootDir() {
  return root;
}

function dirFor(identifier, quality) {
  if (!/^[\w.-]+$/.test(identifier || '')) throw new Error('Invalid book id');
  return path.join(root, `${identifier}__${quality}`);
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
    const meta = JSON.parse(await fs.readFile(path.join(dir, META), 'utf8'));
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
  for (const q of [quality, quality === 'high' ? 'standard' : 'high']) {
    const dir = dirFor(identifier, q);
    const meta = await readBook(dir);
    if (meta) return { dir, meta };
  }
  return null;
}

async function remove(name) {
  await fs.rm(dirByName(name), { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Delete unfinished downloads left over from an earlier session: folders
 * without book.json, and MP3s in saved books that book.json doesn't list.
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

module.exports = { init, rootDir, dirFor, dirByName, readBook, writeBook, list, find, remove, cleanupPartial };
