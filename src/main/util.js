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

// ---------------------------------------------------------------- tidying titles from archive.org

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "LILY OF LAGUNA" -> "Lily of Laguna". Text that isn't all capitals is returned unchanged. */
function fixAllCaps(text) {
  const s = String(text ?? '');
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return s;
  let first = true;
  return s.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (word) => {
    const keepSmall = !first && SMALL_WORDS.has(word);
    first = false;
    if (keepSmall) return word;
    // roman numerals and initials stay in capitals: "Part II", "W.C. Handy"
    if (/^(?=[ivxlc]+$)(c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(word) && word.length > 1) return word.toUpperCase();
    return word[0].toUpperCase() + word.slice(1);
  }).replace(/([:—–-]\s+|\(\s*)([a-z])/g, (m, pre, c) => pre + c.toUpperCase()); // capital after a colon or dash too
}

const LEADING_NUMBER = /^\s*\d{1,3}\s*(?:[-–—.:)_]\s*|\s+-\s+)/;

/**
 * Tidy the titles of an item's tracks, which are often file names:
 * - "wonderland_ch_01" -> "Chapter 1", other underscores become spaces
 * - "01 - A Scandal in Bohemia" -> "A Scandal in Bohemia" (the list shows the number already),
 *   only when most tracks start that way, so a title like "1984" is left alone
 * - "MY MAN O' WAR - BETTY THORNTON - Frank Signorelli" -> "My Man O' War" when the
 *   trailing names are the item's own performers
 * - all-capital titles get normal capitals
 */
function tidyTrackTitles(titles, creators = []) {
  const names = new Set(creators.map((c) => String(c).trim().toLowerCase()).filter(Boolean));
  let out = titles.map((t) => {
    let s = String(t ?? '').trim();
    if (/_/.test(s) && !/\s/.test(s.replace(/_/g, ''))) s = s.replace(/_+/g, ' ').trim(); // a file name, not a title
    const chapter = /^(?:.*\s)?(?:ch|chap|chapter)\s*0*(\d+)$/i.exec(s);
    if (chapter && /^[\w\s-]+$/.test(s)) s = `Chapter ${chapter[1]}`;
    return s;
  });
  const numbered = out.filter((t) => LEADING_NUMBER.test(t)).length;
  if (out.length > 1 && numbered / out.length >= 0.8) out = out.map((t) => t.replace(LEADING_NUMBER, '').trim() || t);
  if (names.size) {
    out = out.map((t) => {
      const parts = t.split(/\s+-\s+/);
      while (parts.length > 1 && names.has(parts[parts.length - 1].trim().toLowerCase())) parts.pop();
      return parts.join(' - ');
    });
  }
  return out.map(fixAllCaps);
}

/**
 * What kind of live recording a concert is, from its identifier and source note:
 * "Soundboard", "Audience", "Soundboard and audience mix" or "Broadcast" (or '' when unknown).
 */
function recordingKind(identifier, source) {
  const id = String(identifier || '').toLowerCase();
  const src = String(Array.isArray(source) ? source[0] : source || '').toLowerCase();
  const has = (re) => re.test(id) || re.test(src);
  if (has(/\b(mtx|matrix)\b|[._-](mtx|matrix)[._-]/)) return 'Soundboard and audience mix';
  if (has(/\b(sbd|soundboard)\b|[._-]sbd[._-]?/)) return 'Soundboard';
  if (has(/\b(fm|broadcast|webcast|radio|tv)\b|[._-](fm|bcast|webcast)[._-]/)) return 'Broadcast';
  if (has(/\b(aud|audience)\b|[._-]aud[._-]|\b(schoeps|neumann|akg|dpa|nak(amichi)?|senn(heiser)?|shure|ecm|beyer(dynamic)?|core\s?sound|mk4|km\d+|cmc\d)\b/)) return 'Audience';
  return '';
}

module.exports = { naturalCompare, sanitizeName, titleWithAuthor, parseDuration, parseRuntime, parseTrack, first, htmlToText, fixAllCaps, tidyTrackTitles, recordingKind };
