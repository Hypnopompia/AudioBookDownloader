'use strict';

/*
 * App updates from GitHub Releases (electron-updater).
 *
 * - Windows installer and Linux AppImage: download in the background, then
 *   "Restart to update" (or install automatically on quit).
 * - macOS: Apple only allows an app to replace itself when it's signed with a
 *   Developer ID. Unsigned / development-signed builds just announce the new
 *   version and open the download page. A Developer ID build is detected
 *   automatically and gets full self-updating.
 * - Windows portable .exe: can't replace itself, so it also just announces.
 */

const { app, shell } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');

const RELEASES_URL = 'https://github.com/Hypnopompia/ListenSync/releases/latest';
const CHECK_EVERY_MS = 6 * 3600 * 1000;

let autoUpdater = null;
let status = { state: 'idle', current: app.getVersion() };
let notify = () => {};
let selfUpdate = false;

function setStatus(patch) {
  status = { ...status, ...patch, current: app.getVersion(), selfUpdate };
  notify(status);
}

/** Is this macOS app signed with a Developer ID (required for self-updating)? */
function macHasDeveloperId() {
  return new Promise((resolve) => {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    execFile('codesign', ['-dv', '--verbose=2', bundle], (err, stdout, stderr) => {
      resolve(!err && /Authority=Developer ID Application/.test(String(stderr) + String(stdout)));
    });
  });
}

async function canSelfUpdate() {
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR; // portable builds can't
  if (process.platform === 'darwin') return macHasDeveloperId();
  return !!process.env.APPIMAGE; // .deb installs update through the package manager
}

async function init(onStatus) {
  notify = onStatus;
  if (!app.isPackaged) {
    setStatus({ state: 'dev' }); // running from source: nothing to update
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  selfUpdate = await canSelfUpdate();
  autoUpdater.autoDownload = selfUpdate;
  autoUpdater.autoInstallOnAppQuit = selfUpdate;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'current', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) =>
    setStatus({ state: selfUpdate ? 'downloading' : 'available', version: info.version, percent: 0, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    console.error('Update check failed:', err?.message || err);
    setStatus({ state: 'error', error: 'Couldn’t check for updates. Please check the internet connection.' });
  });

  setTimeout(check, 10000);
  setInterval(check, CHECK_EVERY_MS).unref();
}

function check() {
  if (!autoUpdater) return status;
  if (['checking', 'downloading', 'ready'].includes(status.state)) return status;
  autoUpdater.checkForUpdates().catch(() => {});
  return status;
}

/** Restart into the downloaded update (self-updating builds) or open the download page. */
function install() {
  if (status.state === 'ready' && autoUpdater) {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }
  shell.openExternal(RELEASES_URL);
  return false;
}

module.exports = { init, check, install, getStatus: () => status };
