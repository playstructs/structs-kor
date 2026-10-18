/* 일일 교전 (the daily challenge): one battle a day, the same for every commander, scored and
 * shareable without a server. The day rolls over at midnight KST. A result is just your orders: a
 * daily code carries them, and anyone who opens it plays the day again with the same seeded chain
 * and the same computer to get the score. Nobody can claim a score their orders didn't earn.
 *
 * Pure: no DOM, no storage. The guild's ladder (REQ-SIM-1) can take the same codes. */
import { base64urlnopad } from '@scure/base';
import { Chain, type Msg } from './chain';
import { Ai } from './ai';
import { CPU, YOU, chainSetup, dailyScenario, type Daily } from './fleets';
import { AMBITS, COMMAND_SHIP_ID, type Ambit } from '../data/catalogue';

/** Both sides start every daily on the same charge (the simulator's slider does not apply). */
export const DAILY_CHARGE = 10;
/** Daily #1. */
export const DAILY_EPOCH = '2026-10-18';
const START = 1000;
const KST = 9 * 3600e3;
const DAY = 86400e3;

/** Today's daily (YYYY-MM-DD) in KST. */
export const kstDay = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);
/** Milliseconds until the next daily (midnight KST). */
export const msToNextDaily = (now = Date.now()) => DAY - ((now + KST) % DAY);
/** The day `n` days before `day`. */
export const dayBefore = (day: string, n = 1) => new Date(Date.parse(day + 'T00:00:00Z') - n * DAY).toISOString().slice(0, 10);
/** Daily number: #1 is DAILY_EPOCH. */
export const dailyNo = (day: string) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(DAILY_EPOCH + 'T00:00:00Z')) / DAY) + 1;
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && kstDayValid(s);
const kstDayValid = (s: string) => { const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
/** A day that can be played: from #1 up to today, never tomorrow's. */
export const playable = (day: string, now = Date.now()) => isDay(day) && day >= DAILY_EPOCH && day <= kstDay(now);

/* ── Korean names (the same picks as dailyScenario's English ones, index for index) ── */
const ADJ_KO = ['침묵의', '강철', '텅 빈', '진홍', '최후의', '부서진', '창백한', '불타는', '고요한', '얼어붙은', '가라앉은', '검은', '기나긴', '좁은', '쓰라린', '머나먼'];
const NOUN_KO = ['모루', '자오선', '등불', '조류', '첨탑', '수확', '불침번', '장부', '용광로', '궤도', '경계', '서약', '여울', '불씨', '변경', '심판'];
const ADJ_EN = ['Silent', 'Iron', 'Hollow', 'Crimson', 'Last', 'Broken', 'Pale', 'Burning', 'Quiet', 'Frozen', 'Sunken', 'Black', 'Long', 'Narrow', 'Bitter', 'Distant'];
const NOUN_EN = ['Anvil', 'Meridian', 'Lantern', 'Tide', 'Spire', 'Harvest', 'Vigil', 'Ledger', 'Furnace', 'Orbit', 'Margin', 'Covenant', 'Shoal', 'Ember', 'Frontier', 'Reckoning'];
export const TWIST_KO: Record<Daily['twist']['id'], { name: string; note: string }> = {
  standard: { name: '대등한 조건', note: '함대 규모가 비슷합니다. 판을 읽고 타격을 계획하세요.' },
  outnumbered: { name: '수적 열세', note: '적이 네 척 더 끌고 왔습니다.' },
  battered: { name: '만신창이', note: '아군 함선이 지난 전투의 피해를 안고 시작합니다.' },
  'no-guards': { name: '호위 없음', note: '양측 모두 아무도 호위하지 않습니다.' },
  orbit: { name: '고궤도', note: '양측 지휘함이 모두 우주에 있습니다.' },
  fortress: { name: '요새', note: '방어할 수 있는 적 함선은 모두 지휘함을 지킵니다.' },
};
/** 작전 「강철 모루」 for "Operation Iron Anvil". */
export function nameKo(d: Daily): string {
  const m = /^Operation (\w+) (\w+)$/.exec(d.name);
  const a = m ? ADJ_EN.indexOf(m[1]) : -1, b = m ? NOUN_EN.indexOf(m[2]) : -1;
  return a >= 0 && b >= 0 ? `${ADJ_KO[a]} ${NOUN_KO[b]}` : d.name;
}

/* ── Playing a day ─────────────────────────────────────────────────────── */
export interface Order { height: number; msg: Msg }
export interface DailyResult {
  day: string;
  winner: 'player' | 'computer' | 'draw';
  /** Blocks the battle lasted. */
  blocks: number;
  stalemate?: 'quiet' | 'time';
  stars: number;
  score: number;
  /** Each side's ships in layout order: still flying? (the share grid) */
  mine: boolean[]; theirs: boolean[];
  hullMine: number; hullTheirs: number;
  /** Every executed order, both sides: what the simulator's replay link carries. */
  txs: { height: number; signer: string; msg: Msg }[];
}

/**
 * Play `day` with these orders of yours, the computer answering as it would live. This is the
 * simulator's battle loop (src/screens/sim.ts tick()) without the screen: your order for a block goes
 * in first, then the computer's, then the block; a fight that stalls 40 blocks or runs past 400 is
 * decided on hull. Returns null when an order comes after the battle was already over.
 */
export function playDaily(day: string, orders: Order[]): DailyResult | null {
  const d = dailyScenario(day);
  const { setup, idMap } = chainSetup(d.units, d.seed, { player: DAILY_CHARGE, computer: DAILY_CHARGE });
  const c = new Chain(setup);
  const ai = new Ai(CPU.id, d.difficulty, d.seed);
  const byHeight = new Map(orders.map((o) => [o.height, o.msg]));
  const txs: DailyResult['txs'] = [];
  let blocks = 0, quiet = 0, winner: DailyResult['winner'] | null = null, stalemate: DailyResult['stalemate'];
  const hull = (owner: string) => {
    const m = Object.values(c.structs).filter((s) => s.owner === owner);
    return m.reduce((t, s) => t + (c.isDestroyed(s) ? 0 : s.health), 0) / Math.max(1, m.reduce((t, s) => t + c.typeOf(s).maxHealth, 0));
  };
  while (!winner) {
    const mine = byHeight.get(c.height + 1);
    if (mine) { txs.push({ height: c.height + 1, signer: YOU.id, msg: mine }); c.submit(YOU.id, mine); }
    const theirs = ai.decide(c);
    if (theirs) { txs.push({ height: c.height + 1, signer: CPU.id, msg: theirs }); c.submit(CPU.id, theirs); }
    const b = c.produceBlock();
    blocks++; quiet++;
    if (b.txs.some((t) => t.ok && t.events.some((e) => e.category === 'struct_attack'))) quiet = 0;
    const fleets = c.fleetsAtBattle();
    if (fleets.length < 2) winner = fleets.includes(YOU.fleetId) ? 'player' : fleets.includes(CPU.fleetId) ? 'computer' : 'draw';
    else if (blocks > 400 || quiet > 40) {
      const a = hull(YOU.id), z = hull(CPU.id);
      stalemate = quiet > 40 ? 'quiet' : 'time';
      winner = Math.abs(a - z) < 0.02 ? 'draw' : a > z ? 'player' : 'computer';
    }
  }
  if (orders.some((o) => o.height > c.height)) return null;
  const alive = (side: 'player' | 'computer') => d.units.filter((u) => u.side === side).map((u) => { const s = c.get(idMap[u.id]); return !!s && !c.isDestroyed(s); });
  const mine = alive('player'), theirs = alive('computer');
  const lost = mine.filter((x) => !x).length, killed = theirs.filter((x) => !x).length;
  const hullMine = hull(YOU.id), hullTheirs = hull(CPU.id);
  // The simulator's stars: a win, losing no more than a third of your fleet, and a win inside 60 blocks.
  const stars = winner !== 'player' ? 0 : 1 + (lost <= mine.length / 3 ? 1 : 0) + (blocks < 60 ? 1 : 0);
  const score = winner === 'player'
    ? 1000 + stars * 150 + killed * 25 + Math.round(hullMine * 300) + Math.max(0, 200 - blocks)
    : killed * 25 + (winner === 'draw' ? 250 : 0) + Math.round((1 - hullTheirs) * 200);
  return { day, winner, blocks, stalemate, stars, score, mine, theirs, hullMine, hullTheirs, txs };
}

/* ── Daily codes: the day, a call sign, and your orders, in a few hundred characters ──
 *   byte 0     version (1)
 *   1–2        daily number (uint16)
 *   3          call sign length n (0–30 bytes, UTF-8), then n bytes
 *   …          order count (varint), then per order: block offset from the last (varint),
 *              message type, then its fields (a struct as its index in the layout, an ambit as
 *              its index, a slot or weapon as a byte, targets as a count then indexes).
 * Struct ids are 5-101, 5-102… in chainSetup's order, so an index fits a byte. */
const TYPES = [
  '/structs.structs.MsgStructAttack', '/structs.structs.MsgStructDefenseSet', '/structs.structs.MsgStructDefenseClear',
  '/structs.structs.MsgStructMove', '/structs.structs.MsgStructStealthActivate', '/structs.structs.MsgStructStealthDeactivate',
  '/structs.structs.MsgStructActivate', '/structs.structs.MsgStructDeactivate',
] as const;
type Field = 'id' | 'ids' | 'ws' | 'ambit' | 'slot' | 'loc';
const FIELDS: Record<(typeof TYPES)[number], [string, Field][]> = {
  '/structs.structs.MsgStructAttack': [['operatingStructId', 'id'], ['targetStructId', 'ids'], ['weaponSystem', 'ws']],
  '/structs.structs.MsgStructDefenseSet': [['defenderStructId', 'id'], ['protectedStructId', 'id']],
  '/structs.structs.MsgStructDefenseClear': [['defenderStructId', 'id']],
  '/structs.structs.MsgStructMove': [['structId', 'id'], ['locationType', 'loc'], ['ambit', 'ambit'], ['slot', 'slot']],
  '/structs.structs.MsgStructStealthActivate': [['structId', 'id']],
  '/structs.structs.MsgStructStealthDeactivate': [['structId', 'id']],
  '/structs.structs.MsgStructActivate': [['structId', 'id']],
  '/structs.structs.MsgStructDeactivate': [['structId', 'id']],
};
const WS = ['primaryWeapon', 'secondaryWeapon'] as const;
const LOC = ['fleet', 'planet'] as const;

export interface DailyCode { day: string; name: string; orders: Order[] }

export function encodeDaily(c: DailyCode): string {
  const out: number[] = [1];
  const no = dailyNo(c.day);
  out.push((no >> 8) & 255, no & 255);
  // Whole characters only: a call sign cut mid-syllable would not decode.
  let nm = [...c.name].slice(0, 16).join('');
  while (new TextEncoder().encode(nm).length > 30) nm = [...nm].slice(0, -1).join('');
  const name = [...new TextEncoder().encode(nm)];
  out.push(name.length, ...name);
  const varint = (n: number) => { do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); };
  const index = (id: string) => Number(id.slice(2)) - 101;
  const orders = c.orders.slice().sort((a, b) => a.height - b.height);
  varint(orders.length);
  let at = START;
  for (const o of orders) {
    varint(o.height - at); at = o.height;
    const type = o.msg['@type'] as (typeof TYPES)[number];
    out.push(TYPES.indexOf(type));
    const m = o.msg as unknown as Record<string, unknown>;
    for (const [k, f] of FIELDS[type]) {
      const v = m[k];
      if (f === 'id') out.push(index(v as string));
      else if (f === 'ids') { const l = v as string[]; out.push(l.length, ...l.map(index)); }
      else if (f === 'ws') out.push(WS.indexOf(v as (typeof WS)[number]));
      else if (f === 'loc') out.push(LOC.indexOf(v as (typeof LOC)[number]));
      else if (f === 'ambit') out.push(AMBITS.indexOf(v as Ambit));
      else out.push(v as number);
    }
  }
  return 'D' + base64urlnopad.encode(Uint8Array.from(out));
}

