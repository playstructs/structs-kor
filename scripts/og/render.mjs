/* Renders scripts/og/og.html to public/og.png (1200×630) with headless Chrome.
 * CHROME=/path/to/chrome overrides the browser. Needs the network for Google Fonts. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const src = fileURLToPath(new URL('./og.html', import.meta.url));
const out = resolve(fileURLToPath(new URL('../../public/og.png', import.meta.url)));
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=8000',
  `--screenshot=${out}`, 'file://' + src,
], { stdio: 'inherit' });
console.log('og: ' + out);
