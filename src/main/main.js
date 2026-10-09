'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, nativeImage, protocol, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const catalog = require('./catalog');
const drives = require('./drives');
const sdcard = require('./sdcard');
const settings = require('./settings');
const covers = require('./covers');
const { Downloader } = require('./downloader');
const local = require('./local');
const libstate = require('./libstate');
const media = require('./media');
const verify = require('./verify');
const updater = require('./updater');
const podcasts = require('./podcasts');
const history = require('./history');

/** Book or podcast details, depending on the id. */
const getDetails = (identifier, quality) =>
  podcasts.isPodcast(identifier) ? podcasts.getDetails(identifier) : catalog.getDetails(identifier, quality);

// "Check books" results per card: mount -> Map(folder -> result)
const checks = new Map();
let verifyCtrl = null;
function forgetCheck(mount, folder) {
  checks.get(mount)?.delete(folder);
}

protocol.registerSchemesAsPrivileged([media.schemePrivileges, covers.schemePrivileges]); // before the app is ready

const APP_NAME = 'ListenSync';
const OLD_NAME = 'Audiobook SD Loader'; // name before v1.2
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
app.setName(APP_NAME); // menus, About panel, notifications and the settings folder use this
// LISTENSYNC_PROFILE=<folder> runs the app with separate settings and saved
// books (for testing and screenshots); otherwise migrate from the old name.
const PROFILE = process.env.LISTENSYNC_PROFILE ? path.resolve(process.env.LISTENSYNC_PROFILE) : null;
if (PROFILE) app.setPath('userData', path.join(PROFILE, 'settings'));
else migrateSettingsFolder();

/**
 * The app was called "Audiobook SD Loader" before v1.2. Copy its settings,
 * library (stars, positions…) and catalog cache to the new settings folder
 * the first time ListenSync starts. The old folder is left as a backup.
 */
function migrateSettingsFolder() {
  try {
    const appData = app.getPath('appData');
    const oldDir = path.join(appData, OLD_NAME);
    const newDir = path.join(appData, APP_NAME);
    const alreadyMigrated = ['settings.json', 'library.json'].some((f) => fsSync.existsSync(path.join(newDir, f)));
    if (!fsSync.existsSync(oldDir) || alreadyMigrated) return;
    fsSync.mkdirSync(newDir, { recursive: true });
    for (const name of ['settings.json', 'library.json', 'cache']) {
      const src = path.join(oldDir, name);
      if (fsSync.existsSync(src)) fsSync.cpSync(src, path.join(newDir, name), { recursive: true });
    }
  } catch (err) {
    console.error('Could not copy settings from the old app name:', err);
  }
}

/** Books saved on the computer move from Music/Audiobook SD Loader to Music/ListenSync. */
function migrateMusicFolder() {
  const music = app.getPath('music');
  const oldDir = path.join(music, OLD_NAME);
  const newDir = path.join(music, APP_NAME);
  try {
    if (fsSync.existsSync(oldDir) && !fsSync.existsSync(newDir)) fsSync.renameSync(oldDir, newDir);
  } catch (err) {
    console.error('Could not move the saved books folder:', err);
    return oldDir; // keep using the old folder rather than losing track of saved books
  }
  return newDir;
}

let win = null;
let downloader = null;
// Version the app was updated from, for "What's new": '' when it's unknown (from before
// versions were remembered), null when there's nothing to show (new install, same version).
let whatsNewFrom = null;
let knownDrives = [];
const manualMounts = new Map(); // folders picked by hand via "Choose a folder"
let autoEject = false;
const touchedMounts = new Set();
const fixingMounts = new Set(); // play order being fixed: folders move around for a while
const driveIds = new Map(); // mount -> { key, id } for drives we've recognised
const askedName = new Set(); // mounts we've already offered to name this session

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Only allow card operations on drives we detected or folders the user picked. */
function checkMount(mount) {
  if (typeof mount !== 'string') throw new Error('No drive selected.');
  if (knownDrives.some((d) => d.mount === mount) || manualMounts.has(mount)) return mount;
  throw new Error('That drive is no longer connected.');
}

