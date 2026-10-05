'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchJson } = require('./http');
const { naturalCompare, parseDuration, parseRuntime, parseTrack, first, htmlToText } = require('./util');

/**
 * Every source is an Internet Archive collection, so one search API and one
 * metadata API cover them all. Cover art comes from archive.org/services/img.
 */
const SOURCES = [
  {
    id: 'librivox',
    name: 'LibriVox',
    blurb: 'Free public-domain audiobooks read by volunteers. The biggest and most reliable collection.',
    query: 'collection:librivoxaudio AND mediatype:audio',
  },
  {
    id: 'community',
    name: 'Community Audiobooks',
    blurb: 'Uploaded by Internet Archive members. Quality varies, and some uploads may not be truly free. LibriVox is the safest choice.',
    query:
      'collection:audio_bookspoetry AND mediatype:audio AND -collection:librivoxaudio AND ' +
      '(format:"VBR MP3" OR format:"128Kbps MP3" OR format:"64Kbps MP3")',
  },
  {
    id: 'otr',
    name: 'Old Time Radio',
    blurb: 'Classic radio dramas, mysteries, westerns and comedies from the 1930s-1950s.',
    query: 'collection:oldtimeradio AND mediatype:audio',
  },
];

const FIELDS = 'identifier,title,creator,downloads,publicdate,language,runtime,subject,avg_rating,num_reviews';
const CACHE_VERSION = 3; // bump when the cached fields change

/**
 * Genres for browsing, matched against each book's subject tags (and title).
 * A book can be in several genres.
 */
const GENRES = [
  { id: 'mystery', label: 'Mystery & Crime', words: ['mystery', 'mysteries', 'detective', 'detectives', 'crime', 'murder', 'suspense', 'sherlock', 'thriller'] },
  { id: 'adventure', label: 'Adventure', words: ['adventure', 'adventures', 'pirates', 'pirate', 'exploration', 'sea stories', 'survival'] },
  { id: 'scifi', label: 'Science Fiction', words: ['science fiction', 'sci-fi', 'scifi', 'sf', 'space', 'time travel', 'dystopia', 'utopia'] },
  { id: 'fantasy', label: 'Fantasy & Fairy Tales', words: ['fantasy', 'fairy tales', 'fairy tale', 'fairytales', 'fables', 'fable', 'myths', 'mythology', 'legends', 'folklore', 'folk tales'] },
  { id: 'horror', label: 'Horror & Ghost Stories', words: ['horror', 'ghost', 'ghosts', 'ghost stories', 'uncanny', 'supernatural', 'gothic', 'vampire', 'vampires', 'weird'] },
  { id: 'romance', label: 'Romance', words: ['romance', 'love story', 'love stories'] },
  { id: 'humor', label: 'Humor', words: ['humor', 'humour', 'comedy', 'satire', 'funny', 'humorous', 'parody'] },
  { id: 'children', label: 'Children & Young Adult', words: ['children', "children's", 'childrens', 'kids', 'juvenile', 'young adult', 'teen', 'teens', 'youth', 'nursery rhymes'] },
  { id: 'western', label: 'Westerns', words: ['western', 'westerns', 'cowboy', 'cowboys', 'frontier'] },
  { id: 'historical', label: 'History & Historical Fiction', words: ['history', 'historical', 'historical fiction', 'war', 'civil war', 'wwi', 'world war i', 'world war ii', 'ancient', 'medieval'] },
  { id: 'biography', label: 'Biography & Memoir', words: ['biography', 'autobiography', 'memoir', 'memoirs', 'letters', 'diary', 'diaries'] },
  { id: 'short', label: 'Short Stories', words: ['short stories', 'short story', 'anthology', 'collection'] },
  { id: 'poetry', label: 'Poetry', words: ['poetry', 'poem', 'poems', 'verse', 'ballads', 'sonnets'] },
  { id: 'drama', label: 'Plays & Drama', words: ['drama', 'play', 'plays', 'tragedy', 'shakespeare', 'dramatic reading', 'radio drama', 'theatre', 'theater'] },
  { id: 'religion', label: 'Religion & Spirituality', words: ['religion', 'religious', 'bible', 'christianity', 'christian', 'theology', 'sermons', 'sermon', 'faith', 'catholic', 'new testament', 'old testament', 'jesus', 'spirituality', 'buddhism', 'islam', 'judaism', 'prayer'] },
  { id: 'philosophy', label: 'Philosophy & Ideas', words: ['philosophy', 'psychology', 'essays', 'essay', 'morality', 'ethics', 'politics', 'economics'] },
  { id: 'nature', label: 'Nature & Science', ignore: /science[- ]fiction/g, words: ['nature', 'animals', 'birds', 'science', 'plants', 'insects', 'natural history', 'astronomy', 'biology', 'dogs', 'horses'] },
  { id: 'travel', label: 'Travel', words: ['travel', 'travels', 'journey', 'voyage', 'voyages', 'travelogue'] },
];
const GENRE_RES = GENRES.map((g) => ({
  id: g.id,
  ignore: g.ignore || null,
  re: new RegExp(`(^|[^a-z])(${g.words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|[^a-z])`),
}));

