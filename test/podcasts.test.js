'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toDetails, useAnchorStore } = require('../src/main/podcasts');

const show = { id: 'pod-1', title: 'Show', author: 'A', categories: [] };
const ep = (day, ext = 'mp3') => ({ url: `https://x.test/${day}.${ext}`, type: ext === 'mp3' ? 'audio/mpeg' : 'audio/x-m4a', size: 5e6, title: `Day ${day}`, seconds: 600, date: day * 86400 });

test('only MP3 episodes are offered, numbered oldest first', () => {
  useAnchorStore({ get: () => null, set: () => {} });
  const d = toDetails(show, [ep(3), ep(1), ep(2, 'm4a')], '', '');
  assert.deepStrictEqual(d.tracks.map((t) => [t.number, t.title]), [[1, 'Day 1'], [3, 'Day 3']]);
  assert.strictEqual(d.hiddenEpisodes, 1);
  assert.strictEqual(d.unit, 'episode');
});

test('episode numbers stay put when a capped feed slides forward', () => {
  const store = new Map();
  useAnchorStore({ get: (id) => store.get(id) || null, set: (id, a) => store.set(id, a) });
  // first visit: feed lists days 1-5
  let d = toDetails(show, [1, 2, 3, 4, 5].map((n) => ep(n)), '', '');
  const day4 = d.tracks.find((t) => t.title === 'Day 4').number;
  // later: feed only keeps the newest 5, now days 3-7
  d = toDetails(show, [3, 4, 5, 6, 7].map((n) => ep(n)), '', '');
  assert.strictEqual(d.tracks.find((t) => t.title === 'Day 4').number, day4, 'same episode, same number');
  assert.strictEqual(d.tracks.find((t) => t.title === 'Day 7').number, 7);
  assert.strictEqual(d.trackTotal, 7);
});
