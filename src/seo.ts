/* Search and share metadata, one entry per screen.
 *
 * The build (vite.config.ts › seo) writes a copy of the shell for every indexed path with that
 * path's <head> filled in (title, description, canonical, Open Graph, Twitter), plus sitemap.xml
 * and robots.txt. In the browser, applySeo keeps the same tags current as the router moves, so
 * what a crawler renders matches what the static file said. No import.meta here: the Vite config
 * imports this file too. */

export interface PageSeo {
  title: string;
  description: string;
  /** Left out of the sitemap; noindex too unless it names a canonical (private or duplicate screens). */
  hidden?: boolean;
  /** The path this one duplicates, for rel=canonical. */
  canonical?: string;
  priority?: number;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export const SITE_NAME = '구조체 STRUCTS';
export const SITE_TAGLINE = '우주는 구조체가 지배한다';
export const DEFAULT_DESCRIPTION =
  'Structs 한국 서버. 행성을 채굴하고, 알파 매터를 정제하고, 길드와 함께 함대를 지휘하는 실시간 우주 전략 게임. 설치 없이 브라우저에서 바로 무료로 플레이하세요.';
export const KEYWORDS =
  '구조체, Structs, 스트럭츠, 우주 전략 게임, 하드코어 전략, 웹 게임, 브라우저 게임, 무료 게임, 함대 전투, 길드, 행성 채굴, 알파 매터, MMO 전략';
export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630, alt: '구조체 STRUCTS — 우주는 구조체가 지배한다' };
export const THEME_COLOR = '#16142A';

export const PAGES: Record<string, PageSeo> = {
  '/': { title: `${SITE_NAME} — ${SITE_TAGLINE}`, description: DEFAULT_DESCRIPTION, priority: 1, changefreq: 'daily' },
  '/start': { title: '사령관 입대', description: '구조체 STRUCTS에 사령관으로 입대하세요. 브라우저에서 지갑을 만들고 바로 한국 서버에 합류합니다.', priority: 0.9, changefreq: 'monthly' },
  '/login': { title: '로그인', description: '구조체 STRUCTS 사령관 로그인.', hidden: true, canonical: '/start' },
  '/tutorial': { title: '훈련소 · 전투 훈련', description: '처음이라면 여기서 시작하세요. 전투 보드에서 구조체 배치, 공격, 방어를 한국어로 차근차근 배웁니다.', priority: 0.9, changefreq: 'monthly' },
  '/campaign': { title: '작전 · 캠페인', description: '열 개의 작전 임무. 점점 강해지는 적 함대를 상대로 전략을 시험하고 보상을 얻으세요.', priority: 0.8, changefreq: 'weekly' },
  '/daily': { title: '일일 교전 · 오늘의 작전', description: '매일 자정(KST) 새 작전. 모든 사령관이 같은 함대, 같은 적과 싸웁니다. 점수를 겨루고 결과를 카카오톡으로 공유하세요.', priority: 0.9, changefreq: 'daily' },
  '/sim': { title: '전투 시뮬레이터', description: 'Structs 실제 전투 규칙을 그대로 옮긴 시뮬레이터. 습격 전에 함대 구성과 결과를 미리 확인하세요.', priority: 0.8, changefreq: 'weekly' },
  '/codex': { title: '교본 · 게임 가이드', description: '채굴, 정제, 전력망, 전투, 길드까지 구조체의 모든 시스템을 한 페이지에. 수치는 게임 상수에서 직접 읽어옵니다.', priority: 0.8, changefreq: 'weekly' },
  '/console': { title: '함교 · 사령부', description: '행성, 광석, 전력, 함대를 한눈에. 사령관의 지휘 콘솔.', priority: 0.7, changefreq: 'daily' },
  '/galaxy': { title: '은하 지도', description: '은하의 상위 사령관과 행성을 살펴보고 함대를 출격시키세요.', priority: 0.7, changefreq: 'daily' },
  '/energy': { title: '전력망', description: '발전기, 변전소, 전력 할당. 정전(브라운아웃)을 미리 계산하고 구조체 전력을 관리하세요.', priority: 0.6, changefreq: 'weekly' },
  '/market': { title: '시장', description: '전력 계약, 판매자, 길드 은행. 알파와 전력을 사고파세요.', priority: 0.6, changefreq: 'daily' },
  '/replicants': { title: '레플리칸트', description: '레플리칸트를 복제하고 상시 명령을 맡겨 기지를 자동으로 운영하세요.', priority: 0.6, changefreq: 'weekly' },
  '/guild': { title: '길드', description: '길드 명단과 은행. 동료와 전력을 나누고 동맹 행성을 함께 방어하세요.', priority: 0.7, changefreq: 'daily' },
  '/chat': { title: '통신', description: '길드 채널과 교신 기록. Matrix 기반 실시간 길드 채팅.', priority: 0.5, changefreq: 'daily' },
  '/record': { title: '전적', description: '사령관 계급과 경력, 훈장, 작전 목표.', priority: 0.5, changefreq: 'weekly' },
  '/profile': { title: '사령관 프로필', description: '사령관 프로필.', hidden: true },
  '/diag': { title: '시스템 진단', description: '연결, 데이터 지연, 작업 엔진, 대체 경로를 한눈에.', hidden: true },
  '/board': { title: '작전 보드', description: '내 방식대로 배치하는 실시간 카드 콘솔. 프리셋과 보드 공유.', hidden: true },
  '/war': { title: '작전 상황실', description: '표적 보드, 원한과 공격 금지 목록, 내 행성 사건 기록, 진행 중인 습격.', hidden: true },
  '/stats': { title: '은하 통계 · 랭킹', description: '사령관, 행성, 구조체 수와 서버 상태, 최고의 사령관과 길드 순위.', priority: 0.6, changefreq: 'daily' },
  '/o': { title: '객체 카드', description: '플레이어, 행성, 구조체, 함대, 길드, 공급자 — 구조체의 모든 객체를 실시간 카드로.', hidden: true },
  '/s': { title: '공유된 상황', description: '사령관이 공유한 전장 상황. 습격, 전투 예측, 거래 제안을 한 장의 카드로.', hidden: true },
  '/404': { title: '찾을 수 없는 좌표', description: '요청한 페이지를 찾을 수 없습니다.', hidden: true },
};

