'use strict';

/* global api, state, el, $, bookCard, onCardIds, queuedIds, applyFilters, ratingScore, SORTERS, showError, toast */

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
    chip('all', 'All books', items.length),
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

function topBy(items, sorter, filter) {
  const list = filter ? items.filter(filter) : items.slice();
  return list.sort(sorter).slice(0, SHELF_SIZE);
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
    {
      title: 'Short listens',
      hint: 'under 2 hours',
      books: topBy(items, SORTERS.popular, (it) => it.runtime && it.runtime <= 7200),
      genre: 'all',
      sort: 'shortest',
    },
    { title: 'Recently added', books: topBy(items, SORTERS.newest), genre: 'all', sort: 'newest' },
  ];
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
        'Applies to books put on an SD card from now on. Books saved on this computer keep their original chapters. ' +
        'Chapters only slightly longer than the part length are left whole.'),

      el('h3', {}, 'Sound quality for new downloads'),
      select(s.quality || 'standard', [
        ['standard', 'Standard (recommended): smaller files, great for spoken word'],
        ['high', 'High: about twice the size'],
      ], (v) => save({ quality: v })),
      el('p', { class: 'hint' }, 'You can also choose the quality for each book in its details.'),

      el('h3', {}, 'About & updates'),
      el('div', { id: 'updateStatus', class: 'update-status' })),
    el('div', { class: 'dialog-foot' }, el('button', { class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done'))
  );
  renderUpdateStatus();
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
  box.replaceChildren(
    el('div', {}, el('strong', {}, `Audiobook SD Loader ${u.current || ''}`)),
    el('div', { class: 'muted' }, updateText(u)),
    u.state === 'available' && !u.selfUpdate
      ? el('p', { class: 'hint' }, 'This copy can\u2019t install updates by itself, so the download page will open in your browser.')
      : null,
    action
  );
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
    el('span', { class: 'update-text' }, label),
    u.state === 'downloading'
      ? null
      : el('button', { class: 'btn btn-primary btn-small', onclick: installUpdate }, u.state === 'ready' ? 'Restart' : 'Download')
  );
}
