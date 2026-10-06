'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { fetchJson, UA } = require('./http');
const { naturalCompare, parseDuration, parseRuntime, parseTrack, first, htmlToText } = require('./util');

/**
 * Every source is an Internet Archive collection, so one search API and one
 * metadata API cover them all. Cover art comes from archive.org/services/img.
 */
const SOURCES = [
  {
    id: 'librivox',
    name: 'Audiobooks',
    blurb: 'Classic public-domain books read aloud by LibriVox volunteers.',
    query: 'collection:librivoxaudio AND mediatype:audio',
  },
  {
    id: 'community',
    name: 'More Audiobooks',
    blurb: 'More books, stories and poems read aloud and shared by listeners. Recording quality varies.',
    query:
      'collection:audio_bookspoetry AND mediatype:audio AND -collection:librivoxaudio AND ' +
      '(format:"VBR MP3" OR format:"128Kbps MP3" OR format:"64Kbps MP3")',
  },
  {
    id: 'otr',
    name: 'Old Time Radio',
    blurb: 'Radio dramas, mysteries, westerns and comedies from the 1930s–50s.',
    query: 'collection:oldtimeradio AND mediatype:audio',
  },
  {
    id: 'live',
    name: 'Live Music Archive',
    blurb: 'Concert recordings from bands that allow taping and sharing, from the Grateful Dead to today.',
    // "stream_only" shows can be played on archive.org but not downloaded
    query: 'mediatype:etree AND -collection:stream_only',
    genres: 'artists',
    unit: 'track',
  },
  {
    id: 'lectures',
    name: 'Lectures & Speeches',
    blurb: 'Famous speeches, college lectures and talks uploaded to the Internet Archive.',
    // Tags like "speech" also catch free-speech radio and text-to-speech uploads, so match
    // whole tags and leave those out.
    query:
      'mediatype:audio AND (subject:"speeches" OR subject:"lectures" OR subject:"lecture" OR subject:"talks" OR ' +
      'subject:"oratory" OR subject:"great speeches and interviews" OR collection:longnow OR ' +
      'collection:middleburydigitallectures OR collection:ucberkeleylectures) AND -subject:"free speech" AND ' +
      '-subject:"freedom of speech" AND -subject:"text to speech" AND -subject:"radio program" AND ' +
      '-collection:audio_religion AND -collection:audio_islamic AND -collection:audio_sermons AND ' +
      '-collection:audio_bookspoetry AND -collection:librivoxaudio AND -collection:oldtimeradio AND ' +
      '(format:"VBR MP3" OR format:"128Kbps MP3" OR format:"64Kbps MP3")',
    genres: 'talks',
    unit: 'part',
  },
  {
    id: '78s',
    name: 'Vintage Music',
    blurb: 'Songs from the 1900s–1950s, saved from old 78 rpm records by the Great 78 Project.',
    query: 'collection:georgeblood AND mediatype:audio',
    genres: 'music',
    unit: 'track',
  },
];

const FIELDS = 'identifier,title,creator,downloads,publicdate,language,runtime,subject,avg_rating,num_reviews';
const CACHE_VERSION = 3; // bump when the cached fields change

/**
 * Genres for browsing, matched against each book's subject tags (and title).
 * A book can be in several genres.
 */