/** A screen's page; a path below a screen (a shared daily result, a replay) is that screen, not indexed on its own. */
export const pageFor = (path: string): PageSeo => {
  if (PAGES[path]) return PAGES[path];
  const top = '/' + path.split('/')[1];
  return top !== path && (top === '/daily' || top === '/sim' || top === '/o' || top === '/s') ? { ...PAGES[top], canonical: top, hidden: true } : PAGES['/404'];
};
export const fullTitle = (path: string, p = pageFor(path)) => (path === '/' ? p.title : `${p.title} | ${SITE_NAME}`);

/** Absolute URL of a path. `base` has no trailing slash ('' at the root). */
export const absUrl = (siteUrl: string, base: string, path: string) => siteUrl + base + path;
const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS_HIDDEN = 'noindex, follow';
/** A duplicate keeps index so its canonical is honoured; private screens are noindex. */
const robotsFor = (p: PageSeo) => (p.hidden && !p.canonical ? ROBOTS_HIDDEN : ROBOTS_INDEX);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The <head> tags for one path, written into the static HTML at build time. */
export function headFor(path: string, siteUrl: string, base: string): string {
  const p = pageFor(path);
  const url = absUrl(siteUrl, base, p.canonical ?? path);
  const home = absUrl(siteUrl, base, '/');
  const image = absUrl(siteUrl, base, OG_IMAGE.path);
  const title = fullTitle(path, p);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': home + '#website', url: home, name: SITE_NAME, alternateName: ['구조체', 'Structs Korea', '구조체.com'], inLanguage: 'ko-KR', description: DEFAULT_DESCRIPTION },
      {
        '@type': 'VideoGame', '@id': home + '#game', name: SITE_NAME, alternateName: ['Structs', '구조체'], url: home, image, description: DEFAULT_DESCRIPTION,
        inLanguage: 'ko-KR', genre: ['Strategy', 'MMO', 'Space'], gamePlatform: ['Web browser', 'Desktop', 'Mobile'], applicationCategory: 'GameApplication', operatingSystem: 'Any',
        playMode: ['MultiPlayer', 'SinglePlayer'], isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW', availability: 'https://schema.org/InStock', url: home },
      },
      { '@type': 'WebPage', '@id': url + '#webpage', url, name: title, description: p.description, inLanguage: 'ko-KR', isPartOf: { '@id': home + '#website' }, about: { '@id': home + '#game' }, primaryImageOfPage: { '@type': 'ImageObject', url: image, width: OG_IMAGE.width, height: OG_IMAGE.height } },
    ],
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<meta name="keywords" content="${esc(KEYWORDS)}">`,
    `<meta name="robots" content="${robotsFor(p)}">`,
    `<meta name="googlebot" content="${robotsFor(p)}">`,
    `<meta name="application-name" content="${SITE_NAME}">`,
    `<meta name="apple-mobile-web-app-title" content="구조체">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="format-detection" content="telephone=no">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="ko" href="${url}">`,
    `<link rel="alternate" hreflang="x-default" href="${url}">`,
    `<link rel="sitemap" type="application/xml" href="${absUrl(siteUrl, base, '/sitemap.xml')}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="ko_KR">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:secure_url" content="${image}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(p.description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:image:alt" content="${esc(OG_IMAGE.alt)}">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n  ');
}

