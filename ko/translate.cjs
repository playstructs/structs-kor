// Applies the Korean overlay to one structs-webapp source file.
//
// Nothing upstream is edited. Each upstream file that needs Korean has a twin
// under ko/strings/ (js/foo/Bar.js -> ko/strings/js/foo/Bar.js.json) mapping
// exact source text to its replacement. ko/patches.cjs holds the few changes
// that are not text (endpoints). Both are applied to the source as webpack
// reads it, so a newer structs-webapp builds with the same overlay; any entry
// whose text upstream no longer contains is reported as stale.
const fs = require('node:fs');
const path = require('node:path');

const UPSTREAM_SRC = path.resolve(__dirname, '../structs-webapp/src');
const STRINGS_DIR = path.join(__dirname, 'strings');
const PATCHES_FILE = path.join(__dirname, 'patches.cjs');

/** @param {string} file absolute path inside structs-webapp/src */
function upstreamPath(file) {
  return path.relative(UPSTREAM_SRC, file).split(path.sep).join('/');
}

/** @param {string} rel upstream path, e.g. js/index.js */
function stringsFile(rel) {
  return path.join(STRINGS_DIR, rel + '.json');
}

/**
 * The file's twin, as written: source text to replacement, plus an optional
 * "$keep" list of English left as is on purpose (read by ko/audit.cjs).
 *
 * @return {Object<string, string|string[]>}
 */
function readStringsFile(rel) {
  const file = stringsFile(rel);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`ko: ${path.relative(process.cwd(), file)}: ${error.message}`);
  }
}

/** @return {Object<string, string>} the replacements alone */
function loadStrings(rel) {
  return Object.fromEntries(Object.entries(readStringsFile(rel)).filter(([key]) => key !== '$keep'));
}

/** @return {Array<[string, string]>} */
function loadPatches(rel) {
  delete require.cache[PATCHES_FILE];
  return require(PATCHES_FILE)[rel] ?? [];
}

/**
 * Longest text first, so a sentence is replaced whole before any word in it.
 *
 * @param {string} source
 * @param {Array<[string, string]>} pairs
 * @param {string[]} stale collects the source text that was not found
 */
function replaceAll(source, pairs, stale) {
  let code = source;
  for (const [from, to] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    if (!source.includes(from)) {
      stale.push(from);
      continue;
    }
    code = code.split(from).join(to);
  }
  return code;
}

/**
 * @param {string} rel upstream path
 * @param {string} source upstream text
 * @return {{code: string, stale: string[], dependencies: string[]}}
 */
function translate(rel, source) {
  const stale = [];
  const patched = replaceAll(source, loadPatches(rel), stale);
  const code = replaceAll(patched, Object.entries(loadStrings(rel)), stale);
  return {code, stale, dependencies: [stringsFile(rel), PATCHES_FILE]};
}

module.exports = {UPSTREAM_SRC, STRINGS_DIR, upstreamPath, stringsFile, readStringsFile, loadStrings, translate};
