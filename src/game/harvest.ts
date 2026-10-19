/* 자동 작업: builds, mining and refining finish themselves, wherever the player is in the client
 * (Structs Desktop's auto-build / auto-harvest). Every so often, and whenever an order lands, the
 * commander's owed work is read and handed to the hashing engine, which starts if it isn't running.
 * The engine waits on proofs the chain's bar is still far above (pow/engine.ts), so this costs little
 * until a proof is within reach. Stopping it on the bridge (작업 정지) is remembered. */
import { session } from '../api/session';
import { guildApi } from '../api/guild';
import { wallet } from '../wallet/wallet';
import { pow } from '../pow/engine';
import { DEMO_ID } from './demo';

const OFF = 'structs-kor.harvest.off', EVERY_MS = 45_000;
let pid: string | null = null, timer: ReturnType<typeof setInterval> | null = null, busy = false;

export function harvestOff(off: boolean) { try { if (off) localStorage.setItem(OFF, '1'); else localStorage.removeItem(OFF); } catch { /* fine */ } }
const isOff = () => { try { return localStorage.getItem(OFF) === '1'; } catch { return false; } };

async function round() {
  if (!pid || busy || wallet.state !== 'unlocked' || isOff()) return;
  busy = true;
  try {
    const [work, block] = await Promise.all([guildApi.workOf(pid), guildApi.block().catch(() => null)]);
    pow.sync(work, block?.height ?? null);
    if (work.length && !pow.running) pow.start();
  } catch { /* next round */ } finally { busy = false; }
}

session.onChange((s) => {
  const next = s.state === 'in' && s.playerId !== DEMO_ID ? s.playerId : null;
  if (next === pid) return;
  pid = next;
  if (timer) clearInterval(timer);
  timer = pid ? setInterval(() => void round(), EVERY_MS) : null;
  if (pid) void round();
});
addEventListener('structs:order', () => { setTimeout(() => void round(), 1500); });