const BOOK_GENRES = [
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

/** Genres for 78 rpm records, matched against the Great 78 Project's subject tags. */
const MUSIC_GENRES = [
  { id: 'popular', label: 'Popular Songs', words: ['popular music', 'popular', 'pop', 'vocal', 'broadway', 'musical', 'film', 'rock and roll'] },
  { id: 'jazz', label: 'Jazz & Swing', words: ['jazz', 'swing', 'be-bop', 'bebop', 'dixieland', 'big band', 'boogie woogie', 'ragtime'] },
  { id: 'blues', label: 'Blues & R&B', words: ['blues', 'rhythm & blues', 'r&b'] },
  { id: 'country', label: 'Country & Hillbilly', words: ['country', 'hillbilly', 'cowboy', 'western', 'bluegrass'] },
  { id: 'folk', label: 'Folk & World', words: ['folk', 'ethnic', 'polka', 'hawaiian', 'calypso', 'jewish', 'national'] },
  { id: 'latin', label: 'Latin', words: ['latin', 'tango', 'bolero', 'rumba', 'mambo', 'samba'] },
  { id: 'dance', label: 'Dance Bands', words: ['dance', 'waltz', 'fox-trot', 'fox trot', 'foxtrot', 'square dance', 'schottische', 'march', 'military'] },
  { id: 'classical', label: 'Classical & Opera', words: ['classical', 'orchestral', 'opera', 'choral', 'symphony'] },
  { id: 'sacred', label: 'Gospel & Sacred', words: ['sacred', 'gospel', 'religious', 'hymn', 'spiritual'] },
  { id: 'christmas', label: 'Christmas', words: ['christmas'] },
  { id: 'comedy', label: 'Comedy & Novelty', words: ['comedy', 'novelty', 'humor'] },
  { id: 'children', label: 'Children', words: ['children', "children's"] },
  { id: 'spoken', label: 'Spoken Word', words: ['spoken word', 'story', 'radio', 'educational', 'sound effects'] },
];

/** Topics for lectures and speeches. */
const TALK_GENRES = [
  { id: 'speeches', label: 'Famous Speeches', words: ['speech', 'speeches', 'oratory', 'address', 'inaugural', 'great speeches and interviews'] },
  { id: 'history', label: 'History', words: ['history', 'historical', 'war', 'world war ii', 'civil war', 'vietnam war', 'ancient', 'medieval'] },
  { id: 'politics', label: 'Politics & Society', words: ['politics', 'political', 'government', 'law', 'election', 'president', 'civil rights', 'human rights', 'activism', 'economics', 'capitalism'] },
  { id: 'science', label: 'Science & Nature', words: ['science', 'physics', 'biology', 'astronomy', 'chemistry', 'mathematics', 'math', 'medicine', 'health', 'nature', 'evolution', 'environment'] },
  { id: 'philosophy', label: 'Philosophy & Psychology', words: ['philosophy', 'ethics', 'existentialism', 'psychology', 'mind', 'consciousness'] },
  { id: 'religion', label: 'Religion & Spirituality', words: ['religion', 'religious', 'islam', 'islamic', 'buddhism', 'buddhist', 'dharma', 'dhamma', 'christian', 'christianity', 'bible', 'theology', 'spirituality', 'meditation', 'mindfulness', 'sermon', 'church', 'quran', 'tafsir'] },
  { id: 'arts', label: 'Literature & Arts', words: ['literature', 'writing', 'writers', 'poetry', 'art', 'arts', 'music', 'film', 'books', 'architecture'] },
  { id: 'business', label: 'Business & Self-Help', words: ['business', 'motivational', 'motivation', 'self-help', 'inspirational', 'leadership', 'success', 'career'] },
  { id: 'technology', label: 'Technology', words: ['technology', 'computer', 'computers', 'computing', 'internet', 'software', 'programming'] },
  { id: 'comedy', label: 'Comedy', words: ['comedy', 'humor', 'humour', 'satire', 'stand-up'] },
];

const compileGenres = (list) =>
  list.map((g) => ({
    id: g.id,
    ignore: g.ignore || null,
    re: new RegExp(`(^|[^a-z])(${g.words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|[^a-z])`),
  }));
const GENRE_LISTS = { books: BOOK_GENRES, music: MUSIC_GENRES, talks: TALK_GENRES };
const GENRE_RES = Object.fromEntries(Object.entries(GENRE_LISTS).map(([k, list]) => [k, compileGenres(list)]));

function genresFor(subjects, title, kind = 'books') {
  const text = subjects.map((s) => s.toLowerCase()).join(' | ');
  const out = GENRE_RES[kind].filter((g) => g.re.test(g.ignore ? text.replace(g.ignore, '') : text)).map((g) => g.id);
  if (kind !== 'books') return out;
  // a few strong title hints when tags are missing
  if (!out.length && /\b(poems|poetry|verses)\b/i.test(title)) out.push('poetry');
  if (!out.length && /\b(stories|tales)\b/i.test(title)) out.push('short');
  return out;
}

/** Live music is browsed by band: each show's "genre" is its band. */
const artistKey = (name) => 'a:' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ARTIST_SHELVES = 24;

/** The genre chips and shelves for a source; for live music, its most played bands. */
function genreList(src, items) {
  if (src.genres !== 'artists') return GENRE_LISTS[src.genres || 'books'].map(({ id, label }) => ({ id, label }));
  const bands = new Map();
  for (const it of items) {
    const name = it.artist;
    if (!name) continue;
    const b = bands.get(name) || { id: artistKey(name), label: name, downloads: 0, shows: 0 };
    b.downloads += it.downloads;
    b.shows += 1;
    bands.set(name, b);
  }
  return [...bands.values()]
    .filter((b) => b.shows >= 4)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, ARTIST_SHELVES)
    .map(({ id, label }) => ({ id, label }));
}
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const GENERIC_TAGS = new Set([
  'librivox', 'audiobook', 'audiobooks', 'audio book', 'audio books', 'literature', 'audio',
  'old time radio', 'otr', 'radio', 'mp3', '78rpm', 'live concert',
]);

