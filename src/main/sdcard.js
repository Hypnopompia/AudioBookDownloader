'use strict';

/*
 * drive layout
 * --------------
 *   <card>/<Book Title - Author>/001 - Chapter 1.mp3
 *                               /002 - Chapter 2.mp3
 *                               /.listensync.json    (hidden; title, author, track list)
 *
 * Book folders sit at the top of the card because many inexpensive players
 * only look one folder deep.
 *
 * Why play order needs care: lots of cheap MP3 players (most headphones with
 * an SD slot) don't sort by name. They play files in the order their entries
 * appear in the FAT directory table, which is the order the files were
 * *written*, and deleted entries can be reused later. So we:
 *   1. name every file with a zero-padded number (for players that do sort),
 *   2. write files to the card one at a time, in order, into a fresh folder,
 *   3. offer "Fix play order", which rebuilds each folder by moving its files
 *      into a brand-new folder in sorted order (like the Linux `fatsort` tool,
 *      but using ordinary file moves that work on every OS).
 *
 * fs.opendir() returns entries in on-disk order on FAT/exFAT, so we can
 * check whether the order is right. (fs.readdir() can't be used for this:
 * on macOS/Linux libuv sorts its results alphabetically.)
 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const crypto = require('node:crypto');
const mp3split = require('./mp3split');
const { naturalCompare, sanitizeName, titleWithAuthor } = require('./util');
const { run, space } = require('./drives');

const META_FILE = '.listensync.json';
const LEGACY_META_FILE = '.book.json'; // name used before v1.2
const DRIVE_FILE = '.listensync-drive.json'; // at the top of the drive: its id and the name given in the app
const REORDER_DIR = '_reorder_in_progress';
const SYSTEM_NAMES = new Set([
  'system volume information', '$recycle.bin', 'recycler', 'lost.dir', 'android', 'dcim', REORDER_DIR,
]);

const isMp3 = (n) => /\.mp3$/i.test(n);
const isJunk = (n) => n.startsWith('._') || n === '.DS_Store';
const isHiddenOrSystem = (n) =>
  n.startsWith('.') || SYSTEM_NAMES.has(n.toLowerCase()) || /^GAP\d{5}\.TMP$/i.test(n);

/** Resolve a top-level folder name on the card, refusing anything that escapes the card. */
function bookPath(mount, folder) {
  if (typeof folder !== 'string' || !folder || folder.includes('/') || folder.includes('\\') || folder === '.' || folder === '..') {
    throw new Error('Invalid folder name');
  }
  const p = path.resolve(mount, folder);
  if (path.dirname(p) !== path.resolve(mount)) throw new Error('Invalid folder name');
  return p;
}

async function readMeta(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, META_FILE), 'utf8'));
  } catch {
    /* not found under the current name */
  }
  try {
    // older copies: read the old file name and rename it (if the drive is writable)
    const meta = JSON.parse(await fs.readFile(path.join(dir, LEGACY_META_FILE), 'utf8'));
    await fs.rename(path.join(dir, LEGACY_META_FILE), path.join(dir, META_FILE)).catch(() => {});
    return meta;
  } catch {
    return null;
  }
}

async function writeMeta(dir, meta) {
  await writeHiddenJson(path.join(dir, META_FILE), meta);
}

/** Name and id of the drive itself, kept in a hidden file at its top level. */
async function readDriveFile(mount) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(mount, DRIVE_FILE), 'utf8'));
    return data && typeof data.id === 'string' ? data : null;
  } catch {
    return null;
  }
}

async function writeDriveFile(mount, data) {
  await writeHiddenJson(path.join(mount, DRIVE_FILE), data);
}

async function writeHiddenJson(file, data) {
  // Overwrite in place (r+ when it exists) so the file keeps its directory slot.
  let fh;
  try {
    fh = await fs.open(file, fsSync.existsSync(file) ? 'r+' : 'w');
    const buf = Buffer.from(JSON.stringify(data, null, 2));
    await fh.truncate(0);
    await fh.write(buf, 0, buf.length, 0);
    await fh.sync();
  } finally {
    await fh?.close();
  }
  if (process.platform === 'win32') await run('attrib', ['+h', file]).catch(() => {});
}

/** Directory entries in on-disk order (unlike fs.readdir, which may sort). */
async function rawDir(dir) {
  const out = [];
  for await (const e of await fs.opendir(dir)) out.push(e);
  return out;
}

async function rawNames(dir) {
  return (await rawDir(dir)).map((e) => e.name);
}

