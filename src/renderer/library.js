'use strict';

/* global api, state, el, icon, $, coverEl, toast, showError, confirmBox, fmtBytes, fmtClock, fmtRuntime,
   libEntry, setLib, localBook, cardBook, currentDrive, openBook, openMakeRoom, refreshCard, refreshBadges,
   showView, applyFilters, playBook, stopPlayerIf, refreshBookDialog, bookCard, onCardIds, queuedIds, toDetails, rememberCover, sourceTag */

// =========================================================================
// "My library": continue listening, books saved on this computer, starred
// and finished books.
// =========================================================================

let localReq = 0;
async function refreshLocal() {
  const req = ++localReq;
  try {
    const info = await api.local.list();
    if (req !== localReq) return;
    state.local = info;
    for (const b of info.books) rememberCover(b.identifier, b.cover);
  } catch (err) {
    console.warn(err);
  }
  $('#libCount').textContent = state.local.books.length ? String(state.local.books.length) : '';
  refreshBadges();
  refreshBookDialog();
  if (state.view === 'library') renderLibrary();
}

/** Where a library entry can be played from right now, if anywhere. */
function playableSource(key, entry) {
  const id = entry.identifier || (key.startsWith('folder:') ? null : key);
  const loc = localBook(id);
  if (loc) return { kind: 'local', dir: loc.dir };
  const cb = id ? cardBook(id) : (state.card?.books || []).find((b) => `folder:${b.folder}` === key);
  if (cb && state.mount) return { kind: 'card', mount: state.mount, folder: cb.folder };
  return null;
}

function idOf(key, entry) {
  return entry.identifier || (key.startsWith('folder:') ? null : key);
}

function renderLibrary() {
  const root = $('#libraryView');
  const entries = Object.entries(state.lib);
  const parts = [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'My library'), el('p', {}, 'What you’re listening to, what you’ve saved on this computer, and what you’ve finished.'))),
  ];

  // ---- Continue listening
  const inProgress = entries
    .filter(([, e]) => e.position && e.position.tracks && e.status !== 'read')
    .sort((a, b) => (b[1].position.at || 0) - (a[1].position.at || 0));
  if (inProgress.length) {
    parts.push(el('div', { class: 'section-title' }, 'Continue listening'),
      el('div', { class: 'list' }, inProgress.map(([key, e]) => {
        const src = playableSource(key, e);
        const p = e.position;
        return el('div', { class: 'row lib-row' },
          toDetails(coverEl(idOf(key, e), e.title, e.author), idOf(key, e), e),
          el('div', {},
            toDetails(el('div', { class: 'row-title' }, e.title || key), idOf(key, e), e),
            el('div', { class: 'row-sub' }, sourceTag(idOf(key, e), e.source), `Chapter ${p.track + 1} of ${p.tracks}${p.chapter ? ` (${p.chapter})` : ''} · stopped at ${fmtClock(p.time)}`),
            el('div', { class: 'progress thin' }, el('span', { style: { width: `${Math.min(100, ((p.track + 0.5) / p.tracks) * 100)}%` } })),
            !src ? el('div', { class: 'row-sub' }, 'Not on this computer or the drive that’s plugged in.') : null),
          el('div', { class: 'row-actions' },
            src ? el('button', { class: 'btn btn-primary btn-small', onclick: () => playBook(src) }, icon('play'), 'Continue')
              : idOf(key, e) ? el('button', { class: 'btn btn-secondary btn-small', onclick: () => openBook(idOf(key, e), e) }, 'Details') : null,
            el('button', { class: 'btn btn-secondary btn-small', title: 'Forget where you stopped', onclick: () => setLib(key, { position: null }).then(renderLibrary) }, icon('x'))));
      })));
  }

  // ---- Saved on this computer
  const L = state.local;
  parts.push(
    el('div', { class: 'section-head' },
      el('div', { class: 'section-title' }, 'Saved on this computer'),
      el('div', { class: 'head-actions' },
        el('span', { class: 'muted' }, L.books.length ? `${L.books.length} ${L.books.length === 1 ? 'title' : 'titles'} · ${fmtBytes(L.total)}` : ''),
        el('button', { class: 'btn btn-secondary btn-small', title: L.root, onclick: () => api.local.reveal().catch(showError) }, icon('folder'), 'Open folder'),
        L.books.length ? el('button', { class: 'btn btn-danger-ghost btn-small', onclick: deleteAllLocal }, icon('trash'), 'Delete all') : null))
  );
  if (!L.books.length) {
    parts.push(el('p', { class: 'muted' },
      'Nothing saved yet. Open anything you’d like to hear and press "Save to computer" to download it now, so you can listen here or copy it to a drive later without waiting.'));
  } else {
    parts.push(el('div', { class: 'list' }, L.books.map(localRow)));
  }

  // ---- Read / not interested
  const read = entries.filter(([, e]) => e.status === 'read').sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  if (read.length) {
    parts.push(el('details', { class: 'lib-details' },
      el('summary', { class: 'section-title' }, `Already read (${read.length})`),
      el('div', { class: 'list' }, read.map(([key, e]) => entryRow(key, e, [
        el('button', { class: 'btn btn-secondary btn-small', onclick: () => setLib(key, { status: null }).then(() => { renderLibrary(); refreshBadges(); }) }, 'Mark as not read'),
      ])))));
  }
  const hidden = entries.filter(([, e]) => e.status === 'not_interested').length;
  if (hidden) {
    parts.push(el('p', { class: 'muted' }, `${hidden} ${hidden === 1 ? 'title is' : 'titles are'} marked "Not interested" and hidden while browsing. `,
      el('button', { class: 'link', onclick: () => { state.show = 'hidden'; $('#show').value = 'hidden'; showView('browse'); applyFilters(); } }, 'Show them')));
  }
  root.replaceChildren(...parts.filter(Boolean));
}

