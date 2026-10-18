/* `npx tsx playtest/ai/collect.ts --out <run dir> [--triage triage.json]` — merge the per-profile
 * results the drivers wrote (<out>/ai/<id>.json) into <out>/ai.json: feature coverage across the
 * run (the best status any profile reached, and who), the accounts used, and an optional triage
 * written by whoever read the notes. Then `pnpm playtest:report --out <run dir>`. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURES } from '../features';
import type { AiResult } from './agent';
import { args, reportDir, writeJson } from '../lib/util';

const a = args();
const out = reportDir(a);
const dir = resolve(out, 'ai');
const results: AiResult[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));
const rank = { touched: 0, guarded: 1, blocked: 2, passed: 3, failed: 4 } as const;
const coverage: Record<string, { status: string; by: string[]; notes: string[] }> = {};
for (const f of FEATURES) coverage[f.id] = { status: 'untouched', by: [], notes: [] };
for (const r of results) for (const [id, raw] of Object.entries(r.coverage)) {
  const c = { ...raw, status: raw.status in rank ? raw.status : 'touched' }; // older drivers took any word
  const cur = coverage[id]; if (!cur) continue;
  if (cur.status === 'untouched' || rank[c.status as keyof typeof rank] > rank[cur.status as keyof typeof rank]) cur.status = c.status;
  cur.by.push(`${r.persona}:${c.status}`); if (c.note && c.note !== 'screen visited') cur.notes.push(`${r.persona}: ${c.note}`);
}
const triage = a.triage && existsSync(a.triage) ? JSON.parse(readFileSync(a.triage, 'utf8')) : null;
const accounts = results.map((r) => r.account).filter(Boolean);
writeJson(resolve(out, 'ai.json'), { at: new Date().toISOString(), model: results[0]?.model, agent: 'subagent', accounts, coverage, results, triage, cost: null });
const counts = Object.values(coverage).reduce<Record<string, number>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});
console.log(`collected ${results.length} profiles · ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')} · ${accounts.length} accounts · ${resolve(out, 'ai.json')}`);