function createWindow() {
  // Roomy enough for the sidebar, drive panel and player bar, but never bigger than the screen.
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, screenW),
    height: Math.min(960, screenH),
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#f7f3ec',
    icon: ICON, // Windows/Linux window icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform !== 'darwin') win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!downloader.isBusy()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep going', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'Audiobooks are still downloading or copying.',
      detail: 'If you quit now, unfinished books will not be put on the drive. You can add them again later.',
    });
    if (choice === 0) e.preventDefault();
  });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') shell.openExternal(u.toString());
  } catch {
    /* ignore bad urls */
  }
}

// ----------------------------------------------------------------- drives

let polling = false;
let lastKey = '';
async function pollDrives(force = false) {
  if (polling) return knownDrives;
  polling = true;
  try {
    knownDrives = await drives.listDrives();
    for (const d of knownDrives) await attachIdentity(d);
    for (const m of driveIds.keys()) if (!knownDrives.some((d) => d.mount === m) && !manualMounts.has(m)) driveIds.delete(m);
    for (const m of checks.keys()) if (!knownDrives.some((d) => d.mount === m) && !manualMounts.has(m)) checks.delete(m);
    const key = JSON.stringify(knownDrives.map((d) => [d.mount, d.label, d.total, d.driveId, d.name]));
    if (force || key !== lastKey) {
      lastKey = key;
      send('drives:changed', knownDrives);
    }
  } finally {
    polling = false;
  }
  return knownDrives;
}

/**
 * Recognise a drive from its hidden drive file or serial number (once per
 * plug-in), and add its id and name. `askName` is set the first time we see
 * a drive the app has never used, so the window can offer to name it.
 */
async function attachIdentity(d) {
  const key = `${d.serial || ''}|${d.label}|${d.total}`;
  let known = driveIds.get(d.mount);
  if (!known || known.key !== key) {
    const rec = await history.identify(d).catch((err) => {
      console.error('Could not read the drive name', err);
      return null;
    });
    known = { key, id: rec?.id || null };
    driveIds.set(d.mount, known);
  }
  const rec = known.id ? history.get(known.id) : null;
  d.driveId = rec?.id || null;
  d.name = rec?.name || '';
  d.askName = !rec && !d.manual && !(d.readOnly && !d.serial) && !askedName.has(d.mount);
  return d;
}

/** The detected or hand-picked drive at a mount. */
const driveAt = (mount) => knownDrives.find((d) => d.mount === mount) || manualMounts.get(mount) || null;

/** Make sure a drive has history kept for it (e.g. it was never named); returns its id. */
async function ensureDrive(mount) {
  const drive = driveAt(mount);
  if (!drive) return null;
  if (drive.driveId) return drive.driveId;
  const rec = await history.register(drive);
  driveIds.set(mount, { key: driveIds.get(mount)?.key || '', id: rec.id });
  await attachIdentity(drive);
  return rec.id;
}

/** Bring the history up to date with a drive's contents, unless folders are moving around. */
function updateHistory(mount, info) {
  const id = driveAt(mount)?.driveId;
  if (!id || verifyCtrl || fixingMounts.has(mount) || downloader.pendingBytes(mount) > 0) return;
  if (fsSync.existsSync(path.join(mount, sdcard.REORDER_DIR))) return; // fixing play order was interrupted
  if (history.update(id, info.books)) send('history:changed', {});
}

async function ejectMount(mount) {
  const drive = knownDrives.find((d) => d.mount === mount);
  if (!drive) throw new Error('Only detected drives can be ejected. Use your computer to eject this one.');
  if (downloader.pendingBytes(mount) > 0) throw new Error('Please wait until all books have finished copying.');
  const msg = await drives.eject(drive);
  await pollDrives(true);
  return msg;
}

// ----------------------------------------------------------------- IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      console.error(channel, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

const catalogProgress = (p) => send('catalog:progress', p);
const prefetchLists = () =>
  catalog.prefetch({
    onProgress: catalogProgress,
    onDone: (sourceId, data) => send('catalog:updated', { sourceId, fetchedAt: data.fetchedAt }),
  });