function genresFor(subjects, title) {
  const text = subjects.map((s) => s.toLowerCase()).join(' | ');
  const out = GENRE_RES.filter((g) => g.re.test(g.ignore ? text.replace(g.ignore, '') : text)).map((g) => g.id);
  // a few strong title hints when tags are missing
  if (!out.length && /\b(poems|poetry|verses)\b/i.test(title)) out.push('poetry');
  if (!out.length && /\b(stories|tales)\b/i.test(title)) out.push('short');
  return out;
}
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const GENERIC_TAGS = new Set([
  'librivox', 'audiobook', 'audiobooks', 'audio book', 'audio books', 'literature', 'audio',
  'old time radio', 'otr', 'radio', 'mp3',
]);

let cacheDir = null;
function init(dir) {
  cacheDir = dir;
  // remove caches written by older versions (they lack ratings and genres)
  fs.readdir(dir)
    .then((names) => names.filter((n) => /^catalog-/.test(n) && !n.startsWith(`catalog-v${CACHE_VERSION}-`)))
    .then((old) => Promise.all(old.map((n) => fs.rm(path.join(dir, n), { force: true }))))
    .catch(() => {});
}

function getSource(id) {
  const src = SOURCES.find((s) => s.id === id);
  if (!src) throw new Error(`Unknown source: ${id}`);
  return src;
}

function cachePath(id) {
  return path.join(cacheDir, `catalog-v${CACHE_VERSION}-${id}.json`);
}

function compact(it) {
  const creators = Array.isArray(it.creator) ? it.creator : it.creator ? [it.creator] : [];
  let subjects = Array.isArray(it.subject) ? it.subject : it.subject ? String(it.subject).split(';') : [];
  subjects = subjects.map((s) => String(s).trim()).filter(Boolean);
  const title = String(first(it.title) || it.identifier).trim();
  const genres = genresFor(subjects, title);
  subjects = subjects.filter((s) => s.length < 40 && !GENERIC_TAGS.has(s.toLowerCase()));
  const reviews = Number(it.num_reviews) || 0;
  return {
    id: it.identifier,
    title,
    author: creators.slice(0, 3).join(', '),
    downloads: Number(it.downloads) || 0,
    year: it.publicdate ? String(first(it.publicdate)).slice(0, 4) : '',
    added: it.publicdate ? String(first(it.publicdate)).slice(0, 10) : '',
    rating: reviews && Number(it.avg_rating) ? Math.round(Number(it.avg_rating) * 10) / 10 : null,
    reviews,
    genres,
    lang: String(first(it.language) || '').trim(),
    runtime: parseRuntime(it.runtime),
    tags: [...new Set(subjects)].slice(0, 8).join(', '),
  };
}

async function fetchAll(src, onProgress) {
  const byId = new Map();
  let cursor = null;
  let total = 0;
  do {
    const u = new URL('https://archive.org/services/search/v1/scrape');
    u.searchParams.set('q', src.query);
    u.searchParams.set('fields', FIELDS);
    u.searchParams.set('count', '10000');
    if (cursor) u.searchParams.set('cursor', cursor);
    const data = await fetchJson(u.toString(), { timeout: 120000 });
    if (!total) total = data.total || 0; // later pages report only the remainder
    for (const it of data.items || []) if (it.identifier) byId.set(it.identifier, compact(it));
    onProgress?.({ sourceId: src.id, loaded: byId.size, total });
    cursor = data.cursor || null;
  } while (cursor);
  return [...byId.values()];
}

async function readCache(id) {
  try {
    const raw = await fs.readFile(cachePath(id), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.items)) return data;
  } catch {
    /* no cache yet */
  }
  return null;
}

const inFlight = new Map();

