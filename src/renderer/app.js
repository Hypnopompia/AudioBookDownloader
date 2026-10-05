'use strict';

/* global api */

// =========================================================================
// Helpers
// =========================================================================

const $ = (sel) => document.querySelector(sel);

/** Tiny DOM builder. Text is always inserted as text (never HTML). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  card: 'M8 2h9a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7zm1 2v4h2V4zm3 0v4h2V4zm3 0v4h2V4z',
  warn: 'M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z',
  ok: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.4 13.2-3.5-3.5-1.4 1.4 4.9 4.9 8-8-1.4-1.4z',
  folder: 'M3 5h7l2 2h9v12H3z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  sort: 'M7 4l4 4H8v8H6V8H3zm10 16-4-4h3V8h2v8h3z',
  eject: 'M12 5l7 8H5zM5 16h14v3H5z',
  retry: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  x: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  star: 'M12 17.3 5.8 21l1.6-7L2 9.2l7.2-.6L12 2l2.8 6.6 7.2.6-5.4 4.8 1.6 7z',
  starOutline: 'M12 2l2.8 6.6 7.2.6-5.4 4.8 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.2-.6zm0 5.1-1.5 3.5-3.8.3 2.9 2.5-.9 3.7 3.3-2 3.3 2-.9-3.7 2.9-2.5-3.8-.3z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  ban: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM5.7 7.1A8 8 0 0 0 16.9 18.3zm1.4-1.4 11.2 11.2A8 8 0 0 0 7.1 5.7z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  download: 'M11 3h2v9l3.3-3.3 1.4 1.4L12 15.8 6.3 10.1l1.4-1.4L11 12zM4 18h16v2H4z',
  computer: 'M3 4h18v12H3zm2 2v8h14V6zM8 18h8v2H8z',
};
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

function fmtBytes(b) {
  if (b == null || !isFinite(b)) return '–';
  if (b < 1024 * 1024) return `${Math.max(0, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 100 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function fmtRuntime(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function fmtClock(sec) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtEta(sec) {
  if (sec == null || !isFinite(sec)) return 'working out time left…';
  if (sec < 45) return 'less than a minute left';
  if (sec < 90) return 'about 1 minute left';
  if (sec < 3600) return `about ${Math.round(sec / 60)} minutes left`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `about ${h} hr${m ? ` ${m} min` : ''} left`;
}

function fmtAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 3600) return 'just now';
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`;
  const days = Math.floor(d / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Standard-quality LibriVox MP3s are 64 kbps = ~28.8 MB per hour of listening.
const BYTES_PER_HOUR = 64000 / 8 * 3600;

const LANGS = {
  eng: ['English', 'en', 'english', 'en-us', 'en-gb', 'en_us', 'en_gb'],
  spa: ['Spanish', 'es', 'spanish', 'español', 'espanol'],
  fra: ['French', 'fr', 'fre', 'french', 'français', 'francais'],
  deu: ['German', 'de', 'ger', 'german', 'deutsch'],
  ita: ['Italian', 'it', 'italian', 'italiano'],
  por: ['Portuguese', 'pt', 'portuguese', 'português'],
  nld: ['Dutch', 'nl', 'dut', 'dutch', 'nederlands'],
  rus: ['Russian', 'ru', 'russian'],
  zho: ['Chinese', 'zh', 'chi', 'chinese'],
  jpn: ['Japanese', 'ja', 'japanese'],
  lat: ['Latin', 'la', 'latin'],
  grc: ['Ancient Greek', 'ancient greek'],
  ell: ['Greek', 'el', 'gre', 'greek'],
  pol: ['Polish', 'pl', 'polish'],
  fin: ['Finnish', 'fi', 'finnish'],
  swe: ['Swedish', 'sv', 'swedish'],
  dan: ['Danish', 'da', 'danish'],
  nor: ['Norwegian', 'no', 'nb', 'norwegian'],
  heb: ['Hebrew', 'he', 'hebrew'],
  ara: ['Arabic', 'ar', 'arabic'],
  hun: ['Hungarian', 'hu', 'hungarian'],
  tgl: ['Tagalog', 'tl', 'tagalog'],
  epo: ['Esperanto', 'eo', 'esperanto'],
  cat: ['Catalan', 'ca', 'catalan'],
  ukr: ['Ukrainian', 'uk', 'ukrainian'],
  hin: ['Hindi', 'hi', 'hindi'],
  tur: ['Turkish', 'tr', 'turkish'],
  ces: ['Czech', 'cs', 'cze', 'czech'],
  kor: ['Korean', 'ko', 'korean'],
};
const LANG_ALIAS = new Map();
for (const [code, [name, ...aliases]] of Object.entries(LANGS)) {
  LANG_ALIAS.set(code, code);
  LANG_ALIAS.set(name.toLowerCase(), code);
  for (const a of aliases) LANG_ALIAS.set(a, code);
}
const langKey = (raw) => {
  const s = String(raw || '').trim().toLowerCase();
  return s ? LANG_ALIAS.get(s) || s : '';
};
const langName = (key) => (LANGS[key] ? LANGS[key][0] : key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown');

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COVER_COLORS = ['#1f6f6b', '#8a4b2a', '#3e5a8a', '#6b4a7a', '#4d6b2f', '#8a3a4a', '#2f5d6b', '#7a5d1f'];
function coverEl(id, title, author) {
  const color = COVER_COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COVER_COLORS.length];
  const wrap = el('div', { class: 'cover', style: { background: color } });
  const fallback = el('div', { class: 'cover-fallback' }, title || '', author ? el('small', {}, author) : null);
  if (id) {
    const img = el('img', {
      src: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      onerror: () => img.replaceWith(fallback),
    });
    wrap.append(img);
  } else {
    wrap.append(fallback);
  }
  return wrap;
}

function toast(text, kind = '', action) {
  const t = el('div', { class: `toast ${kind}` }, el('div', {}, text));
  if (action) t.append(el('button', { onclick: () => { action.run(); t.remove(); } }, action.label));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 5000);
}

function showError(err) {
  toast(err?.message || String(err), 'error');
}

/** Promise-based confirm dialog. */
function confirmBox({ title, text, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  const dlg = $('#confirmDialog');
  return new Promise((resolve) => {
    dlg.replaceChildren(
      el('div', { class: 'dialog-body' }, el('h2', {}, title), text ? el('p', { class: 'muted' }, text) : null),
      el(
        'div',
        { class: 'dialog-foot' },
        cancel ? el('button', { class: 'btn btn-secondary', onclick: () => dlg.close('cancel') }, cancel) : null,
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => dlg.close('ok') }, ok)
      )
    );
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// =========================================================================
// State
// =========================================================================

const state = {
  settings: {},
  sources: [],
  sourceId: 'librivox',
  catalogs: {}, // sourceId -> { items, fetchedAt, langs }
  loading: null,
  filtered: [],
  shown: 0,
  query: '',
  lang: 'eng',
  sort: 'popular',
  drives: [],
  manualDrives: [],
  mount: null,
  card: null,
  downloads: { jobs: [], busy: false },
  autoEject: false,
  view: 'browse',
  show: 'all',
  genre: 'home', // 'home' (shelves), 'all', or a genre id
  genres: [],
  lib: {}, // per-book starred / status / position (see libstate.js)
  local: { books: [], total: 0, root: '' }, // books saved on this computer
};

// ------------------------------------------------------------ personal library helpers

const libEntry = (key) => (key && state.lib[key]) || {};

/** Update a book's starred / status / position, remembering its title for the library page. */
async function setLib(key, patch, meta = {}) {
  if (!key) return null;
  const { title, author, source, runtime, identifier } = meta;
  const entry = await api.library.update(key, { title, author, source, runtime, identifier, ...patch });
  state.lib[key] = entry;
  if ('starred' in patch) {
    updateStarCount();
    if (state.view === 'starred') renderStarred();
  }
  return entry;
}

function localBook(identifier) {
  return identifier ? state.local.books.find((b) => b.identifier === identifier) || null : null;
}

function cardBook(identifier) {
  return identifier ? (state.card?.books || []).find((b) => b.identifier === identifier) || null : null;
}

const PAGE = 60;

function currentDrive() {
  return [...state.drives, ...state.manualDrives].find((d) => d.mount === state.mount) || null;
}

function onCardIds() {
  return new Set((state.card?.books || []).map((b) => b.identifier).filter(Boolean));
}

function queuedIds() {
  return new Set(
    state.downloads.jobs
      .filter((j) => j.mount === state.mount && ['queued', 'downloading', 'copying', 'waiting'].includes(j.status))
      .map((j) => j.identifier)
  );
}

// =========================================================================
// Browse
// =========================================================================

function renderSources() {
  $('#sources').replaceChildren(
    ...state.sources.map((s) =>
      el(
        'button',
        {
          class: `source ${s.id === state.sourceId ? 'active' : ''}`,
          role: 'tab',
          'aria-selected': String(s.id === state.sourceId),
          onclick: () => selectSource(s.id),
        },
        s.name
      )
    )
  );
  const src = state.sources.find((s) => s.id === state.sourceId);
  $('#sourceBlurb').textContent = src?.blurb || '';
}

async function selectSource(id) {
  if (state.sourceId === id && state.catalogs[id]) return;
  state.sourceId = id;
  api.settings.set({ source: id });
  renderSources();
  await loadCatalog(id);
}

function prepareCatalog(data) {
  const counts = new Map();
  for (const it of data.items) {
    it.lk = langKey(it.lang);
    it.hay = fold(`${it.title} ${it.author} ${it.tags}`);
    counts.set(it.lk, (counts.get(it.lk) || 0) + 1);
  }
  data.langs = [...counts.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]);
  return data;
}

async function loadCatalog(id, force = false) {
  state.loading = id;
  $('#grid').replaceChildren();
  $('#resultCount').textContent = '';
  if (!state.catalogs[id] || force) {
    renderLoading(null);
  }
  try {
    const data = state.catalogs[id] && !force ? state.catalogs[id] : prepareCatalog(await api.catalog.load(id, force));
    state.catalogs[id] = data;
    if (state.sourceId !== id) return;
    state.loading = null;
    renderLangs();
    applyFilters();
  } catch (err) {
    if (state.sourceId !== id) return;
    state.loading = null;
    $('#loadState').replaceChildren(
      el('div', { class: 'state' },
        el('h3', {}, 'The list of audiobooks could not be loaded'),
        el('div', {}, err.message),
        el('button', { class: 'btn btn-primary', onclick: () => loadCatalog(id, true) }, 'Try again'))
    );
  }
}

function renderLoading(p) {
  const pct = p && p.total ? Math.min(100, (p.loaded / p.total) * 100) : null;
  const bar = el('div', { class: `progress ${pct == null ? 'indeterminate' : ''}` }, el('span', { style: pct != null ? { width: `${pct}%` } : {} }));
  $('#loadState').replaceChildren(
    el('div', { class: 'state' },
      el('h3', {}, 'Getting the list of audiobooks…'),
      el('div', {}, p && p.total ? `${p.loaded.toLocaleString()} of ${p.total.toLocaleString()} books` : 'This only takes a while the first time. After that it opens instantly.'),
      bar)
  );
}

function renderLangs() {
  const data = state.catalogs[state.sourceId];
  const sel = $('#lang');
  const opts = [el('option', { value: '' }, `All languages (${data.items.length.toLocaleString()})`)];
  for (const [k, n] of data.langs.slice(0, 40)) {
    opts.push(el('option', { value: k }, `${langName(k)} (${n.toLocaleString()})`));
  }
  sel.replaceChildren(...opts);
  const has = (k) => data.langs.some(([key]) => key === k);
  sel.value = state.lang && has(state.lang) ? state.lang : has('eng') && state.lang ? 'eng' : '';
}

const SORTERS = {
  popular: (a, b) => b.downloads - a.downloads,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
  author: (a, b) => (a.author || '~').localeCompare(b.author || '~', undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title),
  rated: (a, b) => ratingScore(b) - ratingScore(a) || b.downloads - a.downloads,
  newest: (a, b) => (b.added || b.year || '').localeCompare(a.added || a.year || '') || b.downloads - a.downloads,
  shortest: (a, b) => (a.runtime || Infinity) - (b.runtime || Infinity),
  longest: (a, b) => (b.runtime || 0) - (a.runtime || 0),
};

function applyFilters() {
  const data = state.catalogs[state.sourceId];
  if (!data) return;
  const lang = $('#lang').value;
  const terms = fold(state.query).split(/\s+/).filter(Boolean);
  let items = data.items;
  if (lang) items = items.filter((it) => it.lk === lang);
  if (terms.length) items = items.filter((it) => terms.every((t) => it.hay.includes(t)));
  const show = state.show;
  items = items.filter((it) => {
    const e = state.lib[it.id];
    if (show === 'starred') return !!e?.starred;
    if (show === 'read') return e?.status === 'read';
    if (show === 'hidden') return e?.status === 'not_interested';
    if (show === 'unread') return !e?.status;
    return e?.status !== 'not_interested';
  });
  renderGenreChips(items);
  const home = state.genre === 'home' && !terms.length;
  $('#sortLabel').hidden = home;
  if (home) {
    state.filtered = [];
    state.shown = 0;
    $('#grid').replaceChildren();
    $('#browseScroller').scrollTop = 0;
    $('#resultCount').textContent = `${items.length.toLocaleString()} books · list updated ${fmtAgo(data.fetchedAt)}`;
    $('#loadState').replaceChildren();
    renderShelves(items);
    return;
  }
  $('#shelves').replaceChildren();
  if (state.genre !== 'home' && state.genre !== 'all') items = items.filter((it) => it.genres?.includes(state.genre));
  state.filtered = [...items].sort(SORTERS[state.sort] || SORTERS.popular);
  state.shown = 0;
  $('#grid').replaceChildren();
  $('#browseScroller').scrollTop = 0;
  $('#resultCount').textContent = `${state.filtered.length.toLocaleString()} ${state.filtered.length === 1 ? 'book' : 'books'} · list updated ${fmtAgo(data.fetchedAt)}`;
  if (!state.filtered.length) {
    $('#loadState').replaceChildren(
      el('div', { class: 'state' }, el('h3', {}, 'No audiobooks match'),
        el('div', {}, state.show === 'all' ? 'Try a different search word, or choose "All languages".' : 'Try a different search word, or set "Show" to "All books".'))
    );
  } else {
    $('#loadState').replaceChildren();
    renderMore();
  }
}

/** Badges on a cover: SD card / downloading / on computer / read, a star, and listening progress. */
function decorateCover(cover, id, onCard, queued) {
  cover.querySelectorAll('.badge, .star-mark, .cover-progress').forEach((n) => n.remove());
  const e = state.lib[id] || {};
  let badge = null;
  const cb = onCard.has(id) ? cardBook(id) : null;
  if (cb && (!cb.complete || cb.check?.status === 'problem')) badge = el('span', { class: 'badge warn', title: 'Open "On the SD card" to repair it' }, 'Check SD card');
  else if (cb && cb.check?.status === 'ok') badge = el('span', { class: 'badge', title: 'Checked: every chapter matches the original' }, 'On SD card ✓');
  else if (cb) badge = el('span', { class: 'badge' }, 'On SD card');
  else if (queued.has(id)) badge = el('span', { class: 'badge queued' }, 'Downloading');
  else if (localBook(id)) badge = el('span', { class: 'badge local' }, 'On computer');
  else if (e.status === 'read') badge = el('span', { class: 'badge read' }, 'Read');
  if (badge) cover.append(badge);
  if (e.starred) cover.append(el('span', { class: 'star-mark', title: 'Starred' }, icon('star')));
  const p = e.position;
  if (p && p.tracks && e.status !== 'read') {
    cover.append(el('span', { class: 'cover-progress' }, el('span', { style: { width: `${Math.min(100, ((p.track + 0.5) / p.tracks) * 100)}%` } })));
  }
}

/** Rating adjusted for how many reviews it has, so one 5-star review doesn't top the list. */
function ratingScore(it) {
  if (!it.rating || !it.reviews) return 0;
  const PRIOR = 3, WEIGHT = 3;
  return (it.rating * it.reviews + PRIOR * WEIGHT) / (it.reviews + WEIGHT);
}

const fmtRating = (rating) => (rating ? `★ ${rating.toFixed(1)}` : '');

function bookCard(it, onCard, queued) {
  const cover = coverEl(it.id, it.title, it.author);
  decorateCover(cover, it.id, onCard, queued);
  const meta = [fmtRating(it.rating), fmtRuntime(it.runtime), state.lang ? '' : langName(it.lk)].filter(Boolean).join(' · ');
  return el(
    'button',
    { class: 'book', dataset: { id: it.id }, onclick: () => openBook(it.id, it) },
    cover,
    el('div', { class: 'book-title' }, it.title),
    el('div', { class: 'book-author' }, it.author || 'Unknown author'),
    meta ? el('div', { class: 'book-meta' }, meta) : null
  );
}

function renderMore() {
  const onCard = onCardIds();
  const queued = queuedIds();
  const next = state.filtered.slice(state.shown, state.shown + PAGE);
  state.shown += next.length;
  $('#grid').append(...next.map((it) => bookCard(it, onCard, queued)));
}

/** Re-draw badges on visible cards after the card or queue changes. */
function refreshBadges() {
  if (state.view === 'starred') renderStarred();
  const onCard = onCardIds();
  const queued = queuedIds();
  for (const node of document.querySelectorAll('#browseScroller .book')) decorateCover(node.querySelector('.cover'), node.dataset.id, onCard, queued);
}

// =========================================================================
// Book details dialog
// =========================================================================

let bookReq = 0;

async function openBook(id, item) {
  const dlg = $('#bookDialog');
  const req = ++bookReq;
  dlg.replaceChildren(
    el('button', { class: 'close-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
    el('div', { class: 'dialog-body' },
      el('div', { class: 'detail' },
        coverEl(id, item?.title, item?.author),
        el('div', {},
          el('h2', {}, item?.title || 'Loading…'),
          el('div', { class: 'detail-author' }, item?.author || ''),
          el('div', { class: 'state', style: { padding: '30px 0' } }, el('div', { class: 'progress indeterminate' }, el('span')), 'Getting chapter list…'))))
  );
  if (!dlg.open) dlg.showModal();
  try {
    const details = await api.catalog.details(id, state.settings.quality);
    if (req !== bookReq) return;
    renderBook(details);
  } catch (err) {
    if (req !== bookReq) return;
    dlg.querySelector('.state').replaceChildren(el('div', {}, err.message), el('button', { class: 'btn btn-primary', onclick: () => openBook(id, item) }, 'Try again'));
  }
}

function fitInfo(bytes) {
  const drive = currentDrive();
  if (!drive) return { ok: false, text: 'Plug in the SD card to put this book on it.', noCard: true };
  const pending = state.card?.pendingBytes || 0;
  const free = (state.card?.free ?? drive.free) - pending;
  if (bytes <= free) return { ok: true, text: `Fits on the SD card (${fmtBytes(free - bytes)} will be left).`, free };
  const local = ' You can still save it to this computer.';
  // Even removing every audiobook wouldn't free enough space
  const mostPossible = free + (state.card?.booksSize || 0);
  if (bytes > mostPossible) {
    return {
      ok: false,
      tooBig: true,
      text: `Too big for this SD card: needs ${fmtBytes(bytes)}, but the card can hold at most ${fmtBytes(Math.max(0, mostPossible))} of audiobooks.${local}`,
      free,
      shortBy: bytes - free,
    };
  }
  return {
    ok: false,
    text: `Too big for the SD card right now: needs ${fmtBytes(bytes)}, but the card only has ${fmtBytes(Math.max(0, free))} free.${local}`,
    free,
    shortBy: bytes - free,
  };
}

/** Star / Read / Not interested toggle buttons for a book. */
function statusButtons(key, meta, rerender) {
  const e = libEntry(key);
  const toggle = (label, iconName, active, patch) =>
    el('button', {
      class: `toggle ${active ? 'on' : ''}`,
      'aria-pressed': String(active),
      onclick: async () => {
        try {
          await setLib(key, patch, meta);
          rerender();
          refreshBadges();
          if (state.view === 'library') renderLibrary();
        } catch (err) {
          showError(err);
        }
      },
    }, icon(iconName), label);
  return el('div', { class: 'toggles' },
    toggle(e.starred ? 'Starred' : 'Star', e.starred ? 'star' : 'starOutline', !!e.starred, { starred: !e.starred }),
    toggle(e.status === 'read' ? 'Read' : 'Mark as read', 'check', e.status === 'read', { status: e.status === 'read' ? null : 'read' }),
    toggle('Not interested', 'ban', e.status === 'not_interested', { status: e.status === 'not_interested' ? null : 'not_interested' }));
}

/** Re-draw the open book dialog after the card, library or downloads change. */
function refreshBookDialog() {
  if ($('#bookDialog').open && state.dialogBook) renderBook(state.dialogBook);
}

function renderBook(d) {
  const dlg = $('#bookDialog');
  state.dialogBook = d;
  const onCard = onCardIds().has(d.identifier);
  const queued = queuedIds().has(d.identifier);
  const fit = fitInfo(d.totalBytes);
  const meta = { title: d.title, author: d.author, source: state.sourceId, runtime: d.runtime, identifier: d.identifier };
  const loc = localBook(d.identifier);
  const savingLocal = state.downloads.jobs.some((j) => j.identifier === d.identifier && !j.toCard && ['queued', 'downloading'].includes(j.status));
  const pos = libEntry(d.identifier).position;

  const desc = el('div', { class: 'description' }, d.description || 'No description available.');
  let moreBtn = null;
  if ((d.description || '').length > 500) {
    desc.classList.add('clamped');
    moreBtn = el('button', { class: 'link', onclick: () => { desc.classList.remove('clamped'); moreBtn.remove(); } }, 'Show more');
  }

  const facts = el('dl', { class: 'facts' });
  const addFact = (k, v) => v && facts.append(el('dt', {}, k), el('dd', {}, v));
  if (d.rating) addFact('Rating', `${'★'.repeat(Math.round(d.rating))}${'☆'.repeat(5 - Math.round(d.rating))}  ${d.rating.toFixed(1)} (${d.reviews} ${d.reviews === 1 ? 'review' : 'reviews'} on archive.org)`);
  addFact('Length', fmtRuntime(d.runtime));
  addFact('Chapters', d.tracks.length ? String(d.tracks.length) : 'No MP3 files');
  addFact('Download size', d.totalBytes ? fmtBytes(d.totalBytes) : '');
  addFact('Language', langName(langKey(d.language)));
  addFact('Published', d.date);

  let quality = null;
  if (d.sizes.standard && d.sizes.high && d.sizes.standard !== d.sizes.high) {
    const opt = (value, label, hint) =>
      el('label', {},
        el('input', { type: 'radio', name: 'quality', value, checked: d.quality === value, onchange: () => changeQuality(d.identifier, value) }),
        el('span', {}, label, el('small', {}, hint)));
    quality = el('div', {},
      el('h3', {}, 'Sound quality'),
      el('div', { class: 'quality' },
        opt('standard', `Standard — ${fmtBytes(d.sizes.standard)}`, 'Recommended. Sounds great for spoken word and fits twice as many books.'),
        opt('high', `High — ${fmtBytes(d.sizes.high)}`, 'Bigger files. Only needed for music or very good headphones.')));
  }

  const chapters = el('ol', { class: 'chapters' },
    d.tracks.map((t, i) => el('li', {}, el('span', { class: 'n' }, i + 1), el('span', { class: 't' }, t.title), el('span', { class: 'd' }, fmtClock(t.seconds)))));

  let action;
  if (!d.tracks.length) action = el('button', { class: 'btn btn-primary btn-big', disabled: true }, 'No MP3 files available');
  else if (onCard && cardBook(d.identifier) && (!cardBook(d.identifier).complete || cardBook(d.identifier).check?.status === 'problem')) {
    action = el('button', { class: 'btn btn-primary btn-big', onclick: () => { dlg.close(); repairBook(cardBook(d.identifier)); } }, icon('retry'), 'Repair on SD card');
  } else if (onCard) action = el('button', { class: 'btn btn-primary btn-big', disabled: true }, icon('ok'), 'Already on the SD card');
  else if (queued) action = el('button', { class: 'btn btn-primary btn-big', disabled: true }, 'Downloading now…');
  else if (fit.noCard) action = el('button', { class: 'btn btn-primary btn-big', disabled: true }, icon('plus'), 'Put on SD card');
  else if (fit.tooBig) action = el('button', { class: 'btn btn-primary btn-big', disabled: true }, 'Too big for this SD card');
  else if (!fit.ok) action = el('button', { class: 'btn btn-primary btn-big', onclick: () => openMakeRoom(d) }, 'Make room on the SD card…');
  else action = el('button', { class: 'btn btn-primary btn-big', onclick: (e) => addBook(d, e.currentTarget) }, icon('plus'), 'Put on SD card');

  // Listen on this computer / save for later
  let play = null;
  const cb = cardBook(d.identifier);
  const playLabel = pos && pos.tracks ? 'Continue listening' : 'Play';
  if (loc) play = el('button', { class: 'btn btn-secondary btn-big', onclick: () => { dlg.close(); playBook({ kind: 'local', dir: loc.dir }); } }, icon('play'), playLabel);
  else if (cb) play = el('button', { class: 'btn btn-secondary btn-big', onclick: () => { dlg.close(); playBook({ kind: 'card', mount: state.mount, folder: cb.folder }); } }, icon('play'), playLabel);
  let save = null;
  if (d.tracks.length && !loc) {
    save = savingLocal
      ? el('button', { class: 'btn btn-secondary btn-big', disabled: true }, 'Saving to computer…')
      : el('button', { class: 'btn btn-secondary btn-big', title: 'Download now and listen here, or copy to an SD card later', onclick: (e) => saveLocal(d, e.currentTarget) }, icon('computer'), 'Save to computer');
  }

  dlg.replaceChildren(
    el('button', { class: 'close-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
    el('div', { class: 'dialog-body' },
      el('div', { class: 'detail' },
        el('div', {}, coverEl(d.identifier, d.title, d.author),
          d.tags.length ? el('div', { class: 'tags' }, d.tags.slice(0, 8).map((t) => el('span', {}, t))) : null),
        el('div', {},
          el('h2', {}, d.title),
          el('div', { class: 'detail-author' }, d.author || 'Unknown author'),
          statusButtons(d.identifier, meta, () => renderBook(d)),
          loc ? el('div', { class: 'fit ok' }, icon('computer'), ' Saved on this computer') : null,
          pos && pos.tracks && libEntry(d.identifier).status !== 'read'
            ? el('div', { class: 'muted' }, `You stopped at chapter ${pos.track + 1} of ${pos.tracks}, ${fmtClock(pos.time)}.`)
            : null,
          facts,
          desc, moreBtn,
          quality,
          d.tracks.length ? [el('h3', {}, `Chapters (${d.tracks.length})`), chapters] : null))),
    el('div', { class: 'dialog-foot' },
      el('button', { class: 'link', onclick: () => api.openExternal(d.url) }, 'View on archive.org'),
      el('span', { class: 'spacer' }),
      d.tracks.length && !onCard && !queued ? el('span', { class: `fit ${fit.ok ? 'ok' : 'bad'}` }, fit.text) : null,
      play,
      save,
      action)
  );
}

async function saveLocal(d, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting…';
  }
  try {
    await api.downloads.add({ identifier: d.identifier, quality: d.quality, source: state.sourceId, target: 'local' });
    toast(`"${d.title}" is being saved to this computer. Find it under My library.`, 'success', { label: 'See progress', run: () => showView('downloads') });
    renderBook(d);
  } catch (err) {
    showError(err);
    renderBook(d);
  }
}

async function changeQuality(id, quality) {
  state.settings = await api.settings.set({ quality });
  try {
    renderBook(await api.catalog.details(id, quality));
  } catch (err) {
    showError(err);
  }
}

async function addBook(d, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding…';
  }
  try {
    await api.downloads.add({ identifier: d.identifier, quality: d.quality, mount: state.mount, source: state.sourceId });
    $('#bookDialog').close();
    toast(`"${d.title}" is downloading. It will be copied to the SD card automatically.`, 'success', {
      label: 'See progress',
      run: () => showView('downloads'),
    });
    await refreshCard();
  } catch (err) {
    if (err.message.includes('NO_SPACE')) {
      await refreshCard();
      openMakeRoom(d);
    } else {
      showError(err);
      if (btn) renderBook(d);
    }
  }
}

// =========================================================================
// "Make room" dialog
// =========================================================================

function openMakeRoom(d) {
  $('#bookDialog').close();
  const dlg = $('#roomDialog');
  const books = (state.card?.books || []).slice().sort((a, b) => b.size - a.size);
  const fit = fitInfo(d.totalBytes);
  const shortBy = Math.max(0, fit.shortBy || 0);
  const selected = new Set();
  const status = el('div', { class: 'room-status' });
  const go = el('button', { class: 'btn btn-danger', disabled: true }, 'Remove selected and add book');

  const update = () => {
    const freed = books.filter((b) => selected.has(b.folder)).reduce((a, b) => a + b.size, 0);
    const enough = freed >= shortBy;
    status.className = `room-status ${enough ? 'ok' : ''}`;
    status.textContent = enough
      ? `That frees ${fmtBytes(freed)} — enough room for "${d.title}".`
      : `Selected: ${fmtBytes(freed)}. Still need ${fmtBytes(shortBy - freed)} more.`;
    go.disabled = !enough || !selected.size;
  };

  go.onclick = async () => {
    const names = books.filter((b) => selected.has(b.folder));
    const ok = await confirmBox({
      title: `Remove ${names.length} ${names.length === 1 ? 'book' : 'books'} from the SD card?`,
      text: names.map((b) => b.title).join(', ') + '. You can always download them again later.',
      ok: 'Remove',
      danger: true,
    });
    if (!ok) return;
    go.disabled = true;
    go.textContent = 'Removing…';
    try {
      stopPlayerIf((src) => src.kind === 'card' && names.some((b) => b.folder === src.folder));
      for (const b of names) await api.card.remove(state.mount, b.folder);
      await refreshCard();
      dlg.close();
      await addBook(d);
    } catch (err) {
      showError(err);
      dlg.close();
      refreshCard();
    }
  };

  dlg.replaceChildren(
    el('div', { class: 'dialog-body' },
      el('h2', {}, 'Make room on the SD card'),
      el('p', { class: 'muted' },
        `"${d.title}" needs ${fmtBytes(d.totalBytes)}, but only ${fmtBytes(Math.max(0, fit.free || 0))} is free. ` +
        'Choose books to remove from the card:'),
      books.length
        ? el('div', { class: 'room-list' },
          books.map((b) =>
            el('label', { class: 'room-item' },
              el('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? selected.add(b.folder) : selected.delete(b.folder); update(); } }),
              el('span', { class: 't' }, b.title, b.author ? el('span', { class: 'muted' }, ` — ${b.author}`) : null),
              el('span', { class: 's' }, fmtBytes(b.size)))))
        : el('p', {}, 'There are no audiobooks on this card to remove. The card is full of other files — try a bigger card, or remove files using your computer.'),
      books.length && books.reduce((a, b) => a + b.size, 0) < shortBy
        ? el('p', { class: 'notice-inline' }, 'Even removing every audiobook would not free enough space. The rest of the card is used by other files, so this book needs a bigger SD card.')
        : null,
      status),
    el('div', { class: 'dialog-foot' },
      el('button', { class: 'btn btn-secondary', onclick: () => dlg.close() }, 'Cancel'),
      go)
  );
  update();
  dlg.showModal();
}

// =========================================================================
// SD card (sidebar + "On the SD card" view)
// =========================================================================

function renderDrivePanel() {
  const area = $('#driveArea');
  const all = [...state.drives, ...state.manualDrives];
  const drive = currentDrive();
  $('#ejectBtn').hidden = !drive || drive.manual;

  if (!all.length) {
    area.replaceChildren(
      el('div', { class: 'drive-empty' },
        el('strong', {}, 'No SD card found'),
        el('span', { class: 'muted' }, 'Put the micro SD card in its adapter and plug it into the computer. It will show up here automatically.'),
        el('button', { class: 'link', style: { textAlign: 'left' }, onclick: pickFolder }, 'Card not showing up? Choose it yourself…'))
    );
    $('#usage').replaceChildren();
    return;
  }

  const nodes = [];
  if (all.length > 1) {
    const sel = el('select', { class: 'drive-select', onchange: (e) => selectDrive(e.target.value) },
      all.map((d) => el('option', { value: d.mount, selected: d.mount === state.mount }, `${d.label} (${fmtBytes(d.total)})`)));
    nodes.push(sel);
  }
  if (drive) {
    nodes.push(
      el('div', {},
        el('div', { class: 'drive-name' }, icon('card'), drive.label),
        el('div', { class: 'drive-meta' }, `${fmtBytes(drive.total)} · ${drive.fs}${drive.manual ? ' · chosen by hand' : ''}`))
    );
    if (drive.fs && /exfat/i.test(drive.fs)) {
      nodes.push(el('div', { class: 'notice-inline' }, 'This card is formatted as exFAT. Some headphones can only read FAT32 cards. If books won’t play, the card may need to be reformatted as FAT32.'));
    }
    if (drive.readOnly) nodes.push(el('div', { class: 'notice-inline' }, 'This card is locked (read-only). Slide the lock switch on the SD adapter up and plug it in again.'));
  }
  nodes.push(el('button', { class: 'link', style: { textAlign: 'left', fontSize: '13px' }, onclick: pickFolder }, 'Use a different card or folder…'));
  area.replaceChildren(...nodes);
  renderUsage();
}

function renderUsage() {
  const drive = currentDrive();
  const c = state.card;
  if (!drive || !c) {
    $('#usage').replaceChildren();
    return;
  }
  const total = c.total || 1;
  const pending = Math.min(c.pendingBytes || 0, c.free);
  const free = Math.max(0, c.free - pending);
  const pct = (v) => `${Math.max(0, (v / total) * 100)}%`;
  const hours = Math.floor(free / BYTES_PER_HOUR);
  $('#usage').replaceChildren(
    el('div', { class: 'usage-free' }, fmtBytes(free), ' ', el('small', {}, 'free')),
    el('div', { class: 'usage-bar', title: 'SD card space' },
      el('span', { class: 'seg-books', style: { width: pct(c.booksSize) } }),
      el('span', { class: 'seg-pending', style: { width: pct(pending) } }),
      el('span', { class: 'seg-other', style: { width: pct(c.otherSize) } })),
    el('div', { class: 'legend' },
      el('i', { class: 'seg-books' }), 'Audiobooks', el('span', { class: 'num' }, fmtBytes(c.booksSize)),
      pending ? [el('i', { class: 'seg-pending' }), 'Being added', el('span', { class: 'num' }, fmtBytes(pending))] : null,
      el('i', { class: 'seg-other' }), 'Other files', el('span', { class: 'num' }, fmtBytes(c.otherSize)),
      el('i', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } }), 'Free', el('span', { class: 'num' }, fmtBytes(free))),
    el('div', { class: 'hint' }, `Room for about ${hours.toLocaleString()} more ${hours === 1 ? 'hour' : 'hours'} of listening.`)
  );
}

async function pickFolder() {
  try {
    const d = await api.drives.pickFolder();
    if (!d) return;
    state.manualDrives = state.manualDrives.filter((m) => m.mount !== d.mount).concat(d);
    await selectDrive(d.mount);
  } catch (err) {
    showError(err);
  }
}

async function selectDrive(mount) {
  state.mount = mount;
  state.settings.lastMount = mount;
  api.settings.set({ lastMount: mount }).catch(() => {});
  state.card = null;
  renderDrivePanel();
  await refreshCard();
}

let cardReq = 0;
async function refreshCard() {
  const req = ++cardReq;
  if (!state.mount) {
    state.card = null;
  } else {
    try {
      const info = await api.card.list(state.mount);
      if (req !== cardReq) return;
      state.card = info;
    } catch (err) {
      if (req !== cardReq) return;
      state.card = null;
      console.warn(err);
    }
  }
  renderDrivePanel();
  renderCardView();
  refreshBadges();
  refreshBookDialog();
  const n = state.card?.books.length || 0;
  $('#cardCount').textContent = n ? String(n) : '';
}

function renderCardView() {
  const root = $('#cardView');
  const drive = currentDrive();
  if (!drive) {
    root.replaceChildren(
      el('div', { class: 'state' }, el('h3', {}, 'No SD card plugged in'), el('div', {}, 'Plug in the SD card to see which audiobooks are on it.'))
    );
    return;
  }
  const c = state.card;
  if (!c) {
    root.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'progress indeterminate' }, el('span')), 'Reading the SD card…'));
    return;
  }

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('h1', {}, 'On the SD card'),
      el('p', {}, `${c.books.length} ${c.books.length === 1 ? 'audiobook' : 'audiobooks'} on "${drive.label}" · ${fmtBytes(c.free)} free`)),
    el('div', { class: 'head-actions' },
      c.books.some((b) => b.managed)
        ? el('button', { class: 'btn btn-secondary', disabled: !!state.verifying, title: 'Read every chapter back from the card and make sure it matches the original', onclick: () => checkBooks() }, icon('check'), 'Check books')
        : null,
      el('button', { class: 'btn btn-secondary', onclick: () => api.card.reveal(state.mount).catch(showError) }, icon('folder'), 'Open card in file browser'),
      el('button', { class: 'btn btn-primary', onclick: () => showView('browse') }, icon('plus'), 'Add audiobooks')));

  const parts = [head];

  if (state.verifying) {
    const p = state.verifying;
    const pct = p.bytesTotal ? (p.bytesDone / p.bytesTotal) * 100 : 0;
    const title = c.books.find((b) => b.folder === p.folder)?.title;
    parts.push(
      el('div', { class: 'banner ok' }, icon('check'),
        el('div', {},
          el('strong', {}, `Checking books… ${Math.min(p.index + 1, p.count)} of ${p.count}`),
          title ? el('span', { class: 'muted' }, title) : null,
          el('div', { class: 'progress', style: { width: '100%', marginTop: '8px' } }, el('span', { style: { width: `${pct.toFixed(1)}%` } }))),
        el('button', { class: 'btn btn-secondary', onclick: () => api.card.cancelVerify() }, 'Stop'))
    );
  }
  const problems = c.books.filter((b) => b.managed && (!b.complete || b.check?.status === 'problem'));
  if (problems.length && !state.verifying) {
    parts.push(
      el('div', { class: 'banner error' }, icon('warn'),
        el('div', {}, el('strong', {}, `${problems.length} ${problems.length === 1 ? 'book has' : 'books have'} a problem on the card`),
          'Press "Repair" to copy the book onto the card again.'))
    );
  }

  if (c.needsFix) {
    parts.push(
      el('div', { class: 'banner' }, icon('warn'),
        el('div', {}, el('strong', {}, 'Some chapters or books are not in play order'),
          'Many headphones play files in the order they were saved, not by name. This can happen after removing books or copying files by hand.'),
        el('button', { class: 'btn btn-primary', onclick: (e) => fixOrder(e.currentTarget) }, icon('sort'), 'Fix play order'))
    );
  }

  if (!c.books.length && !c.looseFiles.length) {
    parts.push(el('div', { class: 'state' }, el('h3', {}, 'This card has no audiobooks yet'),
      el('div', {}, 'Find a book you like and press "Put on SD card".'),
      el('button', { class: 'btn btn-primary btn-big', onclick: () => showView('browse') }, 'Find audiobooks')));
  } else {
    parts.push(el('div', { class: 'list' }, c.books.map((b, i) => bookRow(b, i))));
  }

  if (c.looseFiles.length) {
    parts.push(
      el('div', { class: 'section-title' }, 'Loose MP3 files (not in a folder)'),
      el('div', { class: 'list' }, c.looseFiles.map((f) =>
        el('div', { class: 'row', style: { gridTemplateColumns: '1fr auto' } },
          el('div', {}, el('div', { class: 'row-title' }, f.name), el('div', { class: 'row-sub' }, fmtBytes(f.size))),
          el('div', { class: 'row-actions' },
            el('button', { class: 'btn btn-danger-ghost btn-small', onclick: () => removeLoose(f) }, icon('trash'), 'Remove'))))));
  }

  parts.push(
    el('details', { class: 'explain' },
      el('summary', {}, 'How are books arranged on the card?'),
      el('p', {}, 'Each audiobook gets its own folder named after the book, and every chapter is numbered (001, 002, 003…) so it plays in the right order.'),
      el('p', {}, 'Many headphones and MP3 players ignore file names and play files in the order they were saved to the card. This app always copies chapters one at a time, in order. If you remove books or copy files by hand, use "Fix play order" to put everything back in order. Books are listed here in the order the headphones will see them.'))
  );
  root.replaceChildren(...parts);
}

