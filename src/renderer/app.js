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

// Podcast artwork lives on each publisher's site, so remember it by id.
const covers = new Map();
function rememberCover(id, url) {
  if (id && typeof url === 'string' && /^https:\/\//.test(url)) covers.set(id, url);
}
const isPodcastId = (id) => /^pod(apple)?-/.test(id || '');

const COVER_COLORS = ['#1f6f6b', '#8a4b2a', '#3e5a8a', '#6b4a7a', '#4d6b2f', '#8a3a4a', '#2f5d6b', '#7a5d1f'];
function coverEl(id, title, author) {
  const color = COVER_COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COVER_COLORS.length];
  const wrap = el('div', { class: 'cover', style: { background: color } });
  const fallback = el('div', { class: 'cover-fallback' }, title || '', author ? el('small', {}, author) : null);
  const url = covers.get(id) || (id && !isPodcastId(id) ? `https://archive.org/services/img/${encodeURIComponent(id)}` : null);
  const src = url && `cover://img/${encodeURIComponent(url)}`; // saved on disk by the main process (covers.js)
  // The title shows until the picture arrives (or if it never does), then the picture covers it.
  wrap.append(fallback);
  if (src) {
    wrap.classList.add('loading');
    const done = () => wrap.classList.remove('loading');
    const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async', onload: done, onerror: () => { done(); img.remove(); } });
    wrap.append(img);
  }
  return wrap;
}

