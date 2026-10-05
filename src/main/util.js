'use strict';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural sort compare: "Chapter 2" < "Chapter 10". */
function naturalCompare(a, b) {
  return collator.compare(String(a), String(b));
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Make a string safe to use as a file or folder name on FAT32 / exFAT and
 * on every OS: strips characters Windows forbids, control characters and
 * trailing dots/spaces, and keeps names short enough for cheap players.
 */
function sanitizeName(name, maxLen = 80) {
  let s = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) {
    // cut at a word boundary when there is one reasonably close
    const cut = s.lastIndexOf(' ', maxLen);
    s = (cut > maxLen - 20 ? s.slice(0, cut) : s.slice(0, maxLen)).trim().replace(/[-–,:;]+$/, '').trim();
  }
  s = s.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!s) s = 'Untitled';
  if (RESERVED.test(s)) s = '_' + s;
  return s;
}

/** "Title - Author" for folder names, without repeating an author the title already mentions. */
function titleWithAuthor(title, author) {
  const t = String(title || '').trim() || 'Untitled';
  const a = String(author || '').trim();
  return a && !t.toLowerCase().includes(a.toLowerCase()) ? `${t} - ${a}` : t;
}

/** Parse "577.86", "09:37" or "1:02:03" into seconds (or null). */
function parseDuration(v) {
  if (v == null) return null;
  const s = String(Array.isArray(v) ? v[0] : v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) {
    return Math.round(s.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0));
  }
  return null;
}

/**
 * Parse an archive.org item "runtime". Besides "H:MM:SS" and "M:SS", long
 * LibriVox books use "H:MM.SS" (a dot before the seconds), e.g. Dracula is
 * "16:31.09" = 16 h 31 min 9 s. parseDuration would read that as 16½ minutes.
 */
function parseRuntime(v) {
  const s = String(Array.isArray(v) ? v[0] : v ?? '').trim();
  const m = /^(\d+):(\d{2})\.(\d{2})$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return parseDuration(s);
}

/** Parse a track field like "3", "03" or "3/50" into a number (or null). */
function parseTrack(v) {
  if (v == null) return null;
  const m = String(Array.isArray(v) ? v[0] : v).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

/** Turn archive.org HTML descriptions into readable plain text. */
function htmlToText(html) {
  if (!html) return '';
  const s = Array.isArray(html) ? html.join('\n\n') : String(html);
  return s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { naturalCompare, sanitizeName, titleWithAuthor, parseDuration, parseRuntime, parseTrack, first, htmlToText };
