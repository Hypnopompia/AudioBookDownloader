'use strict';

const { version } = require('../../package.json');

// Identifies the app to archive.org, with a link to reach the maintainer.
const UA = `ListenSync/${version} (+https://github.com/Hypnopompia/ListenSync)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with a timeout and a few retries (archive.org is occasionally slow). */
async function fetchJson(url, { retries = 3, timeout = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`archive.org responded with HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw friendlyNetError(lastErr);
}

function friendlyNetError(err) {
  const msg = String(err?.message || err);
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|network/i.test(msg)) {
    return new Error('Could not reach archive.org. Please check the internet connection and try again.');
  }
  if (/timeout|aborted due to timeout/i.test(msg)) {
    return new Error('archive.org is taking too long to respond. Please try again in a minute.');
  }
  return err instanceof Error ? err : new Error(msg);
}

module.exports = { UA, fetchJson, sleep, friendlyNetError };
