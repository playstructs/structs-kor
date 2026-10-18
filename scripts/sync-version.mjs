/* Sets the desktop app's version everywhere it's written, from the release tag (v1.2.3 → 1.2.3):
 * src-tauri/tauri.conf.json, src-tauri/Cargo.toml and src-tauri/Cargo.lock. Run by the release
 * workflow, so nobody bumps versions by hand before tagging. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) { console.error(`not a semver version: "${version}"`); process.exit(1); }

const conf = 'src-tauri/tauri.conf.json';
const c = JSON.parse(readFileSync(conf, 'utf8'));
c.version = version;
writeFileSync(conf, JSON.stringify(c, null, 2) + '\n');

const toml = 'src-tauri/Cargo.toml';
writeFileSync(toml, readFileSync(toml, 'utf8').replace(/(\[package\][^[]*?\nversion = ")[^"]*(")/, `$1${version}$2`));

const lock = 'src-tauri/Cargo.lock';
if (existsSync(lock)) writeFileSync(lock, readFileSync(lock, 'utf8').replace(/(name = "structs-kor"\nversion = ")[^"]*(")/, `$1${version}$2`));
console.log(`desktop version ${version}`);
