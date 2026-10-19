/* Alerts: raids on the signed-in commander's planet, wherever they are in the client. GRASS reports
 * each raid_status change; this turns them into the alarm, banners, music and XP that the retired
 * demo director used to give (src/game/director.ts). The bridge still plays the attacks itself. */
import { session } from '../api/session';
import { orderName } from '../i18n/ko';
import { playerMessage } from '../api/errors';
import type { Order } from '../api/pending';
import { guildApi } from '../api/guild';
import { onGrass } from '../grass/grass';
import { current } from '../router';
import { sfx } from './sfx';
import { banner, flash, notify, shake } from './fx';
import { music } from './music';
import { career } from './progress';
import { pushNative } from './native';
import { watchlist, onWatch } from '../social/actions';

let off: (() => void) | null = null, watching: string | null = null, last = '';

function onStatus(status: string, fleet: string) {
  const key = `${fleet}:${status}`;
  if (key === last) return;
  last = key;
  const away = current() !== '/console';
  if (status === 'ongoing' || status === 'initiated') {
    music.setMode('battle');
    sfx.play('alarm'); flash();
    notify('경보', `함대 ${fleet}이(가) 행성을 습격합니다${away ? ' · C로 함교 복귀' : ''}`, 'jeok', null);
    pushNative('raid', '습격 경보', `함대 ${fleet}이(가) 내 행성을 습격합니다`);
    if (!away) { shake('lg'); banner({ kicker: '습격', title: '적 함대 도착', sub: `함대 ${fleet}`, tone: 'jeok', ms: 2000 }); }
  } else if (status === 'attackerDefeated' || status === 'attackerRetreated') {
    music.setMode('calm');
    career.bump('repelled');
    career.award(40, '습격 격퇴');
    sfx.play('victory');
    const title = status === 'attackerRetreated' ? '적 함대 철수' : '습격 격퇴';
    pushNative('raid', '방어 성공', title);
    if (away) notify('방어 성공', title, 'hwang', null); else banner({ kicker: '방어 성공', title, sub: `함대 ${fleet}`, tone: 'gold', ms: 2600 });
  } else if (status === 'raidSuccessful') {
    music.setMode('calm');
    sfx.play('defeat');
    pushNative('raid', '방어 실패', '광석을 약탈당했습니다');
    if (away) notify('방어 실패', '광석을 약탈당했습니다', 'jeok', null); else { shake('lg'); banner({ kicker: '방어 실패', title: '약탈당함', sub: `함대 ${fleet}`, tone: 'jeok' }); }
  }
}

async function watch() {
  const pid = session.status.state === 'in' ? session.playerId : null;
  if (pid === watching) return;
  off?.(); off = null; watching = pid; last = '';
  if (!pid) return;
  const planet = await guildApi.player(pid).then((p) => p.planet_id).catch(() => null);
  if (!planet || watching !== pid) return;
  off = onGrass(`structs.planet.${planet}.>`, (e) => {
    if (e.category !== 'raid_status') return;
    onStatus(String(e.data.status ?? (e.data.detail as Record<string, unknown> | undefined)?.status ?? ''), String(e.data.fleet_id ?? (e.data.detail as Record<string, unknown> | undefined)?.fleet_id ?? ''));
  });
}

session.onChange(() => void watch());

/* Watched planets (☆ on any card, or the palette's 감시): a raid on one is news wherever you are. */
const watchOffs = new Map<string, () => void>();
function syncWatch() {
  const want = session.status.state === 'in' ? new Set(watchlist().filter((w) => w.startsWith('2-'))) : new Set<string>();
  for (const [id, off] of watchOffs) if (!want.has(id)) { off(); watchOffs.delete(id); }
  for (const id of want) {
    if (watchOffs.has(id)) continue;
    let lastKey = '';
    watchOffs.set(id, onGrass(`structs.planet.${id}.>`, (e) => {
      if (e.category !== 'raid_status') return;
      const d = (e.data.detail ?? {}) as Record<string, unknown>;
      const status = String(e.data.status ?? d.status ?? ''), fleet = String(e.data.fleet_id ?? d.fleet_id ?? '');
      if (`${fleet}:${status}` === lastKey) return;
      lastKey = `${fleet}:${status}`;
      if (status === 'ongoing' || status === 'initiated') { notify('감시 경보', `감시 중인 행성 ${id}이(가) 습격받고 있습니다 · 함대 ${fleet}`, 'jeok', 'alarm'); pushNative('raid', '감시 행성 습격', `${id} · 함대 ${fleet}`); }
      else if (status === 'raidSuccessful') notify('감시 행성 약탈', `${id}이(가) 약탈당했습니다`, 'jeok', null);
      else if (status === 'attackerDefeated' || status === 'attackerRetreated') notify('감시 행성 방어', `${id}이(가) 습격을 막아냈습니다`, 'hwang', null);
    }));
  }
}
session.onChange(syncWatch);
onWatch(syncWatch);

/* A transaction that made it into a block but failed there: say so (the broadcast toast said 전송됨). */
import { onTxFailed } from '../api/txlog';
onTxFailed((t) => notify('명령 실패', `${orderName(t.name)} · ${playerMessage(t.error)}`, 'jeok', 'error'));
// The first planet is the moment the game starts: say so when the explore order has landed.
addEventListener('structs:order', (e) => { const o = (e as CustomEvent<Order>).detail; if (o.name === 'MsgPlanetExplore' && o.phase === 'done') notify('행성 발견', '정착할 행성을 찾았습니다 · 이제 건설할 수 있습니다', 'cheong', 'confirm'); });