function registerIpc() {
  handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));
  handle('app:changelog', () => require('../changelog.json'));
  handle('app:whatsNew', () => {
    const from = whatsNewFrom;
    whatsNewFrom = null; // only once, even if the window reloads
    return from;
  });
  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => settings.set(patch));
  handle('open:external', (url) => openExternal(url));

  handle('catalog:sources', () => catalog.sources());
  handle('catalog:load', async (sourceId, force) => {
    const data = await catalog.load(sourceId, { force: !!force, onProgress: catalogProgress });
    if (data.stale) {
      catalog
        .refresh(sourceId, catalogProgress)
        .then((fresh) => send('catalog:updated', { sourceId, fetchedAt: fresh.fetchedAt }))
        .catch((err) => console.error('Background refresh failed', err));
    }
    return data;
  });
  handle('catalog:info', () => catalog.cacheInfo());
  handle('catalog:clear', async () => {
    await catalog.clearCache();
    prefetchLists(); // download them again in the background
  });
  handle('book:details', (identifier, quality) => getDetails(identifier, quality));
  handle('podcasts:info', () => ({ directory: podcasts.usingPI() ? 'Podcast Index' : 'Apple Podcasts', categories: podcasts.categories() }));
  handle('podcasts:search', (term, opts) => podcasts.search(term, opts));
  handle('podcasts:trending', (opts) => podcasts.trending(opts));
  handle('podcasts:latest', (ids) => podcasts.latest(ids));

  handle('drives:list', () => pollDrives(true));
  handle('drives:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose the drive (or a folder on it)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const mount = r.filePaths[0];
    const drive = { id: mount, mount, label: path.basename(mount) || mount, fs: 'Folder', manual: true, isFat32: null, ...(await drives.space(mount)) };
    manualMounts.set(mount, drive);
    driveIds.delete(mount);
    return attachIdentity(drive);
  });
  handle('drives:space', (mount) => drives.space(checkMount(mount)));
  handle('drives:eject', (mount) => ejectMount(checkMount(mount)));
  /** Name a drive (or skip naming with name null); this only changes the name shown in the app. */
  handle('drives:name', async (mount, name) => {
    const drive = driveAt(checkMount(mount));
    askedName.add(mount);
    if (drive.driveId) await history.rename(drive.driveId, name ?? drive.name, drive);
    else {
      const rec = await history.register(drive, name == null ? undefined : name);
      driveIds.set(mount, { key: driveIds.get(mount)?.key || '', id: rec.id });
    }
    await attachIdentity(drive);
    await pollDrives(true);
    send('history:changed', {});
    return { mount, driveId: drive.driveId, name: drive.name };
  });

  handle('history:state', () => history.state());
  handle('history:rename', async (id, name) => {
    const drive = [...knownDrives, ...manualMounts.values()].find((d) => d.driveId === id);
    await history.rename(id, name, drive);
    if (drive) await attachIdentity(drive);
    await pollDrives(true);
    send('history:changed', {});
  });
  handle('history:clear', () => {
    history.clear();
    send('history:changed', {});
  });
  handle('history:forget', async (id) => {
    history.forget(id);
    for (const [m, v] of driveIds) if (v.id === id) driveIds.delete(m);
    for (const d of manualMounts.values()) if (d.driveId === id) await attachIdentity(d);
    await pollDrives(true);
    send('history:changed', {});
  });

  handle('card:list', async (mount) => {
    const info = await sdcard.listCard(checkMount(mount));
    updateHistory(mount, info);
    info.pendingBytes = downloader.pendingBytes(mount);
    const results = checks.get(mount);
    for (const b of info.books) b.check = results?.get(b.folder) || null;
    info.checking = !!verifyCtrl;
    return info;
  });
  handle('card:delete', async (mount, folder) => {
    if (downloader.pendingBytes(mount) > 0) throw new Error('Please wait until copying has finished before removing books.');
    await sdcard.deleteFolder(checkMount(mount), folder);
    forgetCheck(mount, folder);
    const id = driveAt(mount)?.driveId;
    if (id) {
      history.logRemoved(id, folder);
      send('history:changed', {});
    }
  });
  handle('card:verify', async (mount, folders) => {
    checkMount(mount);
    if (verifyCtrl) throw new Error('The books are already being checked.');
    if (downloader.pendingBytes(mount) > 0) throw new Error('Please wait until copying has finished before checking books.');
    if (!Array.isArray(folders) || !folders.every((f) => typeof f === 'string')) throw new Error('Nothing to check');
    verifyCtrl = new AbortController();
    try {
      const results = await verify.verifyCard(mount, folders, {
        signal: verifyCtrl.signal,
        onProgress: (p) => send('card:verifyProgress', { mount, ...p }),
      });
      if (!checks.has(mount)) checks.set(mount, new Map());
      for (const r of results) checks.get(mount).set(r.folder, r);
      return results;
    } catch (err) {
      if (verifyCtrl?.signal.aborted) throw new Error('Checking was stopped.');
      throw err;
    } finally {
      verifyCtrl = null;
    }
  });
  handle('card:verifyCancel', () => verifyCtrl?.abort());
  handle('card:deleteFile', (mount, name) => sdcard.deleteLooseFile(checkMount(mount), name));
  handle('card:fixOrder', async (mount) => {
    if (downloader.pendingBytes(mount) > 0) throw new Error('Please wait until copying has finished.');
    fixingMounts.add(checkMount(mount));
    try {
      await sdcard.fixPlayOrder(mount, (p) => send('card:fixProgress', p));
    } finally {
      fixingMounts.delete(mount);
    }
  });
  handle('card:reveal', (mount, folder) => {
    checkMount(mount);
    return shell.openPath(folder ? sdcard.bookPath(mount, folder) : mount);
  });

  handle('downloads:state', () => downloader.snapshot());
  /**
   * target 'card': put a book on the drive (copied from the local library
   * when it's already there, otherwise downloaded). target 'local': save it
   * on this computer only.
   */
  handle('downloads:add', async ({ identifier, quality, mount, source, target = 'card', numbers = null }) => {
    if (numbers != null && (!Array.isArray(numbers) || !numbers.length || !numbers.every(Number.isInteger))) {
      throw new Error('Choose at least one chapter.');
    }
    const existing = await local.find(identifier, quality);
    if (target === 'local') {
      let details = selectTracks(await getDetails(identifier, existing?.meta.quality || quality), numbers);
      if (existing) {
        // only download what isn't saved yet
        const have = new Set(existing.meta.tracks.map((t) => t.number));
        details = withTracks(details, details.tracks.filter((t) => !have.has(t.number)));
        if (!details.tracks.length) throw new Error('These are already saved on this computer.');
      }
      await fs.mkdir(local.rootDir(), { recursive: true });
      const { free } = await drives.space(local.rootDir());
      if (details.totalBytes + 200 * 1024 * 1024 > free) {
        throw new Error('There is not enough free space on this computer to save this book.');
      }
      return downloader.add(details, { source: details.source || source, toCard: false });
    }
    checkMount(mount);
    const drive = driveAt(mount);
    // Use the saved copy if it has everything asked for (no network needed);
    // otherwise get the list from archive.org and download what's missing.
    const have = new Set((existing?.meta.tracks || []).map((t) => t.number));
    const wanted = numbers || (existing ? Array.from({ length: existing.meta.trackTotal }, (_, i) => i + 1) : []);
    const details =
      existing && wanted.every((n) => have.has(n))
        ? selectTracks(detailsFromLocal(existing.meta), numbers)
        : selectTracks(await getDetails(identifier, existing?.meta.quality || quality), numbers);
    const { free } = await drives.space(mount);
    if (details.totalBytes + downloader.pendingBytes(mount) > free) throw new Error('NO_SPACE');
    touchedMounts.add(mount);
    return downloader.add(details, {
      mount,
      driveLabel: drive?.name || drive?.label || 'Drive',
      source: details.source || existing?.meta.source || source,
      toCard: true,
      splitMinutes: Number(settings.get().splitMinutes) || 0,
    });
  });
  handle('downloads:cancel', (id) => downloader.cancel(id));
  handle('downloads:retry', (id) => downloader.retry(id));
  handle('downloads:clear', () => downloader.clearFinished());
  handle('library:state', () => libstate.all());
  handle('library:update', (key, patch) => {
    const entry = libstate.update(key, patch);
    send('library:changed', { key, entry });
    return entry;
  });

  handle('local:list', () => local.list());
  handle('local:delete', async (dir) => {
    if (downloader.busyLocalDirs().has(dir)) throw new Error('This book is being downloaded or copied right now. Please wait until it has finished.');
    await local.remove(dir);
    send('local:changed', {});
  });
  handle('local:deleteAll', async () => {
    const busy = downloader.busyLocalDirs();
    const { books } = await local.list();
    for (const b of books) if (!busy.has(b.dir)) await local.remove(b.dir);
    await local.cleanupPartial();
    send('local:changed', {});
  });
  handle('local:reveal', async (dir) => {
    const target = dir ? local.dirByName(dir) : local.rootDir();
    await fs.mkdir(target, { recursive: true });
    return shell.openPath(target);
  });

  handle('player:open', (source) => {
    if (source?.kind === 'card') checkMount(source.mount);
    return media.open(source);
  });

  handle('update:status', () => updater.getStatus());
  handle('update:check', () => updater.check());
  handle('update:install', () => {
    if (updater.getStatus().state === 'ready' && downloader.isBusy()) {
      throw new Error('Please wait until the books have finished downloading and copying, then restart to update.');
    }
    return updater.install();
  });

  handle('downloads:setAutoEject', (v) => {
    autoEject = !!v;
    return autoEject;
  });
}

