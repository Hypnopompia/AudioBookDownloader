'use strict';

/*
 * API credentials that must not live in the public repository.
 *
 * - Running from source: read from ".env" in the project folder.
 * - Packaged app: read from src/main/secrets.json, which the build step
 *   (scripts/write-secrets.js) generates from ".env". Both files are gitignored.
 *
 * Note: anything shipped inside a desktop app can be extracted by a
 * determined person; this keeps keys out of GitHub, not out of the app.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function readEnvFile() {
  try {
    return parseEnv(fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8'));
  } catch {
    return {};
  }
}

function readBundled() {
  try {
    return require('./secrets.json');
  } catch {
    return {}; // not a packaged build
  }
}

// Later sources win, but empty values never override real ones.
const values = {};
for (const source of [readEnvFile(), readBundled(), process.env]) {
  for (const k of ['PODCASTINDEX_KEY', 'PODCASTINDEX_SECRET']) if (source[k]) values[k] = source[k];
}

module.exports = {
  podcastIndex: values.PODCASTINDEX_KEY && values.PODCASTINDEX_SECRET
    ? { key: values.PODCASTINDEX_KEY, secret: values.PODCASTINDEX_SECRET }
    : null,
  parseEnv,
};
