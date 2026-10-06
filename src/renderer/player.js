'use strict';

/* global api, state, el, $, icon, coverEl, toast, showError, fmtClock, libEntry, setLib, refreshBadges, renderLibrary */

// =========================================================================
// Built-in player. Plays a book from this computer or the drive and
// remembers the chapter + position so listening can resume later.
// =========================================================================

const player = {
  book: null, // { key, identifier, title, author, source, tracks: [{ title, url, seconds }] }
  index: 0,
  pendingSeek: 0,
  seeking: false,
  lastSave: 0,
};

const audio = () => $('#audio');

function initPlayer() {
  const a = audio();
  $('#pPlay').append(icon('play'));
  $('#pPlay').addEventListener('click', togglePlay);
  $('#pPrev').addEventListener('click', prevTrack);
  $('#pNext').addEventListener('click', () => nextTrack());
  $('#pBack').addEventListener('click', () => skip(-30));
  $('#pFwd').addEventListener('click', () => skip(30));
  $('#pClose').addEventListener('click', closePlayer);
  $('#playerChapter').addEventListener('change', (e) => loadTrack(Number(e.target.value), 0, true));

  const speed = $('#pSpeed');
  speed.value = state.settings.speed || '1';
  speed.addEventListener('change', () => {
    applySpeed();
    api.settings.set({ speed: speed.value });
  });

  const seek = $('#pSeek');
  seek.addEventListener('input', () => {
    player.seeking = true;
    if (a.duration) $('#pTime').textContent = fmtClock((seek.value / 1000) * a.duration);
  });
  seek.addEventListener('change', () => {
    if (a.duration) a.currentTime = (seek.value / 1000) * a.duration;
    player.seeking = false;
    savePosition(true);
  });

  a.addEventListener('loadedmetadata', () => {
    if (player.pendingSeek) a.currentTime = Math.min(player.pendingSeek, Math.max(0, a.duration - 2));
    player.pendingSeek = 0;
    applySpeed();
    updateTime();
  });
  a.addEventListener('timeupdate', () => {
    updateTime();
    savePosition(false);
  });
  a.addEventListener('play', updatePlayButton);
  a.addEventListener('pause', () => {
    updatePlayButton();
    savePosition(true);
  });
  a.addEventListener('ended', () => nextTrack(true));
  a.addEventListener('error', () => {
    if (!player.book || !a.getAttribute('src')) return;
    toast(`This ${player.book.unit || 'chapter'} could not be played. The file may be missing or damaged.`, 'error');
  });

  // Keyboard media keys / headset buttons
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => a.play());
    ms.setActionHandler('pause', () => a.pause());
    ms.setActionHandler('previoustrack', prevTrack);
    ms.setActionHandler('nexttrack', () => nextTrack());
    ms.setActionHandler('seekbackward', () => skip(-30));
    ms.setActionHandler('seekforward', () => skip(30));
  }

  // Stop if the drive being played from is unplugged
  api.drives.onChange((list) => {
    stopPlayerIf((src) => src.kind === 'card' && !list.some((d) => d.mount === src.mount) && !state.manualDrives.some((d) => d.mount === src.mount));
  });
  window.addEventListener('beforeunload', () => savePosition(true));
}

/** Open a book in the player, resuming where it was left off. */
async function playBook(source, { track = null } = {}) {
  let book;
  try {
    book = await api.player.open(source);
  } catch (err) {
    showError(err);
    return;
  }
  if (player.book) savePosition(true);
  player.book = book;
  const e = libEntry(book.key);
  let index = 0;
  let time = 0;
  const p = e.position;
  if (track != null) index = track;
  else if (p && e.status !== 'read') {
    // Resume by track number when known (works across partial copies and
    // between the computer and the card); otherwise by position in the list.
    const byNumber = p.number != null ? book.tracks.findIndex((t) => t.number === p.number) : -1;
    if (byNumber >= 0) {
      index = byNumber;
      time = p.time;
    } else if (p.number == null && p.tracks === book.tracks.length) {
      index = Math.min(p.track, book.tracks.length - 1);
      time = p.time;
    }
  }
  // make sure the library knows the title, even for folders copied by hand
  setLib(book.key, {}, { title: book.title, author: book.author, identifier: book.identifier || undefined }).catch(() => {});

  $('#player').hidden = false;
  $('#playerCover').replaceChildren(coverEl(book.identifier, book.title, book.author));
  $('#playerTitle').textContent = book.title;
  $('#playerTitle').title = [book.title, book.author].filter(Boolean).join(' — ');
  $('#playerChapter').replaceChildren(
    ...book.tracks.map((t, i) => el('option', { value: String(i) }, `${i + 1}. ${t.title}`))
  );
  if (time > 5) toast(`Continuing "${book.title}" from ${book.unit || 'chapter'} ${index + 1} at ${fmtClock(time)}.`);
  loadTrack(index, time, true);
}

