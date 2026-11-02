// The Korean overlay's runtime, loaded ahead of structs-webapp's entry.
//
// Most of webapp's text is in its own source, which ko/strings/ translates at
// build time. Game data is not: struct classes, weapon names and the like come
// from the guild API in English, and some of it (structType.type) is also
// what webapp's code compares against. Such text is translated where it is
// shown, by overlay entries that call these helpers, never where it is read.
import terms from './terms.json';

const lookup = new Map(Object.entries(terms));

globalThis.__ko = Object.freeze({

  /**
   * @param {*} text English game data
   * @return {*} its Korean, or the value as it was
   */
  t(text) {
    return typeof text === 'string' ? (lookup.get(text) ?? text) : text;
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