/** Make a row's cover or title open the book's details window (description, rating, chapters…). */
function toDetails(node, id, item) {
  if (!id) return node; // e.g. folders copied to the card by hand
  node.classList.add('to-details');
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.title = 'Show details';
  const open = () => openBook(id, item);
  node.addEventListener('click', open);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return node;
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

// ------------------------------------------------------------ tooltips
// The built-in tooltips take over a second to appear (and sometimes don't), so
// any element with a title gets this quicker one instead. It's a popover, so it
// also shows above open dialogs.

const TIP_DELAY_MS = 250;
let tipEl = null;
let tipFor = null;
let tipTimer = null;

/** Set an element's tooltip text, whether or not it has been shown yet. */
function setTip(node, text) {
  if (node.hasAttribute('data-tip')) node.dataset.tip = text;
  else node.title = text;
  if (tipFor === node && tipEl) tipEl.textContent = text;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  if (tipEl?.matches(':popover-open')) tipEl.hidePopover();
}

function showTip(target) {
  if (!target.isConnected || !target.dataset.tip) return;
  if (!tipEl) tipEl = document.body.appendChild(el('div', { class: 'tip', role: 'tooltip', popover: 'manual' }));
  tipEl.textContent = target.dataset.tip;
  tipEl.showPopover();
  const r = target.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  const below = r.bottom + 8;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${below + t.height > innerHeight - 8 ? r.top - t.height - 8 : below}px`;
}

document.addEventListener('mouseover', (e) => {
  const target = e.target.closest?.('[title], [data-tip]');
  if (target === tipFor) return;
  hideTip();
  if (!target) return;
  if (target.hasAttribute('title')) {
    // move the text so the slow built-in tooltip doesn't also appear; keep it for screen readers
    const text = target.title;
    target.removeAttribute('title');
    target.dataset.tip = text;
    if (!target.hasAttribute('aria-label') && !target.textContent.trim()) target.setAttribute('aria-label', text);
    else if (!target.hasAttribute('aria-description')) target.setAttribute('aria-description', text);
  }
  if (!target.dataset.tip) return;
  tipFor = target;
  tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
});
document.addEventListener('mousedown', hideTip, true);
document.addEventListener('scroll', hideTip, true);
document.addEventListener('keydown', hideTip, true);
window.addEventListener('blur', hideTip);

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
  fetching: {}, // sourceId -> { loaded, total } while a list downloads
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

// Icon and short description for each source card
const SOURCE_STYLE = {
  librivox: {
    tagline: 'Classic books, read aloud',
    path: 'M12 6.5C10.3 5 7.8 4.3 4 4.5v13c3.6-.2 6.1.5 8 2 1.9-1.5 4.4-2.2 8-2v-13c-3.8-.2-6.3.5-8 2zm-1 10.6c-1.7-.9-3.7-1.3-5-1.3V6.5c2 0 3.6.5 5 1.4zm7-1.3c-1.3 0-3.3.4-5 1.3V7.9c1.4-.9 3-1.4 5-1.4z',
  },
  community: {
    tagline: 'Shared by listeners',
    path: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm-4 4c.3-.9 2-2 4-2s3.7 1.1 4 2zm12-4c-.6 0-1.2.1-1.7.2.9.9 1.7 2.1 1.7 3.8v2h4v-2c0-2.2-1.8-4-4-4z',
  },
  otr: {
    tagline: '1930s–50s shows',
    path: 'M20 6H8.3l8.3-3.4-.8-1.8L3.2 6.1A2 2 0 0 0 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM7 20a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm13-8h-2v-2h-2v2H4V8h16z',
  },
  live: {
    label: 'Live Music',
    tagline: 'Concert recordings',
    path: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3zm-2 16a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  },
  lectures: {
    label: 'Lectures',
    tagline: 'Talks & speeches',
    path: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l1 3h2v2H7v-2h2l1-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h16V6zm3 2h6v2H7zm0 3h10v2H7z',
  },
  '78s': {
    tagline: 'Songs, 1900s–50s',
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 0 0-6 6h2a4 4 0 0 1 4-4zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  },
  podcasts: {
    tagline: 'Shows & episodes',
    path: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z',
  },
};

const SOURCE_SHORT = { librivox: 'Audiobooks', community: 'More Audiobooks', otr: 'Old Time Radio', live: 'Live Music', lectures: 'Lectures', '78s': 'Vintage Music', podcasts: 'Podcast' };

/** What one item of a source is called, and whether it's read or heard. */
const SOURCE_NOUN = { otr: ['show', 'shows'], live: ['concert', 'concerts'], lectures: ['talk', 'talks'], '78s': ['song', 'songs'] };
const noun = (n = 2, id = state.sourceId) => (SOURCE_NOUN[id] || ['book', 'books'])[n === 1 ? 0 : 1];
const isMusic = (id = state.sourceId) => !!state.sources.find((s) => s.id === id)?.music;
let sourceIndex = null; // id -> source, built from loaded catalogs

/** Which source an item came from: podcast ids, the saved source, or the loaded catalogs. */
function sourceOf(id, hint) {
  if (isPodcastId(id)) return 'podcasts';
  if (hint && SOURCE_SHORT[hint] && hint !== 'podcasts') return hint;
  if (!id) return null;
  if (!sourceIndex || sourceIndex.size === 0) {
    sourceIndex = new Map();
    for (const [src, data] of Object.entries(state.catalogs)) for (const it of data.items) if (!sourceIndex.has(it.id)) sourceIndex.set(it.id, src);
  }
  return sourceIndex.get(id) || (/librivox/i.test(id) ? 'librivox' : null);
}

/** Small coloured tag with the source's icon and name. */
function sourceTag(id, hint) {
  const src = sourceOf(id, hint);
  if (!src) return null;
  const svg = sourceIcon(src);
  return el('span', { class: `src-tag src-${src}`, title: `From ${state.sources.find((s) => s.id === src)?.name || SOURCE_SHORT[src]}` }, svg, SOURCE_SHORT[src]);
}

function sourceIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', SOURCE_STYLE[id]?.path || ICONS.play);
  svg.append(p);
  return svg;
}

/** "Show" filter options worded for the current source. */
function showOptions(id) {
  if (id === 'podcasts') return [['all', 'All podcasts'], ['starred', 'Following'], ['hidden', 'Not interested']];
  const [notYet, already] = SOURCE_NOUN[id] ? ['Not heard yet', 'Already heard'] : ['Not read yet', 'Already read'];
  return [['all', `All ${noun(2, id)}`], ['starred', 'Starred'], ['unread', notYet], ['read', already], ['hidden', 'Not interested']];
}

function renderShowOptions() {
  const opts = showOptions(state.sourceId);
  if (!opts.some(([v]) => v === state.show)) {
    state.show = 'all';
    api.settings.set({ show: 'all' }).catch(() => {});
  }
  $('#show').replaceChildren(...opts.map(([value, label]) => el('option', { value, selected: value === state.show }, label)));
}

/** Sources are shown as compact tabs in groups, so they wrap a group at a time on narrow windows. */
const SOURCE_GROUPS = [
  ['Audiobooks', ['librivox', 'community']],
  ['Radio & talks', ['otr', 'lectures', 'podcasts']],
  ['Music', ['live', '78s']],
];

function renderSources() {
  renderShowOptions();
  const tab = (s) =>
    el(
      'button',
      {
        class: `source ${s.id === state.sourceId ? 'active' : ''}`,
        role: 'tab',
        dataset: { source: s.id, baseTip: s.blurb || SOURCE_STYLE[s.id]?.tagline || '' },
        'aria-selected': String(s.id === state.sourceId),
        title: s.blurb || SOURCE_STYLE[s.id]?.tagline || '',
        onclick: () => selectSource(s.id),
      },
      el('span', { class: 'source-icon' }, sourceIcon(s.id)),
      el('span', { class: 'source-name' }, SOURCE_STYLE[s.id]?.label || s.name)
    );
  const grouped = new Set(SOURCE_GROUPS.flatMap(([, ids]) => ids));
  const groups = SOURCE_GROUPS.map(([label, ids]) => [label, ids.map((id) => state.sources.find((s) => s.id === id)).filter(Boolean)]);
  const rest = state.sources.filter((s) => !grouped.has(s.id));
  if (rest.length) groups.push(['More', rest]);
  $('#sources').replaceChildren(
    ...groups
      .filter(([, list]) => list.length)
      .map(([label, list]) => el('div', { class: 'source-group', role: 'group', 'aria-label': label }, list.map(tab)))
  );
  for (const [id, p] of Object.entries(state.fetching)) showFetching(id, p);
  const src = state.sources.find((s) => s.id === state.sourceId);
  $('#sourceBlurb').textContent = src?.blurb || '';
}

/** A thin progress line on a source's tab while its list downloads (also in the background). */
function showFetching(id, p) {
  if (p && p.total && p.loaded >= p.total) p = null;
  if (p) state.fetching[id] = p;
  else delete state.fetching[id];
  const tab = document.querySelector(`.source[data-source="${CSS.escape(id)}"]`);
  if (!tab) return;
  tab.classList.toggle('fetching', !!p);
  tab.style.setProperty('--pct', p && p.total ? `${Math.max(4, Math.min(100, (p.loaded / p.total) * 100))}%` : '4%');
  const base = tab.dataset.baseTip;
  setTip(tab, p ? `${base} (getting the list${p.total ? `: ${Math.round((p.loaded / p.total) * 100)}%` : ''})` : base);
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
  $('#lang').closest('label').hidden = id === 'podcasts';
  $('#search').placeholder = id === 'podcasts' ? 'Search podcasts by name or topic…' : 'Search by title, author or subject…';
  if (id === 'podcasts') {
    state.loading = null;
    $('#grid').replaceChildren();
    $('#shelves').replaceChildren();
    $('#loadState').replaceChildren();
    renderPodcasts(force);
    return;
  }
  // Clear everything from the previous source so its books, genre counts and
  // language counts don't show while this source's list is loading.
  $('#grid').replaceChildren();
  $('#shelves').replaceChildren();
  $('#genres').replaceChildren();
  $('#resultCount').textContent = '';
  state.filtered = [];
  state.shown = 0;
  if (!state.catalogs[id] || force) {
    $('#lang').replaceChildren(el('option', { value: '' }, 'Loading…'));
    renderLoading(null);
  }
  try {
    const data = state.catalogs[id] && !force ? state.catalogs[id] : prepareCatalog(await api.catalog.load(id, force));
    state.catalogs[id] = data;
    sourceIndex = null;
    if (state.sourceId !== id) return;
    state.loading = null;
    // each source has its own genres (live music's are its bands)
    state.genres = data.genres || [];
    if (!['home', 'all'].includes(state.genre) && !state.genres.some((g) => g.id === state.genre)) state.genre = 'home';
    renderLangs();
    applyFilters();
  } catch (err) {
    if (state.sourceId !== id) return;
    state.loading = null;
    $('#loadState').replaceChildren(
      el('div', { class: 'state' },
        el('h3', {}, `The list of ${noun()} could not be loaded`),
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
      el('h3', {}, `Getting the list of ${noun()}…`),
      el('div', {}, p && p.total ? `${p.loaded.toLocaleString()} of ${p.total.toLocaleString()} ${noun()}` : 'This only takes a while the first time. After that it opens instantly.'),
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
  // Hide the filter when most items don't say their language (live music, many talks):
  // choosing English would hide them all.
  const known = data.langs.reduce((a, [, n]) => a + n, 0);
  const useLang = known >= data.items.length * 0.7;
  sel.closest('label').hidden = !useLang;
  sel.value = !useLang ? '' : state.lang && has(state.lang) ? state.lang : has('eng') && state.lang ? 'eng' : '';
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
  if (state.sourceId === 'podcasts') {
    renderPodcasts();
    return;
  }
  const data = state.catalogs[state.sourceId];
  if (!data) return;
  const lang = $('#lang').value;
  const terms = fold(state.query).split(/\s+/).filter(Boolean);
  let items = data.items;
  if (lang) items = items.filter((it) => it.lk === lang);
  if (terms.length) items = items.filter((it) => terms.every((t) => it.hay.includes(t)));
  const show = state.show;
  // Items kept off the shelves (see src/main/shelf-rules.js) only show up when searched for,
  // or in the person's own Starred / heard / hidden lists.
  if (!terms.length && show === 'all') items = items.filter((it) => !it.offShelf);
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
    $('#resultCount').textContent = `${items.length.toLocaleString()} ${noun(items.length)} · list updated ${fmtAgo(data.fetchedAt)}`;
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
  $('#resultCount').textContent = `${state.filtered.length.toLocaleString()} ${noun(state.filtered.length)} · list updated ${fmtAgo(data.fetchedAt)}`;
  if (!state.filtered.length) {
    $('#loadState').replaceChildren(
      el('div', { class: 'state' }, el('h3', {}, `No ${noun()} match`),
        el('div', {}, state.show === 'all' ? 'Try a different search word, or choose "All languages".' : `Try a different search word, or set "Show" to "All ${noun()}".`))
    );
  } else {
    $('#loadState').replaceChildren();
    renderMore();
  }
}

/** Badges on a cover: drive / downloading / on computer / read, a star, and listening progress. */
function decorateCover(cover, id, onCard, queued) {
  cover.querySelectorAll('.badge, .star-mark, .cover-progress').forEach((n) => n.remove());
  const e = state.lib[id] || {};
  let badge = null;
  const cb = onCard.has(id) ? cardBook(id) : null;
  if (state.podNew?.has(id)) badge = el('span', { class: 'badge new' }, 'New episodes'); // followed podcast with new episodes
  else if (cb && (!cb.complete || cb.check?.status === 'problem')) badge = el('span', { class: 'badge warn', title: 'Click "Show drive contents" to repair it' }, 'Check drive');
  else if (cb && cb.check?.status === 'ok') badge = el('span', { class: 'badge', title: `Checked: every ${cb.unit || 'chapter'} matches the original` }, 'On drive ✓');
  else if (cb) badge = el('span', { class: 'badge' }, 'On drive');
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
  // concerts: what kind of recording and who taped it, since a show is often listed several times
  const meta = it.metaText || [fmtRating(it.rating), fmtRuntime(it.runtime), it.rec, it.taper, state.lang ? '' : langName(it.lk)].filter(Boolean).join(' · ');
  return el(
    'button',
    { class: 'book', dataset: { id: it.id }, onclick: () => openBook(it.id, it) },
    cover,
    el('div', { class: 'book-title' }, it.title),
    el('div', { class: 'book-author' }, it.author || 'Unknown author'),
    it.showSource ? el('div', { class: 'book-source' }, sourceTag(it.id, it.source)) : null,
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
          el('div', { class: 'state', style: { padding: '30px 0' } }, el('div', { class: 'progress indeterminate' }, el('span')), `Getting ${unitForSource(sourceOf(id, item?.source) || state.sourceId)} list…`))))
  );
  if (!dlg.open) dlg.showModal();
  try {
    // Standard quality is made for speech; music starts on High (it can still be changed per title)
    const details = await api.catalog.details(id, isMusic(sourceOf(id, item?.source) || state.sourceId) ? 'high' : state.settings.quality);
    if (req !== bookReq || !dlg.open) return;
    renderBook(details);
  } catch (err) {
    if (req !== bookReq) return;
    dlg.querySelector('.state').replaceChildren(el('div', {}, err.message), el('button', { class: 'btn btn-primary', onclick: () => openBook(id, item) }, 'Try again'));
  }
}

function fitInfo(bytes) {
  const drive = currentDrive();
  if (!drive) return { ok: false, text: 'Plug in the drive to put this on it.', noCard: true };
  const pending = state.card?.pendingBytes || 0;
  const free = (state.card?.free ?? drive.free) - pending;
  if (bytes <= free) return { ok: true, text: `Fits on the drive (${fmtBytes(free - bytes)} will be left).`, free };
  const local = ' You can still save it to this computer.';
  // Even removing every audiobook wouldn't free enough space
  const mostPossible = free + (state.card?.booksSize || 0);
  if (bytes > mostPossible) {
    return {
      ok: false,
      tooBig: true,
      text: `Too big for this drive: needs ${fmtBytes(bytes)}, but the drive can hold at most ${fmtBytes(Math.max(0, mostPossible))} of audiobooks.${local}`,
      free,
      shortBy: bytes - free,
    };
  }
  return {
    ok: false,
    text: `Too big for the drive right now: needs ${fmtBytes(bytes)}, but the drive only has ${fmtBytes(Math.max(0, free))} free.${local}`,
    free,
    shortBy: bytes - free,
  };
}

/** Star / Read / Not interested toggle buttons for a book. */
function statusButtons(key, meta, rerender, podcast = false) {
  const e = libEntry(key);
  const heard = !!SOURCE_NOUN[meta.source]; // radio, music and talks are heard, not read
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
    toggle(podcast ? (e.starred ? 'Following' : 'Follow') : e.starred ? 'Starred' : 'Star', e.starred ? 'star' : 'starOutline', !!e.starred, { starred: !e.starred }),
    toggle(e.status === 'read' ? (heard ? 'Heard' : 'Read') : heard ? 'Mark as heard' : 'Mark as read', 'check', e.status === 'read', { status: e.status === 'read' ? null : 'read' }),
    toggle('Not interested', 'ban', e.status === 'not_interested', { status: e.status === 'not_interested' ? null : 'not_interested' }));
}

/** Re-draw the open book dialog after the card, library or downloads change. */
function refreshBookDialog() {
  if ($('#bookDialog').open && state.dialogBook) renderBook(state.dialogBook);
}

// ------------------------------------------------------------ chapters / episodes

const unitWord = (d, n = 2) => (d.unit || 'chapter') + (n === 1 ? '' : 's');
/** What a source's parts are called, before an item's details have loaded. */
const unitForSource = (src) => (src === 'podcasts' || src === 'otr' ? 'episode' : state.sources.find((s) => s.id === src)?.unit || 'chapter');
const UnitTitle = (d) => unitWord(d).replace(/^./, (c) => c.toUpperCase());

/** Track numbers of a book that are on the plugged-in card (across all its folders). */
function numbersOnCard(identifier) {
  const set = new Set();
  for (const b of state.card?.books || []) {
    if (b.identifier !== identifier) continue;
    if (b.trackNumbers) b.trackNumbers.forEach((n) => set.add(n));
    else for (let i = 1; i <= (b.trackTotal || b.chapters); i++) set.add(i);
  }
  return set;
}

function numbersSaved(identifier) {
  return new Set(localBook(identifier)?.numbers || []);
}

function numbersQueued(identifier, toCard) {
  const set = new Set();
  for (const j of state.downloads.jobs) {
    if (j.identifier !== identifier || j.toCard !== toCard || (toCard && j.mount !== state.mount)) continue;
    if (['queued', 'downloading', 'copying', 'waiting'].includes(j.status)) (j.numbers || []).forEach((n) => set.add(n));
  }
  return set;
}

/**
 * Pick the next run of tracks that fits in the card's free space, starting
 * after the last one copied before (or the highest one on the card).
 * Without a card, picks the next 50.
 */
function selectNextThatFit(d, sel) {
  const onCard = numbersOnCard(d.identifier);
  const last = Math.max(libEntry(d.identifier).lastCopied || 0, ...onCard, 0);
  let start = d.tracks.findIndex((t) => t.number > last);
  if (start < 0) start = 0; // finished the series: start over
  const fit = fitInfo(0);
  const budget = fit.noCard ? Infinity : Math.max(0, (fit.free || 0) - 5 * 1024 * 1024);
  sel.numbers = new Set();
  let used = 0;
  for (let i = start; i < d.tracks.length; i++) {
    const t = d.tracks[i];
    if (onCard.has(t.number)) continue;
    if (fit.noCard ? sel.numbers.size >= 50 : used + t.size > budget) break;
    sel.numbers.add(t.number);
    used += t.size;
  }
}

/** Podcasts: the newest episodes not on the card yet that fit (10 when there's no card). */
function selectNewestThatFit(d, sel) {
  const onCard = numbersOnCard(d.identifier);
  const fit = fitInfo(0);
  const budget = fit.noCard ? Infinity : Math.max(0, (fit.free || 0) - 5 * 1024 * 1024);
  sel.numbers = new Set();
  let used = 0;
  for (let i = d.tracks.length - 1; i >= 0; i--) {
    const t = d.tracks[i];
    if (onCard.has(t.number)) continue;
    if (fit.noCard ? sel.numbers.size >= 10 : used + t.size > budget) break;
    sel.numbers.add(t.number);
    used += t.size;
  }
}

function renderBook(d) {
  const dlg = $('#bookDialog');
  const podcast = d.kind === 'podcast';
  const episodic = d.unit === 'episode';
  // Episode list order, remembered per show: podcasts default to newest first,
  // radio series to oldest first. (Display only: numbers and card order don't change.)
  const order = episodic ? libEntry(d.identifier).episodeOrder || (podcast ? 'newest' : 'oldest') : 'oldest';
  state.dialogBook = d;
  const id = d.identifier;
  const total = d.tracks.length;
  const meta = { title: d.title, author: d.author, source: d.source || state.sourceId, runtime: d.kind === 'podcast' ? undefined : d.runtime, identifier: id };
  const loc = localBook(id);
  const pos = libEntry(id).position;
  const onCardNums = numbersOnCard(id);
  const savedNums = numbersSaved(id);
  const allOnCard = total > 0 && d.tracks.every((t) => onCardNums.has(t.number));
  const cardPartial = onCardNums.size > 0 && !allOnCard;
  const fitWhole = fitInfo(d.totalBytes);
  const byNumber = new Map(d.tracks.map((t) => [t.number, t]));

  // Selection mode: pick a batch of chapters/episodes. Turned on automatically
  // when the whole thing won't fit, is already partly on the card, or is huge.
  if (!state.sel || state.sel.id !== id) state.sel = { id, mode: false, numbers: new Set(), anchor: null, auto: false };
  const sel = state.sel;
  if (podcast && !sel.seen) {
    // opening a podcast marks its episodes as seen (clears "New episodes") and remembers its artwork
    sel.seen = true;
    rememberCover(id, d.cover);
    state.podNew?.delete(id);
    setLib(id, { seenUpTo: d.newest || 0, image: d.cover || undefined }, meta).then(refreshBadges).catch(() => {});
  }
  if (!sel.auto && total > 1 && (podcast || cardPartial || (!fitWhole.ok && !fitWhole.noCard) || total > 300)) {
    sel.auto = true;
    sel.mode = true;
    order === 'newest' ? selectNewestThatFit(d, sel) : selectNextThatFit(d, sel);
  }

  const desc = el('div', { class: 'description' }, d.description || 'No description available.');
  let moreBtn = null;
  if ((d.description || '').length > 500) {
    desc.classList.add('clamped');
    moreBtn = el('button', { class: 'link', onclick: () => { desc.classList.remove('clamped'); moreBtn.remove(); } }, 'Show more');
  }

  const facts = el('dl', { class: 'facts' });
  const addFact = (k, v) => v && facts.append(el('dt', {}, k), el('dd', {}, v));
  if (d.recording) addFact('Recording', d.recording);
  if (d.rating) addFact('Rating', `${'★'.repeat(Math.round(d.rating))}${'☆'.repeat(5 - Math.round(d.rating))}  ${d.rating.toFixed(1)} (${d.reviews} ${d.reviews === 1 ? 'review' : 'reviews'} on archive.org)`);
  addFact('Length', fmtRuntime(d.runtime));
  addFact(UnitTitle(d), total ? total.toLocaleString() : 'No MP3 files');
  addFact('Download size', d.totalBytes ? fmtBytes(d.totalBytes) : '');
  if (d.language) addFact('Language', langName(langKey(d.language)));
  addFact(podcast ? 'Newest episode' : 'Published', d.date);
  if (onCardNums.size) addFact('On the drive', allOnCard ? `All ${unitWord(d)}` : `${onCardNums.size.toLocaleString()} of ${total.toLocaleString()} ${unitWord(d)}`);
  if (savedNums.size) addFact('On this computer', savedNums.size >= total ? `All ${unitWord(d)}` : `${savedNums.size.toLocaleString()} of ${total.toLocaleString()} ${unitWord(d)}`);

  let quality = null;
  if (d.sizes.standard && d.sizes.high && d.sizes.standard !== d.sizes.high) {
    const opt = (value, label, hint) =>
      el('label', {},
        el('input', { type: 'radio', name: 'quality', value, checked: d.quality === value, onchange: () => changeQuality(id, value) }),
        el('span', {}, label, el('small', {}, hint)));
    quality = el('div', {},
      el('h3', {}, 'Sound quality'),
      el('div', { class: 'quality' },
        ...(isMusic(d.source)
          ? [opt('standard', `Standard — ${fmtBytes(d.sizes.standard)}`, 'Smaller files, but music loses some of its sound.'),
            opt('high', `High — ${fmtBytes(d.sizes.high)}`, 'Recommended for music.')]
          : [opt('standard', `Standard — ${fmtBytes(d.sizes.standard)}`, 'Recommended. Sounds great for spoken word and fits about twice as much.'),
            opt('high', `High — ${fmtBytes(d.sizes.high)}`, 'Bigger files. Only needed for very good headphones.')])));
  }

  // ---- chapter / episode list
  const list = el('ol', { class: `chapters ${sel.mode ? 'selectable' : ''}` },
    (order === 'newest' ? [...d.tracks].reverse() : d.tracks).map((t) =>
      el('li', { dataset: { n: t.number } },
        sel.mode ? el('input', { type: 'checkbox', checked: sel.numbers.has(t.number), tabindex: -1, 'aria-label': `Select ${t.title}` }) : null,
        el('span', { class: 'n' }, t.number),
        el('span', { class: 't' }, t.title,
          podcast && t.date ? el('span', { class: 'ep-date' }, new Date(t.date * 1000).toLocaleDateString()) : null,
          onCardNums.has(t.number) ? el('span', { class: 'tag ok' }, 'On drive') : null,
          savedNums.has(t.number) ? el('span', { class: 'tag muted' }, 'Saved') : null),
        el('span', { class: 'd' }, fmtClock(t.seconds)))));

  const summary = el('div', { class: 'sel-summary' });
  const syncChecks = () => {
    for (const box of list.querySelectorAll('input[type=checkbox]')) box.checked = sel.numbers.has(Number(box.closest('li').dataset.n));
  };
  const selectionChanged = () => {
    const bytes = [...sel.numbers].reduce((a, n) => a + (byNumber.get(n)?.size || 0), 0);
    const secs = [...sel.numbers].reduce((a, n) => a + (byNumber.get(n)?.seconds || 0), 0);
    const next = d.tracks.find((t) => !onCardNums.has(t.number) && t.number > (libEntry(id).lastCopied || 0));
    const cardFull = !fitWhole.noCard && next && next.size > (fitInfo(0).free || 0) - 5 * 1024 * 1024;
    summary.textContent = sel.numbers.size
      ? `${sel.numbers.size.toLocaleString()} ${unitWord(d, sel.numbers.size)} selected · ${fmtBytes(bytes)}${secs ? ` · ${fmtRuntime(secs)}` : ''}`
      : cardFull
        ? `The drive is full: there isn't room for the next ${unitWord(d, 1)} (${fmtBytes(next.size)}). Remove something from the drive first.`
        : 'Nothing selected yet.';
    footer.replaceWith((footer = buildFooter()));
  };
  list.addEventListener('click', (e) => {
    if (!sel.mode) return;
    const li = e.target.closest('li');
    if (!li) return;
    const n = Number(li.dataset.n);
    const turnOn = !sel.numbers.has(n);
    if (e.shiftKey && sel.anchor != null) {
      // shift-click: apply to the whole range from the last click
      const [a, b] = [sel.anchor, n].sort((x, y) => x - y);
      for (const t of d.tracks) if (t.number >= a && t.number <= b) turnOn ? sel.numbers.add(t.number) : sel.numbers.delete(t.number);
    } else {
      turnOn ? sel.numbers.add(n) : sel.numbers.delete(n);
    }
    sel.anchor = n;
    syncChecks();
    selectionChanged();
  });

  let selBar = null;
  if (sel.mode) {
    const from = el('input', { type: 'number', min: 1, max: total, value: d.tracks[0]?.number || 1, class: 'num' });
    const to = el('input', { type: 'number', min: 1, max: total, value: Math.min(total, 50), class: 'num' });
    const last = libEntry(id).lastCopied;
    selBar = el('div', { class: 'sel-bar' },
      el('div', { class: 'sel-buttons' },
        episodic
          ? el('button', { class: 'btn btn-secondary btn-small', onclick: () => { selectNewestThatFit(d, sel); syncChecks(); selectionChanged(); } },
            fitWhole.noCard ? 'Newest 10' : 'Newest that fit')
          : null,
        el('button', { class: 'btn btn-secondary btn-small', onclick: () => { selectNextThatFit(d, sel); syncChecks(); selectionChanged(); } },
          fitWhole.noCard ? `Select next 50` : 'Select next that fit'),
        el('button', { class: 'btn btn-secondary btn-small', onclick: () => { sel.numbers = new Set(d.tracks.map((t) => t.number)); syncChecks(); selectionChanged(); } }, 'All'),
        el('button', { class: 'btn btn-secondary btn-small', onclick: () => { sel.numbers.clear(); syncChecks(); selectionChanged(); } }, 'None'),
        el('span', { class: 'sel-range' }, 'From', from, 'to', to,
          el('button', {
            class: 'btn btn-secondary btn-small',
            onclick: () => {
              const [a, b] = [Number(from.value), Number(to.value)].sort((x, y) => x - y);
              sel.numbers = new Set(d.tracks.filter((t) => t.number >= a && t.number <= b).map((t) => t.number));
              syncChecks();
              selectionChanged();
            },
          }, 'Select'))),
      last ? el('div', { class: 'hint' }, `Last time you put ${unitWord(d)} up to #${last} on a drive.`) : null,
      el('div', { class: 'hint' }, 'Tip: click one, then Shift-click another to select everything in between.'),
      summary);
  }

  // ---- footer actions
  const buildFooter = () => {
    const parts = [
      d.url ? el('button', { class: 'link', onclick: () => api.openExternal(d.url) }, podcast ? 'Podcast website' : 'View on archive.org') : null,
      el('span', { class: 'spacer' }),
    ];
    const big = (cls, label, onclick, opts = {}) => el('button', { class: `btn ${cls} btn-big`, onclick, ...opts }, label);

    // Listen
    const cb = cardBook(id);
    const playLabel = pos && pos.tracks ? 'Continue listening' : 'Play';
    if (loc) parts.push(big('btn-secondary', [icon('play'), playLabel], () => { dlg.close(); playBook({ kind: 'local', dir: loc.dir }); }));
    else if (cb) parts.push(big('btn-secondary', [icon('play'), playLabel], () => { dlg.close(); playBook({ kind: 'card', mount: state.mount, folder: cb.folder }); }));

    if (!total) {
      parts.push(big('btn-primary', 'No MP3 files available', null, { disabled: true }));
      return el('div', { class: 'dialog-foot' }, parts);
    }

    if (sel.mode) {
      const queuedCard = numbersQueued(id, true);
      const queuedLocal = numbersQueued(id, false);
      const toCard = [...sel.numbers].filter((n) => !onCardNums.has(n) && !queuedCard.has(n)).sort((a, b) => a - b);
      const toSave = [...sel.numbers].filter((n) => !savedNums.has(n) && !queuedLocal.has(n)).sort((a, b) => a - b);
      const bytes = toCard.reduce((a, n) => a + (byNumber.get(n)?.size || 0), 0);
      const saveBytes = toSave.reduce((a, n) => a + (byNumber.get(n)?.size || 0), 0);
      const fit = fitInfo(bytes);
      const sub = (numbers, b) => ({ ...d, numbers, totalBytes: b, base: d }); // a batch of this book
      const word = (n) => `${n.toLocaleString()} ${unitWord(d, n)}`;
      if (sel.numbers.size && toCard.length && !fit.noCard) parts.splice(2, 0, el('span', { class: `fit ${fit.ok ? 'ok' : 'bad'}` }, fit.text));
      parts.push(toSave.length
        ? big('btn-secondary', [icon('computer'), `Save ${word(toSave.length)}`], (e) => saveLocal(sub(toSave, saveBytes), e.currentTarget), { title: 'Download to this computer' })
        : big('btn-secondary', sel.numbers.size ? 'Saved on computer' : 'Save to computer', null, { disabled: true }));
      if (!sel.numbers.size) parts.push(big('btn-primary', 'Choose some first', null, { disabled: true }));
      else if (!toCard.length) parts.push(big('btn-primary', [icon('ok'), 'Already on the drive'], null, { disabled: true }));
      else if (fit.noCard) parts.push(big('btn-primary', [icon('plus'), 'Put on drive'], null, { disabled: true }));
      else if (fit.tooBig) parts.push(big('btn-primary', 'Too many for this drive', null, { disabled: true }));
      else if (!fit.ok) parts.push(big('btn-primary', 'Make room on the drive…', () => openMakeRoom(sub(toCard, bytes))));
      else parts.push(big('btn-primary', [icon('plus'), `Put ${word(toCard.length)} on drive`], (e) => addBook(sub(toCard, bytes), e.currentTarget)));
      return el('div', { class: 'dialog-foot' }, parts);
    }

    // Whole book
    const queued = queuedIds().has(id);
    const savingLocal = numbersQueued(id, false).size > 0;
    if (!queued && !allOnCard) parts.splice(2, 0, el('span', { class: `fit ${fitWhole.ok ? 'ok' : 'bad'}` }, fitWhole.text));
    if (!loc) {
      parts.push(savingLocal
        ? big('btn-secondary', 'Saving to computer…', null, { disabled: true })
        : big('btn-secondary', [icon('computer'), 'Save to computer'], (e) => saveLocal(d, e.currentTarget), { title: 'Download now and listen here, or copy to a drive later' }));
    }
    if (allOnCard && cb && (!cb.complete || cb.check?.status === 'problem')) parts.push(big('btn-primary', [icon('retry'), 'Repair on drive'], () => { dlg.close(); repairBook(cb); }));
    else if (allOnCard) parts.push(big('btn-primary', [icon('ok'), 'Already on the drive'], null, { disabled: true }));
    else if (queued) parts.push(big('btn-primary', 'Downloading now…', null, { disabled: true }));
    else if (fitWhole.noCard) parts.push(big('btn-primary', [icon('plus'), 'Put on drive'], null, { disabled: true }));
    else if (fitWhole.tooBig) parts.push(big('btn-primary', 'Too big for this drive', null, { disabled: true }));
    else if (!fitWhole.ok) parts.push(big('btn-primary', 'Make room on the drive…', () => openMakeRoom(d)));
    else parts.push(big('btn-primary', [icon('plus'), 'Put on drive'], (e) => addBook(d, e.currentTarget)));
    return el('div', { class: 'dialog-foot' }, parts);
  };
  let footer = buildFooter();

  const toggleMode = () => {
    sel.mode = !sel.mode;
    sel.auto = true;
    if (sel.mode && !sel.numbers.size) selectNextThatFit(d, sel);
    renderBook(d);
  };
  const stopped = pos && pos.tracks && libEntry(id).status !== 'read'
    ? el('div', { class: 'muted' }, `You stopped at ${unitWord(d, 1)} ${pos.number ?? pos.track + 1}${pos.number ? '' : ` of ${pos.tracks}`}, ${fmtClock(pos.time)}.`)
    : null;

  dlg.replaceChildren(
    el('button', { class: 'close-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×'),
    el('div', { class: 'dialog-body' },
      el('div', { class: 'detail' },
        el('div', {}, coverEl(id, d.title, d.author),
          d.tags.length ? el('div', { class: 'tags' }, d.tags.slice(0, 8).map((t) => el('span', {}, t))) : null),
        el('div', {},
          el('h2', {}, d.title),
          el('div', { class: 'detail-author' }, d.author || 'Unknown author'),
          statusButtons(id, meta, () => renderBook(d), podcast),
          loc ? el('div', { class: 'fit ok' }, icon('computer'), loc.partial ? ' Partly saved on this computer' : ' Saved on this computer') : null,
          stopped,
          facts,
          d.hiddenEpisodes
            ? el('div', { class: 'notice-inline', style: { marginBottom: '12px' } },
              `${d.hiddenEpisodes} ${d.hiddenEpisodes === 1 ? 'episode is' : 'episodes are'} in a format (like AAC or video) that many headphones can\u2019t play, so ${d.hiddenEpisodes === 1 ? 'it isn\u2019t' : 'they aren\u2019t'} shown.`)
            : null,
          desc, moreBtn,
          quality,
          total
            ? [
                el('div', { class: 'chapters-head' },
                  el('h3', {}, `${UnitTitle(d)} (${total.toLocaleString()})`),
                  el('div', { class: 'chapters-tools' },
                    episodic && total > 1
                      ? el('select', {
                        class: 'order-select',
                        'aria-label': 'Episode order',
                        onchange: (e) => setLib(id, { episodeOrder: e.target.value }, meta).then(() => renderBook(d)).catch(showError),
                      },
                      el('option', { value: 'newest', selected: order === 'newest' }, 'Newest first'),
                      el('option', { value: 'oldest', selected: order === 'oldest' }, 'Oldest first'))
                      : null,
                    total > 1 ? el('button', { class: 'link', onclick: toggleMode }, sel.mode ? `Use all ${unitWord(d)}` : `Choose ${unitWord(d)}…`) : null)),
                selBar,
                list,
              ]
            : null))),
    footer
  );
  if (sel.mode) selectionChanged();
}

async function saveLocal(d, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting…';
  }
  try {
    await api.downloads.add({ identifier: d.identifier, quality: d.quality, source: d.source || state.sourceId, target: 'local', numbers: d.numbers || null });
    toast(`"${d.title}" is being saved to this computer. Find it under My library.`, 'success', { label: 'See progress', run: () => showView('downloads') });
    renderBook(d.base || d);
  } catch (err) {
    showError(err);
    renderBook(d.base || d);
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
    await api.downloads.add({ identifier: d.identifier, quality: d.quality, mount: state.mount, source: d.source || state.sourceId, numbers: d.numbers || null });
    $('#bookDialog').close();
    toast(`"${d.title}" is downloading. It will be copied to the drive automatically.`, 'success', {
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
      if (btn) renderBook(d.base || d);
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
  const go = el('button', { class: 'btn btn-danger', disabled: true }, 'Remove selected and add this');

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
      title: `Remove ${names.length} ${names.length === 1 ? 'title' : 'titles'} from the drive?`,
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
      el('h2', {}, 'Make room on the drive'),
      el('p', { class: 'muted' },
        `"${d.title}" needs ${fmtBytes(d.totalBytes)}, but only ${fmtBytes(Math.max(0, fit.free || 0))} is free. ` +
        'Choose what to remove from the drive:'),
      books.length
        ? el('div', { class: 'room-list' },
          books.map((b) =>
            el('label', { class: 'room-item' },
              el('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? selected.add(b.folder) : selected.delete(b.folder); update(); } }),
              el('span', { class: 't' }, b.title, b.author ? el('span', { class: 'muted' }, ` — ${b.author}`) : null),
              el('span', { class: 's' }, fmtBytes(b.size)))))
        : el('p', {}, 'There are no audiobooks on this drive to remove. The drive is full of other files — try a bigger one, or remove files using your computer.'),
      books.length && books.reduce((a, b) => a + b.size, 0) < shortBy
        ? el('p', { class: 'notice-inline' }, 'Even removing everything this app put on the drive would not free enough space. The rest of the drive is used by other files, so this needs a bigger drive.')
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
// drive (sidebar + "Drive contents" view)
// =========================================================================

function renderDrivePanel() {
  const area = $('#driveArea');
  const all = [...state.drives, ...state.manualDrives];
  const drive = currentDrive();
  $('#ejectBtn').hidden = !drive || drive.manual;
  $('#showDriveBtn').hidden = !drive;

  if (!all.length) {
    area.replaceChildren(
      el('div', { class: 'drive-empty' },
        el('strong', {}, 'No drive found'),
        el('span', { class: 'muted' }, 'Plug in a drive, USB stick or MP3 player. It will show up here automatically.'),
        el('button', { class: 'link', style: { textAlign: 'left' }, onclick: pickFolder }, 'Drive not showing up? Choose it yourself…'))
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
      nodes.push(el('div', { class: 'notice-inline' }, 'This drive is formatted as exFAT. Some headphones and players can only read FAT32. If files won’t play, the drive may need to be reformatted as FAT32.'));
    }
    if (drive.readOnly) nodes.push(el('div', { class: 'notice-inline' }, 'This drive is read-only. If it’s an SD card, slide the lock switch on its adapter up and plug it in again.'));
  }
  nodes.push(el('button', { class: 'link', style: { textAlign: 'left', fontSize: '13px' }, onclick: pickFolder }, 'Use a different drive or folder…'));
  area.replaceChildren(...nodes);
  renderUsage();
}

/** Space used on the drive and number of titles, split by type of content. */
function usageByType(c) {
  const types = {};
  for (const k of ['books', 'radio', 'music', 'podcasts', 'otherAudio']) types[k] = { bytes: 0, count: 0 };
  const add = (k, size) => { types[k].bytes += size; types[k].count++; };
  for (const b of c.books) {
    const src = b.identifier ? sourceOf(b.identifier, b.source) : null;
    if (src === 'podcasts') add('podcasts', b.size);
    else if (src === 'otr' || src === 'lectures') add('radio', b.size);
    else if (src === 'live' || src === '78s') add('music', b.size);
    else if (src) add('books', b.size);
    else add('otherAudio', b.size); // folders copied onto the drive by hand
  }
  for (const f of c.looseFiles) add('otherAudio', f.size);
  return types;
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
  const u = usageByType(c);
  // [css class, label, { bytes, count }]; types with nothing on the drive are left out
  const types = [
    ['seg-books', 'Audiobooks', u.books],
    ['seg-radio', 'Radio & talks', u.radio],
    ['seg-music', 'Music', u.music],
    ['seg-podcasts', 'Podcasts', u.podcasts],
    ['seg-other-audio', 'Other audio', u.otherAudio],
  ].filter(([, , t]) => t.count > 0);
  const row = (cls, label, bytes, style, count) => [
    el('i', { class: cls, style }),
    el('span', {}, label, count ? el('span', { class: 'legend-count', title: `${count} on the drive` }, String(count)) : null),
    el('span', { class: 'num' }, fmtBytes(bytes))];
  $('#usage').replaceChildren(
    el('div', { class: 'usage-free' }, fmtBytes(free), ' ', el('small', {}, 'free')),
    el('div', { class: 'usage-bar', title: 'Drive space' },
      types.map(([cls, , t]) => el('span', { class: cls, style: { width: pct(t.bytes) } })),
      el('span', { class: 'seg-pending', style: { width: pct(pending) } }),
      el('span', { class: 'seg-other', style: { width: pct(c.otherSize) } })),
    el('div', { class: 'legend' },
      types.map(([cls, label, t]) => row(cls, label, t.bytes, null, t.count)),
      pending ? row('seg-pending', 'Being added', pending) : null,
      row('seg-other', 'Other files', c.otherSize),
      row('', 'Free', free, { background: 'var(--surface)', border: '1px solid var(--border)' })),
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
      for (const b of info.books) rememberCover(b.identifier, b.cover);
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
}

function renderCardView() {
  const root = $('#cardView');
  const drive = currentDrive();
  if (!drive) {
    root.replaceChildren(
      el('div', { class: 'state' }, el('h3', {}, 'No drive plugged in'), el('div', {}, 'Plug in the drive to see which audiobooks are on it.'))
    );
    return;
  }
  const c = state.card;
  if (!c) {
    root.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'progress indeterminate' }, el('span')), 'Reading the drive…'));
    return;
  }

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('h1', {}, 'Drive contents'),
      el('p', {}, `${c.books.length} ${c.books.length === 1 ? 'title' : 'titles'} on "${drive.label}" · ${fmtBytes(c.free)} free`)),
    el('div', { class: 'head-actions' },
      c.books.some((b) => b.managed)
        ? el('button', { class: 'btn btn-secondary', disabled: !!state.verifying, title: 'Read every file back from the drive and make sure it matches the original', onclick: () => checkBooks() }, icon('check'), 'Check files')
        : null,
      el('button', { class: 'btn btn-secondary', onclick: () => api.card.reveal(state.mount).catch(showError) }, icon('folder'), 'Open drive in file browser'),
      el('button', { class: 'btn btn-primary', onclick: () => showView('browse') }, icon('plus'), 'Discover more')));

  const parts = [head];

  if (state.verifying) {
    const p = state.verifying;
    const pct = p.bytesTotal ? (p.bytesDone / p.bytesTotal) * 100 : 0;
    const title = c.books.find((b) => b.folder === p.folder)?.title;
    parts.push(
      el('div', { class: 'banner ok' }, icon('check'),
        el('div', {},
          el('strong', {}, `Checking files… ${Math.min(p.index + 1, p.count)} of ${p.count}`),
          title ? el('span', { class: 'muted' }, title) : null,
          el('div', { class: 'progress', style: { width: '100%', marginTop: '8px' } }, el('span', { style: { width: `${pct.toFixed(1)}%` } }))),
        el('button', { class: 'btn btn-secondary', onclick: () => api.card.cancelVerify() }, 'Stop'))
    );
  }
  const problems = c.books.filter((b) => b.managed && (!b.complete || b.check?.status === 'problem'));
  if (problems.length && !state.verifying) {
    parts.push(
      el('div', { class: 'banner error' }, icon('warn'),
        el('div', {}, el('strong', {}, `${problems.length} ${problems.length === 1 ? 'title has' : 'titles have'} a problem on the drive`),
          'Press "Repair" to copy it onto the drive again.'))
    );
  }

  if (c.needsFix) {
    parts.push(
      el('div', { class: 'banner' }, icon('warn'),
        el('div', {}, el('strong', {}, 'Some files are not in play order'),
          'Many headphones play files in the order they were saved, not by name. This can happen after removing titles or copying files by hand.'),
        el('button', { class: 'btn btn-primary', onclick: (e) => fixOrder(e.currentTarget) }, icon('sort'), 'Fix play order'))
    );
  }

  if (!c.books.length && !c.looseFiles.length) {
    parts.push(el('div', { class: 'state' }, el('h3', {}, 'This drive has no audiobooks yet'),
      el('div', {}, 'Find something you like and press "Put on drive".'),
      el('button', { class: 'btn btn-primary btn-big', onclick: () => showView('browse') }, 'Discover something to listen to')));
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
      el('summary', {}, 'How is everything arranged on the drive?'),
      el('p', {}, 'Everything gets its own folder named after its title, and every file in it is numbered (001, 002, 003…) so it plays in the right order.'),
      el('p', {}, 'Many headphones and MP3 players ignore file names and play files in the order they were saved to the drive. This app always copies files one at a time, in order. If you remove titles or copy files by hand, use "Fix play order" to put everything back in order. Titles are listed here in the order the headphones will see them.'))
  );
  root.replaceChildren(...parts.filter(Boolean));
}