function sortedNames(names) {
  return [...names].sort(naturalCompare);
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Everything the "Drive contents" screen needs. */
async function listCard(mount) {
  await cleanAppleDouble(mount).catch(() => {});
  const { total, free } = await space(mount);
  const entries = await rawDir(mount);
  const books = [];
  const looseFiles = [];
  let interrupted = false;

  for (const e of entries) {
    if (e.name === REORDER_DIR) interrupted = true;
    if (isHiddenOrSystem(e.name)) continue;
    if (e.isFile() && isMp3(e.name)) {
      const st = await fs.stat(path.join(mount, e.name)).catch(() => null);
      looseFiles.push({ name: e.name, size: st?.size || 0 });
      continue;
    }
    if (!e.isDirectory()) continue;
    const dir = path.join(mount, e.name);
    let names;
    try {
      names = await rawNames(dir);
    } catch {
      continue;
    }
    const mp3s = names.filter((n) => isMp3(n) && !isJunk(n));
    const meta = await readMeta(dir);
    if (!mp3s.length && !meta) continue; // not an audio folder
    const dirStat = await fs.stat(dir).catch(() => null);
    let size = 0;
    for (const n of names) {
      const st = await fs.stat(path.join(dir, n)).catch(() => null);
      if (st?.isFile()) size += st.size;
    }
    books.push({
      folder: e.name,
      title: meta?.title || e.name,
      author: meta?.author || '',
      identifier: meta?.identifier || null,
      source: meta?.source || null,
      addedAt: meta?.addedAt || null,
      // when the folder was made, for titles put on the drive without the app's note of the date
      createdAt: dirStat ? (dirStat.birthtimeMs > 0 ? dirStat.birthtimeMs : dirStat.mtimeMs) : null,
      complete: meta ? meta.complete !== false && (!meta.chapters || meta.chapters === mp3s.length) : true,
      managed: !!meta,
      chapters: mp3s.length,
      expectedChapters: meta?.chapters || null,
      unit: meta?.unit || 'chapter',
      kind: meta?.kind || 'book',
      cover: meta?.cover || null,
      trackNumbers: meta?.trackNumbers || null,
      trackTotal: meta?.trackTotal || null,
      quality: meta?.format === '64Kbps MP3' ? 'standard' : meta?.format ? 'high' : null,
      size,
      inOrder: sameOrder(mp3s, sortedNames(mp3s)),
    });
  }

  const folderOrder = books.map((b) => b.folder);
  const booksSize = books.reduce((a, b) => a + b.size, 0) + looseFiles.reduce((a, f) => a + f.size, 0);
  return {
    mount,
    total,
    free,
    booksSize,
    otherSize: Math.max(0, total - free - booksSize),
    books,
    looseFiles,
    foldersInOrder: sameOrder(folderOrder, sortedNames(folderOrder)),
    needsFix: interrupted || books.some((b) => !b.inOrder) || !sameOrder(folderOrder, sortedNames(folderOrder)),
  };
}

async function deleteFolder(mount, folder) {
  const p = bookPath(mount, folder);
  await fs.rm(p, { recursive: true, force: true, maxRetries: 3 });
}

async function deleteLooseFile(mount, name) {
  if (!isMp3(name)) throw new Error('Only MP3 files can be removed here.');
  await fs.rm(bookPath(mount, name), { force: true });
}

async function removeJunk(dir) {
  for (const n of await fs.readdir(dir).catch(() => [])) {
    if (n.startsWith('._')) await fs.rm(path.join(dir, n), { force: true }).catch(() => {});
  }
}

/**
 * macOS stores extended attributes on FAT cards as hidden "._name" files.
 * A "._chapter.mp3" file looks like a broken track to many players, so
 * remove them from the top level and every folder one level down.
 */
async function cleanAppleDouble(mount) {
  if (process.platform !== 'darwin') return;
  await removeJunk(mount);
  for (const e of await fs.readdir(mount, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !isHiddenOrSystem(e.name)) await removeJunk(path.join(mount, e.name));
  }
}

/**
 * FAT drivers put a new entry in the first free run of directory slots that
 * is big enough, and long names need several slots. So after entries are
 * removed, a short name can land in an early gap that a longer name skipped,
 * jumping ahead in play order. To prevent that, fill every gap with tiny
 * one-slot placeholder files (plain 8.3 names use a single slot) until a
 * placeholder lands at the very end of the directory. Entries added after
 * that are appended strictly in order; the placeholders are deleted later.
 */
async function fillDirectoryGaps(dir) {
  const made = [];
  for (let i = 0; i < 2000; i++) {
    const name = `GAP${String(i).padStart(5, '0')}.TMP`;
    await fs.writeFile(path.join(dir, name), '');
    const names = (await rawNames(dir)).filter((n) => !isJunk(n));
    made.push(name);
    if (names[names.length - 1] === name) break; // reached the free space at the end
  }
  return made;
}

/**
 * Rebuild the card so the FAT directory order matches name order:
 * every book folder is recreated with its files moved in one at a time in
 * sorted order, and top-level folders are re-added alphabetically.
 * Only renames are used, so it is quick and needs no free space.
 */
async function fixPlayOrder(mount, onProgress) {
  const tmp = path.join(mount, REORDER_DIR);
  for (const n of await rawNames(mount)) {
    if (/^GAP\d{5}\.TMP$/i.test(n)) await fs.rm(path.join(mount, n), { force: true }); // from an interrupted run
  }
  await fs.mkdir(tmp, { recursive: true });

  const rootEntries = await rawDir(mount);
  const items = rootEntries.filter(
    (e) => !isHiddenOrSystem(e.name) && (e.isDirectory() || (e.isFile() && isMp3(e.name)))
  );
  const total = items.length;
  let done = 0;

  // 1. Move each item out of the top level, rebuilding folders as we go.
  for (const e of items) {
    const src = path.join(mount, e.name);
    const dst = path.join(tmp, e.name);
    if (e.isDirectory()) {
      if (fsSync.existsSync(dst)) continue; // left over from an interrupted run; handled below
      await fs.mkdir(dst);
      await removeJunk(src);
      const names = (await fs.readdir(src)).filter((n) => !isJunk(n));
      const order = [
        ...sortedNames(names.filter(isMp3)),
        ...sortedNames(names.filter((n) => !isMp3(n))),
      ];
      for (const n of order) await fs.rename(path.join(src, n), path.join(dst, n));
      await fs.rmdir(src);
    } else {
      await fs.rename(src, dst);
    }
    onProgress?.({ done: ++done, total: total * 2 });
  }

  // 2. Move everything back to the top level in alphabetical order
  //    (folders first, then any loose MP3 files).
  // macOS keeps "._name" companions for folders on FAT; they move with their
  // folder automatically, so skip them here.
  const staged = (await rawDir(tmp)).filter((e) => !isJunk(e.name));
  const dirs = sortedNames(staged.filter((e) => e.isDirectory()).map((e) => e.name));
  const files = sortedNames(staged.filter((e) => !e.isDirectory()).map((e) => e.name));
  const fillers = await fillDirectoryGaps(mount);
  for (const n of [...dirs, ...files]) {
    let target = path.join(mount, n);
    if (fsSync.existsSync(target)) target = path.join(mount, `${n} (restored)`);
    await fs.rename(path.join(tmp, n), target);
    onProgress?.({ done: Math.min(total * 2, ++done), total: total * 2 });
  }
  for (const f of fillers) await fs.rm(path.join(mount, f), { force: true });
  await removeJunk(tmp);
  await fs.rmdir(tmp);
  await cleanAppleDouble(mount);
}

async function uniqueFolder(mount, base) {
  let name = base;
  for (let i = 2; fsSync.existsSync(path.join(mount, name)); i++) name = `${base} (${i})`;
  return name;
}

function trackFileName(index, count, title) {
  const width = Math.max(3, String(count).length);
  const num = String(index + 1).padStart(width, '0');
  // "01 - Chapter One" -> "Chapter One" (we add our own number)
  let t = sanitizeName(String(title ?? '').replace(/^\s*\d{1,4}\s*[-.:)_]\s*(?=\S)/, ''), 60);
  if (t === 'Untitled') t = `Track ${num}`;
  return `${num} - ${t}.mp3`;
}

