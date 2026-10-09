'use strict';

/* global api, state, el, $, bookCard, onCardIds, queuedIds, applyFilters, ratingScore, SORTERS, showError, toast, noun, isMusic, fmtBytes, fmtAgo, loadCatalog, sourceIndex: writable */

// =========================================================================
// Browse "Home": genre chips and shelves (rows of books).
// =========================================================================

const SHELF_SIZE = 24;

function renderGenreChips(items) {
  const counts = new Map();
  for (const it of items) for (const g of it.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  const chip = (id, label, count) =>
    el('button', {
      class: `chip ${state.genre === id ? 'active' : ''}`,
      role: 'tab',
      'aria-selected': String(state.genre === id),
      onclick: () => selectGenre(id),
    }, label, count != null ? el('span', { class: 'chip-count' }, count.toLocaleString()) : null);
  $('#genres').replaceChildren(
    chip('home', 'Home'),
    chip('all', `All ${noun()}`, items.length),
    ...state.genres.filter((g) => counts.get(g.id)).map((g) => chip(g.id, g.label, counts.get(g.id)))
  );
}

function selectGenre(id) {
  state.genre = id;
  if (id !== 'home' && state.query) {
    // keep the search; it now searches inside the genre
  }
  applyFilters();
}

/** "See all" on a shelf: show the full grid for that genre with the shelf's sort order. */
function seeAll(genre, sort) {
  state.genre = genre || 'all';
  if (sort) {
    state.sort = sort;
    $('#sort').value = sort;
  }
  applyFilters();
}

/**
 * The first SHELF_SIZE items in this order, one per title: a concert is often
 * listed once per recording, and a shelf of the same show isn't much of a shelf.
 * ("See all" and search still list every copy.)
 */
function topBy(items, sorter, filter) {
  const list = (filter ? items.filter(filter) : items.slice()).sort(sorter);
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const key = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length === SHELF_SIZE) break;
  }
  return out;
}

function renderShelves(items) {
  const onCard = onCardIds();
  const queued = queuedIds();
  const shelves = [
    { title: 'Most popular', books: topBy(items, SORTERS.popular), genre: 'all', sort: 'popular', count: items.length },
    {
      title: 'Top rated',
      hint: 'by listeners on archive.org',
      books: topBy(items, SORTERS.rated, (it) => it.reviews >= 3 && it.rating >= 4),
      genre: 'all',
      sort: 'rated',
    },
    // records are all a few minutes long, so "short" says nothing there
    isMusic() ? null : {
      title: 'Short listens',
      hint: 'under 2 hours',
      books: topBy(items, SORTERS.popular, (it) => it.runtime && it.runtime <= 7200),
      genre: 'all',
      sort: 'shortest',
    },
    { title: 'Recently added', books: topBy(items, SORTERS.newest), genre: 'all', sort: 'newest' },
  ].filter(Boolean);
  for (const g of state.genres) {
    const inGenre = items.filter((it) => it.genres?.includes(g.id));
    if (inGenre.length < 4) continue;
    shelves.push({ title: g.label, books: topBy(inGenre, SORTERS.popular), genre: g.id, sort: 'popular', count: inGenre.length });
  }

  $('#shelves').replaceChildren(
    ...shelves
      .filter((s) => s.books.length >= 4)
      .map((s) =>
        el('section', { class: 'shelf' },
          el('div', { class: 'shelf-head' },
            el('h2', {}, s.title, s.hint ? el('span', { class: 'shelf-hint' }, s.hint) : null),
            el('div', { class: 'shelf-actions' },
              el('button', { class: 'link', dataset: { seeAll: s.genre, sort: s.sort } },
                s.count ? `See all ${s.count.toLocaleString()} ›` : 'See all ›'),
              el('button', { class: 'shelf-arrow', 'aria-label': 'Scroll left', onclick: (e) => scrollShelf(e, -1) }, '‹'),
              el('button', { class: 'shelf-arrow', 'aria-label': 'Scroll right', onclick: (e) => scrollShelf(e, 1) }, '›'))),
          el('div', { class: 'shelf-row' }, s.books.map((it) => bookCard(it, onCard, queued)))))
  );
}

/** Arrow buttons: scroll a shelf by most of its visible width (rows are hard to scroll sideways with a mouse wheel). */
function scrollShelf(e, dir) {
  const row = e.currentTarget.closest('.shelf').querySelector('.shelf-row');
  row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
}

// =========================================================================
// Settings
// =========================================================================

