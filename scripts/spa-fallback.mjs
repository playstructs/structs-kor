/* Static hosts answer unknown paths with 404.html. Screens live at real paths (/console, /energy):
 * the build writes one HTML file per screen plus a noindex 404.html (vite.config.ts › seo), each the
 * app shell, which routes itself. Netlify/Cloudflare Pages also get _redirects. */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

if (!existsSync('dist/404.html')) copyFileSync('dist/index.html', 'dist/404.html');
writeFileSync('dist/_redirects', '/*  /index.html  200\n');
console.log('spa-fallback: dist/404.html, dist/_redirects');