function bookRow(b, i) {
  const sub = [b.author, `${b.chapters} ${b.chapters === 1 ? 'chapter' : 'chapters'}`, fmtBytes(b.size)].filter(Boolean).join(' · ');
  return el('div', { class: 'row' },
    el('div', { class: 'order' }, i + 1),
    coverEl(b.identifier, b.title, b.author),
    el('div', {},
      el('div', { class: 'row-title' }, b.title,
        libEntry(b.identifier || `folder:${b.folder}`).status === 'read' ? el('span', { class: 'tag ok' }, 'Read') : null,
        !b.inOrder ? el('span', { class: 'tag warn' }, 'Out of order') : null,
        !b.complete ? el('span', { class: 'tag error' }, 'Incomplete') : null,
        b.check?.status === 'ok' ? el('span', { class: 'tag ok', title: `Every chapter matches (checked against ${b.check.checkedFrom})` }, '✓ Checked') : null,
        b.check?.status === 'problem' ? el('span', { class: 'tag error' }, 'Problem') : null,
        b.check?.status === 'unknown' ? el('span', { class: 'tag muted', title: b.check.problems.join(' ') }, 'Can’t check') : null),
      el('div', { class: 'row-sub' }, sub),
      b.check?.status === 'problem' ? el('div', { class: 'row-problem' }, b.check.problems.slice(0, 3).join(' ')) : null,
      !b.complete && b.expectedChapters ? el('div', { class: 'row-problem' }, `Only ${b.chapters} of ${b.expectedChapters} chapters are on the card.`) : null),
    el('div', { class: 'row-actions' },
      b.identifier && (!b.complete || b.check?.status === 'problem')
        ? el('button', { class: 'btn btn-primary btn-small', onclick: () => repairBook(b) }, icon('retry'), 'Repair')
        : null,
      el('button', { class: 'btn btn-secondary btn-small', title: 'Listen on this computer', onclick: () => playBook({ kind: 'card', mount: state.mount, folder: b.folder }) }, icon('play'), 'Play'),
      el('button', { class: 'btn btn-secondary btn-small', title: 'Show the files in this folder', onclick: () => api.card.reveal(state.mount, b.folder).catch(showError) }, icon('folder'), 'Files'),
      el('button', { class: 'btn btn-danger-ghost btn-small', onclick: () => removeBook(b) }, icon('trash'), 'Remove')));
}