let cacheDir = null;
let listSource = () => 'github'; // or 'archive': always read archive.org directly (Settings)

function init(dir, { getListSource } = {}) {
  cacheDir = dir;
  if (getListSource) listSource = getListSource;
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

function compact(it, src) {
  const creators = Array.isArray(it.creator) ? it.creator : it.creator ? [it.creator] : [];
  let subjects = Array.isArray(it.subject) ? it.subject : it.subject ? String(it.subject).split(';') : [];
  subjects = subjects.map((s) => String(s).trim()).filter(Boolean);
  const title = String(first(it.title) || it.identifier).trim();
  const genres =
    src.genres === 'artists' ? (creators[0] ? [artistKey(String(creators[0]).trim())] : []) : genresFor(subjects, title, src.genres || 'books');
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
    ...(src.genres === 'artists' ? { artist: String(creators[0] || '').trim() } : {}),
  };
}

/**
 * archive.org only lets a listing be read page by page in order, at a few
 * seconds a page, so a big list (live music has ~290,000 shows) is split by
 * upload date and the parts are read side by side. Edges of the ranges may
 * overlap; items are de-duplicated by id.
 */
const DATE_PARTS = [
  'publicdate:[* TO 2006-01-01]',
  'publicdate:[2006-01-01 TO 2010-01-01]',
  'publicdate:[2010-01-01 TO 2014-01-01]',
  'publicdate:[2014-01-01 TO 2018-01-01]',
  'publicdate:[2018-01-01 TO 2022-01-01]',
  'publicdate:[2022-01-01 TO *]',
  '-publicdate:[* TO *]',
];
const PARALLEL = 4;

function scrapeUrl(q, cursor) {
  const u = new URL('https://archive.org/services/search/v1/scrape');
  u.searchParams.set('q', q);
  u.searchParams.set('fields', FIELDS);
  u.searchParams.set('count', '2000'); // big pages are much slower per item
  if (cursor) u.searchParams.set('cursor', cursor);
  return u.toString();
}