/**
 * Copy downloaded chapter files onto the card strictly in order, one file at
 * a time, flushing each to disk. Streams are used instead of fs.copyFile so
 * macOS doesn't add "._" resource-fork files to the card.
 */
/**
 * Work out the files to write: one per chapter, or several "part" files for
 * chapters longer than the split length.
 * Returns [{ src, index, part, parts, title }].
 */
async function planOutputs(book, localFiles, splitSeconds) {
  const plan = [];
  for (let i = 0; i < localFiles.length; i++) {
    const title = book.tracks[i]?.title || `Chapter ${i + 1}`;
    let parts = 1;
    if (splitSeconds) {
      const { frames, duration } = mp3split.scanFrames(await fs.readFile(localFiles[i]));
      parts = mp3split.partCount(duration, splitSeconds);
      if (frames.length < parts * 10) parts = 1;
    }
    for (let p = 1; p <= parts; p++) {
      plan.push({ src: localFiles[i], index: i, part: p, parts, title: parts > 1 ? `${title} (part ${p} of ${parts})` : title });
    }
  }
  return plan;
}

/** Write a stream or buffer to `dest`, counting bytes and computing its MD5, then flush to disk. */
async function writeOut(dest, source, { onBytes, signal }) {
  const hash = crypto.createHash('md5');
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      onBytes?.(chunk.length);
      cb(null, chunk);
    },
  });
  const input = Buffer.isBuffer(source) ? Readable.from([source]) : source;
  await pipeline(input, counter, fsSync.createWriteStream(dest), { signal });
  const fh = await fs.open(dest, 'r+');
  await fh.sync().finally(() => fh.close());
  return hash.digest('hex');
}