async function checkBooks() {
  const mount = state.mount;
  const folders = (state.card?.books || []).filter((b) => b.managed).map((b) => b.folder);
  if (!folders.length) return;
  stopPlayerIf((src) => src.kind === 'card' && src.mount === mount);
  state.verifying = { index: 0, count: folders.length, bytesDone: 0, bytesTotal: 0, folder: folders[0] };
  renderCardView();
  try {
    const results = await api.card.verify(mount, folders);
    const bad = results.filter((r) => r.status === 'problem').length;
    const unknown = results.filter((r) => r.status === 'unknown').length;
    if (bad) toast(`${bad} ${bad === 1 ? 'book has' : 'books have'} a problem. Press "Repair" to fix ${bad === 1 ? 'it' : 'them'}.`, 'error');
    else toast(`All ${results.length - unknown} books checked: every chapter matches the original.${unknown ? ` (${unknown} couldn’t be checked.)` : ''}`, 'success');
  } catch (err) {
    showError(err);
  } finally {
    state.verifying = null;
    refreshCard();
  }
}

/** Remove a damaged book from the card and copy it again (from this computer if saved there). */
async function repairBook(b) {
  const ok = await confirmBox({
    title: `Repair "${b.title}"?`,
    text: localBook(b.identifier)
      ? 'The book will be removed from the SD card and copied again from this computer.'
      : 'The book will be removed from the SD card and downloaded again.',
    ok: 'Repair',
  });
  if (!ok) return;
  stopPlayerIf((src) => src.kind === 'card' && src.folder === b.folder);
  try {
    await api.card.remove(state.mount, b.folder);
    await api.downloads.add({ identifier: b.identifier, quality: b.quality || state.settings.quality, mount: state.mount, source: b.source, target: 'card' });
    toast(`Repairing "${b.title}".`, 'success', { label: 'See progress', run: () => showView('downloads') });
  } catch (err) {
    showError(err);
  }
  refreshCard();
}

