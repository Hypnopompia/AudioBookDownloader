'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scanFrames, splitBuffer, partCount, buildId3 } = require('../src/main/mp3split');

// A synthetic CBR MP3: MPEG-1 Layer III, 128 kbps, 44.1 kHz -> 417-byte frames of 1152 samples.
function fakeMp3(frames, { id3 = true, xing = true } = {}) {
  const frame = () => {
    const f = Buffer.alloc(417);
    f.set([0xff, 0xfb, 0x90, 0x00]);
    return f;
  };
  const parts = [];
  if (id3) parts.push(buildId3({ title: 'Original' }));
  if (xing) {
    const x = frame();
    x.write('Xing', 4 + 32, 'latin1'); // stereo MPEG-1: side info is 32 bytes
    parts.push(x);
  }
  for (let i = 0; i < frames; i++) parts.push(frame());
  parts.push(Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)])); // ID3v1
  return Buffer.concat(parts);
}

const FRAME_SEC = 1152 / 44100;

test('scanFrames skips tags and the Xing frame', () => {
  const { frames, duration } = scanFrames(fakeMp3(1000));
  assert.strictEqual(frames.length, 1000);
  assert.ok(Math.abs(duration - 1000 * FRAME_SEC) < 1e-6);
});

test('partCount leaves short chapters alone and makes equal parts', () => {
  assert.strictEqual(partCount(14 * 60, 15 * 60), 1);
  assert.strictEqual(partCount(18 * 60, 15 * 60), 1); // within 25%
  assert.strictEqual(partCount(50 * 60, 15 * 60), 4);
  assert.strictEqual(partCount(50 * 60, 0), 1);
});

test('splitBuffer cuts on frame boundaries into equal parts', () => {
  const buf = fakeMp3(10000); // ~4.4 minutes
  const pieces = splitBuffer(buf, 4);
  assert.strictEqual(pieces.length, 4);
  const counts = pieces.map((p) => scanFrames(p).frames.length);
  assert.strictEqual(counts.reduce((a, b) => a + b, 0), 10000, 'no frames lost or duplicated');
  for (const c of counts) assert.ok(Math.abs(c - 2500) <= 1, `part has ${c} frames`);
  for (const p of pieces) assert.strictEqual(p.length % 417, 0, 'each part is whole frames');
  // tag + part is still a valid MP3
  const tagged = Buffer.concat([buildId3({ title: 'Part 1', track: '1/4' }), pieces[0]]);
  assert.strictEqual(scanFrames(tagged).frames.length, counts[0]);
});
