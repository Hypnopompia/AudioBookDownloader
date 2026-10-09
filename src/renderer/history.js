'use strict';

/* global api, state, $, el, icon, toast, showError, confirmBox, currentDrive, showView, openBook, coverEl, toDetails, fmtBytes, fmtAgo, refreshBadges, refreshBookDialog, renderDrivePanel, renderLibrary */

// =========================================================================
// Drive names and History: what was copied to which drive, and when it was
// removed. Kept by the app (see src/main/history.js), separate from My library.
// =========================================================================

const historyUi = { drive: 'all', query: '', limit: 200 };

async function loadHistory() {
  try {
    state.history = await api.history.state();
  } catch (err) {
    console.warn(err);
    return;
  }
  if (state.view === 'history') renderHistory();
  if (state.view === 'library') renderLibrary();
  refreshBadges();
  refreshBookDialog();
}

const driveRecord = (id) => state.history.drives.find((d) => d.id === id) || null;
const driveTitle = (rec) => rec?.name || rec?.label || 'Drive';
const pluggedIn = (id) => [...state.drives, ...state.manualDrives].find((d) => d.driveId === id) || null;

const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "chapters 1-40", "chapter 4" or "12 episodes". */
function numbersLabel(numbers, unit = 'chapter') {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 1) return `${unit} ${sorted[0]}`;
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return contiguous ? `${unit}s ${sorted[0]}–${sorted[sorted.length - 1]}` : `${sorted.length} ${unit}s`;
}

/**
 * What the history knows about a title copied before, not counting the drive
 * that's plugged in now. Null when it has never been on another drive.
 */
function copiedBefore(id) {
  const s = id && state.history.summary[id];
  if (!s) return null;
  const current = currentDrive()?.driveId;
  const others = s.drives.filter((d) => d !== current);
  if (!others.length) return null;
  const names = others.map((d) => `"${driveTitle(driveRecord(d))}"`);
  const where = names.length === 1 ? names[0] : names.length === 2 ? names.join(' and ') : `${names.length} drives`;
  const text = `Copied to ${where}, last on ${fmtDate(s.lastAt)}`;
  return { ...s, text };
}

/** Small "Previously copied" tag for list rows. */
function copiedTag(id) {
  const c = copiedBefore(id);
  return c ? el('span', { class: 'tag copied', title: c.text }, 'Previously copied') : null;
}

// ------------------------------------------------------------ naming drives

const namePrompted = new Set(); // mounts asked about in this window

/** Ask for a name. Resolves with the name, '' to clear it, or null when skipped. */
function askDriveName({ title, text, value = '', ok = 'Save name', cancel = 'Cancel' }) {
  const dlg = $('#nameDialog');
  const input = el('input', { type: 'text', class: 'text-input', maxlength: 60, value, placeholder: 'For example: Mitchell’s card 1', 'aria-label': 'Drive name' });
  return new Promise((resolve) => {
    const form = el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); dlg.close('ok'); } },
      el('div', { class: 'dialog-body' },
        el('h2', {}, title),
        el('p', { class: 'muted' }, text),
        input,
        el('p', { class: 'hint' }, 'This name is only used in ListenSync. The drive’s own name doesn’t change.')),
      el('div', { class: 'dialog-foot' },
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => dlg.close('cancel') }, cancel),
        el('button', { type: 'submit', class: 'btn btn-primary' }, ok)));
    dlg.replaceChildren(form);
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? input.value.trim() : null);
    dlg.returnValue = '';
    dlg.showModal();
    input.select();
  });
}

/** The first time a drive is plugged in, offer to give it a name. */
async function offerDriveNames() {
  if ($('#nameDialog').open) return;
  const drive = state.drives.find((d) => d.askName && !namePrompted.has(d.mount));
  if (!drive) return;
  namePrompted.add(drive.mount);
  const name = await askDriveName({
    title: 'New drive found',
    text: `Give "${drive.label}" a name so you can tell your drives apart. ListenSync will remember what you put on it, even after it’s unplugged.`,
    value: drive.label,
    cancel: 'Not now',
  });
  try {
    await api.drives.name(drive.mount, name || null); // "Not now" still remembers the drive, without a name
  } catch (err) {
    showError(err);
  }
  offerDriveNames(); // another new drive may be waiting
}

