/* `pnpm playtest [--target URL] [--personas …] [--seeds 8] [--blocks 6000] [--skip sim,browser,ai]`
 * Runs every layer into one run directory, builds report.html, and exits non-zero if any layer's
 * gate failed. Extra flags pass through to each layer. */
import { spawnSync } from 'node:child_process';
import { args, reportDir, stamp } from './lib/util';

const a = args();
process.env.PLAYTEST_RUN ??= stamp();
const out = reportDir(a);
const skip = new Set((a.skip ?? '').split(',').filter(Boolean));
const pass = process.argv.slice(2).filter((x, i, all) => !(x === '--skip' || all[i - 1] === '--skip' || x.startsWith('--skip=')));
let worst = 0;
for (const layer of ['sim', 'browser', 'ai']) {
  if (skip.has(layer)) continue;
  console.log(`\n── ${layer} ──`);
  const r = spawnSync('npx', ['tsx', `playtest/${layer}/run.ts`, ...pass, '--out', out], { stdio: 'inherit', env: process.env });
  worst = Math.max(worst, r.status ?? 1);
}
spawnSync('npx', ['tsx', 'playtest/report/build.ts', '--out', out], { stdio: 'inherit' });
process.exitCode = worst;