function loadTrack(i, time = 0, autoplay = true) {
  const b = player.book;
  if (!b || i < 0 || i >= b.tracks.length) return;
  const a = audio();
  player.index = i;
  player.pendingSeek = time;
  a.src = b.tracks[i].url;
  $('#playerChapter').value = String(i);
  $('#pSeek').value = 0;
  $('#pTime').textContent = fmtClock(time);
  $('#pDur').textContent = b.tracks[i].seconds ? fmtClock(b.tracks[i].seconds) : '–:––';
  if (autoplay) a.play().catch(() => {});
  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: b.tracks[i].title,
      artist: b.author || '',
      album: b.title,
      artwork: b.identifier ? [{ src: `https://archive.org/services/img/${b.identifier}`, sizes: '180x180' }] : [],
    });
  }
  savePosition(true);
}

function togglePlay() {
  const a = audio();
  if (a.paused) a.play().catch(() => {});
  else a.pause();
}

function prevTrack() {
  const a = audio();
  // like most players: restart the chapter unless we're at its very start
  if (a.currentTime > 5 || player.index === 0) a.currentTime = 0;
  else loadTrack(player.index - 1, 0, !a.paused);
}

async function nextTrack(fromEnded = false) {
  const b = player.book;
  if (!b) return;
  if (player.index < b.tracks.length - 1) {
    loadTrack(player.index + 1, 0, fromEnded || !audio().paused);
    return;
  }
  if (fromEnded) {
    // finished the whole book
    await setLib(b.key, { status: 'read', position: null }, { title: b.title, author: b.author, identifier: b.identifier || undefined }).catch(() => {});
    toast(`Finished "${b.title}". It has been marked as read.`, 'success');
    refreshBadges();
    if (state.view === 'library') renderLibrary();
    closePlayer(false);
  }
}

function skip(sec) {
  const a = audio();
  if (!a.duration) return;
  const t = a.currentTime + sec;
  if (t < 0 && player.index > 0) {
    loadTrack(player.index - 1, Math.max(0, (player.book.tracks[player.index - 1].seconds || 0) + t), !a.paused);
  } else if (t >= a.duration && player.book && player.index < player.book.tracks.length - 1) {
    loadTrack(player.index + 1, 0, !a.paused);
  } else {
    a.currentTime = Math.max(0, Math.min(t, a.duration - 0.5));
  }
}

function applySpeed() {
  const a = audio();
  const rate = Number($('#pSpeed').value) || 1;
  a.defaultPlaybackRate = rate;
  a.playbackRate = rate;
}

function updateTime() {
  const a = audio();
  if (player.seeking) return;
  $('#pTime').textContent = fmtClock(a.currentTime || 0);
  if (a.duration && isFinite(a.duration)) {
    $('#pDur').textContent = fmtClock(a.duration);
    $('#pSeek').value = String(Math.round((a.currentTime / a.duration) * 1000));
  }
}

function updatePlayButton() {
  $('#pPlay').replaceChildren(icon(audio().paused ? 'play' : 'pause'));
}

/** Save the listening position (at most every 5 seconds unless forced). */
function savePosition(force) {
  const b = player.book;
  if (!b) return;
  const now = Date.now();
  if (!force && now - player.lastSave < 5000) return;
  player.lastSave = now;
  const a = audio();
  const time = player.pendingSeek || a.currentTime || 0;
  setLib(b.key, {
    position: {
      track: player.index,
      number: b.tracks[player.index]?.number ?? null,
      time,
      tracks: b.tracks.length,
      chapter: b.tracks[player.index]?.title || '',
    },
  }, { title: b.title, author: b.author, identifier: b.identifier || undefined }).catch(() => {});
}

function closePlayer(save = true) {
  if (save) savePosition(true);
  const a = audio();
  a.pause();
  a.removeAttribute('src');
  a.load();
  player.book = null;
  $('#player').hidden = true;
}

/** Close the player if it's playing something matching pred(source). */
function stopPlayerIf(pred) {
  if (player.book && pred(player.book.source)) closePlayer(true);
}
