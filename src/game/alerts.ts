/* Alerts: raids on the signed-in commander's planet, wherever they are in the client. GRASS reports
 * each raid_status change; this turns them into the alarm, banners, music and XP that the retired
 * demo director used to give (src/game/director.ts). The bridge still plays the attacks itself. */
import { session } from '../api/session';
import { guildApi } from '../api/guild';
import { onGrass } from '../grass/grass';
import { current } from '../router';
import { sfx } from './sfx';
import { banner, flash, notify, shake } from './fx';
import { music } from './music';
import { career } from './progress';

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
    if (!away) { shake('lg'); banner({ kicker: '습격', title: '적 함대 도착', sub: `함대 ${fleet}`, tone: 'jeok', ms: 2000 }); }
  } else if (status === 'attackerDefeated' || status === 'attackerRetreated') {
    music.setMode('calm');
    career.bump('repelled');
    career.award(40, '습격 격퇴');
    sfx.play('victory');
    const title = status === 'attackerRetreated' ? '적 함대 철수' : '습격 격퇴';
    if (away) notify('방어 성공', title, 'hwang', null); else banner({ kicker: '방어 성공', title, sub: `함대 ${fleet}`, tone: 'gold', ms: 2600 });
  } else if (status === 'raidSuccessful') {
    music.setMode('calm');
    sfx.play('defeat');
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
