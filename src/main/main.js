'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Menu, nativeImage } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const catalog = require('./catalog');
const drives = require('./drives');
const sdcard = require('./sdcard');
const settings = require('./settings');
const { Downloader } = require('./downloader');
const local = require('./local');
const libstate = require('./libstate');
const media = require('./media');
const verify = require('./verify');
const updater = require('./updater');
const podcasts = require('./podcasts');

/** Book or podcast details, depending on the id. */
const getDetails = (identifier, quality) =>
  podcasts.isPodcast(identifier) ? podcasts.getDetails(identifier) : catalog.getDetails(identifier, quality);

// "Check books" results per card: mount -> Map(folder -> result)
const checks = new Map();
let verifyCtrl = null;
function forgetCheck(mount, folder) {
  checks.get(mount)?.delete(folder);
}

media.registerScheme(); // must happen before the app is ready

const APP_NAME = 'ListenSync';
const OLD_NAME = 'Audiobook SD Loader'; // name before v1.2
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
app.setName(APP_NAME); // menus, About panel, notifications and the settings folder use this
migrateSettingsFolder();

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
let knownDrives = [];
const manualMounts = new Map(); // folders picked by hand via "Choose a folder"
let autoEject = false;
const touchedMounts = new Set();

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
  win = new BrowserWindow({
    width: 1280,
    height: 840,
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
    for (const m of checks.keys()) if (!knownDrives.some((d) => d.mount === m) && !manualMounts.has(m)) checks.delete(m);
    const key = JSON.stringify(knownDrives.map((d) => [d.mount, d.label, d.total]));
    if (force || key !== lastKey) {
      lastKey = key;
      send('drives:changed', knownDrives);
    }
  } finally {
    polling = false;
  }
  return knownDrives;
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

function registerIpc() {
  handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));
  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => settings.set(patch));
  handle('open:external', (url) => openExternal(url));

  handle('catalog:sources', () => catalog.sources());
  handle('catalog:genres', () => catalog.genres());
  handle('catalog:load', async (sourceId, force) => {
    const onProgress = (p) => send('catalog:progress', p);
    const data = await catalog.load(sourceId, { force: !!force, onProgress });
    if (data.stale) {
      catalog
        .refresh(sourceId, onProgress)
        .then(() => send('catalog:updated', { sourceId }))
        .catch((err) => console.error('Background refresh failed', err));
    }
    return data;
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
    return drive;
  });
  handle('drives:space', (mount) => drives.space(checkMount(mount)));
  handle('drives:eject', (mount) => ejectMount(checkMount(mount)));

  handle('card:list', async (mount) => {
    const info = await sdcard.listCard(checkMount(mount));
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
    await sdcard.fixPlayOrder(checkMount(mount), (p) => send('card:fixProgress', p));
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
    const drive = knownDrives.find((d) => d.mount === mount) || manualMounts.get(mount);
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
      driveLabel: drive?.label || 'Drive',
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
      if (info.needsFix) await sdcard.fixPlayOrder(mount);
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
function setupMenuAndAbout() {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Audiobooks from LibriVox and the Internet Archive. Not affiliated with either.',
    iconPath: ICON,
  });
  if (process.platform !== 'darwin') return;
  if (!app.isPackaged) app.dock?.setIcon(nativeImage.createFromPath(ICON));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `About ${APP_NAME}` },
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
  setupMenuAndAbout();
  const userData = app.getPath('userData');
  settings.init(userData);
  catalog.init(path.join(userData, 'cache'));
  libstate.init(userData);
  local.init(migrateMusicFolder());
  local.migrateNames().then(() => local.cleanupPartial());
  fs.rm(path.join(os.tmpdir(), 'audiobook-sd-loader'), { recursive: true, force: true }).catch(() => {}); // v1.0 temp folder
  media.handleProtocol();
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
    send('card:changed', { mount: job.mount });
  });
  downloader.on('idle', () => onQueueIdle().catch((err) => console.error(err)));

  registerIpc();
  createWindow();
  pollDrives(true);
  updater.init((status) => send('update:changed', status));
  setInterval(() => pollDrives(false).catch(() => {}), process.platform === 'win32' ? 5000 : 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => libstate.flush());

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