async function renameDrive(id) {
  const rec = driveRecord(id);
  const plugged = pluggedIn(id);
  const name = await askDriveName({ title: 'Rename drive', text: 'Choose a name that helps you tell this drive apart from the others.', value: rec?.name || plugged?.name || '' });
  if (name == null) return;
  try {
    await api.history.rename(id, name);
  } catch (err) {
    showError(err);
  }
}

/** Rename the drive that's plugged in, or name it if it doesn't have history yet. */
async function renameCurrentDrive() {
  const drive = currentDrive();
  if (!drive) return;
  if (drive.driveId) return renameDrive(drive.driveId);
  const name = await askDriveName({ title: 'Name this drive', text: 'Choose a name that helps you tell this drive apart from the others.', value: drive.label });
  if (name == null) return;
  try {
    const r = await api.drives.name(drive.mount, name);
    Object.assign(drive, { driveId: r.driveId, name: r.name });
    renderDrivePanel();
  } catch (err) {
    showError(err);
  }
}

// ------------------------------------------------------------ History tab

function renderHistory() {
  const root = $('#historyView');
  const { drives, events } = state.history;
  const parts = [
    el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'History'), el('p', {}, 'What was put on each drive, and when it was removed. This stays here even after titles are removed from My library.')),
      el('div', { class: 'head-actions' },
        events.length ? el('button', { class: 'btn btn-danger-ghost', onclick: clearHistory }, icon('trash'), 'Clear history') : null)),
  ];

  if (!drives.length) {
    parts.push(el('div', { class: 'state' }, el('h3', {}, 'Nothing here yet'),
      el('div', {}, 'Plug in a drive and put something on it. Everything you copy will be listed here.')));
    root.replaceChildren(...parts);
    return;
  }

  const sorted = [...drives].sort((a, b) => (pluggedIn(b.id) ? 1 : 0) - (pluggedIn(a.id) ? 1 : 0) || b.lastSeen - a.lastSeen);
  parts.push(el('div', { class: 'section-title' }, 'Drives'), el('div', { class: 'list' }, sorted.map(driveRow)));

  // ---- activity
  const q = historyUi.query.trim().toLowerCase();
  if (historyUi.drive !== 'all' && !driveRecord(historyUi.drive)) historyUi.drive = 'all';
  const shown = events
    .filter((e) => historyUi.drive === 'all' || e.driveId === historyUi.drive)
    .filter((e) => !q || `${e.title} ${e.author}`.toLowerCase().includes(q))
    .sort((a, b) => b.at - a.at);
  const search = el('input', {
    type: 'search', placeholder: 'Search by title or author…', value: historyUi.query, 'aria-label': 'Search the history',
    oninput: (e) => {
      historyUi.query = e.target.value;
      historyUi.limit = 200;
      renderHistory();
      const box = $('#historySearch');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    },
  });
  search.id = 'historySearch';
  parts.push(
    el('div', { class: 'section-head history-head' },
      el('div', { class: 'section-title' }, 'Activity'),
      el('div', { class: 'head-actions' },
        search,
        el('select', { 'aria-label': 'Drive', onchange: (e) => { historyUi.drive = e.target.value; historyUi.limit = 200; renderHistory(); } },
          el('option', { value: 'all', selected: historyUi.drive === 'all' }, 'All drives'),
          sorted.map((d) => el('option', { value: d.id, selected: historyUi.drive === d.id }, driveTitle(d)))))));
  if (!shown.length) {
    parts.push(el('p', { class: 'muted' }, events.length ? 'Nothing matches.' : 'Nothing has been copied yet.'));
  } else {
    parts.push(el('div', { class: 'list' }, shown.slice(0, historyUi.limit).map(eventRow)));
    if (shown.length > historyUi.limit) {
      parts.push(el('button', { class: 'btn btn-secondary', style: { marginTop: '12px' }, onclick: () => { historyUi.limit += 200; renderHistory(); } }, `Show more (${(shown.length - historyUi.limit).toLocaleString()} left)`));
    }
  }
  root.replaceChildren(...parts);
}