/** A shared code is untrusted: every byte is checked, and anything off rejects the whole code. */
export function decodeDaily(code: string): DailyCode | null {
  if (typeof code !== 'string' || !/^D[A-Za-z0-9_-]{4,4000}$/.test(code)) return null;
  try {
    const b = base64urlnopad.decode(code.slice(1));
    let i = 0;
    const byte = () => { if (i >= b.length) throw new Error('short'); return b[i++]; };
    const varint = () => { let n = 0, s = 0, x; do { x = byte(); n |= (x & 127) << s; s += 7; if (s > 21) throw new Error('varint'); } while (x & 128); return n; };
    if (byte() !== 1) return null;
    const no = (byte() << 8) | byte();
    const day = new Date(Date.parse(DAILY_EPOCH + 'T00:00:00Z') + (no - 1) * DAY).toISOString().slice(0, 10);
    const n = byte();
    if (n > 30) return null;
    const nameBytes = b.slice(i, i + n); if (nameBytes.length !== n) return null; i += n;
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes).replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 16);
    const units = dailyScenario(day).units.length;
    const id = () => { const x = byte(); if (x >= units) throw new Error('struct'); return '5-' + (101 + x); };
    const count = varint();
    if (count > 401) return null;
    const orders: Order[] = [];
    let at = START;
    for (let k = 0; k < count; k++) {
      const step = varint();
      // One order a block, in order: the battle screen can't send two into the same block.
      if (step < 1 || step > 401) return null;
      at += step;
      const type = TYPES[byte()];
      if (!type) return null;
      const msg: Record<string, unknown> = { '@type': type };
      for (const [key, f] of FIELDS[type]) {
        if (f === 'id') msg[key] = id();
        else if (f === 'ids') { const l = byte(); if (l < 1 || l > 4) return null; msg[key] = Array.from({ length: l }, id); }
        else if (f === 'ws') { const w = WS[byte()]; if (!w) return null; msg[key] = w; }
        else if (f === 'loc') { const l = LOC[byte()]; if (!l) return null; msg[key] = l; }
        else if (f === 'ambit') { const a = AMBITS[byte()]; if (!a) return null; msg[key] = a; }
        else { const s = byte(); if (s > 7) return null; msg[key] = s; }
      }
      if (Array.isArray(msg.targetStructId) && msg.targetStructId.includes(msg.operatingStructId)) return null;
      orders.push({ height: at, msg: msg as unknown as Msg });
    }
    if (i !== b.length) return null;
    return { day, name, orders };
  } catch { return null; }
}