// ----------------------------------------------------------------- queue finished

async function onQueueIdle() {
  const mounts = [...touchedMounts];
  touchedMounts.clear();
  const snap = downloader.snapshot();
  const failed = snap.jobs.filter((j) => j.status === 'error').length;
  const added = snap.jobs.filter((j) => j.status === 'done' && mounts.includes(j.mount)).length;

  for (const mount of mounts) {
    try {
      const info = await sdcard.listCard(mount);
      if (info.needsFix) {
        fixingMounts.add(mount);
        await sdcard.fixPlayOrder(mount).finally(() => fixingMounts.delete(mount));
      }
    } catch (err) {
      console.error('Automatic order fix failed', err);
    }
    send('card:changed', { mount });
  }

  let text = failed
    ? `${failed} book${failed === 1 ? '' : 's'} could not be copied. See the Downloads tab.`
    : 'All audiobooks have been copied to the drive.';
  if (autoEject && !failed && mounts.length && added) {
    try {
      for (const m of mounts) await ejectMount(m);
      text += ' The drive has been ejected and can be removed now.';
      send('card:ejected', {});
    } catch (err) {
      text += ` The drive could not be ejected automatically: ${err.message}`;
    }
  }
  if (!mounts.length) return;
  send('app:notice', { kind: failed ? 'error' : 'success', text });
  if (Notification.isSupported() && !win?.isFocused()) {
    new Notification({ title: APP_NAME, body: text }).show();
  }
}

