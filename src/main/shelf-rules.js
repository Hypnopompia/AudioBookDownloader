'use strict';

/*
 * Which items stay off the shelves while browsing.
 *
 * Nothing here is removed from the app: these items still turn up in search
 * results, and play, save and copy as usual. They just aren't shown on the
 * Home shelves, genre shelves or "See all" lists, so the front of the app
 * features the rest. The rules (agreed 2026-10-06):
 *
 *   1. Slurs in the title, about any group, from any era. No exceptions,
 *      so there are no case-by-case calls.
 *   2. Material made by hate movements and terrorist groups (Nazi and
 *      white-supremacist speeches and writings, Holocaust denial, terrorist
 *      recruiters). Work *about* them by others stays.
 *   3. Minstrel shows and racial-caricature entertainment.
 *   4. Sexually explicit titles.
 *
 * Words match whole words in the title only (not the author or tags, which
 * caught surnames and genre tags). Some words only count in some sources,
 * where they're otherwise mostly innocent (Squaw Valley concerts, raccoon
 * stories). When a rule catches something it shouldn't, change the rule
 * here rather than adding exceptions for single items.
 *
 * This file names slurs so it can match them; it is not displayed anywhere.
 */

const ALL = null; // every source
const NOT_LIVE = ['librivox', 'community', 'otr', 'lectures', '78s'];
const SPOKEN = ['community', 'otr', 'lectures']; // where explicit stories turned up

const RULES = [
  {
    rule: 1,
    words: [
      ['nigger', ALL], ['niggers', ALL], ['nigga', ALL], ['niggas', ALL], ['nigra', ALL], ['niggah', ALL],
      ['darkey', ALL], ['darkeys', ALL], ['darky', ALL], ['darkie', ALL], ['darkies', ALL],
      ['pickaninny', ALL], ['pickaninnies', ALL], ['jigaboo', ALL], ['sambo', ALL], ['golliwog', ALL], ['golliwogg', ALL],
      ['coon', ['78s', 'otr', 'community', 'lectures']], ['coons', ['78s', 'otr', 'community', 'lectures']],
      ['chink', ALL], ['chinks', ALL], ['chinaman', ALL], ['jap', ALL], ['japs', ALL],
      ['wop', ALL], ['wops', ALL], ['kike', ALL], ['kikes', ALL], ['wetback', ALL], ['wetbacks', ALL],
      ['squaw', ['librivox', 'community', 'otr', 'lectures', '78s']], ['squaws', ['librivox', 'community', 'otr', 'lectures', '78s']],
      ['redskin', ['librivox', 'community', 'otr', 'lectures', '78s']], ['redskins', ['librivox', 'community', 'otr', 'lectures', '78s']],
      ['injun', ALL], ['injuns', ALL], ['half breed', ALL], ['half breeds', ALL],
      ['faggot', ALL], ['faggots', ALL], ['fag', ALL], ['fags', ALL], ['retard', ALL], ['retards', ALL], ['retarded', ALL],
    ],
  },
  {
    rule: 2,
    // the movements' own material, by title
    words: [
      // apostrophes are dropped before matching, so "Hitler's" reads "hitlers"
      ['hitler on the', ALL], ['speeches from hitler', ALL], ['speeches from hitlers', ALL], ['hitler speech', ALL], ['hitler speeches', ALL],
      ['hitlers speech', ALL], ['hitlers speeches', ALL],
      ['goebbels', ALL], ['sportpalastrede', ALL], ['horst wessel', ALL], ['third reich speeches', ALL], ['mein kampf', ALL],
      ['protocols of the elders', ALL], ['ku klux', ALL], ['awlaki', ALL], ['degrelle', ALL], ['al jihad', ALL],
    ],
    // and by who made it
    creators: [
      'adolf hitler', 'joseph goebbels', 'heinrich himmler', 'julius streicher', 'george lincoln rockwell', 'william luther pierce',
      'david duke', 'ernst zundel', 'david irving', 'thomas dalton', 'anwar al awlaki', 'diary of a stranger',
    ],
  },
  {
    rule: 3,
    words: [
      ['amos n andy', ALL], ['amos and andy', ALL], ['minstrel show', ALL], ['minstrel shows', ALL], ['black and white minstrel', ALL],
      ['mitchell minstrels', ALL], ['blackface', ALL], ['coon song', ALL], ['coon songs', ALL], ['uncle remus', ALL], ['tar baby', ALL],
      ['mammy', ['78s', 'otr']],
    ],
    creators: ['amos n andy'],
  },
  {
    rule: 4,
    // Not in Live Music (band and venue names) and, for "erotic" words, not in the audiobook
    // classics or 78s, where they're classical titles (Grieg's "Erotik", Goethe's "Erotica Romana").
    words: [
      ['erotic', SPOKEN], ['erotica', SPOKEN], ['erotique', SPOKEN], ['erotisme', SPOKEN], ['erotik', SPOKEN],
      ['porn', NOT_LIVE], ['porno', NOT_LIVE], ['pornographic', NOT_LIVE], ['jizz', NOT_LIVE], ['maisons closes', NOT_LIVE],
    ],
  },
];

/** Lowercase words without accents or punctuation: "Amos 'N' Andy" -> "amos n andy", "Érotique" -> "erotique". */
const norm = (s) =>
  ' ' +
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/doo-wop/g, 'doowop') // the music genre, not the slur
    .replace(/[^a-z0-9]+/g, ' ') +
  ' ';

/** The rule (1-4) that keeps an item off the shelves, or 0. */
function shelfRule({ title, author }, sourceId) {
  const t = norm(title);
  const a = norm(author);
  for (const r of RULES) {
    for (const [word, sources] of r.words || []) {
      if ((!sources || sources.includes(sourceId)) && t.includes(` ${word} `)) return r.rule;
    }
    for (const c of r.creators || []) if (a.includes(` ${c} `)) return r.rule;
  }
  return 0;
}

module.exports = { shelfRule };
