'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyBook } = require('../src/main/verify');

test('Check books detects damaged, missing and good chapters', async () => {
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  try {
    const dir = path.join(mount, 'Book - Author');
    fs.mkdirSync(dir);
    const tracks = [];
    for (let i = 0; i < 3; i++) {
      const buf = crypto.randomBytes(5000 + i);
      const file = `00${i + 1} - Chapter ${i + 1}.mp3`;
      fs.writeFileSync(path.join(dir, file), buf);
      tracks.push({ file, size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') });
    }
    fs.writeFileSync(path.join(dir, '.book.json'), JSON.stringify({ identifier: 'x', format: '64Kbps MP3', chapters: 3, tracks }));

    let r = await verifyBook(mount, 'Book - Author');
    assert.strictEqual(r.status, 'ok', r.problems.join(' '));

    // flip one byte in chapter 2 (same size, different contents)
    const f2 = path.join(dir, tracks[1].file);
    const b = fs.readFileSync(f2);
    b[100] ^= 0xff;
    fs.writeFileSync(f2, b);
    r = await verifyBook(mount, 'Book - Author');
    assert.strictEqual(r.status, 'problem');
    assert.match(r.problems.join(' '), /Chapter 2 is damaged/);

    // remove chapter 3
    fs.rmSync(path.join(dir, tracks[2].file));
    r = await verifyBook(mount, 'Book - Author');
    assert.match(r.problems.join(' '), /1 of 3 chapters are missing/);

    // folder copied by hand: nothing to compare with
    fs.mkdirSync(path.join(mount, 'Hand Copied'));
    fs.writeFileSync(path.join(mount, 'Hand Copied', 'a.mp3'), 'x');
    r = await verifyBook(mount, 'Hand Copied');
    assert.strictEqual(r.status, 'unknown');
  } finally {
    fs.rmSync(mount, { recursive: true, force: true });
  }
});
