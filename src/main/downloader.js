'use strict';

/*
 * Download queue. Each book goes through up to two phases:
 *   1. download every chapter into the local library folder (3 at a time;
 *      chapters already there are skipped, so a book saved on the computer
 *      is copied to a card without downloading it again),
 *   2. (card jobs) copy the chapters to the SD card one by one, in play order.
 * Downloading to the computer first lets us download in parallel while still
 * writing to the card in strict order (see sdcard.js for why order matters),
 * and means a slow or flaky connection never leaves half a book on the card.
 * After a card job the local copy is removed unless it was asked for
 * (keepLocal) or was already in the library.
 */

const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { UA, sleep, friendlyNetError } = require('./http');
const sdcard = require('./sdcard');
const { space } = require('./drives');
const local = require('./local');

const PARALLEL = 3;
const STALL_MS = 60000;
const DEFAULT_DL_SPEED = 1.5 * 1024 * 1024;
const DEFAULT_COPY_SPEED = 8 * 1024 * 1024;

let nextId = 1;

class Downloader extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.running = false;
    this.dlSpeed = 0; // bytes/sec, smoothed
    this.copySpeed = 0;
    this._emitTimer = null;
    setInterval(() => this._tick(), 1000).unref();
  }

  isBusy() {
    return this.jobs.some((j) => ['queued', 'downloading', 'copying', 'waiting'].includes(j.status));
  }

  /** Bytes still to be written to a given card by unfinished jobs. */
  pendingBytes(mount) {
    return this.jobs
      .filter((j) => j.toCard && j.mount === mount && ['queued', 'downloading', 'copying', 'waiting'].includes(j.status))
      .reduce((a, j) => a + (j.totalBytes - j.copied), 0);
  }

  hasBook(identifier, mount, toCard) {
    return this.jobs.some(
      (j) =>
        j.identifier === identifier && j.toCard === toCard && (!toCard || j.mount === mount) &&
        ['queued', 'downloading', 'copying', 'waiting'].includes(j.status)
    );
  }

  /** Folders in the local library that a running or queued job is using. */
  busyLocalDirs() {
    return new Set(
      this.jobs
        .filter((j) => ['queued', 'downloading', 'copying', 'waiting'].includes(j.status))
        .map((j) => path.basename(local.dirFor(j.identifier, j.quality)))
    );
  }

  add(details, { mount = null, driveLabel = '', source, toCard = true, keepLocal = false }) {
    if (!details.tracks.length) throw new Error('This item has no MP3 files to download.');
    if (this.hasBook(details.identifier, mount, toCard)) throw new Error('This book is already in the download list.');
    const job = {
      id: nextId++,
      identifier: details.identifier,
      source,
      title: details.title,
      author: details.author,
      cover: details.cover,
      format: details.format,
      quality: details.quality,
      tracks: details.tracks,
      runtime: details.runtime || null,
      totalBytes: details.totalBytes,
      toCard,
      keepLocal: keepLocal || !toCard,
      mount,
      driveLabel,
      status: 'queued',
      message: 'Waiting to start',
      downloaded: 0,
      copied: 0,
      fileIndex: 0,
      eta: null,
      error: null,
      folder: null,
      addedAt: Date.now(),
    };
    this.jobs.push(job);
    this._changed();
    this._pump();
    return job.id;
  }

  cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'queued' || job.status === 'waiting') {
      job.status = 'cancelled';
      job.message = 'Cancelled';
    }
    job.ctrl?.abort();
    this._changed();
  }

  retry(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || !['error', 'cancelled'].includes(job.status)) return;
    Object.assign(job, { status: 'queued', message: 'Waiting to start', error: null, downloaded: 0, copied: 0, eta: null });
    this._changed();
    this._pump();
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => !['done', 'cancelled', 'error'].includes(j.status));
    this._changed();
  }

  snapshot() {
    const active = this.jobs.filter((j) => ['queued', 'downloading', 'copying', 'waiting'].includes(j.status));
    const dl = this.dlSpeed || DEFAULT_DL_SPEED;
    const cp = this.copySpeed || DEFAULT_COPY_SPEED;
    let queueEta = 0;
    for (const j of active) queueEta += j.eta ?? j.totalBytes / dl + (j.toCard ? j.totalBytes / cp : 0);
    const totalBytes = active.reduce((a, j) => a + j.totalBytes * (j.toCard ? 2 : 1), 0);
    const doneBytes = active.reduce((a, j) => a + j.downloaded + j.copied, 0);
    return {
      jobs: this.jobs.map(({ ctrl, tracks, ...j }) => ({ ...j, chapterCount: tracks.length })),
      busy: active.length > 0,
      queueEta: active.length ? queueEta : null,
      queueProgress: totalBytes ? doneBytes / totalBytes : 0,
      dlSpeed: this.dlSpeed,
      copySpeed: this.copySpeed,
    };
  }

  // ------------------------------------------------------------------ internals

  _changed() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit('change', this.snapshot());
    }, 250);
  }

  _tick() {
    const job = this.jobs.find((j) => j.status === 'downloading' || j.status === 'copying');
    if (!job) return;
    const now = Date.now();
    const key = job.status === 'downloading' ? 'downloaded' : 'copied';
    const speedKey = job.status === 'downloading' ? 'dlSpeed' : 'copySpeed';
    if (job._lastKey === key && job._lastAt) {
      const inst = ((job[key] - job._lastBytes) * 1000) / (now - job._lastAt);
      this[speedKey] = this[speedKey] ? this[speedKey] * 0.75 + inst * 0.25 : inst;
    }
    job._lastKey = key;
    job._lastBytes = job[key];
    job._lastAt = now;

    const dl = this.dlSpeed > 1024 ? this.dlSpeed : DEFAULT_DL_SPEED;
    const cp = this.copySpeed || DEFAULT_COPY_SPEED;
    job.eta =
      job.status === 'downloading'
        ? (job.totalBytes - job.downloaded) / dl + (job.toCard ? job.totalBytes / cp : 0)
        : (job.totalBytes - job.copied) / cp;
    this._changed();
  }

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      let job;
      while ((job = this.jobs.find((j) => j.status === 'queued'))) {
        await this._run(job);
      }
    } finally {
      this.running = false;
    }
    this.emit('idle');
  }

  async _run(job) {
    job.ctrl = new AbortController();
    const signal = job.ctrl.signal;
    const dir = local.dirFor(job.identifier, job.quality);
    const n = job.tracks.length;
    const localFiles = job.tracks.map((t, i) => path.join(dir, sdcard.trackFileName(i, n, t.title)));
    let wasLocal = false;
    try {
      // ---- Phase 1: download to the computer
      wasLocal = !!(await local.readBook(dir));
      job.status = 'downloading';
      job.message = wasLocal ? 'Getting the book ready…' : 'Starting download…';
      this._changed();
      await fs.mkdir(dir, { recursive: true });
      await this._downloadAll(job, localFiles, signal);
      if (!wasLocal) {
        // Marks the download as complete; until then the folder counts as unfinished.
        await local.writeBook(dir, {
          identifier: job.identifier,
          source: job.source,
          title: job.title,
          author: job.author,
          format: job.format,
          quality: job.quality,
          runtime: job.runtime,
          totalBytes: job.totalBytes,
          downloadedAt: new Date().toISOString(),
          tracks: job.tracks.map((t, i) => ({
            name: t.name,
            size: t.size,
            md5: t.md5 || null,
            title: t.title,
            seconds: t.seconds,
            file: path.basename(localFiles[i]),
          })),
        });
      }

      if (!job.toCard) {
        job.status = 'done';
        job.message = 'Saved on this computer';
        job.eta = 0;
        job.finishedAt = Date.now();
        this.emit('localChanged');
        return;
      }

      // ---- Wait for the card if it was unplugged meanwhile
      while (!fsSync.existsSync(job.mount)) {
        signal.throwIfAborted();
        job.status = 'waiting';
        job.message = `Downloaded. Waiting for the SD card "${job.driveLabel}" to be plugged in…`;
        job.eta = null;
        this._changed();
        await sleep(2000);
      }

      const { free } = await space(job.mount);
      if (free < job.totalBytes + 1024 * 1024) {
        throw new Error('There is not enough free space on the SD card. Remove a book from the card, then press Try again.');
      }

      // ---- Phase 2: copy to the card, strictly in order
      job.status = 'copying';
      job.copied = 0;
      this._changed();
      let bytesThisFile = 0;
      let fileIdx = 0;
      const sizes = await Promise.all(localFiles.map((f) => fs.stat(f).then((s) => s.size)));
      job.folder = await sdcard.writeBook(
        job.mount,
        { identifier: job.identifier, source: job.source, title: job.title, author: job.author, format: job.format, tracks: job.tracks },
        localFiles,
        {
          signal,
          onBytes: (b) => {
            job.copied += b;
            bytesThisFile += b;
            while (fileIdx < n - 1 && bytesThisFile >= sizes[fileIdx]) {
              bytesThisFile -= sizes[fileIdx];
              fileIdx++;
            }
            job.message = `Copying chapter ${fileIdx + 1} of ${n} to the SD card`;
            this._changed();
          },
        }
      );
      job.totalBytes = job.copied;
      job.status = 'done';
      job.message = 'On the SD card';
      job.eta = 0;
      job.finishedAt = Date.now();
      this.emit('bookAdded', job);
      if (!job.keepLocal && !wasLocal) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      this.emit('localChanged');
    } catch (err) {
      if (signal.aborted) {
        job.status = 'cancelled';
        job.message = 'Cancelled';
        if (!wasLocal) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      } else {
        job.status = 'error';
        job.error = friendlyNetError(err).message;
        job.message = 'Something went wrong';
      }
      job.eta = null;
    } finally {
      job.ctrl = null;
      this._changed();
    }
  }

  async _downloadAll(job, localFiles, signal) {
    const n = localFiles.length;
    const perFile = new Array(n).fill(0);
    const sync = () => {
      job.downloaded = perFile.reduce((a, b) => a + b, 0);
      const done = perFile.filter((b, i) => b > 0 && b >= (job.tracks[i].size || Infinity)).length;
      job.message = `Downloading chapter ${Math.min(done + 1, n)} of ${n}`;
      this._changed();
    };
    let next = 0;
    let failed = null;
    const worker = async () => {
      while (next < n && !failed) {
        const i = next++;
        try {
          await this._downloadFile(job, i, localFiles[i], signal, (bytes) => {
            perFile[i] = bytes;
            sync();
          });
        } catch (err) {
          failed = failed || err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, worker));
    if (failed) throw failed;
    // Use real sizes from disk (archive.org sizes are occasionally missing)
    const sizes = await Promise.all(localFiles.map((f) => fs.stat(f).then((s) => s.size)));
    job.totalBytes = sizes.reduce((a, b) => a + b, 0);
    job.downloaded = job.totalBytes;
  }

  async _downloadFile(job, i, dest, signal, setBytes) {
    const track = job.tracks[i];
    const existing = await fs.stat(dest).catch(() => null);
    if (existing && (track.size ? existing.size === track.size : existing.size > 0)) {
      setBytes(existing.size);
      return;
    }
    const url =
      `https://archive.org/download/${encodeURIComponent(job.identifier)}/` +
      track.name.split('/').map(encodeURIComponent).join('/');
    const part = dest + '.part';
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted();
      const stall = new AbortController();
      let timer = setTimeout(() => stall.abort(new Error('Download stalled')), STALL_MS);
      const both = AbortSignal.any([signal, stall.signal]);
      let got = 0;
      setBytes(0);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: both });
        if (!res.ok) throw new Error(`archive.org responded with HTTP ${res.status} for "${track.title}"`);
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            got += chunk.length;
            setBytes(got);
            clearTimeout(timer);
            timer = setTimeout(() => stall.abort(new Error('Download stalled')), STALL_MS);
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body), counter, fsSync.createWriteStream(part), { signal: both });
        if (track.size && got !== track.size) throw new Error(`Incomplete download of "${track.title}"`);
        await fs.rename(part, dest);
        return;
      } catch (err) {
        lastErr = err;
        if (signal.aborted) throw err;
        await sleep(2000 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    setBytes(0);
    throw friendlyNetError(lastErr);
  }
}

module.exports = { Downloader };
