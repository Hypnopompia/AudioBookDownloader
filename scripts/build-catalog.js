'use strict';

// Build the prebuilt source lists the app downloads (see "Prebuilt lists" in
// src/main/catalog.js). Run weekly by .github/workflows/catalog.yml:
//   node scripts/build-catalog.js <output folder>
//
// Writes one gzipped list per source plus a manifest. A list that fails to
// download, or comes back much smaller than last week's (archive.org having a
// bad day), is left out and last week's entry is kept in the manifest, so the
// app keeps using the previous file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const catalog = require('../src/main/catalog');

const MIN_SHARE_OF_PREVIOUS = 0.8;
const outDir = path.resolve(process.argv[2] || 'catalog-out');

async function previousManifest() {
  try {
    const res = await fetch(`${catalog.prebuiltBase()}/${catalog.manifestFile()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const warn = (msg) => console.log(`::warning::${msg}`);

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const previous = await previousManifest();
  const sources = { ...(previous?.sources || {}) };
  let built = 0;

  for (const { id } of catalog.sources()) {
    const started = Date.now();
    let lastLog = 0;
    const onProgress = (p) => {
      if (Date.now() - lastLog < 30000) return;
      lastLog = Date.now();
      console.log(`  ${id}: ${p.loaded.toLocaleString()} of ${p.total.toLocaleString()}`);
    };
    try {
      console.log(`Building ${id}…`);
      const items = await catalog.fetchList(id, onProgress);
      const before = previous?.sources?.[id]?.count;
      if (before && items.length < before * MIN_SHARE_OF_PREVIOUS) {
        warn(`${id}: got ${items.length} items, last time ${before}. Keeping last week's list.`);
        continue;
      }
      const fetchedAt = Date.now();
      const gz = zlib.gzipSync(JSON.stringify({ fetchedAt, items }), { level: 9 });
      fs.writeFileSync(path.join(outDir, catalog.prebuiltFile(id)), gz);
      sources[id] = {
        fetchedAt,
        count: items.length,
        bytes: gz.length,
        sha256: crypto.createHash('sha256').update(gz).digest('hex'),
      };
      built++;
      console.log(`  ${id}: ${items.length.toLocaleString()} items, ${(gz.length / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (err) {
      warn(`${id}: ${err.message}. Keeping last week's list.`);
    }
  }

  if (!built) {
    console.error('No list could be built.');
    process.exit(1);
  }
  const manifest = { builtAt: Date.now(), sources };
  fs.writeFileSync(path.join(outDir, catalog.manifestFile()), JSON.stringify(manifest, null, 2));
  console.log(`Built ${built} of ${catalog.sources().length} lists in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
