'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { quality: 'standard', language: 'eng', source: 'librivox', sort: 'popular', show: 'all', speed: '1', splitMinutes: '0', lastMount: '' };

let file = null;
let data = { ...DEFAULTS };

function init(dir) {
  file = path.join(dir, 'settings.json');
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    data = { ...DEFAULTS };
  }
}

function get() {
  return { ...data };
}

function set(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in DEFAULTS && (typeof v === 'string' || typeof v === 'boolean')) data[k] = v;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Could not save settings', err);
  }
  return get();
}

module.exports = { init, get, set };