function bookRow(b, i) {
  const unit = b.unit || 'chapter';
  const count = b.trackNumbers && b.trackTotal && b.trackNumbers.length < b.trackTotal
    ? `${b.trackNumbers.length} of ${b.trackTotal} ${unit}s`
    : `${b.chapters} ${b.chapters === 1 ? unit : `${unit}s`}`;
  const sub = [b.author, count, fmtBytes(b.size)].filter(Boolean).join(' · ');
  return el('div', { class: 'row' },
    el('div', { class: 'order' }, i + 1),
    toDetails(coverEl(b.identifier, b.title, b.author), b.identifier, b),
    el('div', {},
      toDetails(el('div', { class: 'row-title' }, b.title,
        libEntry(b.identifier || `folder:${b.folder}`).status === 'read' ? el('span', { class: 'tag ok' }, 'Read') : null,
        !b.inOrder ? el('span', { class: 'tag warn' }, 'Out of order') : null,
        !b.complete ? el('span', { class: 'tag error' }, 'Incomplete') : null,
        b.check?.status === 'ok' ? el('span', { class: 'tag ok', title: `Every ${unit} matches (checked against ${b.check.checkedFrom})` }, '✓ Checked') : null,
        b.check?.status === 'problem' ? el('span', { class: 'tag error' }, 'Problem') : null,
        b.check?.status === 'unknown' ? el('span', { class: 'tag muted', title: b.check.problems.join(' ') }, 'Can’t check') : null), b.identifier, b),
      el('div', { class: 'row-sub' }, sourceTag(b.identifier, b.source), sub),
      b.check?.status === 'problem' ? el('div', { class: 'row-problem' }, b.check.problems.slice(0, 3).join(' ')) : null,
      !b.complete && b.expectedChapters ? el('div', { class: 'row-problem' }, `Only ${b.chapters} of ${b.expectedChapters} ${unit}s are on the drive.`) : null),
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
    if (bad) toast(`${bad} ${bad === 1 ? 'title has' : 'titles have'} a problem. Press "Repair" to fix ${bad === 1 ? 'it' : 'them'}.`, 'error');
    else toast(`All ${results.length - unknown} titles checked: every file matches the original.${unknown ? ` (${unknown} couldn’t be checked.)` : ''}`, 'success');
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
      ? 'It will be removed from the drive and copied again from this computer.'
      : 'It will be removed from the drive and downloaded again.',
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
    title: `Remove "${b.title}" from the drive?`,
    text: `This frees up ${fmtBytes(b.size)}. You can download it again any time.`,
    ok: 'Remove',
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
  const ok = await confirmBox({ title: `Remove "${f.name}"?`, text: 'This file will be deleted from the drive.', ok: 'Remove', danger: true });
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
    toast('Play order fixed. Everything on the drive is now in order.', 'success');
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
    await confirmBox({ title: 'Drive ejected', text: `${msg} Insert your drive into your MP3 player and enjoy!`, ok: 'OK', cancel: null });
  } catch (err) {
    await confirmBox({ title: 'Could not eject the drive', text: err.message, ok: 'OK', cancel: null });
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
  if (!state.mount && state.view === 'card') showView('browse');
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
      el('strong', {}, `Adding ${active.length}…`),
      el('div', { class: 'progress', style: { width: '100%' } }, el('span', { style: { width: `${(s.queueProgress * 100).toFixed(1)}%` } })),
      el('span', { class: 'muted' }, fmtEta(s.queueEta)));
    mini.onclick = () => showView('downloads');
  } else {
    mini.hidden = true;
  }

  const root = $('#downloadsView');
  const parts = [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'Downloads'), el('p', {}, 'Everything is downloaded from the internet, then copied to the drive in the right order.')),
      s.jobs.some((j) => ['done', 'error', 'cancelled'].includes(j.status))
        ? el('button', { class: 'btn btn-secondary', onclick: () => api.downloads.clear() }, 'Clear finished')
        : null),
  ];

  if (active.length) {
    parts.push(
      el('div', { class: 'summary-card' },
        el('div', { class: 'summary-top' },
          el('strong', {}, `${active.length} to go`),
          el('span', { class: 'muted' }, fmtEta(s.queueEta))),
        el('div', { class: 'progress' }, el('span', { style: { width: `${(s.queueProgress * 100).toFixed(1)}%` } })),
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: state.autoEject, onchange: (e) => { state.autoEject = e.target.checked; api.downloads.setAutoEject(state.autoEject); } }),
          'Eject the drive automatically when everything is finished'))
    );
  }

  if (!s.jobs.length) {
    parts.push(el('div', { class: 'state' }, el('h3', {}, 'Nothing downloading'), el('div', {}, 'Anything you add to the drive shows up here while it downloads.'),
      el('button', { class: 'btn btn-primary', onclick: () => showView('browse') }, 'Discover something to listen to')));
  } else {
    parts.push(el('div', { class: 'list' }, [...s.jobs].reverse().map(jobRow)));
  }
  root.replaceChildren(...parts.filter(Boolean));
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
    numbers = `${j.chapterCount} ${j.unit || 'chapter'}${j.chapterCount === 1 ? '' : 's'} · ${fmtBytes(j.totalBytes)}`;
  } else if (j.status === 'queued') {
    numbers = `${j.chapterCount} ${j.unit || 'chapter'}${j.chapterCount === 1 ? '' : 's'} · ${fmtBytes(j.totalBytes)} · waiting for the one above to finish`;
  }

  const actions = [];
  if (['queued', 'downloading', 'copying', 'waiting'].includes(j.status)) {
    actions.push(el('button', { class: 'btn btn-secondary btn-small', onclick: () => api.downloads.cancel(j.id) }, icon('x'), 'Cancel'));
  } else if (['error', 'cancelled'].includes(j.status)) {
    actions.push(el('button', { class: 'btn btn-primary btn-small', onclick: () => api.downloads.retry(j.id) }, icon('retry'), 'Try again'));
  }

  return el('div', { class: `row job ${j.status}` },
    toDetails(coverEl(j.identifier, j.title, j.author), j.identifier, j),
    el('div', {},
      toDetails(el('div', { class: 'row-title' }, j.title), j.identifier, j),
      el('div', { class: 'row-sub' }, sourceTag(j.identifier, j.source)),
      el('div', { class: 'status' },
        j.status === 'done' ? el('span', { style: { color: 'var(--ok)', fontWeight: 600 } }, j.toCard ? '✓ On the drive' : '✓ Saved on this computer') : j.message),
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
  for (const t of document.querySelectorAll('.tab[data-view]')) t.classList.toggle('active', t.dataset.view === name);
  $('#showDriveBtn').classList.toggle('active', name === 'card');
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
  for (const t of document.querySelectorAll('.tab[data-view]')) t.addEventListener('click', () => showView(t.dataset.view)); // (Settings is a tab-styled button that opens a dialog)
  $('#showDriveBtn').addEventListener('click', () => showView('card'));
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
  // (the close event fires after a task delay, so it must not cancel a book that was just opened)
  $('#bookDialog').addEventListener('close', () => { if (!$('#bookDialog').open) state.dialogBook = null; });
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click backdrop to close
  }

  api.catalog.onProgress((p) => {
    showFetching(p.sourceId, p);
    if (p.sourceId === state.sourceId && state.loading === p.sourceId) renderLoading(p);
  });
  api.catalog.onUpdated(async ({ sourceId, fetchedAt }) => {
    showFetching(sourceId, null);
    if (state.catalogs[sourceId]?.fetchedAt >= fetchedAt) return; // already showing this list
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
  api.onAbout(showAbout);
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
  for (const [key, e] of Object.entries(state.lib)) rememberCover(key, e.image);
  updateStarCount();
  initPlayer();
  refreshLocal();
  state.sources = await api.catalog.sources();
  await initPodcasts();
  state.update = await api.updates.status();
  renderUpdateBanner();
  api.updates.onChange((s) => {
    state.update = s;
    renderUpdateBanner();
    if ($('#settingsDialog').open) renderUpdateStatus();
  });
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