function driveRow(d) {
  const plugged = pluggedIn(d.id);
  const contents = d.contents || [];
  const size = contents.reduce((a, c) => a + (c.size || 0), 0);
  const sub = [
    d.name && d.label && d.name !== d.label ? `Drive name "${d.label}"` : '',
    plugged ? 'Plugged in now' : `Last plugged in ${fmtAgo(d.lastSeen)}`,
    d.contents ? `${contents.length} ${contents.length === 1 ? 'title' : 'titles'}${size ? ` · ${fmtBytes(size)}` : ''}` : '',
  ].filter(Boolean).join(' · ');
  const list = contents.length
    ? el('details', { class: 'drive-contents' },
      el('summary', {}, plugged ? 'What’s on it' : `What was on it on ${fmtDate(d.contentsAt || d.lastSeen)}`),
      el('ul', {}, [...contents].sort((a, b) => a.title.localeCompare(b.title)).map((c) =>
        el('li', {}, toDetails(el('span', {}, c.title), c.identifier, c),
          c.author ? el('span', { class: 'muted' }, ` · ${c.author}`) : null,
          c.trackNumbers && c.trackTotal && c.trackNumbers.length < c.trackTotal ? el('span', { class: 'muted' }, ` · ${numbersLabel(c.trackNumbers, c.unit)}`) : null))))
    : null;
  return el('div', { class: 'row history-drive' },
    el('div', { class: 'drive-icon' }, icon('card')),
    el('div', {},
      el('div', { class: 'row-title' }, driveTitle(d), plugged ? el('span', { class: 'tag ok' }, 'Plugged in') : null),
      el('div', { class: 'row-sub' }, sub),
      list),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-secondary btn-small', onclick: () => renameDrive(d.id) }, 'Rename'),
      el('button', { class: 'btn btn-secondary btn-small', onclick: () => { historyUi.drive = d.id; renderHistory(); } }, 'Show activity'),
      plugged ? null : el('button', { class: 'btn btn-danger-ghost btn-small', title: 'Remove this drive and its history from the list', onclick: () => forgetDrive(d) }, icon('trash'), 'Forget')));
}

function eventRow(e) {
  const rec = driveRecord(e.driveId);
  const partial = e.trackNumbers && e.trackTotal && e.trackNumbers.length < e.trackTotal;
  const drive = `"${driveTitle(rec)}"`;
  let what;
  if (e.type === 'removed') what = e.noticed ? `${drive} · noticed when it was plugged in on ${fmtDate(e.at)}` : `${drive} · ${fmtDateTime(e.at)}`;
  else what = e.found ? `${drive} · ${fmtDate(e.at)} (already on the drive when ListenSync first saw it)` : `${drive} · ${fmtDateTime(e.at)}`;
  const sub = [e.author, partial ? numbersLabel(e.trackNumbers, e.unit) : ''].filter(Boolean).join(' · ');
  return el('div', { class: 'row lib-row' },
    toDetails(coverEl(e.identifier || e.folder, e.title, e.author), e.identifier, e),
    el('div', {},
      toDetails(el('div', { class: 'row-title' }, e.title), e.identifier, e),
      sub ? el('div', { class: 'row-sub' }, sub) : null,
      el('div', { class: 'row-sub' }, e.type === 'removed' ? el('span', { class: 'tag muted', style: { marginLeft: 0, marginRight: '6px' } }, 'Removed') : el('span', { class: 'tag ok', style: { marginLeft: 0, marginRight: '6px' } }, 'Copied'), what)),
    el('div', { class: 'row-actions' },
      e.identifier ? el('button', { class: 'btn btn-secondary btn-small', onclick: () => openBook(e.identifier, e) }, 'Details') : null));
}

async function clearHistory() {
  const ok = await confirmBox({
    title: 'Clear the history?',
    text: 'This forgets which titles were copied to which drives, and when. Drive names and what’s on each drive now are kept. This can’t be undone.',
    ok: 'Clear history',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.history.clear();
    toast('The history has been cleared.');
  } catch (err) {
    showError(err);
  }
}

async function forgetDrive(d) {
  const ok = await confirmBox({
    title: `Forget "${driveTitle(d)}"?`,
    text: 'Its name and everything copied to it will be removed from the history. Nothing on the drive itself is changed. This can’t be undone.',
    ok: 'Forget drive',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.history.forget(d.id);
  } catch (err) {
    showError(err);
  }
}
