/* The desktop app's frontend: the same client as the website, built for the app's own origin
 * (tauri://localhost, http://tauri.localhost on Windows) at the root path. Share links still point at
 * the website (VITE_SITE_URL). Run by Tauri before it bundles (src-tauri/tauri.conf.json). */
import { execSync } from 'node:child_process';

const env = { ...process.env, VITE_BASE: '/', VITE_TRANSPORT: process.env.VITE_TRANSPORT || 'direct' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });
run('pnpm exec vite build');
run('node scripts/spa-fallback.mjs');
