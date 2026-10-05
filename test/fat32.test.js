'use strict';
// Integration test on a real FAT32 volume (macOS only: uses a disk image).
// Verifies that the on-disk directory order (what cheap players use) is correct
// after writing, deleting and re-adding books, and after "Fix play order".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sdcard = require('../src/main/sdcard');

const mac = process.platform === 'darwin';

test('play order on a FAT32 volume', { skip: !mac && 'needs macOS hdiutil' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fat32-'));
  const img = path.join(work, 'card.dmg');
  execFileSync('hdiutil', ['create', '-size', '64m', '-fs', 'MS-DOS FAT32', '-volname', 'TESTCARD', '-layout', 'MBRSPUD', img], { stdio: 'ignore' });
  const out = execFileSync('hdiutil', ['attach', img, '-nobrowse']).toString();
  const mount = out.trim().split('\n').pop().split('\t').pop().trim();
  try {
    // fake downloaded chapters, deliberately created in reverse order
    const src = path.join(work, 'src');
    fs.mkdirSync(src);
    const mk = (n) => Array.from({ length: n }, (_, i) => {
      const f = path.join(src, `${String(i).padStart(4, '0')}-${n}.mp3`);
      fs.writeFileSync(f, Buffer.alloc(1000 + i));
      return f;
    });
    const book = (title, n) => ({ identifier: title.toLowerCase(), title, author: 'Tester', tracks: Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1}` })) });

    // a loose file written by hand (gets a macOS "._" companion on FAT)
    fs.writeFileSync(path.join(mount, 'loose.mp3'), Buffer.alloc(500));
    const fa = await sdcard.writeBook(mount, book('Alpha', 12), mk(12));
    await sdcard.writeBook(mount, book('Charlie', 3), mk(3));
    await sdcard.writeBook(mount, book('Bravo', 5), mk(5));

    let info = await sdcard.listCard(mount);
    assert.deepStrictEqual(info.books.map((b) => b.title), ['Alpha', 'Charlie', 'Bravo'], 'readdir reflects write order');
    assert.ok(info.books.every((b) => b.inOrder), 'chapters written in order');
    assert.strictEqual(info.books[0].chapters, 12);
    assert.ok(!fs.readdirSync(path.join(mount, fa)).some((n) => n.startsWith('._')), 'no AppleDouble files');

    // Scramble a folder's order by renaming chapters in the wrong sequence
    const dir = path.join(mount, fa);
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.mp3'));
    for (const n of [...names].reverse()) fs.renameSync(path.join(dir, n), path.join(dir, 'x' + n));
    for (const n of [...names].reverse()) fs.renameSync(path.join(dir, 'x' + n), path.join(dir, n));
    info = await sdcard.listCard(mount);
    assert.ok(info.needsFix);

    await sdcard.fixPlayOrder(mount);
    info = await sdcard.listCard(mount);
    assert.deepStrictEqual(info.books.map((b) => b.title), ['Alpha', 'Bravo', 'Charlie'], 'folders alphabetical after fix');
    assert.ok(info.books.every((b) => b.inOrder), 'chapters in order after fix');
    assert.strictEqual(info.needsFix, false);
    assert.strictEqual(info.books[0].chapters, 12);

    // Gap test: a short-named folder, then a hidden entry the app never moves
    // (like .fseventsd), then a long-named book. Moving folders out leaves a
    // small gap at the front that only the short name fits into.
    await sdcard.deleteFolder(mount, info.books[0].folder);
    await sdcard.deleteFolder(mount, info.books[1].folder);
    await sdcard.writeBook(mount, book('Zulu', 2), mk(2));
    fs.writeFileSync(path.join(mount, '.pinned'), 'x');
    await sdcard.writeBook(mount, book('Alpha and a very long title needing several directory slots', 2), mk(2));
    await sdcard.fixPlayOrder(mount);
    info = await sdcard.listCard(mount);
    assert.deepStrictEqual(info.books.map((b) => b.title.split(' ')[0]), ['Alpha', 'Charlie', 'Zulu'], 'long names not overtaken by short ones');
    assert.ok(!info.needsFix);
    assert.ok(!fs.readdirSync(mount).some((n) => /^GAP\d+/i.test(n)), 'filler entries removed');

    await sdcard.deleteFolder(mount, info.books[1].folder);
    info = await sdcard.listCard(mount);
    assert.deepStrictEqual(info.books.map((b) => b.title.split(' ')[0]), ['Alpha', 'Zulu']);
    assert.ok(info.total > 0 && info.free > 0 && info.booksSize > 0);

    // No "._something.mp3" files anywhere: some players try to play those.
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]);
    assert.deepStrictEqual(walk(mount).filter((n) => n.startsWith('._') && n.endsWith('.mp3')), []);
    assert.deepStrictEqual(info.looseFiles.map((f) => f.name), ['loose.mp3']);
  } finally {
    execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