/** Download the full listing for a source and save it to the cache. */
function refresh(id, onProgress) {
  if (inFlight.has(id)) return inFlight.get(id);
  const p = (async () => {
    const items = await fetchAll(getSource(id), onProgress);
    const data = { fetchedAt: Date.now(), items };
    await fs.mkdir(cacheDir, { recursive: true });
    const tmp = cachePath(id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, cachePath(id));
    return data;
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

/**
 * Returns the cached listing immediately when there is one (flagging it as
 * stale after a week so the caller can refresh in the background), otherwise
 * fetches it.
 */
async function load(id, { force = false, onProgress } = {}) {
  getSource(id);
  if (!force) {
    const cached = await readCache(id);
    if (cached) return { ...cached, stale: Date.now() - cached.fetchedAt > MAX_AGE_MS };
  }
  const data = await refresh(id, onProgress);
  return { ...data, stale: false };
}

// ---------------------------------------------------------------------------
// Book details (chapter list, sizes, description)
// ---------------------------------------------------------------------------

const FORMAT_PREFS = {
  standard: ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', 'MP3'],
  high: ['VBR MP3', '128Kbps MP3', 'MP3', '64Kbps MP3'],
};

/**
 * Archive items usually hold the same chapters in several MP3 encodings.
 * Pick one complete set, preferring the requested quality, but never pick a
 * set that is missing chapters other sets have.
 */
function chooseFormat(groups, quality) {
  const prefs = FORMAT_PREFS[quality] || FORMAT_PREFS.standard;
  const names = [...groups.keys()].sort((a, b) => {
    const ia = prefs.indexOf(a), ib = prefs.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const maxCount = Math.max(0, ...[...groups.values()].map((g) => g.length));
  return names.find((n) => groups.get(n).length >= maxCount) || names[0];
}

function buildTracks(files, quality) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const groups = new Map();
  for (const f of files) {
    if (!/\.mp3$/i.test(f.name || '') || f.private === 'true') continue;
    const fmt = f.format || 'MP3';
    if (!groups.has(fmt)) groups.set(fmt, []);
    groups.get(fmt).push(f);
  }
  if (!groups.size) return { format: null, tracks: [] };
  const format = chooseFormat(groups, quality);
  let tracks = groups.get(format).map((f) => {
    const orig = f.original ? byName.get(f.original) : null;
    const base = f.name.split('/').pop().replace(/\.mp3$/i, '').replace(/_64kb$/i, '');
    return {
      name: f.name,
      size: Number(f.size) || 0,
      md5: typeof f.md5 === 'string' ? f.md5 : null, // archive.org checksum, used to verify copies
      title: String(first(f.title) || first(orig?.title) || base).trim(),
      seconds: parseDuration(f.length ?? orig?.length),
      trackNo: parseTrack(f.track ?? orig?.track),
    };
  });
  const nums = tracks.map((t) => t.trackNo);
  const useTrackNo = nums.every((n) => n != null) && new Set(nums).size === nums.length;
  tracks.sort((a, b) => (useTrackNo ? a.trackNo - b.trackNo : naturalCompare(a.name, b.name)));
  // stable 1-based position in the full list; used to pick batches and name files
  tracks.forEach((t, i) => (t.number = i + 1));
  return { format, tracks };
}

const detailCache = new Map();

function averageRating(reviews) {
  const stars = reviews.map((r) => Number(r.stars)).filter((n) => n >= 1 && n <= 5);
  return stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : null;
}

async function getDetails(identifier, quality = 'standard') {
  if (typeof identifier !== 'string' || !/^[\w.-]+$/.test(identifier)) throw new Error('Invalid book id');
  let meta = detailCache.get(identifier);
  if (!meta) {
    meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (!meta || !meta.metadata) throw new Error('This book could not be found on archive.org.');
    detailCache.set(identifier, meta);
    if (detailCache.size > 150) detailCache.delete(detailCache.keys().next().value);
  }
  const m = meta.metadata;
  const files = meta.files || [];
  const { format, tracks } = buildTracks(files, quality);
  const sizes = {};
  for (const q of Object.keys(FORMAT_PREFS)) {
    sizes[q] = buildTracks(files, q).tracks.reduce((a, t) => a + t.size, 0);
  }
  const creators = Array.isArray(m.creator) ? m.creator : m.creator ? [m.creator] : [];
  const subjects = (Array.isArray(m.subject) ? m.subject : String(m.subject || '').split(';'))
    .map((s) => String(s).trim())
    .filter((s) => s && !GENERIC_TAGS.has(s.toLowerCase()));
  const trackSeconds = tracks.reduce((a, t) => a + (t.seconds || 0), 0);
  return {
    identifier,
    title: String(first(m.title) || identifier).trim(),
    author: creators.join(', '),
    description: htmlToText(m.description),
    language: String(first(m.language) || ''),
    date: String(first(m.date) || first(m.publicdate) || '').slice(0, 10),
    runtime: Math.max(parseRuntime(m.runtime) || 0, trackSeconds) || null, // some listed runtimes are wrong
    tags: [...new Set(subjects)].slice(0, 12),
    rating: Number(meta.reviews?.length) ? averageRating(meta.reviews) : null,
    reviews: Array.isArray(meta.reviews) ? meta.reviews.length : 0,
    cover: `https://archive.org/services/img/${identifier}`,
    url: `https://archive.org/details/${identifier}`,
    format,
    quality,
    sizes,
    tracks,
    totalBytes: tracks.reduce((a, t) => a + t.size, 0),
    trackTotal: tracks.length,
    // radio shows are collections of episodes rather than chapters of one story
    unit: [].concat(m.collection || []).some((c) => /oldtimeradio|radioprograms|otrr/i.test(c)) ? 'episode' : 'chapter',
  };
}

module.exports = {
  init,
  load,
  refresh,
  getDetails,
  buildTracks,
  sources: () => SOURCES.map(({ id, name, blurb }) => ({ id, name, blurb })),
  genres: () => GENRES.map(({ id, label }) => ({ id, label })),
  genresFor,
};
