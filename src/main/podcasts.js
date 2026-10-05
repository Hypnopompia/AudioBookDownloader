'use strict';

/*
 * Podcasts. Shows are found through Podcast Index (free API; credentials from
 * secrets.js) or, without credentials, Apple's public iTunes Search API.
 * Episodes come from the same service as JSON, so no RSS/XML parsing is
 * needed. Episode audio is downloaded straight from the publisher's URL.
 *
 * Shows are turned into the same "details" shape as archive.org books, so the
 * book window, batch selection, downloads, card copying, checking and the
 * player all work unchanged. Identifiers: "pod-<feedId>" (Podcast Index) or
 * "podapple-<collectionId>" (Apple).
 */

const crypto = require('node:crypto');
const { UA, sleep, friendlyNetError } = require('./http');
const { htmlToText } = require('./util');
const secrets = require('./secrets');

const PI = 'https://api.podcastindex.org/api/1.0';
const CACHE_MS = 30 * 60 * 1000;
const MAX_EPISODES = 1000;

/** Categories for chips / shelves, with Apple Podcasts chart genre ids. */
const APPLE_GENRES = {
  Comedy: 1303, News: 1489, History: 1487, 'True Crime': 1488, Fiction: 1483, 'Society & Culture': 1324,
  Science: 1533, Education: 1304, 'Kids & Family': 1305, 'Religion & Spirituality': 1314, Sports: 1545,
  Arts: 1301, Business: 1321, 'Health & Fitness': 1512, Technology: 1318, 'TV & Film': 1309, Music: 1310,
  Leisure: 1502, Government: 1511,
};
const CATEGORIES = Object.keys(APPLE_GENRES);

// Remembers, per show, the newest episode's date and number (see toDetails).
let anchors = { get: () => null, set: () => {} };
function useAnchorStore(store) {
  anchors = store;
}

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

async function getJson(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
      if (res.status === 401) throw new Error('The podcast directory rejected the app’s API key.');
      if (!res.ok) throw new Error(`The podcast directory responded with HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (/API key/.test(err.message)) break;
      await sleep(800 * (attempt + 1));
    }
  }
  throw friendlyNetError(lastErr);
}

function pi(path, params = {}) {
  const { key, secret } = secrets.podcastIndex;
  const date = Math.floor(Date.now() / 1000).toString();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return getJson(`${PI}${path}${qs ? `?${qs}` : ''}`, {
    'X-Auth-Date': date,
    'X-Auth-Key': key,
    Authorization: crypto.createHash('sha1').update(key + secret + date).digest('hex'),
  });
}

const usingPI = () => !!secrets.podcastIndex;
const httpsOnly = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u.replace(/^http:/i, 'https:') : null);

// ------------------------------------------------------------------ shows

function showFromPI(f) {
  return {
    id: `pod-${f.id}`,
    title: String(f.title || '').trim() || 'Untitled podcast',
    author: String(f.author || f.ownerName || '').trim(),
    image: httpsOnly(f.artwork) || httpsOnly(f.image),
    episodes: f.episodeCount || null,
    newest: f.newestItemPubdate || f.newestItemPublishTime || null,
    lang: String(f.language || '').slice(0, 2).toLowerCase(),
    categories: Object.values(f.categories || {}),
  };
}

function showFromApple(r) {
  return {
    id: `podapple-${r.collectionId}`,
    title: r.collectionName || r.trackName || 'Untitled podcast',
    author: r.artistName || '',
    image: httpsOnly(r.artworkUrl600) || httpsOnly(r.artworkUrl100),
    episodes: r.trackCount || null,
    newest: r.releaseDate ? Math.floor(Date.parse(r.releaseDate) / 1000) : null,
    lang: '',
    categories: (r.genres || []).filter((g) => g !== 'Podcasts'),
  };
}

const notMusicOnly = (s) => s.title;

async function search(term, { lang = 'en' } = {}) {
  term = String(term || '').trim().slice(0, 200);
  if (!term) return [];
  return cached(`search:${usingPI()}:${lang}:${term.toLowerCase()}`, async () => {
    if (usingPI()) {
      const j = await pi('/search/byterm', { q: term, max: 60, clean: '' });
      return (j.feeds || []).map(showFromPI).filter(notMusicOnly);
    }
    const j = await getJson(`https://itunes.apple.com/search?media=podcast&limit=60&term=${encodeURIComponent(term)}`);
    return (j.results || []).filter((r) => r.feedUrl).map(showFromApple);
  });
}