/**
 * Copy downloaded chapter files onto the card strictly in order, one file at
 * a time, flushing each to disk. Streams are used instead of fs.copyFile so
 * macOS doesn't add "._" resource-fork files to the card.
 * With splitMinutes, long chapters become several numbered part files.
 */
/** "episodes 101-185", "chapter 4" or "12 episodes" for a set of track numbers. */
function rangeLabel(numbers, unit = 'chapter') {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 1) return `${unit} ${sorted[0]}`;
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return contiguous ? `${unit}s ${sorted[0]}-${sorted[sorted.length - 1]}` : `${sorted.length} ${unit}s`;
}

async function writeBook(mount, book, localFiles, { onBytes, signal, splitMinutes = 0 } = {}) {
  if (!fsSync.existsSync(mount)) throw new Error('The drive is not plugged in.');
  const numbers = book.tracks.map((t, i) => t.number || i + 1);
  const trackTotal = book.trackTotal || book.tracks.length;
  const partial = numbers.length < trackTotal;
  const unit = book.unit || 'chapter';
  const name = titleWithAuthor(book.title, book.author);
  // keep the range visible even when the title is long
  const base = partial
    ? `${sanitizeName(name, 60)} (${rangeLabel(numbers, unit)})`
    : sanitizeName(name, 70);
  const folder = await uniqueFolder(mount, base);
  const dir = path.join(mount, folder);
  await fs.mkdir(dir);

  const meta = {
    app: 'ListenSync',
    identifier: book.identifier,
    source: book.source,
    title: book.title,
    author: book.author,
    format: book.format,
    kind: book.kind || 'book',
    cover: book.cover || null,
    unit,
    chapters: 0,
    trackTotal,
    trackNumbers: numbers, // which tracks of the full book are in this folder
    splitMinutes: splitMinutes || 0,
    addedAt: new Date().toISOString(),
    complete: false,
    tracks: [], // { file, size, md5, number } per file, used by "Check books" and the player
  };

  try {
    const plan = await planOutputs(book, localFiles, (splitMinutes || 0) * 60);
    meta.chapters = plan.length;
    let pieces = null; // parts of the chapter currently being split
    for (let k = 0; k < plan.length; k++) {
      signal?.throwIfAborted();
      const item = plan[k];
      const number = numbers[item.index];
      // Unsplit files keep their number in the full book (e.g. "0763 - ..."), which
      // also keeps name order = play order when batches are added over time.
      const file = splitMinutes ? trackFileName(k, plan.length, item.title) : trackFileName(number - 1, trackTotal, item.title);
      const dest = path.join(dir, file);
      let md5;
      if (item.parts === 1) {
        md5 = await writeOut(dest, fsSync.createReadStream(item.src), { onBytes, signal });
        const expected = book.tracks[item.index]?.md5;
        if (expected && md5 !== expected) {
          throw new Error(`The downloaded copy of chapter ${item.index + 1} is damaged. Delete the book from My library and try again.`);
        }
        if ((await fs.stat(dest)).size !== (await fs.stat(item.src)).size) throw new Error(`Chapter ${item.index + 1} was not copied completely.`);
      } else {
        if (item.part === 1) pieces = mp3split.splitBuffer(await fs.readFile(item.src), item.parts);
        if (!pieces) throw new Error(`Chapter ${item.index + 1} could not be split into parts.`);
        const tag = mp3split.buildId3({ title: item.title, album: book.title, artist: book.author, track: `${k + 1}/${plan.length}` });
        md5 = await writeOut(dest, Buffer.concat([tag, pieces[item.part - 1]]), { onBytes, signal });
        if (item.part === item.parts) pieces = null;
      }
      meta.tracks.push({ file, size: (await fs.stat(dest)).size, md5, number });
    }
    // Written last so it never sits between chapters in the directory table.
    // A folder without it (e.g. card pulled mid-copy) shows as incomplete.
    meta.complete = true;
    await writeMeta(dir, meta);
    if (process.platform === 'darwin') {
      await cleanAppleDouble(mount);
      // Stop Spotlight from filling the card with index files.
      await fs.writeFile(path.join(mount, '.metadata_never_index'), '').catch(() => {});
    }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (!fsSync.existsSync(mount)) throw new Error('The drive was removed while copying.');
    if (err?.code === 'ENOSPC') throw new Error('The drive ran out of space.');
    throw err;
  }
  return folder;
}

module.exports = {
  listCard,
  deleteFolder,
  deleteLooseFile,
  fixPlayOrder,
  writeBook,
  bookPath,
  trackFileName,
  rangeLabel,
  META_FILE,
  REORDER_DIR,
  readMeta,
  readDriveFile,
  writeDriveFile,
};