async function removeBook(b) {
  const ok = await confirmBox({
    title: `Remove "${b.title}" from the SD card?`,
    text: `This frees up ${fmtBytes(b.size)}. You can download it again any time.`,
    ok: 'Remove book',
    danger: true,
  });
  if (!ok) return;
  stopPlayerIf((src) => src.kind === 'card' && src.folder === b.folder);
  try {
    await api.card.remove(state.mount, b.folder);
    toast(`Removed "${b.title}".`);
  } catch (err) {
    showError(err);
  }
  refreshCard();
}

async function removeLoose(f) {
  const ok = await confirmBox({ title: `Remove "${f.name}"?`, text: 'This file will be deleted from the SD card.', ok: 'Remove', danger: true });
  if (!ok) return;
  try {
    await api.card.removeFile(state.mount, f.name);
  } catch (err) {
    showError(err);
  }
  refreshCard();
}

async function fixOrder(btn) {
  stopPlayerIf((src) => src.kind === 'card' && src.mount === state.mount);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Fixing…';
  }
  try {
    await api.card.fixOrder(state.mount);
    toast('Play order fixed. Everything on the card is now in order.', 'success');
  } catch (err) {
    showError(err);
  }
  refreshCard();
}

async function ejectCard() {
  const drive = currentDrive();
  if (!drive) return;
  const btn = $('#ejectBtn');
  stopPlayerIf((src) => src.kind === 'card' && src.mount === drive.mount);
  btn.disabled = true;
  try {
    const msg = await api.drives.eject(drive.mount);
    await confirmBox({ title: 'SD card ejected', text: `${msg} Put it back in the headphones and enjoy!`, ok: 'OK', cancel: null });
  } catch (err) {
    await confirmBox({ title: 'Could not eject the SD card', text: err.message, ok: 'OK', cancel: null });
  } finally {
    btn.disabled = false;
  }
}