/**
 * Popular shows, optionally in one category, from Apple's Top Podcasts charts
 * (free, no key, and far better curated than "recently active" lists).
 */
async function trending({ category = '', max = 40 } = {}) {
  const genre = APPLE_GENRES[category];
  return cached(`charts:${category}:${max}`, async () => {
    const url = `https://itunes.apple.com/us/rss/toppodcasts/limit=${Math.min(100, max)}${genre ? `/genre=${genre}` : ''}/json`;
    const j = await getJson(url);
    return [].concat(j.feed?.entry || []).map((e) => {
      const images = e['im:image'] || [];
      const img = images.length ? images[images.length - 1].label : null;
      return {
        id: `podapple-${e.id?.attributes?.['im:id']}`,
        title: e['im:name']?.label || 'Untitled podcast',
        author: e['im:artist']?.label || '',
        image: httpsOnly(img ? img.replace(/\/\d+x\d+(bb)?\.(png|jpg)$/, '/600x600bb.$2') : null),
        episodes: null,
        newest: null,
        lang: 'en',
        categories: [e.category?.attributes?.label].filter(Boolean),
      };
    }).filter((x) => /^podapple-\d+$/.test(x.id));
  });
}

/** Lightweight "what's the newest episode" for followed shows. */
async function latest(ids) {
  const out = {};
  for (const id of (ids || []).slice(0, 100)) {
    try {
      if (id.startsWith('pod-') && usingPI()) {
        const j = await pi('/episodes/byfeedid', { id: id.slice(4), max: 1 });
        out[id] = { newest: j.items?.[0]?.datePublished || null };
      } else if (id.startsWith('podapple-')) {
        const j = await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id.slice(9))}`);
        const r = (j.results || [])[0];
        out[id] = { newest: r?.releaseDate ? Math.floor(Date.parse(r.releaseDate) / 1000) : null, episodes: r?.trackCount || null };
      }
    } catch {
      /* skip shows that can't be checked right now */
    }
  }
  return out;
}

// ------------------------------------------------------------------ episodes

const isMp3 = (type, url) => /mpeg|mp3/i.test(type || '') || /\.mp3($|\?)/i.test(String(url || ''));

/** Rough size when a feed doesn't say (or says nonsense): 128 kbps. */
const estimateSize = (seconds) => Math.round((seconds || 1800) * 16000);

/**
 * Episode numbers must not change when new episodes come out (they identify
 * episodes on the card, on the computer and for resuming). Episodes are
 * numbered oldest-first; when the directory only returns the newest N of a
 * longer show, numbering starts from (total - N) so the newest episode is
 * always number <total>. Non-MP3 episodes are numbered too, then hidden.
 */
function toDetails(show, episodes, link, description, totalCount = 0) {
  const all = episodes.filter((e) => e.url).sort((a, b) => a.date - b.date);
  let offset = Math.max(0, (totalCount || 0) - all.length);
  // Many long-running feeds only list their newest N episodes, so the list
  // slides as new ones come out. Keep numbers stable by finding the episode
  // we numbered last time and continuing from it.
  const anchor = anchors.get(show.id);
  if (anchor) {
    const idx = all.findIndex((e) => e.date === anchor.date);
    if (idx >= 0) offset = Math.max(0, anchor.number - (idx + 1));
  }
  all.forEach((e, i) => (e.number = offset + i + 1));
  if (all.length) anchors.set(show.id, { date: all[all.length - 1].date, number: offset + all.length });
  const mp3 = all.filter((e) => isMp3(e.type, e.url));
  const tracks = mp3.map((e, i) => {
    const exact = e.size > 100 * 1024;
    return {
      number: e.number,
      name: e.url.split('?')[0].split('/').pop() || `episode-${i + 1}.mp3`,
      url: e.url,
      size: exact ? e.size : estimateSize(e.seconds),
      approxSize: true, // feeds often report sizes that don't match the real file
      md5: null,
      title: e.title || `Episode ${i + 1}`,
      seconds: e.seconds || null,
      date: e.date || null,
    };
  });
  const newest = all.length ? all[all.length - 1].date : null;
  return {
    identifier: show.id,
    kind: 'podcast',
    source: 'podcasts',
    title: show.title,
    author: show.author,
    description: htmlToText(description || ''),
    language: show.lang || '',
    date: newest ? new Date(newest * 1000).toISOString().slice(0, 10) : '',
    newest,
    runtime: tracks.reduce((a, t) => a + (t.seconds || 0), 0) || null,
    tags: show.categories || [],
    cover: show.image,
    url: httpsOnly(link) || '',
    format: 'MP3',
    quality: 'standard',
    sizes: {},
    tracks,
    hiddenEpisodes: all.length - mp3.length, // AAC/video episodes many headphones can't play
    totalBytes: tracks.reduce((a, t) => a + t.size, 0),
    trackTotal: offset + all.length,
    unit: 'episode',
    rating: null,
    reviews: 0,
  };
}

async function getDetails(identifier) {
  if (!/^pod(apple)?-\d+$/.test(identifier)) throw new Error('Invalid podcast id');
  return cached(`details:${identifier}`, async () => {
    if (identifier.startsWith('pod-')) {
      if (!usingPI()) throw new Error('This podcast needs the Podcast Index directory, which isn’t set up in this copy of the app.');
      const id = identifier.slice(4);
      const [f, e] = await Promise.all([pi('/podcasts/byfeedid', { id }), pi('/episodes/byfeedid', { id, max: MAX_EPISODES, fulltext: '' })]);
      if (!f.feed || !f.feed.id) throw new Error('This podcast could not be found.');
      const episodes = (e.items || []).map((it) => ({
        url: it.enclosureUrl,
        type: it.enclosureType,
        size: Number(it.enclosureLength) || 0,
        title: String(it.title || '').trim(),
        seconds: Number(it.duration) || null,
        date: it.datePublished || 0,
      }));
      return toDetails(showFromPI(f.feed), episodes, f.feed.link, f.feed.description, f.feed.episodeCount);
    }
    const id = identifier.slice(9);
    if (usingPI()) {
      // Podcast Index has the full episode list (Apple's lookup stops at 200)
      try {
        const f = await pi('/podcasts/byitunesid', { id });
        if (f.feed && f.feed.id) {
          const e = await pi('/episodes/byfeedid', { id: f.feed.id, max: MAX_EPISODES, fulltext: '' });
          const episodes = (e.items || []).map((it) => ({
            url: it.enclosureUrl,
            type: it.enclosureType,
            size: Number(it.enclosureLength) || 0,
            title: String(it.title || '').trim(),
            seconds: Number(it.duration) || null,
            date: it.datePublished || 0,
          }));
          if (episodes.length) return toDetails({ ...showFromPI(f.feed), id: identifier }, episodes, f.feed.link, f.feed.description, f.feed.episodeCount);
        }
      } catch {
        /* fall back to Apple */
      }
    }
    const j = await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcastEpisode&limit=200`);
    const results = j.results || [];
    const showRaw = results.find((r) => r.wrapperType === 'track' && r.kind === 'podcast') || results[0];
    if (!showRaw) throw new Error('This podcast could not be found.');
    const episodes = results
      .filter((r) => r.kind === 'podcast-episode')
      .map((r) => ({
        url: r.episodeUrl,
        type: r.episodeContentType === 'audio' ? `audio/${r.episodeFileExtension || 'mpeg'}` : r.episodeContentType,
        size: 0,
        title: r.trackName,
        seconds: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
        date: r.releaseDate ? Math.floor(Date.parse(r.releaseDate) / 1000) : 0,
      }));
    return toDetails(showFromApple(showRaw), episodes, showRaw.collectionViewUrl, episodes.length ? results.find((r) => r.kind === 'podcast-episode')?.description : '');
  });
}

module.exports = { toDetails, useAnchorStore, search, trending, latest, getDetails, categories: () => CATEGORIES, usingPI, isPodcast: (id) => /^pod(apple)?-/.test(id || '') };
