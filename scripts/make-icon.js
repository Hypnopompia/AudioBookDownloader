'use strict';

// Renders build/icon.svg to PNG using Electron's own renderer (no extra tools).
//   npx electron scripts/make-icon.js
// Writes build/icon.png (1024px; electron-builder turns it into the Windows .ico),
// build/icon.icns on macOS (made with Apple's iconutil: the .icns electron-builder
// makes from the PNG has garbled 16, 32 and 48 px icons), and src/assets/icon.png
// (window/dock icon while running from source).

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** build/icon.icns from build/icon.png, every size Finder uses, with Apple's own tools. */
function writeIcns() {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/icon.iconset';
  fs.mkdirSync(set);
  const png = path.join(root, 'build', 'icon.png');
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), png, '--out', `${set}/icon_${s}x${s}.png`]);
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', `${set}/icon_${s}x${s}@2x.png`]);
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build', 'icon.icns')]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
}

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  const png = img.toPNG();
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
  fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  if (process.platform === 'darwin') writeIcns();
  else console.warn('build/icon.icns not updated: it needs macOS (sips and iconutil).');
  console.log('wrote build/icon.png, build/icon.icns and src/assets/icon.png', img.getSize());
  app.quit();
});