function onDrivesChanged(list) {
  state.drives = list;
  const all = [...list, ...state.manualDrives];
  if (!all.some((d) => d.mount === state.mount)) {
    const preferred = all.find((d) => d.mount === state.settings.lastMount) || all[0];
    state.mount = preferred ? preferred.mount : null;
    state.card = null;
  }
  if (state.mount) api.settings.set({ lastMount: state.mount }).catch(() => {});
  renderDrivePanel();
  refreshCard();
}

// =========================================================================
// Downloads
// =========================================================================

function renderDownloads() {
  const s = state.downloads;
  const active = s.jobs.filter((j) => ['queued', 'downloading', 'copying', 'waiting'].includes(j.status));
  $('#dlCount').textContent = active.length ? String(active.length) : '';

  // Sidebar mini progress
  const mini = $('#miniProgress');
  if (active.length) {
    mini.hidden = false;
    mini.replaceChildren(
      el('strong', {}, `Adding ${active.length} ${active.length === 1 ? 'book' : 'books'}…`),
      el('div', { class: 'progress', style: { width: '100%' } }, el('span', { style: { width: `${(s.queueProgress * 100).toFixed(1)}%` } })),
      el('span', { class: 'muted' }, fmtEta(s.queueEta)));
    mini.onclick = () => showView('downloads');
  } else {
    mini.hidden = true;
  }

  const root = $('#downloadsView');
  const parts = [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Downloads'), el('p', {}, 'Books are downloaded from the internet, then copied to the SD card in the right order.')),
      s.jobs.some((j) => ['done', 'error', 'cancelled'].includes(j.status))
        ? el('button', { class: 'btn btn-secondary', onclick: () => api.downloads.clear() }, 'Clear finished')
        : null),
  ];

  if (active.length) {
    parts.push(
      el('div', { class: 'summary-card' },
        el('div', { class: 'summary-top' },
          el('strong', {}, `${active.length} ${active.length === 1 ? 'book' : 'books'} to go`),
          el('span', { class: 'muted' }, fmtEta(s.queueEta))),
        el('div', { class: 'progress' }, el('span', { style: { width: `${(s.queueProgress * 100).toFixed(1)}%` } })),
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: state.autoEject, onchange: (e) => { state.autoEject = e.target.checked; api.downloads.setAutoEject(state.autoEject); } }),
          'Eject the SD card automatically when everything is finished'))
    );
  }

  if (!s.jobs.length) {
    parts.push(el('div', { class: 'state' }, el('h3', {}, 'Nothing downloading'), el('div', {}, 'Books you add to the SD card will show up here while they download.'),
      el('button', { class: 'btn btn-primary', onclick: () => showView('browse') }, 'Find audiobooks')));
  } else {
    parts.push(el('div', { class: 'list' }, [...s.jobs].reverse().map(jobRow)));
  }
  root.replaceChildren(...parts);
}

