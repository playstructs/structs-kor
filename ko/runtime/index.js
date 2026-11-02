// The Korean overlay's runtime, loaded ahead of structs-webapp's entry.
//
// Most of webapp's text is in its own source, which ko/strings/ translates at
// build time. Game data is not: struct classes, weapon names and the like come
// from the guild API in English, and some of it (structType.type) is also
// what webapp's code compares against. Such text is translated where it is
// shown, by overlay entries that call these helpers, never where it is read.
//
// __ko.guild is the guild this page plays through (guild.js).
import terms from './terms.json';
import {guild} from './guild.js';

const lookup = new Map(Object.entries(terms));
const reported = new Set();

globalThis.__ko = Object.freeze({

  guild,

  /**
   * @param {*} text English game data
   * @return {*} its Korean, or the value as it was
   */
  t(text) {
    if (typeof text !== 'string') {
      return text;
    }
    const korean = lookup.get(text);
    // A guild's wording that terms.json lacks is shown in English, and said once.
    if (korean === undefined && /[A-Za-z]{2}/.test(text) && !reported.has(text)) {
      reported.add(text);
      console.warn(`[ko] no Korean for game data ${JSON.stringify(text)}: add it to ko/runtime/terms.json`);
    }
    return korean ?? text;
  },

  /**
   * Replaces the named text fields of a display-only copy in place.
   *
   * @param {object} obj
   * @param {string[]} names
   * @return {object} obj
   */
  fields(obj, names) {
    for (const name of names) {
      obj[name] = this.t(obj[name]);
    }
    return obj;
  },
});
