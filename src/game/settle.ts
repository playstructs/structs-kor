/* A commander without a planet goes looking for one. Enlisting gives a commander a fleet but no home
 * world, and waiting for the player to find the 탐사 button left recruits planetless (structs.xyz
 * explores on its own too). Once signed in with the keys on this device, if the commander has no
 * planet, send the explore order: no prompt, like every other order. Enlisting calls this the moment
 * the guild join lands, before signing in, so the planet is on its way while the rest loads. A send that hasn't landed yet
 * isn't repeated for a couple of minutes, so a slow block or a reload can't double it. */
import { session } from '../api/session';
import { guildApi } from '../api/guild';
import { chainread } from '../api/chainread';
import { MOCK, invalidate } from '../api/http';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { notify } from './fx';

const RETRY_MS = 120_000;
const key = (pid: string) => `structs-kor.explore.${pid}`;
let busy = false;

export async function settle(pid: string) {
  if (busy || wallet.state !== 'unlocked' || wallet.commander?.playerId !== pid) return;
  busy = true;
  try {
    // Ask the chain itself: guild reads wait for sign-in, and the indexer can trail the join.
    const planet = MOCK ? (await guildApi.player(pid).catch(() => null))?.planet_id : await chainread.playerRaw(pid).then((r) => r.Player.planetId, () => undefined);
    if (planet !== '' && planet !== null) return;
    try { if (Date.now() - Number(localStorage.getItem(key(pid)) || 0) < RETRY_MS) return; localStorage.setItem(key(pid), String(Date.now())); } catch { /* no storage: still explore once this visit */ }
    await actions.planetExplore(pid);
    invalidate();
    notify('탐사 시작', '정착할 행성을 찾는 중입니다', 'cheong', 'confirm');
    dispatchEvent(new Event('structs:explored'));
  } catch (e) {
    // Already has one (a send from another tab landed first): nothing to do. Anything else: try again later.
    if (!/already/i.test((e as Error).message)) try { localStorage.removeItem(key(pid)); } catch { /* fine */ }
  } finally { busy = false; }
}

session.onChange((s) => { if (s.state === 'in' && s.playerId) void settle(s.playerId); });