async function fetchAll(src, onProgress) {
  const byId = new Map();
  // the whole list's size, for the progress bar (the scrape API's own total is wrong for small pages)
  const count = new URL('https://archive.org/advancedsearch.php');
  count.searchParams.set('q', src.query);
  count.searchParams.set('rows', '0');
  count.searchParams.set('output', 'json');
  const total = (await fetchJson(count.toString(), { timeout: 120000 })).response?.numFound || 0;
  onProgress?.({ sourceId: src.id, loaded: 0, total });
  const readPart = async (part) => {
    let cursor = null;
    do {
      const data = await fetchJson(scrapeUrl(`(${src.query}) AND ${part}`, cursor), { timeout: 120000 });
      for (const it of data.items || []) if (it.identifier) byId.set(it.identifier, compact(it, src));
      onProgress?.({ sourceId: src.id, loaded: Math.min(byId.size, total), total });
      cursor = data.cursor || null;
    } while (cursor);
  };
  const queue = [...DATE_PARTS];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) await readPart(queue.shift());
  }));
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

// ---------------------------------------------------------------------------
// Prebuilt lists. A weekly GitHub Actions job (scripts/build-catalog.js)
// publishes every source's list, gzipped, to the "catalog" release, so the
// app downloads one file in seconds instead of reading archive.org for
// minutes. The manifest says when each list was made and how to check it.
// ---------------------------------------------------------------------------

// LISTENSYNC_CATALOG_URL points the app (and the build script) somewhere else, for testing.
const prebuiltBase = () => process.env.LISTENSYNC_CATALOG_URL || 'https://github.com/Hypnopompia/ListenSync/releases/download/catalog';
const PREBUILT_MAX_AGE_MS = 10 * 24 * 3600 * 1000; // older than this, the weekly job has stopped: use archive.org
const prebuiltFile = (id) => `catalog-v${CACHE_VERSION}-${id}.json.gz`;
const manifestFile = () => `catalog-v${CACHE_VERSION}.json`;
const gunzip = promisify(zlib.gunzip);