function jobRow(j) {
  const total = j.totalBytes || 1;
  let pct = 0;
  let numbers = '';
  const dlShare = j.toCard ? 50 : 100;
  if (j.status === 'downloading') {
    pct = (j.downloaded / total) * dlShare;
    numbers = `Downloaded ${fmtBytes(j.downloaded)} of ${fmtBytes(j.totalBytes)}${state.downloads.dlSpeed ? ` · ${fmtBytes(state.downloads.dlSpeed)}/s` : ''} · ${fmtEta(j.eta)}`;
  } else if (j.status === 'copying') {
    pct = 50 + (j.copied / total) * 50;
    numbers = `Copied ${fmtBytes(j.copied)} of ${fmtBytes(j.totalBytes)} · ${fmtEta(j.eta)}`;
  } else if (j.status === 'waiting') {
    pct = 50;
  } else if (j.status === 'done') {
    pct = 100;
    numbers = `${j.chapterCount} chapters · ${fmtBytes(j.totalBytes)}`;
  } else if (j.status === 'queued') {
    numbers = `${j.chapterCount} chapters · ${fmtBytes(j.totalBytes)} · waiting for the book above to finish`;
  }

  const actions = [];
  if (['queued', 'downloading', 'copying', 'waiting'].includes(j.status)) {
    actions.push(el('button', { class: 'btn btn-secondary btn-small', onclick: () => api.downloads.cancel(j.id) }, icon('x'), 'Cancel'));
  } else if (['error', 'cancelled'].includes(j.status)) {
    actions.push(el('button', { class: 'btn btn-primary btn-small', onclick: () => api.downloads.retry(j.id) }, icon('retry'), 'Try again'));
  }

  return el('div', { class: `row job ${j.status}` },
    coverEl(j.identifier, j.title, j.author),
    el('div', {},
      el('div', { class: 'row-title' }, j.title),
      el('div', { class: 'status' },
        j.status === 'done' ? el('span', { style: { color: 'var(--ok)', fontWeight: 600 } }, j.toCard ? '✓ On the SD card' : '✓ Saved on this computer') : j.message),
      ['downloading', 'copying', 'waiting', 'done'].includes(j.status)
        ? el('div', { class: 'progress' }, el('span', { style: { width: `${pct.toFixed(1)}%` } }))
        : null,
      numbers ? el('div', { class: 'numbers' }, numbers) : null,
      j.error ? el('div', { class: 'job-error' }, j.error) : null),
    el('div', { class: 'row-actions' }, actions));
}