function entryRow(key, e, extra) {
  const id = idOf(key, e);
  const src = playableSource(key, e);
  return el('div', { class: 'row lib-row' },
    toDetails(coverEl(id, e.title, e.author), id, e),
    el('div', {},
      toDetails(el('div', { class: 'row-title' }, e.title || key, e.status === 'read' ? el('span', { class: 'tag ok' }, 'Read') : null), id, e),
      el('div', { class: 'row-sub' }, sourceTag(id, e.source), [e.author, fmtRuntime(e.runtime)].filter(Boolean).join(' · '))),
    el('div', { class: 'row-actions' },
      src ? el('button', { class: 'btn btn-secondary btn-small', onclick: () => playBook(src) }, icon('play'), 'Play') : null,
      id ? el('button', { class: 'btn btn-secondary btn-small', onclick: () => openBook(id, e) }, 'Details') : null,
      extra));
}

function localRow(b) {
  const onCard = !!cardBook(b.identifier);
  const drive = currentDrive();
  const e = libEntry(b.identifier);
  let copyBtn;
  if (onCard) copyBtn = el('button', { class: 'btn btn-secondary btn-small', disabled: true }, icon('check'), 'On drive');
  else if (!drive) copyBtn = el('button', { class: 'btn btn-secondary btn-small', disabled: true, title: 'Plug in the drive first' }, icon('card'), 'Copy to drive');
  else copyBtn = el('button', { class: 'btn btn-secondary btn-small', onclick: (ev) => copyLocalToCard(b, ev.currentTarget) }, icon('card'), 'Copy to drive');
  return el('div', { class: 'row lib-row' },
    toDetails(coverEl(b.identifier, b.title, b.author), b.identifier, b),
    el('div', {},
      toDetails(el('div', { class: 'row-title' }, b.title, e.status === 'read' ? el('span', { class: 'tag ok' }, 'Read') : null), b.identifier, b),
      el('div', { class: 'row-sub' }, sourceTag(b.identifier, b.source), [
        b.author,
        b.partial ? `${b.chapters} of ${b.trackTotal} ${b.unit || 'chapter'}s` : `${b.chapters} ${b.unit || 'chapter'}s`,
        fmtBytes(b.size),
        b.quality === 'high' ? 'high quality' : '',
      ].filter(Boolean).join(' · '))),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-primary btn-small', onclick: () => playBook({ kind: 'local', dir: b.dir }) }, icon('play'), e.position && e.status !== 'read' ? 'Continue' : 'Play'),
      copyBtn,
      el('button', { class: 'btn btn-danger-ghost btn-small', title: 'Delete from this computer', onclick: () => deleteLocal(b) }, icon('trash'))));
}

