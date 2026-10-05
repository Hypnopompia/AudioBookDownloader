'use strict';

// Copies API credentials from ".env" (or the environment) into
// src/main/secrets.json so they are bundled into the packaged app without
// ever being committed. Runs automatically before `npm run dist` / `npm run release`.

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('../src/main/secrets');

const root = path.join(__dirname, '..');
let env = {};
try {
  env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
} catch {
  /* no .env */
}
const pick = (k) => process.env[k] || env[k] || '';
const secrets = { PODCASTINDEX_KEY: pick('PODCASTINDEX_KEY'), PODCASTINDEX_SECRET: pick('PODCASTINDEX_SECRET') };
const out = path.join(root, 'src', 'main', 'secrets.json');
fs.writeFileSync(out, JSON.stringify(secrets, null, 2));
if (!secrets.PODCASTINDEX_KEY || !secrets.PODCASTINDEX_SECRET) {
  console.warn('⚠ No Podcast Index credentials in .env: podcast search will use the Apple directory instead.');
} else {
  console.log('✓ Podcast Index credentials bundled.');
}
