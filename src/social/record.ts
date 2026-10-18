/* 복무 기록 (service record): a commander's lifetime figures as ribbons, tiers I–VI, read from the
 * guild (ore stats, planets drained, raids launched) and the ledger (refined, infused, mined, seized,
 * forfeited; one `seized` row per raid won). A figure the guild can't give shows "—", never 0.
 * After structs-universe's RECORD card (src-tauri mcp/achievements.rs). */
import { call, get } from '../api/http';

export type Counter = 'ore_mined' | 'alpha_refined' | 'alpha_infused' | 'raids_launched' | 'raids_won' | 'ore_seized' | 'ore_forfeited' | 'planets_drained';
export interface Ribbon { key: Counter; name: string; unit: string; value: number | null; tier: number; next: number | null; family: '산업' | '습격' | '방어' }
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
export const roman = (t: number) => ROMAN[t] ?? '';

const SPEC: { key: Counter; name: string; unit: string; steps: number[]; family: Ribbon['family'] }[] = [
  { key: 'ore_mined', name: '채굴', unit: '광석', steps: [100, 1_000, 5_000, 20_000, 100_000, 500_000], family: '산업' },
  { key: 'alpha_refined', name: '정제', unit: 'g', steps: [1, 10, 100, 1_000, 10_000, 100_000], family: '산업' },
  { key: 'alpha_infused', name: '주입', unit: 'g', steps: [1, 10, 100, 1_000, 10_000, 100_000], family: '산업' },
  { key: 'raids_launched', name: '출격', unit: '회', steps: [1, 5, 20, 50, 150, 500], family: '습격' },
  { key: 'raids_won', name: '습격 승리', unit: '회', steps: [1, 5, 20, 50, 150, 500], family: '습격' },
  { key: 'ore_seized', name: '약탈', unit: '광석', steps: [10, 100, 1_000, 5_000, 20_000, 100_000], family: '습격' },
  { key: 'planets_drained', name: '행성 고갈', unit: '곳', steps: [1, 2, 5, 10, 25, 50], family: '산업' },
  { key: 'ore_forfeited', name: '빼앗긴 광석', unit: '광석', steps: [], family: '방어' },
];

/** The tier a value earns (0 below the first step) and the next step to reach. */
export function tierOf(value: number | null, steps: number[]): { tier: number; next: number | null } {
  if (value == null || !steps.length) return { tier: 0, next: null };
  const tier = steps.filter((s) => value >= s).length;
  return { tier, next: steps[tier] ?? null };
}

/** Sum ledger rows the way the record counts them (only the primary leg of each pair). */
export function foldLedger(rows: { action?: string; denom?: string; amount?: unknown; amount_p?: unknown }[]): Partial<Record<Counter, number>> {
  const out: Partial<Record<Counter, number>> = {};
  for (const r of rows) {
    const amt = Number(r.amount_p ?? r.amount ?? 0) || 0;
    const key: Counter | null = r.action === 'refined' && r.denom === 'ualpha' ? 'alpha_refined' : r.action === 'infused' && r.denom === 'ualpha' ? 'alpha_infused'
      : r.action === 'mined' && r.denom === 'ore' ? 'ore_mined' : r.action === 'seized' && r.denom === 'ore' ? 'ore_seized' : r.action === 'forfeited' && r.denom === 'ore' ? 'ore_forfeited' : null;
    if (!key) continue;
    out[key] = (out[key] ?? 0) + (key.startsWith('alpha') ? amt / 1e6 : amt);
    if (key === 'ore_seized') out.raids_won = (out.raids_won ?? 0) + 1;
  }
  return out;
}

export function ribbons(c: Partial<Record<Counter, number>>): Ribbon[] {
  return SPEC.map((s) => { const value = c[s.key] ?? null; return { key: s.key, name: s.name, unit: s.unit, value, family: s.family, ...tierOf(value, s.steps) }; });
}

const count = (v: unknown) => { const n = Number((v as { count?: unknown } | null)?.count ?? v); return Number.isFinite(n) ? n : null; };
/** Read everything the guild has for one commander. */
export async function serviceRecord(playerId: string): Promise<Ribbon[]> {
  const id = encodeURIComponent(playerId);
  const soft = <T,>(p: Promise<T>) => p.catch(() => null);
  const [ore, planets, raids] = await Promise.all([soft(get<Record<string, unknown>>(`player/${id}/ore/stats`)), soft(get(`player/${id}/planet/completed`)), soft(get(`player/${id}/raid/launched`))]);
  const c: Partial<Record<Counter, number>> = {};
  if (ore) for (const [f, k] of [['mined', 'ore_mined'], ['seized', 'ore_seized'], ['forfeited', 'ore_forfeited']] as const) if (ore[f] != null) c[k] = Number(ore[f]);
  const p = count(planets), r = count(raids);
  if (p != null) c.planets_drained = p;
  if (r != null) c.raids_launched = r;
  // The ledger, every page or none: a partial sum would be a smaller number wearing the same label.
  const rows: Record<string, unknown>[] = [];
  let complete = false;
  for (let page = 1; page <= 20; page++) {
    const body = await call<Record<string, unknown>[]>(`ledger/list/player/${id}/page/${page}?limit=200`).catch(() => null);
    if (!body) break;
    const data = body.data ?? [];
    rows.push(...data);
    if (data.length < 200) { complete = true; break; }
  }
  if (complete) Object.assign(c, foldLedger(rows));
  return ribbons(c);
}
