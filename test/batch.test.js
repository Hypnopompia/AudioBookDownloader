'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sdcard = require('../src/main/sdcard');
const { verifyBook } = require('../src/main/verify');

test('rangeLabel describes a batch', () => {
  assert.strictEqual(sdcard.rangeLabel([101, 102, 103], 'episode'), 'episodes 101-103');
  assert.strictEqual(sdcard.rangeLabel([4], 'chapter'), 'chapter 4');
  assert.strictEqual(sdcard.rangeLabel([1, 5, 9], 'episode'), '3 episodes');
});

test('a batch of episodes keeps original numbers and checks out', async () => {
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'batchsrc-'));
  try {
    const tracks = [];
    const files = [];
    for (const number of [763, 764, 765]) {
      const buf = crypto.randomBytes(3000);
      const f = path.join(src, `${number}.mp3`);
      fs.writeFileSync(f, buf);
      files.push(f);
      tracks.push({ number, title: `Episode ${number}`, md5: crypto.createHash('md5').update(buf).digest('hex') });
    }
    const folder = await sdcard.writeBook(mount, {
      identifier: 'OTRR_LoneRanger_Singles', title: 'The Lone Ranger', author: 'OTRR', format: 'VBR MP3',
      unit: 'episode', trackTotal: 2221, tracks,
    }, files);
    assert.strictEqual(folder, 'The Lone Ranger - OTRR (episodes 763-765)');
    const names = fs.readdirSync(path.join(mount, folder)).filter((n) => n.endsWith('.mp3')).sort();
    assert.deepStrictEqual(names, ['0763 - Episode 763.mp3', '0764 - Episode 764.mp3', '0765 - Episode 765.mp3']);
    const info = await sdcard.listCard(mount);
    assert.deepStrictEqual(info.books[0].trackNumbers, [763, 764, 765]);
    assert.strictEqual(info.books[0].unit, 'episode');
    assert.ok(info.books[0].complete);
    assert.strictEqual((await verifyBook(mount, folder)).status, 'ok');
  } finally {
    fs.rmSync(mount, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});