/** Decode and play a shared code: its result, or null if the code is bad or not for a playable day. */
export function verifyDaily(code: string, now = Date.now()): (DailyResult & { name: string }) | null {
  const c = decodeDaily(code);
  if (!c || !playable(c.day, now)) return null;
  const r = playDaily(c.day, c.orders);
  return r && { ...r, name: c.name };
}

/** The spoiler-free result to paste in a chat: your fleet and theirs, survivors and losses. */
export function shareText(r: DailyResult, d: Daily, url: string): string {
  const [, mo, da] = r.day.split('-').map(Number);
  const head = r.winner === 'player' ? `승리 ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}` : r.winner === 'draw' ? '무승부' : '패배';
  return [
    `구조체 일일 교전 #${dailyNo(r.day)} · ${mo}월 ${da}일`,
    `작전 「${nameKo(d)}」 · ${TWIST_KO[d.twist.id].name}`,
    r.mine.map((x) => (x ? '🟦' : '⬛')).join(''),
    r.theirs.map((x) => (x ? '🟥' : '⬛')).join(''),
    `${head} · ${r.blocks}블록 · ${r.score.toLocaleString('ko-KR')}점`,
    url,
  ].join('\n');
}

/** Your ships and theirs, by type, in layout order (for a grid with icons). */
export const fleetTypes = (d: Daily, side: 'player' | 'computer') => d.units.filter((u) => u.side === side).map((u) => ({ type: u.type, cmd: u.type === COMMAND_SHIP_ID }));
