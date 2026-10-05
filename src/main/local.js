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
    return JSON.parse(await fs.readFile(path.join(dir, META), 'utf8'));
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
    books.push({ ...rest, dir: e.name, chapters: tracks?.length || 0, size: await dirSize(dir) });
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

/** Delete unfinished downloads left over from an earlier session. */
async function cleanupPartial() {
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !(await readBook(path.join(root, e.name)))) {
      await fs.rm(path.join(root, e.name), { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { init, rootDir, dirFor, dirByName, readBook, writeBook, list, find, remove, cleanupPartial };
