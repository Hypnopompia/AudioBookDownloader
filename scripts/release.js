'use strict';

// Build and publish a GitHub Release for the version in package.json.
//   npm run release        (needs the GitHub CLI `gh`, logged in)
//
// The release is created as a draft *before* building, so the parallel Mac
// and Windows uploads all go into one existing release (letting
// electron-builder create it races and fails), then it's published.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('../src/main/secrets');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = `v${version}`;
const repo = 'Hypnopompia/ListenSync';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const gh = (...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' }).trim();

function releaseState() {
  try {
    return JSON.parse(gh('release', 'view', tag, '-R', repo, '--json', 'isDraft'));
  } catch {
    return null;
  }
}

// Users see these notes as "What's new" after updating, so don't release without them.
const notes = require(path.join(root, 'src', 'changelog.json')).find((v) => v.version === version);
if (!notes || !notes.changes?.length || !notes.date) {
  console.error(`Add version ${version} (with its date and a list of changes) to src/changelog.json before releasing.`);
  process.exit(1);
}

// Signing and notarizing the Mac app: a Developer ID certificate in the keychain, and an
// App Store Connect API key from .env (passed to electron-builder, never bundled).
let dotenv = {};
try {
  dotenv = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
} catch {
  /* no .env */
}
const APPLE_KEYS = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
const apple = Object.fromEntries(APPLE_KEYS.map((k) => [k, process.env[k] || dotenv[k] || '']));
const missing = APPLE_KEYS.filter((k) => !apple[k]);
const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
if (!/Developer ID Application/.test(identities)) {
  console.error('No "Developer ID Application" certificate in the keychain, so the Mac app would not be signed.');
  console.error('Create one in Xcode: Settings > Accounts > Manage Certificates > + > Developer ID Application.');
  process.exit(1);
}
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} in .env, so the Mac app would not be notarized. See .env.example.`);
  process.exit(1);
}
if (!fs.existsSync(apple.APPLE_API_KEY)) {
  console.error(`APPLE_API_KEY points to ${apple.APPLE_API_KEY}, which doesn't exist.`);
  process.exit(1);
}

const existing = releaseState();
if (existing && !existing.isDraft) {
  console.error(`Release ${tag} is already published. Bump "version" in package.json first.`);
  process.exit(1);
}
if (!existing) {
  console.log(`Creating draft release ${tag}…`);
  // Start the notes at the previous app version, not the "catalog" lists release.
  const [previous] = JSON.parse(gh('release', 'list', '-R', repo, '--exclude-drafts', '--exclude-pre-releases', '--limit', '1', '--json', 'tagName'));
  const since = previous ? ['--notes-start-tag', previous.tagName] : [];
  gh('release', 'create', tag, '-R', repo, '--draft', '--title', version, '--target', 'main', '--generate-notes', ...since);
}

run('node', ['scripts/write-secrets.js']); // bundle API keys from .env (never committed)

console.log('Building and uploading…');
run('npx', ['electron-builder', '--mac', '--win', '--publish', 'always'], {
  env: { ...process.env, ...apple, GH_TOKEN: process.env.GH_TOKEN || gh('auth', 'token') },
});

console.log(`Publishing ${tag}…`);
gh('release', 'edit', tag, '-R', repo, '--draft=false', '--latest');
console.log(`Done: https://github.com/${repo}/releases/tag/${tag}`);