/** Paths that go in the sitemap, highest priority first. */
export const indexedPaths = () =>
  Object.entries(PAGES).filter(([, p]) => !p.hidden).sort((a, b) => (b[1].priority ?? 0.5) - (a[1].priority ?? 0.5)).map(([path]) => path);

export function sitemapXml(siteUrl: string, base: string, lastmod: string): string {
  const urls = indexedPaths().map((path) => {
    const p = PAGES[path];
    const loc = absUrl(siteUrl, base, path);
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${p.changefreq ?? 'weekly'}</changefreq>\n    <priority>${(p.priority ?? 0.5).toFixed(1)}</priority>\n    <xhtml:link rel="alternate" hreflang="ko" href="${loc}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>${path === '/' ? `\n    <image:image><image:loc>${absUrl(siteUrl, base, OG_IMAGE.path)}</image:loc></image:image>` : ''}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Everyone may crawl everything. */
export const robotsTxt = (siteUrl: string, base: string) =>
  `# 구조체 STRUCTS — all crawlers, all paths, welcome.\nUser-agent: *\nAllow: /\n\nSitemap: ${absUrl(siteUrl, base, '/sitemap.xml')}\n`;

/** Keep <head> in step with the screen the router just showed. */
export function applySeo(path: string, siteUrl: string, base: string) {
  const p = pageFor(path);
  const url = absUrl(siteUrl, base, p.canonical ?? path);
  document.title = fullTitle(path, p);
  const set = (sel: string, attr: string, value: string) => document.head.querySelector(sel)?.setAttribute(attr, value);
  set('meta[name="description"]', 'content', p.description);
  set('meta[name="robots"]', 'content', robotsFor(p));
  set('meta[name="googlebot"]', 'content', robotsFor(p));
  set('link[rel="canonical"]', 'href', url);
  for (const el of document.head.querySelectorAll('link[rel="alternate"][hreflang]')) el.setAttribute('href', url);
  set('meta[property="og:url"]', 'content', url);
  set('meta[property="og:title"]', 'content', document.title);
  set('meta[property="og:description"]', 'content', p.description);
  set('meta[name="twitter:title"]', 'content', document.title);
  set('meta[name="twitter:description"]', 'content', p.description);
}
