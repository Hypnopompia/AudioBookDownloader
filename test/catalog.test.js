'use strict';

const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/main/catalog');

test('78 rpm records get music genres from their tags', () => {
  assert.deepStrictEqual(catalog.genresFor(['78rpm', 'Blues', 'Folk'], 'House Of The Rising Sun', 'music'), ['blues', 'folk']);
  assert.deepStrictEqual(catalog.genresFor(['78rpm', 'Popular Music'], 'Mr. Sandman', 'music'), ['popular']);
  // no book-style guesses from the title for music
  assert.deepStrictEqual(catalog.genresFor(['78rpm'], 'Tales of the Vienna Woods', 'music'), []);
});

test('talks get talk topics', () => {
  assert.deepStrictEqual(catalog.genresFor(['Speeches', 'Vietnam War'], 'Beyond Vietnam', 'talks'), ['speeches', 'history']);
  assert.deepStrictEqual(catalog.genresFor(['philosophy', 'lecture', 'existentialism'], 'Nietzsche', 'talks'), ['philosophy']);
});

test('live music is browsed by its most played bands', () => {
  const show = (artist, downloads) => ({ artist, downloads });
  const items = [
    ...Array.from({ length: 5 }, () => show('Grateful Dead', 1000)),
    ...Array.from({ length: 4 }, () => show('moe.', 10)),
    ...Array.from({ length: 3 }, () => show('One Off Band', 100000)), // too few shows for a shelf
  ];
  assert.deepStrictEqual(catalog.genreList({ genres: 'artists' }, items), [
    { id: 'a:grateful-dead', label: 'Grateful Dead' },
    { id: 'a:moe', label: 'moe.' },
  ]);
});

test('two copies of a recording in the same format are listed once', () => {
  const files = [
    { name: 'a.wma', format: 'Windows Media Audio', title: 'Speech A' },
    { name: 'a.mp3', format: 'VBR MP3', original: 'a.wma', title: 'Speech A', size: '100' },
    { name: 'a_vbr.mp3', format: 'VBR MP3', original: 'a.wma', size: '300' },
    { name: 'a_64kb.mp3', format: '64Kbps MP3', original: 'a.wma', size: '150' },
    { name: 'b.wma', format: 'Windows Media Audio', title: 'Speech B' },
    { name: 'b.mp3', format: 'VBR MP3', original: 'b.wma', title: 'Speech B', size: '100' },
    { name: 'b_vbr.mp3', format: 'VBR MP3', original: 'b.wma', size: '300' },
    { name: 'b_64kb.mp3', format: '64Kbps MP3', original: 'b.wma', size: '150' },
  ];
  const std = catalog.buildTracks(files, 'standard');
  assert.strictEqual(std.format, '64Kbps MP3'); // no longer outnumbered by the doubled set
  assert.deepStrictEqual(std.tracks.map((t) => t.title), ['Speech A', 'Speech B']);
  const high = catalog.buildTracks(files, 'high');
  assert.deepStrictEqual(high.tracks.map((t) => t.name), ['a.mp3', 'b.mp3']);
});

test('prebuilt lists are used when newer, verified, and skipped when stale', async (t) => {
  const http = require('node:http');
  const zlib = require('node:zlib');
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const items = [{ id: 'a', title: 'A', author: '', downloads: 1, genres: [] }];
  const fetchedAt = Date.now() - 3600 * 1000;
  const gz = zlib.gzipSync(JSON.stringify({ fetchedAt, items }));
  let manifest;
  const setManifest = (patch = {}) => {
    manifest = { builtAt: Date.now(), sources: { otr: { fetchedAt, count: 1, bytes: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex'), ...patch } } };
  };
  const server = http.createServer((req, res) => {
    if (req.url.endsWith(catalog.manifestFile())) return res.end(JSON.stringify(manifest));
    if (req.url.endsWith(catalog.prebuiltFile('otr'))) return res.end(gz);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  process.env.LISTENSYNC_CATALOG_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => delete process.env.LISTENSYNC_CATALOG_URL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  catalog.init(dir);

  setManifest();
  const first = await catalog.refresh('otr');
  assert.strictEqual(first.fetchedAt, fetchedAt);
  assert.deepStrictEqual(first.items, items);
  assert.ok(fs.existsSync(path.join(dir, `catalog-v3-otr.json`)));

  // the same list again: nothing new to download, the cache is kept
  assert.strictEqual((await catalog.refresh('otr')).fetchedAt, fetchedAt);

  // a file that doesn't match its checksum, or a list the weekly job stopped updating,
  // isn't used (the app reads archive.org instead, which is stubbed out here)
  const archive = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('archive.org')) {
      archive.push(String(url));
      throw new Error('offline');
    }
    return realFetch(url, opts);
  };
  t.after(() => (global.fetch = realFetch));
  fs.rmSync(path.join(dir, 'catalog-v3-otr.json'));
  setManifest({ sha256: 'bad' });
  await assert.rejects(catalog.refresh('otr'));
  setManifest({ fetchedAt: Date.now() - 30 * 24 * 3600 * 1000 });
  await assert.rejects(catalog.refresh('otr'));
  assert.ok(archive.length >= 2);
});
