'use strict';

// Build and publish a GitHub Release for the version in package.json.
//   npm run release        (needs the GitHub CLI `gh`, logged in)
//
// The release is created as a draft *before* building, so the parallel Mac
// and Windows uploads all go into one existing release (letting
// electron-builder create it races and fails), then it's published.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

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

const existing = releaseState();
if (existing && !existing.isDraft) {
  console.error(`Release ${tag} is already published. Bump "version" in package.json first.`);
  process.exit(1);
}
if (!existing) {
  console.log(`Creating draft release ${tag}…`);
  gh('release', 'create', tag, '-R', repo, '--draft', '--title', version, '--target', 'main', '--generate-notes');
}

run('node', ['scripts/write-secrets.js']); // bundle API keys from .env (never committed)

console.log('Building and uploading…');
run('npx', ['electron-builder', '--mac', '--win', '--publish', 'always'], {
  env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || gh('auth', 'token') },
});

console.log(`Publishing ${tag}…`);
gh('release', 'edit', tag, '-R', repo, '--draft=false', '--latest');
console.log(`Done: https://github.com/${repo}/releases/tag/${tag}`);
