'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeName, parseDuration, parseRuntime, parseTrack, htmlToText, naturalCompare } = require('../src/main/util');
const { buildTracks } = require('../src/main/catalog');
const { trackFileName } = require('../src/main/sdcard');

test('sanitizeName strips characters FAT32 forbids', () => {
  assert.strictEqual(sanitizeName('What? A "Book": Part 1/2.'), 'What A Book Part 1 2');
  assert.strictEqual(sanitizeName('  ...  '), 'Untitled');
  assert.strictEqual(sanitizeName('CON'), '_CON');
  assert.ok(sanitizeName('x'.repeat(300)).length <= 80);
});

test('parseDuration handles archive.org formats', () => {
  assert.strictEqual(parseDuration('577.86'), 578);
  assert.strictEqual(parseDuration('09:37'), 577);
  assert.strictEqual(parseDuration('1:02:03'), 3723);
  assert.strictEqual(parseDuration('garbage'), null);
});

test('parseRuntime handles the H:MM.SS form archive.org uses for long books', () => {
  assert.strictEqual(parseRuntime('16:31.09'), 16 * 3600 + 31 * 60 + 9); // Dracula
  assert.strictEqual(parseRuntime('3:14.29'), 3 * 3600 + 14 * 60 + 29);
  assert.strictEqual(parseRuntime('12:11:09'), 12 * 3600 + 11 * 60 + 9);
  assert.strictEqual(parseRuntime('22:20'), 22 * 60 + 20); // short story: M:SS
  assert.strictEqual(parseRuntime(''), null);
});

test('parseTrack', () => {
  assert.strictEqual(parseTrack('3/50'), 3);
  assert.strictEqual(parseTrack('07'), 7);
  assert.strictEqual(parseTrack(undefined), null);
});

test('naturalCompare orders numbers numerically', () => {
  assert.deepStrictEqual(['ch10', 'ch2', 'ch1'].sort(naturalCompare), ['ch1', 'ch2', 'ch10']);
});

test('htmlToText', () => {
  assert.strictEqual(htmlToText('<a href="x">LibriVox</a> recording &amp; more<br>next'), 'LibriVox recording & more\nnext');
});

test('trackFileName zero-pads so name order == play order', () => {
  assert.strictEqual(trackFileName(0, 50, 'Chapter 01'), '001 - Chapter 01.mp3');
  assert.strictEqual(trackFileName(9, 1200, 'Intro: Part?'), '0010 - Intro Part.mp3');
  assert.strictEqual(trackFileName(1, 8, '02 - 1 Pedro 2'), '002 - 1 Pedro 2.mp3');
  assert.strictEqual(trackFileName(0, 8, '1984'), '001 - 1984.mp3');
});

const files = [
  { name: 'book_10_x.mp3', format: 'VBR MP3', track: '10/10', title: 'Ten', size: '200', length: '100' },
  { name: 'book_02_x.mp3', format: 'VBR MP3', track: '2/10', title: 'Two', size: '200', length: '100' },
  { name: 'book_01_x.mp3', format: 'VBR MP3', track: '1/10', title: 'One', size: '200', length: '100' },
  { name: 'book_10_x_64kb.mp3', format: '64Kbps MP3', original: 'book_10_x.mp3', size: '100', length: '01:40' },
  { name: 'book_02_x_64kb.mp3', format: '64Kbps MP3', original: 'book_02_x.mp3', size: '100', length: '01:40' },
  { name: 'book_01_x_64kb.mp3', format: '64Kbps MP3', original: 'book_01_x.mp3', size: '100', length: '01:40' },
  { name: 'cover.jpg', format: 'JPEG' },
];

test('buildTracks prefers 64kb for standard and orders by original track number', () => {
  const { format, tracks } = buildTracks(files, 'standard');
  assert.strictEqual(format, '64Kbps MP3');
  assert.deepStrictEqual(tracks.map((t) => t.title), ['One', 'Two', 'Ten']);
  assert.strictEqual(tracks[0].seconds, 100);
});

test('buildTracks high quality picks originals', () => {
  const { format, tracks } = buildTracks(files, 'high');
  assert.strictEqual(format, 'VBR MP3');
  assert.strictEqual(tracks.length, 3);
});

test('buildTracks never picks an incomplete format set', () => {
  const partial = files.filter((f) => f.name !== 'book_02_x_64kb.mp3');
  assert.strictEqual(buildTracks(partial, 'standard').format, 'VBR MP3');
});

const { fixAllCaps, tidyTrackTitles, recordingKind } = require('../src/main/util');

test('all-capital titles get normal capitals; other text is left alone', () => {
  assert.strictEqual(fixAllCaps('LILY OF LAGUNA'), 'Lily of Laguna');
  assert.strictEqual(fixAllCaps("SONGS THEY DON'T SING IN SCHOOL"), "Songs They Don't Sing in School");
  assert.strictEqual(fixAllCaps('PART II OF THE STORY'), 'Part II of the Story');
  assert.strictEqual(fixAllCaps('Mr. Sandman'), 'Mr. Sandman');
  assert.strictEqual(fixAllCaps('USA'), 'USA'); // too short to be sure it's shouting
});

test('track titles made from file names are tidied', () => {
  assert.deepStrictEqual(tidyTrackTitles(['wonderland_ch_01', 'wonderland_ch_02']), ['Chapter 1', 'Chapter 2']);
  assert.deepStrictEqual(tidyTrackTitles(['00 - Preface', '01 - A Snow-Drift']), ['Preface', 'A Snow-Drift']);
  assert.deepStrictEqual(
    tidyTrackTitles(["01 - MY MAN O' WAR - BETTY THORNTON - Frank Signorelli", "02 - MAMA'S WELL HAS DONE GONE DRY - BETTY THORNTON"], ['BETTY THORNTON', 'Frank Signorelli']),
    ["My Man O' War", "Mama's Well Has Done Gone Dry"]
  );
  // numbers that are part of the title, or only on some tracks, stay
  assert.deepStrictEqual(tidyTrackTitles(['1984', 'Part 2']), ['1984', 'Part 2']);
  assert.deepStrictEqual(tidyTrackTitles(['01 - Intro', 'Encore']), ['01 - Intro', 'Encore']);
});

test('live recordings are labeled by how they were taped', () => {
  assert.strictEqual(recordingKind('gd77-05-08.maizner.hicks.5002.sbeok.shnf', 'Audience - Sony ECM-990'), 'Audience');
  assert.strictEqual(recordingKind('gd1977-05-08.148737.SBD.Betty.Anon.Noel.t-flac2448', ''), 'Soundboard');
  assert.strictEqual(recordingKind('gd1977-05-08.mtx.dan.29511.flac16', ''), 'Soundboard and audience mix');
  assert.strictEqual(recordingKind('phish1999-12-31.fm.flac', ''), 'Broadcast');
  assert.strictEqual(recordingKind('oar2006-01-14.mix.flac16', ''), '');
});
