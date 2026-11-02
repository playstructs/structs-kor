// Checks the Korean overlay against the structs-webapp submodule.
//
//   node ko/audit.cjs              report
//   node ko/audit.cjs --strict     also exit 1 if anything is reported
//   node ko/audit.cjs --json       machine-readable report
//   node ko/audit.cjs path/Part    only upstream files whose path contains Part
//
// Reports two things after a submodule update:
//   stale        overlay text that upstream no longer contains
//   untranslated English a player would read that the overlay leaves as is
//
// "Would read" is a heuristic over the parsed source: HTML text and
// alt/title/placeholder/aria-label/data-sui-tooltip values in strings and templates, and
// prose-like string literals, skipping console output, thrown errors, DOM
// lookups and the like. English kept on purpose is listed in ko/keep.json
// (everywhere) or under "$keep" in the file's own strings JSON.
const fs = require('node:fs');
const path = require('node:path');
const {UPSTREAM_SRC, STRINGS_DIR, readStringsFile, translate} = require('./translate.cjs');
const acorn = require(require.resolve('acorn', {paths: [UPSTREAM_SRC]}));

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const filters = args.filter(arg => !arg.startsWith('--'));

const keep = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'keep.json'), 'utf8')));

const SCAN_SKIP = /^js\/(ts|tests|vendor)\//;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    entry.isDirectory() ? walk(file, out) : out.push(file);
  }
  return out;
}

const rel = file => path.relative(UPSTREAM_SRC, file).split(path.sep).join('/');

const sources = [
  ...walk(path.join(UPSTREAM_SRC, 'js')).filter(file => file.endsWith('.js')),
  ...walk(path.join(UPSTREAM_SRC, 'templates')).filter(file => file.endsWith('.twig')),
].map(rel).filter(file => !SCAN_SKIP.test(file));

// ---- What a player reads ----

const LATIN = /[A-Za-z]{2,}/;

