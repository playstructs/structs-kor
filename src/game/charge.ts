/* 충전 (charge): blocks since the commander's last order. Every order spends it (a build 8, a power
 * switch 2, a shot 3–5, stealth 2, a guard change 1) and resets it to 0, so the bridge says how much
 * there is and how many blocks until each order is ready, instead of letting the chain refuse it.
 * Read from the chain each block (player lastAction against the tip). */
import { chainread } from '../api/chainread';
import { MOCK } from '../api/http';
import { pending } from '../api/pending';
import { BLOCK_SECONDS } from '../pow/work';
import { session } from '../api/session';

let pid: string | null = null, value: number | null = null, timer: ReturnType<typeof setTimeout> | null = null;
const fns = new Set<() => void>();
const set = (v: number | null) => { if (v === value) return; value = v; for (const f of fns) f(); };

async function tick() {
  if (!pid) return;
  try {
    const [p, h] = await Promise.all([chainread.playerRaw(pid), chainread.height()]);
    const last = Number((p as { gridAttributes?: Record<string, string> }).gridAttributes?.lastAction ?? 0);
    set(last ? Math.max(0, h - last) : null);
  } catch { /* keep the last reading */ }
  timer = setTimeout(tick, BLOCK_SECONDS * 1000);
}

export const charge = {
  /** Blocks of charge now, or null when unknown (the mock, or before the first reading). */
  get value() { return value; },
  /** Blocks until there is `need` charge (0 when ready, or unknown). */
  wait(need: number) { return value == null ? 0 : Math.max(0, need - value); },
  onChange(f: () => void) { fns.add(f); return () => { fns.delete(f); }; },
  follow(id: string | null) {
    if (id === pid) return;
    pid = id; if (timer) clearTimeout(timer); timer = null; set(null);
    if (id && !MOCK) void tick();
  },
};

session.onChange((s) => charge.follow(s.state === 'in' ? s.playerId : null));

// An order spends the charge at once (the chain's reading catches up a block later).
let seen = 0;
pending.onChange(() => { const top = pending.list()[0]; if (top && top.id > seen) { seen = top.id; if (value != null) set(0); } });