function openSettings() {
  const dlg = $('#settingsDialog');
  const s = state.settings;
  const save = async (patch) => {
    try {
      state.settings = await api.settings.set(patch);
    } catch (err) {
      showError(err);
    }
  };
  const select = (value, options, onchange) =>
    el('select', { onchange: (e) => onchange(e.target.value) },
      options.map(([v, label]) => el('option', { value: v, selected: String(value) === v }, label)));

  dlg.replaceChildren(
    el('button', { class: 'close-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
    el('div', { class: 'dialog-body settings' },
      el('h2', {}, 'Settings'),

      el('h3', {}, 'Split long chapters'),
      el('p', { class: 'muted' },
        'Many headphones and simple MP3 players forget where you were when they are turned off. ' +
        'Splitting long chapters into shorter parts means less to skip through to find your place.'),
      select(s.splitMinutes || '0', [
        ['0', 'Don’t split (keep original chapters)'],
        ['10', 'Split into parts of about 10 minutes'],
        ['15', 'Split into parts of about 15 minutes'],
        ['20', 'Split into parts of about 20 minutes'],
        ['30', 'Split into parts of about 30 minutes'],
      ], (v) => save({ splitMinutes: v })),
      el('p', { class: 'hint' },
        'Applies to anything put on a drive from now on. Titles saved on this computer keep their original chapters. ' +
        'Chapters only slightly longer than the part length are left whole.'),

      el('h3', {}, 'Stars'),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: !!s.unstarOnCopy, onchange: (e) => save({ unstarOnCopy: e.target.checked }) }),
        'Remove the star once a title has been put on a drive'),
      el('p', { class: 'hint' }, 'Handy if you star titles you want to put on a drive later. Podcasts you follow keep their star, and so does a long series when only some of its chapters or episodes are copied.'),

      el('h3', {}, 'Sound quality for new downloads'),
      select(s.quality || 'standard', [
        ['standard', 'Standard (recommended): smaller files, great for spoken word'],
        ['high', 'High: about twice the size'],
      ], (v) => save({ quality: v })),
      el('p', { class: 'hint' }, 'Music always starts on High. You can also choose the quality for each title in its details.'),

      el('h3', {}, 'Lists of books, shows and music'),
      select(s.listSource || 'github', [
        ['github', 'Faster (recommended): updated once a week'],
        ['archive', 'Most up to date: can take several minutes'],
      ], (v) => save({ listSource: v })),
      el('p', { class: 'hint' },
        '“Faster” is updated once a week. “Most up to date” includes the very newest additions, ' +
        'but getting a big list can take several minutes.'),
      el('div', { class: 'list-cache' },
        el('span', { id: 'listCacheInfo', class: 'muted' }),
        el('button', { class: 'btn btn-secondary btn-small', onclick: clearLists }, 'Get fresh lists')),

      el('h3', {}, 'About & updates'),
      el('div', { id: 'updateStatus', class: 'update-status' })),
    el('div', { class: 'dialog-foot' }, el('button', { class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done'))
  );
  renderUpdateStatus();
  renderListCacheInfo();
  dlg.showModal();
}

async function renderListCacheInfo() {
  const box = $('#listCacheInfo');
  if (!box) return;
  const info = await api.catalog.info().catch(() => null);
  box.textContent = !info || !info.count
    ? 'No lists saved on this computer yet.'
    : `${info.count} ${info.count === 1 ? 'list' : 'lists'} saved on this computer (${fmtBytes(info.bytes)}), updated ${fmtAgo(info.newest)}.`;
}

/** Delete the saved lists and download them again, from the place chosen above. */
async function clearLists() {
  try {
    await api.catalog.clear();
    state.catalogs = {};
    state.fetching = {};
    sourceIndex = null;
    renderListCacheInfo();
    toast('Getting fresh lists…');
    if (state.sourceId !== 'podcasts') await loadCatalog(state.sourceId);
    renderListCacheInfo();
  } catch (err) {
    showError(err);
  }
}

// =========================================================================
// About
// =========================================================================

const AUTHOR = 'TJ Hunter';
const PROJECT_URL = 'https://hypnopompia.github.io/ListenSync/';

function projectLink() {
  return el('button', { class: 'link', onclick: () => api.openExternal(PROJECT_URL) }, PROJECT_URL.replace(/^https:\/\/|\/$/g, ''));
}

/** The About dialog, opened from the app menu on a Mac. */
/** Compare "1.4.2"-style version numbers. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * List of changes, newest first. With `from`, only what's new since that
 * version ("What's new" after an update); '' means the previous version is
 * unknown, so only this version is shown.
 */
async function showChanges(from) {
  const [info, all] = await Promise.all([api.info(), api.changelog()]).catch(() => [{}, []]);
  const upTo = all.filter((v) => compareVersions(v.version, info.version) <= 0);
  const whatsNew = from !== undefined;
  const list = !whatsNew ? upTo : from ? upTo.filter((v) => compareVersions(v.version, from) > 0) : upTo.slice(0, 1);
  if (!list.length) return;
  const dlg = $('#changesDialog');
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  dlg.replaceChildren(
    el('button', { class: 'close-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
    el('div', { class: 'dialog-body changes' },
      el('h2', {}, whatsNew ? 'What’s new' : 'What’s changed'),
      whatsNew ? el('p', { class: 'muted' }, `ListenSync has been updated to version ${info.version}.`) : null,
      list.map((v) => [
        el('h3', {}, `Version ${v.version}`, v.date ? el('span', { class: 'muted' }, ` · ${fmt(v.date)}`) : null),
        el('ul', {}, v.changes.map((c) => el('li', {}, c))),
      ])),
    el('div', { class: 'dialog-foot' }, el('button', { class: 'btn btn-primary', autofocus: true, onclick: () => dlg.close() }, whatsNew ? 'Got it' : 'Close'))
  );
  dlg.showModal();
}

async function showAbout() {
  const dlg = $('#aboutDialog');
  if (dlg.open) return;
  const info = await api.info().catch(() => ({}));
  dlg.replaceChildren(
    el('div', { class: 'dialog-body about' },
      el('img', { class: 'about-icon', src: '../assets/icon.png', alt: '' }),
      el('h2', {}, 'ListenSync'),
      el('div', { class: 'muted' }, `Version ${info.version || ''}`),
      el('p', {}, 'Free audiobooks, radio, music and podcasts for your MP3 player.'),
      el('p', {}, `Made by ${AUTHOR}`, el('br'), projectLink()),
      el('p', { class: 'hint' }, 'Audiobooks come from LibriVox and the Internet Archive. This app is not affiliated with or endorsed by either.')),
    el('div', { class: 'dialog-foot' }, el('button', { class: 'btn btn-primary', autofocus: true, onclick: () => dlg.close() }, 'OK'))
  );
  dlg.showModal();
}

// =========================================================================
// App updates (see src/main/updater.js)
// =========================================================================

function updateText(u) {
  switch (u?.state) {
    case 'dev': return 'Running from source code, so updates are not checked.';
    case 'checking': return 'Checking for updates…';
    case 'current': return 'You have the latest version.';
    case 'available': return `Version ${u.version} is available.`;
    case 'downloading': return `Downloading version ${u.version || ''}… ${u.percent || 0}%`;
    case 'ready': return `Version ${u.version} is ready to install.`;
    case 'error': return u.error;
    default: return '';
  }
}

async function installUpdate() {
  try {
    const restarting = await api.updates.install();
    if (!restarting) toast('The download page has opened in your web browser. Install the new version from there.');
  } catch (err) {
    showError(err);
  }
}

function renderUpdateStatus() {
  const box = $('#updateStatus');
  if (!box) return;
  const u = state.update || {};
  const action =
    u.state === 'ready' ? el('button', { class: 'btn btn-primary btn-small', onclick: installUpdate }, 'Restart to update')
      : u.state === 'available' ? el('button', { class: 'btn btn-primary btn-small', onclick: installUpdate }, 'Download update')
        : u.state !== 'dev' ? el('button', { class: 'btn btn-secondary btn-small', disabled: ['checking', 'downloading'].includes(u.state), onclick: () => api.updates.check() }, 'Check for updates')
          : null;
  box.replaceChildren(...[
    el('div', {}, el('strong', {}, `ListenSync ${u.current || ''}`)),
    el('div', { class: 'muted' }, updateText(u)),
    u.state === 'available' && !u.selfUpdate
      ? el('p', { class: 'hint' }, 'This copy can\u2019t install updates by itself, so the download page will open in your browser.')
      : null,
    action,
    el('p', { class: 'hint' },
      'Audiobooks come from ',
      el('button', { class: 'link', onclick: () => api.openExternal('https://librivox.org') }, 'LibriVox'),
      ', whose volunteers record public-domain books, and the ',
      el('button', { class: 'link', onclick: () => api.openExternal('https://archive.org') }, 'Internet Archive'),
      ', which hosts them. This app is not affiliated with or endorsed by either. ' +
        'Recordings uploaded by Internet Archive members may be under copyright; you are responsible for making sure your use is allowed where you live.'),
    el('button', { class: 'link', style: { alignSelf: 'flex-start' }, onclick: () => showChanges() }, 'See what’s changed in each version'),
    el('p', { class: 'hint' }, `Made by ${AUTHOR}. Free and open source (MIT license): `, projectLink()),
  ].filter(Boolean)); // (replaceChildren would print null as text)
}

function renderUpdateBanner() {
  const b = $('#updateBanner');
  const u = state.update || {};
  if (!['available', 'downloading', 'ready'].includes(u.state)) {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  const label = u.state === 'ready' ? `Version ${u.version} is ready` : u.state === 'downloading' ? `Updating… ${u.percent || 0}%` : `Version ${u.version} is out`;
  b.replaceChildren(
    ...[
      el('span', { class: 'update-text' }, label),
      u.state === 'downloading'
        ? null
        : el('button', { class: 'btn btn-primary btn-small', onclick: installUpdate }, u.state === 'ready' ? 'Restart' : 'Download'),
    ].filter(Boolean)
  );
}