function clean(text) {
  return text.replace(/&nbsp;/g, ' ').replace(/&[a-z]+;|&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

/** Text nodes and readable attributes of an HTML-ish fragment. */
function fromMarkup(text) {
  const found = [];
  for (const [, , value] of text.matchAll(/\b(alt|title|placeholder|aria-label|data-sui-tooltip)="([^"]*)"/g)) {
    found.push(value);
  }
  const withoutTags = text.replace(/<[^>]*>?/g, '\n').replace(/^[^<]*>/, '\n');
  found.push(...withoutTags.split('\n'));
  return found.map(clean).filter(value => LATIN.test(value));
}

/** A plain string that reads as words rather than an identifier. */
function isProse(text) {
  const value = clean(text);
  if (!LATIN.test(value) || /^(https?:|\/|\.\/|#|data:)/.test(value)) {
    return false;
  }
  if (/\s/.test(value)) {
    // Selectors, class lists and CSS values have spaces but no sentence shape.
    return !/^[a-z0-9_\-.#:\[\]=(),>*'"\s]+$/.test(value) && !/^[\w-]+(\s[\w-]+)*$/.test(value) || /[A-Z]/.test(value);
  }
  // A lone capitalised word; all-caps words are enum values.
  return /^[A-Z][a-z]+[.!?:]?$/.test(value);
}

const QUIET_CALLEES = /^(console\.\w+|document\.(getElementById|querySelector|querySelectorAll|createElement|getElementsByClassName)|.*\.(getElementById|querySelector|querySelectorAll|closest|matches|addEventListener|removeEventListener|dispatchEvent|getItem|setItem|removeItem|add|remove|toggle|contains|getAttribute|setAttribute|removeAttribute|hasAttribute|startsWith|endsWith|includes|split|replace|replaceAll|indexOf|padStart|padEnd|join|test|match|postMessage|tap|debug|info|log|warn|error|trace|fetchJson|get|post|put|delete|send|goto|register|registerController|on|off|emit)|require|setTimeout|Symbol|CustomEvent|Event|RegExp)$/;

function calleeName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    const property = node.computed ? '[]' : node.property.name;
    return `${calleeName(node.object)}.${property}`;
  }
  if (node.type === 'ThisExpression') return 'this';
  return '?';
}

/** True when a string in this position is code, not something shown. */
function quietPosition(node, parent, grandparent) {
  if (!parent) return false;
  switch (parent.type) {
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
    case 'ImportExpression':
    case 'SwitchCase':
    case 'ThrowStatement':
      return true;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return parent.key === node;
    case 'MemberExpression':
      return parent.property === node;
    case 'BinaryExpression':
      return ['===', '!==', '==', '!=', 'in', 'instanceof'].includes(parent.operator);
    case 'CallExpression':
      return parent.callee !== node && QUIET_CALLEES.test(calleeName(parent.callee));
    case 'NewExpression':
      return /Error$|^(RegExp|URL|Worker|CustomEvent|Event|WebSocket)$/.test(calleeName(parent.callee));
    case 'TaggedTemplateExpression':
      return true;
    case 'TemplateLiteral':
      return grandparent && quietPosition(parent, grandparent, null);
    default:
      return false;
  }
}

function strings(code) {
  const found = [];
  let ast;
  try {
    ast = acorn.parse(code, {ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true, allowHashBang: true});
  } catch (error) {
    return [{line: error.loc?.line ?? 0, text: `(could not parse: ${error.message})`}];
  }
  const visit = (node, parent, grandparent) => {
    if (!node || typeof node.type !== 'string') return;
    const quiet = quietPosition(node, parent, grandparent);
    if (node.type === 'Literal' && typeof node.value === 'string' && !quiet) {
      const texts = /<\/?[a-z][^>]*>/i.test(node.value) ? fromMarkup(node.value) : (isProse(node.value) ? [clean(node.value)] : []);
      texts.forEach(text => found.push({line: node.loc.start.line, text}));
    }
    if (node.type === 'TemplateLiteral' && !quiet) {
      // Read whole, with each ${…} as a break, so a tag split by one is still a tag.
      const whole = node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).join('\u0000');
      const markup = /<\/?[a-z][^>]*>/i.test(whole);
      const lineOf = text => node.loc.start.line + (whole.slice(0, Math.max(0, whole.indexOf(text))).match(/\n/g)?.length ?? 0);
      if (markup) {
        fromMarkup(whole)
          .flatMap(text => text.split('\u0000'))
          .map(clean)
          .filter(text => LATIN.test(text))
          .forEach(text => found.push({line: lineOf(text), text}));
      } else {
        // A sentence with values in it reads as prose even between the ${…}.
        const sentence = node.expressions.length > 0 && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(whole) && /[A-Z]/.test(whole);
        whole.split('\u0000')
          .filter(value => isProse(value) || (sentence && LATIN.test(value)))
          .map(clean)
          .filter(text => LATIN.test(text))
          .forEach(text => found.push({line: lineOf(text), text}));
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(item => visit(item, node, parent));
      else if (child && typeof child.type === 'string') visit(child, node, parent);
    }
  };
  visit(ast, null, null);
  return found;
}

function markup(code) {
  const found = [];
  code.split('\n').forEach((line, index) => fromMarkup(line).forEach(text => found.push({line: index + 1, text})));
  return found;
}

// ---- Report ----

const report = {stale: [], untranslated: [], orphans: []};

for (const file of sources) {
  if (filters.length && !filters.some(filter => file.includes(filter))) continue;
  const source = fs.readFileSync(path.join(UPSTREAM_SRC, file), 'utf8');
  const {code, stale} = translate(file, source);
  stale.forEach(text => report.stale.push({file, text}));
  const found = file.endsWith('.twig') ? markup(code.replace(/{#[\s\S]*?#}/g, '')) : strings(code);
  const kept = new Set(readStringsFile(file).$keep ?? []);
  for (const {line, text} of found) {
    // Korean whose only Latin is acronyms and units (ID, HUD, kW) is translated.
    const translated = /[가-힣]/.test(text) && !/[a-z]{2,}/.test(text.replace(/\b[kKMG]?W\b|\bkW\b/g, ''));
    if (!translated && !keep.has(text) && !kept.has(text)) report.untranslated.push({file, line, text});
  }
}

// Overlay files whose upstream file is gone.
if (fs.existsSync(STRINGS_DIR) && !filters.length) {
  for (const file of walk(STRINGS_DIR)) {
    const upstream = path.relative(STRINGS_DIR, file).split(path.sep).join('/').replace(/\.json$/, '');
    if (!fs.existsSync(path.join(UPSTREAM_SRC, upstream))) report.orphans.push(upstream);
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const {file, text} of report.stale) console.log(`stale        ${file}: ${JSON.stringify(text)}`);
  for (const file of report.orphans) console.log(`orphan       ko/strings/${file}.json (upstream file removed)`);
  for (const {file, line, text} of report.untranslated) console.log(`untranslated ${file}:${line}: ${text}`);
  console.log(`\n${report.stale.length} stale, ${report.orphans.length} orphaned, ${report.untranslated.length} untranslated`);
}

const failed = report.stale.length + report.orphans.length + report.untranslated.length > 0;
process.exit(strict && failed ? 1 : 0);