async function copyLocalToCard(b, btn) {
  btn.disabled = true;
  try {
    await api.downloads.add({ identifier: b.identifier, quality: b.quality, mount: state.mount, source: b.source, target: 'card', numbers: b.partial ? b.numbers : null });
    toast(`Copying "${b.title}" to the drive.`, 'success', { label: 'See progress', run: () => showView('downloads') });
    refreshCard();
  } catch (err) {
    btn.disabled = false;
    if (err.message.includes('NO_SPACE')) {
      await refreshCard();
      openMakeRoom({ identifier: b.identifier, title: b.title, author: b.author, quality: b.quality, totalBytes: b.size, numbers: b.partial ? b.numbers : null });
    } else {
      showError(err);
    }
  }
}

async function deleteLocal(b) {
  const ok = await confirmBox({
    title: `Delete "${b.title}" from this computer?`,
    text: `This frees up ${fmtBytes(b.size)} on this computer. Copies on drives are not affected, and your listening position is kept.`,
    ok: 'Delete',
    danger: true,
  });
  if (!ok) return;
  stopPlayerIf((src) => src.kind === 'local' && src.dir === b.dir);
  try {
    await api.local.remove(b.dir);
  } catch (err) {
    showError(err);
  }
  refreshLocal();
}

async function deleteAllLocal() {
  const L = state.local;
  const ok = await confirmBox({
    title: 'Delete everything saved on this computer?',
    text: `This deletes ${L.books.length} ${L.books.length === 1 ? 'title' : 'titles'} and frees up ${fmtBytes(L.total)}. Copies on drives are not affected.`,
    ok: 'Delete all',
    danger: true,
  });
  if (!ok) return;
  stopPlayerIf((src) => src.kind === 'local');
  try {
    await api.local.removeAll();
    toast('Everything saved on this computer was deleted.');
  } catch (err) {
    showError(err);
  }
  refreshLocal();
}

// =========================================================================
// "Starred": quick access to starred books, shown as covers.
// =========================================================================

function starredEntries() {
  return Object.entries(state.lib)
    .filter(([key, e]) => e.starred && idOf(key, e))
    .sort((a, b) => (a[1].title || '').localeCompare(b[1].title || '', undefined, { numeric: true, sensitivity: 'base' }));
}

function updateStarCount() {
  const n = starredEntries().length;
  $('#starCount').textContent = n ? String(n) : '';
}

function renderStarred() {
  updateStarCount();
  const root = $('#starredView');
  const starred = starredEntries();
  const head = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'Starred'),
      el('p', {}, starred.length ? `${starred.length} saved for later` : 'Anything you star shows up here.')));
  if (!starred.length) {
    root.replaceChildren(head,
      el('div', { class: 'state' },
        el('h3', {}, 'Nothing starred yet'),
        el('div', {}, 'Open anything and press "Star" to keep it here for quick access.'),
        el('button', { class: 'btn btn-primary', onclick: () => showView('browse') }, 'Discover something to listen to')));
    return;
  }
  const onCard = onCardIds();
  const queued = queuedIds();
  const items = starred.map(([key, e]) => ({ id: idOf(key, e), title: e.title || key, author: e.author || '', runtime: e.runtime || null, lk: '', source: e.source, showSource: true }));
  root.replaceChildren(head, el('div', { class: 'grid grid-flush' }, items.map((it) => bookCard(it, onCard, queued))));
}
