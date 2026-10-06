'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { shelfRule } = require('../src/main/shelf-rules');

const rule = (title, author, src = '78s') => shelfRule({ title, author }, src);

test('slurs in titles keep items off the shelves', () => {
  assert.strictEqual(rule('What Is Dat Coons Game', 'Len Spencer'), 1);
  assert.strictEqual(rule('Japs Surrender (Aug 14, 1945)', ''), 1);
});

test('innocent look-alikes stay on the shelves', () => {
  assert.strictEqual(rule('The Waltz You Saved for Me', 'Rosie Coon'), 0); // a surname, and authors don't count
  assert.strictEqual(rule('The Adventures of Bobby Coon', 'Thornton W. Burgess', 'librivox'), 0); // a raccoon
  assert.strictEqual(rule('Live at Bar One, Squaw Valley Ski Resort', 'String Cheese Incident', 'live'), 0);
  assert.strictEqual(rule('Doo-Wop Classics', ''), 0);
  assert.strictEqual(rule('The Lay of the Last Minstrel', 'Sir Walter Scott', 'librivox'), 0);
  assert.strictEqual(rule("Darktown Strutters' Ball", 'Shelton Brooks'), 0);
  assert.strictEqual(rule("Uncle Tom's Cabin", 'Harriet Beecher Stowe', 'librivox'), 0);
  assert.strictEqual(rule("Der Fuehrer's Face", 'Arthur Fields'), 0);
  assert.strictEqual(rule('Erotik (Opus 43)', 'Edv. Grieg'), 0); // a piano piece
  assert.strictEqual(rule('Sonnet No. XXX', 'Benjamin Britten'), 0); // a Roman numeral
  assert.strictEqual(rule('Frosted Porn Flakes Live at The Swedenborgian Church', 'Frosted Porn Flakes', 'live'), 0); // a band
  assert.strictEqual(rule('The Kidnapping of President Lincoln', 'Joel Chandler Harris', 'librivox'), 0);
});

test('hate movements, caricature and explicit titles', () => {
  assert.strictEqual(rule('Hitler on the Jews', 'Adolf Hitler', 'lectures'), 2);
  assert.strictEqual(rule('Any title at all', 'Thomas Dalton', 'lectures'), 2);
  assert.strictEqual(rule('The Lives of the Prophets by Anwar Al-Awlaki', '', 'lectures'), 2);
  assert.strictEqual(rule("Amos 'N' Andy", 'Freeman Gosden'), 3);
  assert.strictEqual(rule('Amos & Andy! 309 Eps', '', 'otr'), 3);
  assert.strictEqual(rule('Coal Black Mammy', 'Ernest Hare'), 3);
  assert.strictEqual(rule('lecture-erotique-rapport-3eme-type', 'Charlie F', 'lectures'), 4);
});
