'use strict';

/*
 * Split MP3 files into shorter parts without re-encoding (no ffmpeg needed).
 *
 * An MP3 is a sequence of independent frames (~26 ms each) after an optional
 * ID3v2 tag. We find the frame boundaries, cut at the frame nearest each
 * target time, and give each part its own small ID3v2 tag (title, album,
 * artist, track number) so players that show tags display something sensible.
 * The leading Xing/Info frame (which describes the whole original file) is
 * dropped so players don't show the original length for every part.
 */

const BITRATES = {
  // [version][layer] -> kbps table (index 0 = free, 15 = bad)
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

/** Parse a 4-byte frame header at `i`, or return null if it isn't one. */
function parseHeader(buf, i) {
  if (i + 4 > buf.length) return null;
  const b1 = buf[i + 1], b2 = buf[i + 2];
  if (buf[i] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const verBits = (b1 >> 3) & 3; // 0 = 2.5, 2 = 2, 3 = 1
  const layerBits = (b1 >> 1) & 3; // 1 = III, 2 = II, 3 = I
  if (verBits === 1 || layerBits === 0) return null;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const layer = 4 - layerBits;
  const brIdx = b2 >> 4, srIdx = (b2 >> 2) & 3, pad = (b2 >> 1) & 1;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const bitrate = BITRATES[version === 1 ? 1 : 2][layer][brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  let length, samples;
  if (layer === 1) {
    length = (Math.floor((12 * bitrate) / sampleRate) + pad) * 4;
    samples = 384;
  } else {
    samples = layer === 3 && version !== 1 ? 576 : 1152;
    length = Math.floor(((samples / 8) * bitrate) / sampleRate) + pad;
  }
  if (length < 24) return null;
  return { length, duration: samples / sampleRate, version, layer, channelMode: buf[i + 3] >> 6 };
}

function id3v2Size(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  return 10 + size + (buf[5] & 0x10 ? 10 : 0);
}

/** Is this frame a Xing/Info/VBRI header (a silent frame describing the whole file)? */
function isInfoFrame(buf, offset, h) {
  const sideInfo = h.version === 1 ? (h.channelMode === 3 ? 17 : 32) : h.channelMode === 3 ? 9 : 17;
  const tag = buf.toString('latin1', offset + 4 + sideInfo, offset + 8 + sideInfo);
  return tag === 'Xing' || tag === 'Info' || buf.toString('latin1', offset + 36, offset + 40) === 'VBRI';
}

/** All frames in the file: [{ offset, length, duration }] plus total duration. */
function scanFrames(buf) {
  let end = buf.length;
  if (end >= 128 && buf.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128; // ID3v1
  let i = id3v2Size(buf);
  const frames = [];
  let duration = 0;
  let skippedInfo = false;
  while (i + 4 <= end) {
    const h = parseHeader(buf, i);
    // Accept a header only if the next frame also lines up (avoids false syncs in audio data).
    if (h && (i + h.length >= end || parseHeader(buf, i + h.length))) {
      if (!frames.length && !skippedInfo && isInfoFrame(buf, i, h)) {
        skippedInfo = true;
      } else {
        frames.push({ offset: i, length: Math.min(h.length, end - i), duration: h.duration });
        duration += h.duration;
      }
      i += h.length;
    } else {
      i++; // resync
    }
  }
  return { frames, duration };
}

// ---- minimal ID3v2.3 writer ----------------------------------------------
function textFrame(id, text) {
  // UTF-16 with BOM so any title works
  const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(String(text), 'utf16le')]);
  const head = Buffer.alloc(10);
  head.write(id, 0, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function buildId3({ title, album, artist, track }) {
  const frames = [];
  if (title) frames.push(textFrame('TIT2', title));
  if (album) frames.push(textFrame('TALB', album));
  if (artist) frames.push(textFrame('TPE1', artist));
  if (track) frames.push(textFrame('TRCK', track));
  frames.push(textFrame('TCON', 'Audiobook'));
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length), body]);
}

/**
 * How many parts a file of `duration` seconds becomes for a target part
 * length. Files up to 1.25x the target are left whole; otherwise parts are
 * made roughly equal (e.g. 50 min at 15 min -> 4 parts of 12.5 min).
 */
function partCount(duration, targetSeconds) {
  if (!targetSeconds || duration <= targetSeconds * 1.25) return 1;
  return Math.ceil(duration / targetSeconds);
}

/**
 * Split an MP3 buffer into `parts` roughly equal pieces.
 * Returns an array of Buffers (audio only, no tags), or null if the file
 * doesn't look like an MP3 we can safely cut.
 */
function splitBuffer(buf, parts) {
  const { frames, duration } = scanFrames(buf);
  if (frames.length < parts * 10 || parts < 2) return null;
  const pieces = [];
  let start = 0;
  let t = 0;
  for (let p = 1; p <= parts; p++) {
    const target = (duration * p) / parts;
    let endIdx = start;
    while (endIdx < frames.length && (p === parts || t + frames[endIdx].duration / 2 < target)) {
      t += frames[endIdx].duration;
      endIdx++;
    }
    const a = frames[start];
    const z = frames[endIdx - 1];
    if (!a || !z) return null;
    pieces.push(buf.subarray(a.offset, z.offset + z.length));
    start = endIdx;
  }
  return pieces;
}

module.exports = { scanFrames, splitBuffer, partCount, buildId3 };
