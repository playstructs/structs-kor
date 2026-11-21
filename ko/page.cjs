// Renders structs-webapp's pages to static HTML, with the Korean overlay
// applied: the game (templates/game/index.html.twig on templates/base.html.twig)
// and the public Sector Blitz leaderboard (templates/sector_blitz/index.html.twig).
//
// Only what those templates use is understood: blocks, comments, path() to
// the two pages, the leaderboard's sector and the webpack asset() call.
// Anything else Twig-shaped stops the build, so a template change upstream is
// noticed rather than shipped half-rendered.
const fs = require('node:fs');
const path = require('node:path');
const {UPSTREAM_SRC, translate} = require('./translate.cjs');

const BASE = 'templates/base.html.twig';
const GAME = 'templates/game/index.html.twig';
const LEADERBOARD = 'templates/sector_blitz/index.html.twig';
const LEADERBOARD_CONTROLLER = 'src/Controller/SectorBlitzController.php';
const BLOCK = /{%\s*block\s+(\w+)\s*%}([\s\S]*?){%\s*endblock\s*%}/g;

// Symfony's routes, as this site serves them.
const PATHS = {app_game: '/', app_sector_blitz: '/sector-blitz'};

// Google Tag Manager, high in <head> as Google asks.
const TRACKING = `<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-TBMW388T"></script>
        <script>
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
        </script>
        `;

function read(rel, stale) {
  const result = translate(rel, fs.readFileSync(path.join(UPSTREAM_SRC, rel), 'utf8'));
  result.stale.forEach(text => stale.push(`${rel} no longer contains ${JSON.stringify(text)}`));
  return result.code.replace(/{#[\s\S]*?#}/g, '');
}

/**
 * @param {string} indexBundle the built entry, relative to the site root
 * @return {{html: string, stale: string[], dependencies: string[]}}
 */
function renderPage(indexBundle) {
  const stale = [];
  const child = read(GAME, stale);
  const blocks = {};
  for (const [, name, body] of child.matchAll(BLOCK)) {
    blocks[name] = body;
  }

  const html = finish(read(BASE, stale)
    .replace(BLOCK, (match, name, fallback) => blocks[name] ?? fallback)
    .replace(/{{\s*asset\('js\/index\.js',\s*'webpack'\)\s*}}/g, '/' + indexBundle));

  const dependencies = [BASE, GAME].map(rel => path.join(UPSTREAM_SRC, rel));
  return {html, stale, dependencies};
}

/**
 * @return {boolean} whether this structs-webapp has the public leaderboard
 */
function hasLeaderboard() {
  return fs.existsSync(path.join(UPSTREAM_SRC, LEADERBOARD));
}

/**
 * @return {string[]} the sectors with a page of their own, from the route's requirement
 */
function leaderboardSectors() {
  const controller = fs.readFileSync(path.join(UPSTREAM_SRC, LEADERBOARD_CONTROLLER), 'utf8');
  const requirement = controller.match(/'\/sector-blitz\/{sector}'[^\n]*'sector'\s*=>\s*'([\d|]+)'/);
  if (!requirement) {
    throw new Error(`ko: page: no sector requirement in ${LEADERBOARD_CONTROLLER}`);
  }
  return requirement[1].split('|');
}

/**
 * The public Sector Blitz leaderboard, for every sector or one.
 *
 * @param {string} bundle the built entry, relative to the site root
 * @param {string|null} sector
 * @return {{html: string, stale: string[], dependencies: string[]}}
 */
function renderLeaderboardPage(bundle, sector = null) {
  const stale = [];
  const html = finish(read(LEADERBOARD, stale)
    .replace(/{{\s*path\('(\w+)'\)\s*}}/g, (match, name) => {
      if (!(name in PATHS)) throw new Error(`ko: page: no path for route ${name}`);
      return PATHS[name];
    })
    .replace(/{{\s*sector\s*\?\?\s*''\s*}}/g, sector ?? '')
    .replace(/{{\s*asset\('js\/sectorBlitz\.js',\s*'webpack'\)\s*}}/g, '/' + bundle));

  const dependencies = [LEADERBOARD, LEADERBOARD_CONTROLLER].map(rel => path.join(UPSTREAM_SRC, rel));
  return {html, stale, dependencies};
}

/** Adds tracking and the Korean stylesheet, and checks that no Twig is left. */
function finish(html) {
  html = html
    .replace('<title>', TRACKING + '<title>')
    .replace('</head>', '    <link rel="stylesheet" href="/ko/ko.css">\n    </head>');

  const leftover = html.match(/{[{%][\s\S]*?[}%]}/);
  if (leftover) {
    throw new Error(`ko: page: unrendered Twig ${JSON.stringify(leftover[0])}`);
  }
  return html;
}

module.exports = {renderPage, hasLeaderboard, leaderboardSectors, renderLeaderboardPage};
