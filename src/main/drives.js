'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

function run(cmd, args, { input, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '');
          reject(err);
        } else resolve(String(stdout));
      }
    );
    if (input != null) child.stdin.end(input);
  });
}

function powershell(script, opts) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], opts);
}

/** Total/free bytes for any mounted path. */
async function space(mount) {
  const s = await fs.statfs(mount);
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}

const GOOD_FS = /^(msdos|vfat|fat|fat12|fat16|fat32|exfat)$/i;

// --------------------------------------------------------------------- macOS
async function listMac() {
  let names = [];
  try {
    names = await fs.readdir('/Volumes');
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const mount = path.join('/Volumes', name);
    try {
      const st = await fs.lstat(mount);
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      const plist = await run('diskutil', ['info', '-plist', mount], { timeout: 8000 });
      const info = JSON.parse(await run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }));
      // SD_LOADER_ALLOW_DISK_IMAGES=1 lets a mounted FAT32 .dmg act as a card (for testing).
      const isImage = info.BusProtocol === 'Disk Image' || info.VirtualOrPhysical === 'Virtual';
      if (isImage && !process.env.SD_LOADER_ALLOW_DISK_IMAGES) continue;
      const external = info.RemovableMediaOrExternalDevice || info.RemovableMedia || info.Ejectable || info.Internal === false;
      if (!external) continue;
      const fsType = info.FilesystemType || '';
      if (!GOOD_FS.test(fsType)) continue; // skips Time Machine / APFS backup disks
      out.push({
        id: info.DeviceIdentifier || mount,
        mount,
        label: info.VolumeName || name,
        fs: info.FilesystemUserVisibleName || fsType,
        isFat32: /fat32/i.test(info.FilesystemUserVisibleName || '') || (fsType === 'msdos' && !/fat1[26]/i.test(info.FilesystemUserVisibleName || '')),
        readOnly: info.WritableVolume === false,
      });
    } catch {
      /* network share, unreadable or vanished: skip */
    }
  }
  return out;
}

// ------------------------------------------------------------------- Windows
const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ext = @{}
Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object {
  $d = Get-Disk -Number $_.DiskNumber
  if ($d -and ($d.BusType -in @('USB','SD','MMC')) -and -not $d.IsSystem -and -not $d.IsBoot) {
    $ext[([string]$_.DriveLetter) + ':'] = [string]$d.BusType
  }
}
$list = @(Get-CimInstance Win32_LogicalDisk | Where-Object { ($_.DriveType -eq 2 -or $ext.ContainsKey($_.DeviceID)) -and $_.Size } | ForEach-Object {
  [pscustomobject]@{ id = $_.DeviceID; label = $_.VolumeName; fs = $_.FileSystem }
})
ConvertTo-Json -InputObject $list -Compress
`;

async function listWindows() {
  const raw = (await powershell(WIN_SCRIPT, { timeout: 20000 })).trim();
  if (!raw) return [];
  let arr = JSON.parse(raw);
  if (!Array.isArray(arr)) arr = [arr];
  return arr
    .filter((d) => d && d.id && GOOD_FS.test(d.fs || ''))
    .map((d) => ({
      id: d.id,
      mount: d.id + '\\',
      label: d.label || 'Drive',
      fs: d.fs,
      isFat32: /^fat32$/i.test(d.fs),
      readOnly: false,
    }));
}

// --------------------------------------------------------------------- Linux
async function listLinux() {
  const raw = await run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,MOUNTPOINT,RM,HOTPLUG,FSTYPE,LABEL,TRAN,TYPE,RO']);
  const data = JSON.parse(raw);
  const truthy = (v) => v === true || v === '1' || v === 1;
  const out = [];
  const walk = (node, parent) => {
    const removable =
      truthy(node.rm) || truthy(node.hotplug) || truthy(parent?.rm) || truthy(parent?.hotplug) ||
      /usb|mmc/i.test(node.tran || parent?.tran || '') || /^mmcblk/.test(parent?.name || node.name || '');
    const mp = node.mountpoint;
    if (mp && removable && GOOD_FS.test(node.fstype || '') && !/^\/(boot|efi)?$/.test(mp)) {
      out.push({
        id: node.path || '/dev/' + node.name,
        mount: mp,
        label: node.label || path.basename(mp),
        fs: node.fstype,
        isFat32: /vfat/i.test(node.fstype),
        readOnly: truthy(node.ro),
        device: node.path || '/dev/' + node.name,
        parentDevice: parent ? parent.path || '/dev/' + parent.name : null,
      });
    }
    for (const c of node.children || []) walk(c, node);
  };
  for (const dev of data.blockdevices || []) walk(dev, null);
  return out;
}

/** List mounted drives / USB drives formatted FAT or exFAT, with space info. */
async function listDrives() {
  let list = [];
  try {
    if (process.platform === 'darwin') list = await listMac();
    else if (process.platform === 'win32') list = await listWindows();
    else list = await listLinux();
  } catch (err) {
    console.error('Drive detection failed:', err.message);
    return [];
  }
  const out = [];
  for (const d of list) {
    try {
      out.push({ ...d, ...(await space(d.mount)) });
    } catch {
      /* drive vanished between listing and stat */
    }
  }
  return out;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Safely eject / unmount. Resolves with a message, rejects with a friendly error. */
async function eject(drive) {
  const mount = drive.mount;
  if (process.platform === 'darwin') {
    try {
      await run('diskutil', ['eject', mount], { timeout: 30000 });
    } catch (err) {
      throw new Error(`The drive could not be ejected because something is still using it. Close any Finder windows showing the drive and try again.\n\n${err.stderr || err.message}`.trim());
    }
  } else if (process.platform === 'win32') {
    const letter = mount.replace(/[\\/]+$/, '');
    if (!/^[A-Z]:$/i.test(letter)) throw new Error('Only drive letters can be ejected.');
    await powershell(
      `$s = New-Object -ComObject Shell.Application; $i = $s.Namespace(17).ParseName('${letter}'); if ($i) { $i.InvokeVerb('Eject') }`,
      { timeout: 30000 }
    );
    for (let i = 0; i < 10 && (await exists(letter + '\\')); i++) await new Promise((r) => setTimeout(r, 500));
    if (await exists(letter + '\\')) {
      throw new Error('Windows says the drive is still in use. Close any File Explorer windows showing the drive and try again.');
    }
  } else {
    try {
      if (drive.device) await run('udisksctl', ['unmount', '-b', drive.device], { timeout: 30000 });
      else await run('umount', [mount], { timeout: 30000 });
    } catch (err) {
      throw new Error(`The drive could not be unmounted. Close any windows showing the drive and try again.\n\n${err.stderr || err.message}`.trim());
    }
    if (drive.parentDevice) {
      await run('udisksctl', ['power-off', '-b', drive.parentDevice], { timeout: 15000 }).catch(() => {});
    }
  }
  return 'It is now safe to remove the drive.';
}

module.exports = { listDrives, space, eject, run };
