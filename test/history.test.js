'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const history = require('../src/main/history');

const book = (folder, extra = {}) => ({ folder, identifier: folder.toLowerCase(), title: folder, author: 'A', size: 10, ...extra });

test('reconcile logs titles found on a drive seen for the first time, dated from the drive', () => {
  const books = [
    book('Emma', { addedAt: '2025-03-01T10:00:00.000Z', createdAt: 5 }),
    book('Hand copied', { identifier: null, createdAt: Date.UTC(2024, 0, 2) }),
  ];
  const { contents, events } = history.reconcile('d1', null, books, 1000);
  assert.strictEqual(contents.length, 2);
  assert.deepStrictEqual(events.map((e) => [e.type, e.title, e.at, e.found]), [
    ['copied', 'Emma', Date.parse('2025-03-01T10:00:00.000Z'), true],
    ['copied', 'Hand copied', Date.UTC(2024, 0, 2), true],
  ]);
});

test('reconcile notices removed titles and ignores ones it already knows', () => {
  const prev = history.reconcile('d1', null, [book('Emma'), book('Dracula')]).contents;
  const same = history.reconcile('d1', prev, [book('Dracula'), book('Emma')], 2000);
  assert.deepStrictEqual(same.events, []);
  const { events } = history.reconcile('d1', prev, [book('Emma')], 3000);
  assert.deepStrictEqual(events.map((e) => [e.type, e.title, e.at, e.noticed]), [['removed', 'Dracula', 3000, true]]);
});

test('reconcile tells apart two batches of the same series', () => {
  const prev = history.reconcile('d1', null, [book('Show (episodes 1-10)', { identifier: 'show' })]).contents;
  const { events } = history.reconcile('d1', prev, [book('Show (episodes 1-10)', { identifier: 'show' }), book('Show (episodes 11-20)', { identifier: 'show' })]);
  assert.deepStrictEqual(events.map((e) => [e.type, e.folder]), [['copied', 'Show (episodes 11-20)']]);
});

test('drives are remembered; copies are not logged twice; clearing keeps drive names', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-history-'));
  const mount = path.join(tmp, 'card');
  fs.mkdirSync(mount);
  history.init(path.join(tmp, 'settings'));
  const drive = { mount, label: 'SANDISK', serial: 'ABCD-1234' };
  assert.strictEqual(await history.identify(drive), null);

  const rec = await history.register(drive, '  Card   one ');
  assert.strictEqual(rec.name, 'Card one');
  const onDisk = JSON.parse(fs.readFileSync(path.join(mount, '.listensync-drive.json'), 'utf8'));
  assert.strictEqual(onDisk.id, rec.id);
  assert.strictEqual(onDisk.name, 'Card one');

  history.update(rec.id, [book('Emma')]); // found on the drive
  history.logCopied(rec.id, book('Dracula', { trackNumbers: [1, 2], trackTotal: 5, unit: 'chapter' }));
  assert.strictEqual(history.update(rec.id, [book('Emma'), book('Dracula')]), false);
  let s = history.state();
  assert.deepStrictEqual(s.events.map((e) => [e.type, e.title, !!e.found]), [['copied', 'Emma', true], ['copied', 'Dracula', false]]);
  assert.deepStrictEqual(s.summary.dracula.numbers, [1, 2]);
  assert.deepStrictEqual(s.summary.dracula.onDrives, [rec.id]);

  history.logRemoved(rec.id, 'Dracula');
  s = history.state();
  assert.strictEqual(s.events.at(-1).type, 'removed');
  assert.deepStrictEqual(s.summary.dracula.onDrives, []);

  // the hidden file was erased: recognised by its serial number, and the file is written again
  fs.rmSync(path.join(mount, '.listensync-drive.json'));
  assert.strictEqual((await history.identify(drive)).id, rec.id);
  assert.ok(fs.existsSync(path.join(mount, '.listensync-drive.json')));

  history.clear();
  s = history.state();
  assert.deepStrictEqual(s.events, []);
  assert.strictEqual(s.drives[0].name, 'Card one');

  history.flush();
  history.init(path.join(tmp, 'settings'));
  assert.strictEqual(history.get(rec.id).name, 'Card one');
  fs.rmSync(tmp, { recursive: true, force: true });
});
