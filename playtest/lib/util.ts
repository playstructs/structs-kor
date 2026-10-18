/* Small shared helpers for the playtest CLIs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** `--key value` and `--flag` into a record. */
export function args(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v != null) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = 'true';
  }
  return out;
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export const reportDir = (a: Record<string, string>) => resolve(a.out ?? `playtest/reports/${process.env.PLAYTEST_RUN ?? stamp()}`);

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