async function fetchManifest() {
  try {
    const res = await fetch(`${prebuiltBase()}/${manifestFile()}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The prebuilt list for a source when it's newer than `since`; 'unchanged' when
 * it isn't; null when there's no usable prebuilt list (then read archive.org).
 */
async function fetchPrebuilt(src, since, onProgress) {
  const entry = (await fetchManifest())?.sources?.[src.id];
  if (!entry || !entry.fetchedAt || Date.now() - entry.fetchedAt > PREBUILT_MAX_AGE_MS) return null;
  if (since && entry.fetchedAt <= since) return 'unchanged';
  try {
    const res = await fetch(`${prebuiltBase()}/${prebuiltFile(src.id)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
    if (!res.ok || !res.body) return null;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      chunks.push(chunk);
      bytes += chunk.length;
      // progress in items, estimated from the bytes so far
      if (entry.bytes) onProgress?.({ sourceId: src.id, loaded: Math.round(entry.count * Math.min(1, bytes / entry.bytes)), total: entry.count });
    }
    const gz = Buffer.concat(chunks);
    if (entry.sha256 && crypto.createHash('sha256').update(gz).digest('hex') !== entry.sha256) return null;
    const data = JSON.parse(await gunzip(gz));
    if (!Array.isArray(data.items) || !data.fetchedAt) return null;
    return data;
  } catch (err) {
    console.error(`Prebuilt ${src.id} list could not be used`, err);
    return null;
  }
}

const inFlight = new Map();

/**
 * Get the newest full listing for a source and save it to the cache: the
 * prebuilt list when there's a usable one, otherwise straight from archive.org.
 */
function refresh(id, onProgress) {
  if (inFlight.has(id)) return inFlight.get(id);
  const p = (async () => {
    const src = getSource(id);
    const cached = await readCache(id);
    const prebuilt = listSource() === 'archive' ? null : await fetchPrebuilt(src, cached?.fetchedAt, onProgress);
    if (prebuilt === 'unchanged') return cached;
    const data = prebuilt || { fetchedAt: Date.now(), items: await fetchAll(src, onProgress) };
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
  const src = getSource(id);
  if (!force) {
    const cached = await readCache(id);
    if (cached) return { ...cached, genres: genreList(src, cached.items), stale: Date.now() - cached.fetchedAt > MAX_AGE_MS };
  }
  const data = await refresh(id, onProgress);
  return { ...data, genres: genreList(src, data.items), stale: false };
}

/**
 * Download every source's list that is missing or over a week old, one at a
 * time, so switching sources later doesn't mean waiting. A source someone opens
 * meanwhile is fetched right away (refresh() shares an in-flight download).
 */
async function prefetch({ onProgress, onDone } = {}) {
  for (const src of SOURCES) {
    try {
      const cached = await readCache(src.id);
      if (cached && Date.now() - cached.fetchedAt <= MAX_AGE_MS) continue;
      const data = await refresh(src.id, onProgress);
      onDone?.(src.id, data);
    } catch (err) {
      console.error(`Background download of the ${src.id} list failed`, err);
    }
  }
}

const cacheFiles = async () => (await fs.readdir(cacheDir).catch(() => [])).filter((n) => /^catalog-.*\.json$/.test(n));

/** The source lists saved on this computer, for Settings. */
async function cacheInfo() {
  const lists = [];
  for (const name of await cacheFiles()) {
    const st = await fs.stat(path.join(cacheDir, name)).catch(() => null);
    if (st) lists.push({ bytes: st.size, savedAt: st.mtimeMs });
  }
  return { count: lists.length, bytes: lists.reduce((a, l) => a + l.bytes, 0), newest: Math.max(0, ...lists.map((l) => l.savedAt)) || null };
}

/** Delete the saved lists, so each source's list is downloaded again. */
async function clearCache() {
  await Promise.all((await cacheFiles()).map((n) => fs.rm(path.join(cacheDir, n), { force: true })));
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
  // Some items hold two copies of each recording in one format (an older, smaller
  // "x.mp3" and a newer "x_vbr.mp3" made from the same original). Keep one per
  // original: the bigger (better) copy, with the title from whichever copy has one.
  for (const [fmt, list] of groups) {
    const byOriginal = new Map();
    for (const f of list) {
      const key = f.original || f.name;
      byOriginal.set(key, [...(byOriginal.get(key) || []), f]);
    }
    groups.set(fmt, [...byOriginal.values()].map((copies) => {
      const best = copies.reduce((a, b) => ((Number(b.size) || 0) > (Number(a.size) || 0) ? b : a));
      const title = best.title ?? copies.find((c) => c.title)?.title;
      return title === undefined ? best : { ...best, title };
    }));
  }
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

/** Which of the app's sources an archive.org item belongs to. */
function sourceFromItem(m) {
  const c = [].concat(m.collection || []).map((x) => String(x).toLowerCase());
  if (c.includes('librivoxaudio')) return 'librivox';
  if (c.some((x) => /oldtimeradio|radioprograms|otrr/.test(x))) return 'otr';
  if (c.includes('etree') || m.mediatype === 'etree') return 'live';
  if (c.includes('georgeblood')) return '78s';
  if (c.includes('audio_bookspoetry')) return 'community';
  const subjects = [].concat(m.subject || []).join(';');
  if (/\b(lectures?|speech(es)?|talks|oratory)\b/i.test(subjects) || c.some((x) => /^(longnow|middleburydigitallectures|ucberkeleylectures)$/.test(x))) return 'lectures';
  return 'community';
}

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
  const source = sourceFromItem(m);
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
    // radio shows are collections of episodes rather than chapters of one story; music has tracks
    unit: source === 'otr' ? 'episode' : SOURCES.find((s) => s.id === source)?.unit || 'chapter',
    source,
  };
}

module.exports = {
  init,
  load,
  refresh,
  prefetch,
  cacheInfo,
  clearCache,
  // for scripts/build-catalog.js
  fetchList: (id, onProgress) => fetchAll(getSource(id), onProgress),
  prebuiltBase,
  prebuiltFile,
  manifestFile,
  getDetails,
  buildTracks,
  sources: () => SOURCES.map(({ id, name, blurb, unit, genres }) => ({ id, name, blurb, unit: unit || 'chapter', music: genres === 'music' || genres === 'artists' })),
  genresFor,
  genreList,
};