// ----------------------------------------------------------------- app lifecycle

/**
 * macOS menu bar. (When running from source with `npm start`, macOS still
 * shows "Electron" as the bold app name because that comes from the Electron
 * binary; the packaged app shows "ListenSync".)
 */
function setupMenu() {
  if (process.platform !== 'darwin') return;
  if (!app.isPackaged) app.dock?.setIcon(nativeImage.createFromPath(ICON));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { label: `About ${APP_NAME}`, click: () => send('app:about') }, // our own dialog, so it can have links
          { type: 'separator' },
          { role: 'hide', label: `Hide ${APP_NAME}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${APP_NAME}` },
        ],
      },
      { role: 'editMenu' }, // copy / paste in the search box
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom', label: 'Normal Text Size' },
          { role: 'zoomIn', label: 'Bigger Text' },
          { role: 'zoomOut', label: 'Smaller Text' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ])
  );
}

app.whenReady().then(() => {
  setupMenu();
  const userData = app.getPath('userData');
  settings.init(userData);
  const prevVersion = settings.get().lastVersion;
  if (prevVersion !== app.getVersion()) {
    whatsNewFrom = prevVersion || (settings.existed() ? '' : null);
    settings.set({ lastVersion: app.getVersion() });
  }
  catalog.init(path.join(userData, 'cache'), { getListSource: () => settings.get().listSource });
  libstate.init(userData);
  history.init(userData);
  local.init(PROFILE ? path.join(PROFILE, 'library') : migrateMusicFolder());
  local.migrateNames().then(() => local.cleanupPartial());
  fs.rm(path.join(os.tmpdir(), 'audiobook-sd-loader'), { recursive: true, force: true }).catch(() => {}); // v1.0 temp folder
  media.handleProtocol();
  covers.init(path.join(userData, 'covers'));
  podcasts.useAnchorStore({
    get: (id) => libstate.all()[id]?.podAnchor || null,
    set: (id, anchor) => {
      const cur = libstate.all()[id]?.podAnchor;
      if (!cur || cur.date !== anchor.date || cur.number !== anchor.number) libstate.update(id, { podAnchor: anchor });
    },
  });
  downloader = new Downloader();
  downloader.on('localChanged', () => send('local:changed', {}));
  downloader.on('change', (snap) => send('downloads:changed', snap));
  downloader.on('bookAdded', (job) => {
    forgetCheck(job.mount, job.folder);
    // remember how far through a long book/series has been copied, for "next batch"
    const last = Math.max(...job.tracks.map((t, i) => t.number || i + 1));
    const prev = libstate.all()[job.identifier]?.lastCopied || 0;
    if (job.partial && last > prev) {
      const entry = libstate.update(job.identifier, { lastCopied: last, title: job.title, author: job.author, identifier: job.identifier });
      send('library:changed', { key: job.identifier, entry });
    }
    // Optionally take the star off once the whole title is on a drive (people use stars as a
    // "to copy" list). Podcasts are skipped: their star means following the show.
    if (settings.get().unstarOnCopy && !job.partial && !podcasts.isPodcast(job.identifier) && libstate.all()[job.identifier]?.starred) {
      const entry = libstate.update(job.identifier, { starred: false });
      send('library:changed', { key: job.identifier, entry });
    }
    ensureDrive(job.mount)
      .then((id) => {
        if (!id) return;
        history.logCopied(id, {
          folder: job.folder,
          identifier: job.identifier,
          title: job.title,
          author: job.author,
          source: job.source,
          kind: job.kind,
          unit: job.unit,
          trackNumbers: job.tracks.map((t, i) => t.number || i + 1),
          trackTotal: job.trackTotal || job.tracks.length,
          size: job.totalBytes,
        });
        send('history:changed', {});
      })
      .catch((err) => console.error('Could not add to history', err))
      .finally(() => send('card:changed', { mount: job.mount })); // after logging, so it isn't also "found" on the drive
  });
  downloader.on('idle', () => onQueueIdle().catch((err) => console.error(err)));

  registerIpc();
  createWindow();
  // after the first screen has loaded, fetch the other sources' lists in the background
  setTimeout(prefetchLists, 5000);
  pollDrives(true);
  updater.init((status) => send('update:changed', status));
  setInterval(() => pollDrives(false).catch(() => {}), process.platform === 'win32' ? 5000 : 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  libstate.flush();
  history.flush();
});

/** Keep only the chosen track numbers (all of them when numbers is null). */
function selectTracks(details, numbers) {
  if (!numbers) return details;
  const set = new Set(numbers);
  return withTracks(details, details.tracks.filter((t) => set.has(t.number)));
}

function withTracks(details, tracks) {
  return { ...details, tracks, totalBytes: tracks.reduce((a, t) => a + (t.size || 0), 0) };
}

/** Turn a saved book's listensync.json back into the shape catalog.getDetails returns. */
function detailsFromLocal(meta) {
  return {
    identifier: meta.identifier,
    title: meta.title,
    author: meta.author,
    format: meta.format,
    quality: meta.quality,
    runtime: meta.runtime,
    kind: meta.kind,
    cover: meta.cover || `https://archive.org/services/img/${meta.identifier}`,
    unit: meta.unit,
    trackTotal: meta.trackTotal,
    tracks: meta.tracks.map(({ name, url, size, approxSize, md5, title, seconds, number }) => ({ name, url, size, approxSize, md5, title, seconds, number })),
    totalBytes: meta.tracks.reduce((a, t) => a + (t.size || 0), 0),
  };
}
