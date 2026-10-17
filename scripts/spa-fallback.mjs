/* Static hosts answer unknown paths with 404.html. Screens live at real paths (/console, /energy),
 * so the app shell doubles as 404.html and routes itself. Netlify/Cloudflare Pages also get
 * _redirects. */
import { copyFileSync, writeFileSync } from 'node:fs';

copyFileSync('dist/index.html', 'dist/404.html');
writeFileSync('dist/_redirects', '/*  /index.html  200\n');
console.log('spa-fallback: dist/404.html, dist/_redirects');
