'use strict';

/* global api, state, el, $, bookCard, onCardIds, queuedIds, rememberCover, refreshBadges, showError, fmtAgo */

// =========================================================================
// Podcasts source: trending shows by category, live search, and a
// "New episodes" check for followed (starred) shows.
// =========================================================================

const pod = { info: null, category: '', req: 0 };
const POD_HOME_CATEGORIES = 12;
const POD_CHECK_EVERY_MS = 6 * 3600 * 1000;

async function initPodcasts() {
  try {
    pod.info = await api.podcasts.info();
  } catch {
    pod.info = { directory: 'Apple Podcasts', categories: [] };
  }
  state.podNew = new Set();
  state.sources.push({
    id: 'podcasts',
    name: 'Podcasts',
    blurb: 'Browse the top charts or search for any show.',
  });
  checkFollowedPodcasts();
  setInterval(checkFollowedPodcasts, POD_CHECK_EVERY_MS);
}

/** Mark followed podcasts that have episodes newer than the user last saw. */
async function checkFollowedPodcasts() {
  const followed = Object.entries(state.lib).filter(([key, e]) => e.starred && /^pod(apple)?-/.test(key));
  if (!followed.length) return;
  try {
    const latest = await api.podcasts.latest(followed.map(([key]) => key));
    for (const [key, e] of followed) {
      const newest = latest[key]?.newest;
      if (newest && newest > (e.seenUpTo || 0)) state.podNew.add(key);
    }
    refreshBadges();
  } catch {
    /* offline: try again later */
  }
}

function podcastItem(s) {
  rememberCover(s.id, s.image);
  return {
    id: s.id,
    title: s.title,
    author: s.author,
    runtime: null,
    lk: '',
    rating: null,
    metaText: s.episodes ? `${s.episodes.toLocaleString()} episodes` : s.categories?.[0] || 'Podcast',
  };
}

/** Apply the Show filter (starred / not interested …) to podcast results. */
function showFilter(list) {
  return list.filter((s) => {
    const e = state.lib[s.id];
    if (state.show === 'starred') return !!e?.starred;
    if (state.show === 'read') return e?.status === 'read';
    if (state.show === 'hidden') return e?.status === 'not_interested';
    if (state.show === 'unread') return !e?.status;
    return e?.status !== 'not_interested';
  });
}

function podcastChips() {
  const chip = (id, label) =>
    el('button', {
      class: `chip ${pod.category === id ? 'active' : ''}`,
      onclick: () => {
        pod.category = id;
        renderPodcasts();
      },
    }, label);
  $('#genres').replaceChildren(chip('', 'Home'), ...(pod.info?.categories || []).map((c) => chip(c, c)));
}

function podcastLoading(text) {
  $('#loadState').replaceChildren(
    el('div', { class: 'state' }, el('h3', {}, text), el('div', { class: 'progress indeterminate' }, el('span')))
  );
}

function podcastError(err, retry) {
  $('#loadState').replaceChildren(
    el('div', { class: 'state' },
      el('h3', {}, 'Podcasts could not be loaded'),
      el('div', {}, err.message),
      el('button', { class: 'btn btn-primary', onclick: retry }, 'Try again'))
  );
}

function podcastGrid(list) {
  const onCard = onCardIds();
  const queued = queuedIds();
  const items = showFilter(list);
  $('#resultCount').textContent = `${items.length} ${items.length === 1 ? 'podcast' : 'podcasts'}`;
  if (!items.length) {
    $('#loadState').replaceChildren(el('div', { class: 'state' }, el('h3', {}, 'No podcasts found'), el('div', {}, 'Try a different search word.')));
    return;
  }
  $('#loadState').replaceChildren();
  $('#grid').replaceChildren(...items.map((s) => bookCard(podcastItem(s), onCard, queued)));
}

async function renderPodcasts() {
  const req = ++pod.req;
  $('#search').placeholder = 'Search podcasts by name or topic…';
  $('#sortLabel').hidden = true;
  $('#grid').replaceChildren();
  $('#shelves').replaceChildren();
  $('#resultCount').textContent = '';
  podcastChips();
  const query = state.query.trim();
  try {
    if (query) {
      podcastLoading(`Searching for “${query}”…`);
      const results = await api.podcasts.search(query);
      if (req === pod.req) podcastGrid(results);
      return;
    }
    if (pod.category) {
      podcastLoading(`Finding popular ${pod.category} podcasts…`);
      const results = await api.podcasts.trending({ category: pod.category, max: 60 });
      if (req === pod.req) podcastGrid(results);
      return;
    }
    // Home: trending overall, then a shelf per category (filled in as they arrive)
    podcastLoading('Finding popular podcasts…');
    const cats = ['', ...(pod.info?.categories || []).slice(0, POD_HOME_CATEGORIES)];
    const shelves = cats.map((c) => {
      const row = el('div', { class: 'shelf-row' });
      const section = el('section', { class: 'shelf' },
        el('div', { class: 'shelf-head' },
          el('h2', {}, c ? c : 'Top podcasts'),
          el('div', { class: 'shelf-actions' },
            c ? el('button', { class: 'link', onclick: () => { pod.category = c; renderPodcasts(); } }, 'See more ›') : null,
            el('button', { class: 'shelf-arrow', 'aria-label': 'Scroll left', onclick: () => row.scrollBy({ left: -row.clientWidth * 0.8, behavior: 'smooth' }) }, '‹'),
            el('button', { class: 'shelf-arrow', 'aria-label': 'Scroll right', onclick: () => row.scrollBy({ left: row.clientWidth * 0.8, behavior: 'smooth' }) }, '›'))),
        row);
      section.hidden = true;
      return { c, row, section };
    });
    $('#shelves').replaceChildren(...shelves.map((s) => s.section));
    let first = true;
    await Promise.all(shelves.map(async (s) => {
      try {
        const list = showFilter(await api.podcasts.trending({ category: s.c, max: 24 }));
        if (req !== pod.req || list.length < 3) return;
        const onCard = onCardIds();
        const queued = queuedIds();
        s.row.replaceChildren(...list.map((x) => bookCard(podcastItem(x), onCard, queued)));
        s.section.hidden = false;
        if (first) {
          first = false;
          $('#loadState').replaceChildren();
        }
      } catch (err) {
        if (!s.c && req === pod.req) throw err;
      }
    }));
  } catch (err) {
    if (req === pod.req) podcastError(err, () => renderPodcasts());
  }
}