let lastDoneCount = 0;
function onDownloadsChanged(snap) {
  state.downloads = snap;
  renderDownloads();
  const done = snap.jobs.filter((j) => j.status === 'done').length;
  if (done !== lastDoneCount) {
    lastDoneCount = done;
    refreshBadges();
  }
  // keep the "being added" segment of the usage bar current
  if (state.card) {
    const pending = snap.jobs
      .filter((j) => j.mount === state.mount && ['queued', 'downloading', 'copying', 'waiting'].includes(j.status))
      .reduce((a, j) => a + (j.totalBytes - j.copied), 0);
    if (pending !== state.card.pendingBytes) {
      state.card.pendingBytes = pending;
      renderUsage();
    }
  }
}

// =========================================================================
// Views + startup
// =========================================================================

function showView(name) {
  state.view = name;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === name);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
  if (name === 'card') refreshCard();
  if (name === 'library') refreshLocal();
  if (name === 'starred') renderStarred();
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

async function init() {
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showView(t.dataset.view));
  $('#ejectBtn').addEventListener('click', ejectCard);
  $('#refreshBtn').addEventListener('click', () => loadCatalog(state.sourceId, true));
  $('#search').addEventListener('input', debounce((e) => { state.query = e.target.value; applyFilters(); }, 200));
  $('#browseScroller').addEventListener('click', (e) => {
    const more = e.target.closest('[data-see-all]');
    if (more) seeAll(more.dataset.seeAll, more.dataset.sort);
  });
  $('#lang').addEventListener('change', (e) => {
    state.lang = e.target.value;
    api.settings.set({ language: state.lang });
    applyFilters();
  });
  $('#show').addEventListener('change', (e) => {
    state.show = e.target.value;
    api.settings.set({ show: state.show });
    applyFilters();
  });
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    api.settings.set({ sort: state.sort });
    applyFilters();
  });
  new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.shown < state.filtered.length) renderMore();
    },
    { root: $('#browseScroller'), rootMargin: '600px' }
  ).observe($('#sentinel'));
  $('#bookDialog').addEventListener('close', () => { state.dialogBook = null; bookReq++; });
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click backdrop to close
  }

  api.catalog.onProgress((p) => {
    if (p.sourceId === state.sourceId && state.loading === p.sourceId) renderLoading(p);
  });
  api.catalog.onUpdated(async ({ sourceId }) => {
    delete state.catalogs[sourceId];
    if (sourceId === state.sourceId && !$('#search').value) await loadCatalog(sourceId);
  });
  api.drives.onChange(onDrivesChanged);
  api.card.onChanged(({ mount }) => { if (mount === state.mount) refreshCard(); });
  api.downloads.onChange(onDownloadsChanged);
  api.card.onVerifyProgress((p) => {
    if (!state.verifying || p.mount !== state.mount) return;
    state.verifying = p;
    if (state.view === 'card') renderCardView();
  });
  api.onNotice(({ kind, text }) => toast(text, kind));
  api.library.onChange(({ key, entry }) => {
    state.lib[key] = entry;
    updateStarCount();
    if (state.view === 'library') renderLibrary();
  });
  api.local.onChange(() => refreshLocal());

  state.settings = await api.settings.get();
  state.sourceId = state.settings.source || 'librivox';
  state.lang = state.settings.language ?? 'eng'; // English on first launch, then whatever was chosen last
  state.sort = state.settings.sort || 'popular';
  $('#sort').value = state.sort;
  state.show = state.settings.show || 'all';
  $('#show').value = state.show;
  state.lib = await api.library.state();
  updateStarCount();
  initPlayer();
  refreshLocal();
  state.sources = await api.catalog.sources();
  state.genres = await api.catalog.genres();
  $('#settingsBtn').addEventListener('click', openSettings);
  renderSources();
  renderDrivePanel();
  renderCardView();
  onDownloadsChanged(await api.downloads.state());
  onDrivesChanged(await api.drives.list());
  await loadCatalog(state.sourceId);
}

// library.js and player.js load after this file, so start once the page is ready.
window.addEventListener('DOMContentLoaded', () => init().catch(showError));
